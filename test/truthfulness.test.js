const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { NaviPaySandboxService } = require('../src/sandbox');
const { JsonStore, MemoryStore } = require('../src/store');

async function withHttpService(callback) {
  const service = new NaviPaySandboxService({ store: new MemoryStore() });
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, key, body) {
  const response = await fetch(`${base}/api/purchases/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body)
  });
  return { status: response.status, payload: await response.json() };
}

test('HTTP no-match is task-scoped and cannot display a prior purchase balance or lifecycle', async () => {
  await withHttpService(async (base) => {
    const success = await post(base, 'truth-success', { request: 'I want a mouse' });
    const noMatch = await post(base, 'truth-no-match', { request: 'Find a quantum toaster' });
    assert.equal(success.status, 201);
    assert.equal(noMatch.status, 409);
    assert.equal(noMatch.payload.task.state, 'failed');
    assert.equal(noMatch.payload.task.failure.code, 'NO_LOCAL_MATCHES');
    assert.equal(noMatch.payload.projection.financial.outcome, 'no_match');
    assert.equal(noMatch.payload.projection.financial.finalBalanceMinor, null);
    assert.equal(noMatch.payload.projection.wallet, null);
    assert.deepEqual(noMatch.payload.projection.progress.filter((item) => ['inventory', 'payment', 'order', 'fulfillment', 'delivery', 'receipt'].includes(item.stage)).map((item) => item.status), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    assert.notEqual(noMatch.payload.projection.financial.finalBalanceMinor, success.payload.projection.financial.finalBalanceMinor);
  });
});

test('local scenarios preserve hard constraints, explicit outcomes, quote snapshots, and idempotent replay', () => {
  const noMatch = new NaviPaySandboxService({ store: new MemoryStore() }).startPurchase({ idempotencyKey: 'scenario-no-match', request: 'Find an Apple Magic Keyboard', scenario: 'no-match' });
  assert.equal(noMatch.body.task.failure.code, 'NO_LOCAL_MATCHES');

  const overBudgetService = new NaviPaySandboxService({ store: new MemoryStore() });
  const overBudget = overBudgetService.startPurchase({ idempotencyKey: 'scenario-budget', request: 'Find a keyboard under XSGD 100.00' });
  assert.equal(overBudget.body.task.failure.code, 'SPENDING_CEILING_EXCEEDED');
  assert.equal(overBudget.body.task.financial.outcome, 'over_budget');
  assert.equal(overBudgetService.getWalletLedger().length, 0);

  const constrainedService = new NaviPaySandboxService({ store: new MemoryStore() });
  const constrained = constrainedService.startPurchase({ idempotencyKey: 'scenario-brand-stock', request: 'Find a Razer mouse' });
  assert.equal(constrained.body.task.failure.code, 'OUT_OF_STOCK');
  assert.deepEqual(constrained.body.task.quote.candidates.map((candidate) => candidate.brand), ['Razer']);
  assert.equal(constrainedService.getWalletLedger().length, 0);

  const ambiguous = new NaviPaySandboxService({ store: new MemoryStore() }).startPurchase({ idempotencyKey: 'scenario-ambiguity', request: 'Find a keyboard', scenario: 'ambiguity' });
  assert.equal(ambiguous.body.task.state, 'awaiting_selection');
  assert.equal(ambiguous.body.task.progress.find((item) => item.stage === 'inventory').status, 'not_started');

  const lowBalanceService = new NaviPaySandboxService({ store: new MemoryStore() });
  const lowBalance = lowBalanceService.startPurchase({ idempotencyKey: 'scenario-low-balance', request: 'Find a keyboard', scenario: 'low-balance' });
  assert.equal(lowBalance.body.task.failure.code, 'INSUFFICIENT_FUNDS');
  assert.equal(lowBalance.body.task.financial.balanceBeforeMinor, 50000);
  assert.equal(lowBalance.body.task.financial.finalBalanceMinor, 50000);
  assert.equal(lowBalanceService.getWalletLedger().length, 0);

  const successfulService = new NaviPaySandboxService({ store: new MemoryStore() });
  const successful = successfulService.startPurchase({ idempotencyKey: 'scenario-receipt', request: 'Find an Apple Magic Keyboard' });
  const task = successful.body.task;
  assert.equal(task.quote.quoteStatus, 'locked');
  assert.ok(task.quote.quoteId);
  assert.ok(task.quote.cartId);
  assert.equal(task.quote.lineSnapshot.length, 1);
  assert.match(task.quote.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(task.receipt.subtotalMinor + task.receipt.shippingMinor + task.receipt.taxMinor, task.receipt.totalMinor);
  assert.equal(task.receipt.paymentStatus, 'authorized');
  assert.equal(task.receipt.orderStatus, 'confirmed');
  assert.equal(task.receipt.fulfillmentStatus, 'fulfilled');
  assert.equal(task.receipt.deliveryStatus, 'delivered');
  assert.equal(task.receipt.balanceBeforeMinor, 50000);
  assert.equal(task.receipt.finalBalanceMinor, 50000 - task.quote.totalMinor);
  const replay = successfulService.startPurchase({ idempotencyKey: 'scenario-receipt', request: 'Find an Apple Magic Keyboard' });
  assert.equal(replay.replayed, true);
  assert.equal(successfulService.getWalletLedger().length, 2);
});

test('checkpoint reload restores only a process-local card capability and recovers the purchase', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-truthful-checkpoint-'));
  const filePath = path.join(directory, 'state.json');
  try {
    let service = new NaviPaySandboxService({ store: new JsonStore(filePath) });
    const checkpoint = service.startPurchase({ idempotencyKey: 'checkpoint-card', request: 'Find an Apple Magic Keyboard', scenario: 'card-issued-before-checkout' });
    const taskId = checkpoint.body.task.id;
    assert.equal(checkpoint.body.task.state, 'card_issued');
    assert.equal(service.getWalletLedger().length, 0);
    assert.doesNotMatch(JSON.stringify(service.store.data), /pan|cvv/i);

    service = new NaviPaySandboxService({ store: new JsonStore(filePath) });
    const recovered = service.resumePurchase(taskId, 'checkpoint-resume');
    assert.equal(recovered.body.task.state, 'completed');
    assert.equal(recovered.body.task.receipt.status, 'confirmed');
    assert.equal(service.getWalletLedger().length, 2);
    assert.doesNotMatch(JSON.stringify(recovered), /pan|cvv|cardNumber|credentials/i);

    const reloaded = new NaviPaySandboxService({ store: new JsonStore(filePath) });
    assert.equal(reloaded.getTask(taskId).receipt.status, 'confirmed');
    assert.equal(reloaded.getWalletLedger().length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('order and inventory commit failure is recoverable without a confirmed order', () => {
  const service = new NaviPaySandboxService({ store: new MemoryStore() });
  const result = service.startPurchase({ idempotencyKey: 'scenario-commit-failure', request: 'Find a mouse', scenario: 'order-commit-failure' });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.task.failure.code, 'INVENTORY_COMMIT_FAILED');
  assert.equal(result.body.task.order.status, 'failed');
  assert.equal(result.body.task.inventory.reservation.status, 'released');
  assert.equal(result.body.task.payment.status, 'compensated');
  assert.equal(service.getWallet().balanceMinor, 50000);
  assert.equal(service.getWalletLedger().length, 4);
});
