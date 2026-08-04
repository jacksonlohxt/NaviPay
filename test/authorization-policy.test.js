const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NaviPaySandboxService } = require('../src/sandbox');
const { createServer } = require('../src/server');
const { JsonStore, MemoryStore } = require('../src/store');

function makeService(store = new MemoryStore()) {
  return new NaviPaySandboxService({ store, clock: () => new Date('2026-01-01T10:00:00.000Z') });
}

function run(request, scenario = 'happy', store = new MemoryStore()) {
  const service = makeService(store);
  const result = service.startPurchase({ idempotencyKey: `policy-${scenario}-${request}`, request, scenario });
  return { service, result, task: result.body.task };
}

function assertNoFinancialSideEffects(service, task) {
  assert.equal(task.card, null, 'a card must not be issued before authorization approval');
  assert.equal(task.payment, null, 'payment must not be attempted before authorization approval');
  assert.equal(task.order, null, 'order must not be created before authorization approval');
  assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 0, 'the wallet must not be debited before authorization approval');
}

test('end-user HTTP run completes a concrete Logitech mouse instruction and returns safe evidence', async () => {
  const server = createServer({ service: makeService() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/purchases/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'policy-http-logitech' },
      body: JSON.stringify({ request: 'buy a Logitech mouse' })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.task.state, 'completed');
    assert.equal(payload.task.quote.item, 'Logitech MX Master 3S');
    assert.equal(payload.task.authorizationDecision.status, 'approved');
    assert.equal(payload.task.payment.status, 'authorized');
    assert.equal(payload.task.order.status, 'confirmed');
    assert.equal(payload.task.receipt.status, 'confirmed');
    assert.doesNotMatch(JSON.stringify(payload), /pan|cvv|cardNumber|rawProviderPayload|credentials/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authorizes and completes the exact Logitech mouse instruction with an auditable envelope', () => {
  const { service, result, task } = run('buy a Logitech mouse');
  assert.equal(result.statusCode, 201);
  assert.equal(task.state, 'completed');
  assert.deepEqual(task.request.intent, {
    normalized: 'buy a logitech mouse',
    brand: 'Logitech',
    product: null,
    productCategory: 'mice',
    quantity: 1,
    currency: 'XSGD',
    keywords: ['logitech', 'mouse'],
    budgetMinor: null,
    budget: null
  });
  assert.equal(task.authorizationEnvelope.purpose, 'one_purchase');
  assert.equal(task.authorizationEnvelope.originalInstruction, 'buy a Logitech mouse');
  assert.equal(task.authorizationEnvelope.normalizedConstraints.spendingCeilingMinor, 100000);
  assert.equal(task.authorizationEnvelope.normalizedConstraints.currency, 'XSGD');
  assert.ok(task.authorizationEnvelope.normalizedConstraints.merchantScope.length > 0);
  assert.equal(task.authorizationDecision.status, 'approved');
  assert.equal(task.authorizationDecision.code, 'AUTHORIZATION_APPROVED');
  assert.equal(task.authorizationDecision.candidate.item, 'Logitech MX Master 3S');
  assert.equal(task.card.status, 'retired');
  assert.equal(task.card.scope.amountMinor, task.quote.totalMinor);
  assert.equal(task.card.scope.currency, 'XSGD');
  assert.equal(task.card.scope.maxCaptures, 1);
  assert.equal(task.payment.status, 'authorized');
  assert.equal(task.order.status, 'confirmed');
  assert.equal(task.delivery.status, 'delivered');
  assert.equal(task.receipt.status, 'confirmed');
  assert.doesNotMatch(JSON.stringify(result.body), /pan|cvv|cardNumber|rawProviderPayload|credentials/i);
});

test('hard constraints and ambiguity stop before card issuance', () => {
  const outOfStock = run('buy a Razer mouse');
  assert.equal(outOfStock.task.failure.code, 'OUT_OF_STOCK');
  assert.equal(outOfStock.task.authorizationDecision.status, 'rejected');
  assertNoFinancialSideEffects(outOfStock.service, outOfStock.task);
  assert.deepEqual(outOfStock.task.quote.candidates.map((candidate) => candidate.brand), ['Razer']);

  const ambiguous = run('buy a Logitech mouse', 'ambiguous-same-brand');
  assert.equal(ambiguous.task.state, 'awaiting_selection');
  assert.equal(ambiguous.task.authorizationDecision.status, 'paused');
  assert.equal(ambiguous.task.authorizationDecision.code, 'AMBIGUOUS_MATCH');
  assert.ok(ambiguous.task.quote.candidates.every((candidate) => candidate.brand === 'Logitech'));
  assertNoFinancialSideEffects(ambiguous.service, ambiguous.task);
});

test('missing product type, explicit budget, default ceiling, stale quote, and policy blocks are safe', () => {
  const missing = run('buy Logitech');
  assert.equal(missing.task.failure.code, 'MISSING_PRODUCT_TYPE');
  assertNoFinancialSideEffects(missing.service, missing.task);

  const overBudget = run('buy a Logitech mouse under XSGD 50.00');
  assert.equal(overBudget.task.failure.code, 'SPENDING_CEILING_EXCEEDED');
  assert.equal(overBudget.task.authorizationDecision.code, 'SPENDING_CEILING_EXCEEDED');
  assert.equal(overBudget.task.budget.requestedMinor, 5000);
  assertNoFinancialSideEffects(overBudget.service, overBudget.task);

  const defaultCeiling = run('buy a Logitech mouse');
  assert.equal(defaultCeiling.task.authorizationEnvelope.normalizedConstraints.explicitBudgetMinor, null);
  assert.equal(defaultCeiling.task.authorizationEnvelope.normalizedConstraints.spendingCeilingMinor, 100000);

  const stale = run('buy a Logitech mouse', 'stale-quote');
  assert.equal(stale.task.failure.code, 'QUOTE_EXPIRED');
  assert.equal(stale.task.authorizationDecision.status, 'rejected');
  assertNoFinancialSideEffects(stale.service, stale.task);

  const blocked = run('buy a Logitech mouse', 'merchant-category-violation');
  assert.equal(blocked.task.failure.code, 'MERCHANT_CATEGORY_NOT_ALLOWED');
  assert.equal(blocked.task.authorizationDecision.code, 'MERCHANT_CATEGORY_NOT_ALLOWED');
  assertNoFinancialSideEffects(blocked.service, blocked.task);
});

test('KYC and simulated funding gates reject before card issuance', () => {
  for (const scenario of ['pending-kyc', 'rejected-kyc', 'insufficient-funding']) {
    const { service, task } = run('buy a Logitech mouse', scenario);
    assert.equal(task.card, null, scenario);
    assert.equal(task.payment, null, scenario);
    assert.equal(task.order, null, scenario);
    assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 0, scenario);
    assert.equal(task.authorizationDecision.status, scenario === 'pending-kyc' ? 'paused' : 'rejected', scenario);
  }

  const explicitlyPending = makeService();
  explicitlyPending.simulateKycDecision('policy-explicit-pending', 'pending');
  const pendingRun = explicitlyPending.startPurchase({ idempotencyKey: 'policy-explicit-pending-run', request: 'buy a Logitech mouse' });
  assert.equal(pendingRun.body.task.authorizationDecision.code, 'KYC_NOT_APPROVED');
  assert.equal(pendingRun.body.task.card, null);
});

