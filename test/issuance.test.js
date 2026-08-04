const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NaviPaySandboxService } = require('../src/sandbox');
const { createServer } = require('../src/server');
const { JsonStore, MemoryStore } = require('../src/store');

function service(store = new MemoryStore()) {
  return new NaviPaySandboxService({ store });
}

function run(sandbox, scenario = 'happy', key = `issuance-${scenario}`) {
  return sandbox.startPurchase({ idempotencyKey: key, request: 'Find an Apple Magic Keyboard', scenario });
}

test('issuer-backed success captures once, retires the card, and records safe lifecycle states', () => {
  const sandbox = service();
  const result = run(sandbox);
  const task = result.body.task;
  assert.equal(result.statusCode, 201);
  assert.equal(task.state, 'completed');
  assert.equal(task.paymentMode, 'issuer_authorization');
  assert.equal(task.payment.status, 'authorized');
  assert.equal(task.card.status, 'retired');
  assert.equal(task.card.captureCount, 1);
  assert.equal(task.card.scope.maxCaptures, 1);
  assert.equal(task.card.scope.mcc, '5732');
  assert.ok(task.payment.authorizationReference);
  assert.ok(task.payment.captureReference);
  assert.deepEqual(sandbox.getWalletLedger().map((entry) => entry.entry), ['debit', 'credit']);
  assert.deepEqual(task.lifecycle.map((entry) => entry.state), [
    'created', 'card_issuing', 'card_issued', 'browser_started', 'checkout_submitted',
    'authorized', 'captured', 'card_retired', 'order_confirmed', 'fulfillment', 'delivery', 'receipt', 'completed'
  ]);
  assert.equal(sandbox.store.data.workerRuns[`op_${task.id}_checkout_worker`].cleanup, 'completed');
});

test('decline, unknown, timeout, scope, expiry, and browser crash outcomes never double debit', () => {
  for (const [scenario, code] of [
    ['decline', 'PAYMENT_DECLINED'],
    ['wrong-merchant', 'WRONG_MERCHANT'],
    ['amount-overage', 'AMOUNT_EXCEEDS_SCOPE'],
    ['expired-card', 'CARD_EXPIRED'],
    ['browser-crash', 'CHECKOUT_WORKER_CRASHED']
  ]) {
    const sandbox = service();
    const result = run(sandbox, scenario);
    assert.equal(result.body.task.failure.code, code, scenario);
    assert.equal(sandbox.getWalletLedger().length, 0, scenario);
    assert.equal(result.body.task.card.status, 'retired', scenario);
    assert.equal(result.body.task.checkoutWorker.cleanup, 'completed', scenario);
    assert.equal(result.body.task.inventory.reservation.status, 'released', scenario);
  }
  for (const scenario of ['unknown', 'timeout', 'unknown-payment']) {
    const sandbox = service();
    const result = run(sandbox, scenario);
    assert.equal(result.body.task.state, 'reconciliation_required', scenario);
    assert.equal(result.body.task.checkout.status, 'unknown', scenario);
    assert.equal(sandbox.getWalletLedger().length, 0, scenario);
    assert.equal(result.body.task.lifecycle.includes(undefined), false);
  }
});

test('unknown capture reconciliation is idempotent and never retries checkout', () => {
  const sandbox = service();
  const first = run(sandbox, 'timeout', 'timeout-once');
  const task = first.body.task;
  const reconciled = sandbox.reconcilePayment(task.id, 'reconcile-once', 'authorized');
  assert.equal(reconciled.body.task.state, 'completed');
  assert.equal(reconciled.body.task.card.status, 'retired');
  assert.equal(reconciled.body.task.payment.status, 'authorized');
  assert.equal(sandbox.getWalletLedger().length, 2);
  const replay = sandbox.reconcilePayment(task.id, 'reconcile-once', 'authorized');
  assert.equal(replay.replayed, true);
  assert.equal(sandbox.getWalletLedger().length, 2);
});

test('duplicate submission and refund or reversal are persisted exactly once', () => {
  for (const kind of ['refund', 'reversal']) {
    const sandbox = service();
    const result = run(sandbox, 'duplicate', `duplicate-${kind}`);
    const task = result.body.task;
    const before = sandbox.getWalletLedger().length;
    const reversed = sandbox.refundPayment(task.id, `action-${kind}`, kind);
    assert.equal(reversed.body.task.payment.status, kind === 'refund' ? 'refunded' : 'reversed');
    assert.equal(sandbox.getWalletLedger().length, before + 2);
    assert.equal(sandbox.getCheckoutWebhooks().at(-1).type, kind === 'refund' ? 'payment.refunded' : 'payment.reversed');
    const replay = sandbox.refundPayment(task.id, `action-${kind}`, kind);
    assert.equal(replay.replayed, true);
    assert.equal(sandbox.getWalletLedger().length, before + 2);
  }
});

test('reload keeps safe issuer state and receipt without a disposable credential', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-issuer-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const first = service(new JsonStore(filePath));
    const result = run(first, 'happy', 'reload-issuer');
    const taskId = result.body.task.id;
    const second = service(new JsonStore(filePath));
    const task = second.getTask(taskId);
    const projection = second.getTaskProjection(taskId);
    const serialized = JSON.stringify({ task, projection, audit: second.getAudit(taskId), state: second.store.data });
    assert.equal(second.getCardStatus(task.card.cardId).status, 'retired');
    assert.equal(second.getReceipt(taskId).status, 'confirmed');
    assert.doesNotMatch(serialized, /pan|cvv|cardNumber|security.?code|rawProviderPayload|credentials/i);
    assert.equal(projection.card.maskedReference, task.card.maskedReference);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP exposes safe card, checkout, webhook, refund, and receipt contracts', async () => {
  const sandbox = service();
  const server = createServer({ service: sandbox });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/purchases/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'http-issuer' },
      body: JSON.stringify({ request: 'Find an Apple Magic Keyboard' })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    const task = payload.task;
    const card = await fetch(`${base}/api/tasks/${task.id}/card`).then((value) => value.json());
    const session = await fetch(`${base}/api/checkout/sessions/${task.checkout.checkoutReference}`).then((value) => value.json());
    const webhooks = await fetch(`${base}/api/checkout/webhooks?sessionId=${task.checkout.checkoutReference}`).then((value) => value.json());
    const receipt = await fetch(`${base}/api/tasks/${task.id}/receipt`).then((value) => value.json());
    assert.equal(card.card.status, 'retired');
    assert.equal(session.session.status, 'authorized');
    assert.ok(webhooks.webhooks.some((event) => event.type === 'checkout.captured'));
    assert.equal(receipt.receipt.captureReference, task.payment.captureReference);
    assert.doesNotMatch(JSON.stringify({ payload, card, session, webhooks, receipt }), /pan|cvv|cardNumber|rawProviderPayload|credentials/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