test('duplicate, decline, timeout reconciliation, and restart recovery preserve authorization boundaries', () => {
  const duplicate = run('buy a Logitech mouse', 'duplicate-instruction');
  assert.equal(duplicate.task.authorizationDecision.code, 'DUPLICATE_INSTRUCTION');
  assertNoFinancialSideEffects(duplicate.service, duplicate.task);

  const decline = run('buy a Logitech mouse', 'decline');
  assert.equal(decline.task.authorizationDecision.status, 'approved');
  assert.equal(decline.task.card.status, 'retired');
  assert.equal(decline.task.payment.status, 'declined');
  assert.equal(decline.task.order, null);
  assert.equal(decline.service.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 0);

  const timeout = run('buy a Logitech mouse', 'timeout');
  assert.equal(timeout.task.state, 'reconciliation_required');
  assert.equal(timeout.task.authorizationDecision.status, 'approved');
  assert.equal(timeout.task.card.status, 'pending_reconciliation');
  assert.equal(timeout.service.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 0);
  const reconciled = timeout.service.reconcilePayment(timeout.task.id, 'policy-reconcile', 'authorized');
  assert.equal(reconciled.body.task.receipt.status, 'confirmed');
  assert.equal(timeout.service.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 2);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-policy-restart-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const first = makeService(new JsonStore(filePath));
    const checkpoint = first.startPurchase({ idempotencyKey: 'policy-checkpoint', request: 'buy a Logitech mouse', scenario: 'card-issued-before-checkout' });
    assert.equal(checkpoint.body.task.state, 'card_issued');
    assert.equal(first.getWalletLedger().filter((entry) => entry.kind === 'payment').length, 0);
    const second = makeService(new JsonStore(filePath));
    const recovered = second.resumePurchase(checkpoint.body.task.id, 'policy-checkpoint-resume');
    assert.equal(recovered.body.task.receipt.status, 'confirmed');
    assert.equal(recovered.body.task.authorizationDecision.status, 'approved');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
