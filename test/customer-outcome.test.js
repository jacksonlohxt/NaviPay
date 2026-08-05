const test = require('node:test');
const assert = require('node:assert/strict');
const { NaviPaySandboxService } = require('../src/sandbox');
const { MemoryStore } = require('../src/store');

function makeService(options = {}) {
  return new NaviPaySandboxService({ store: new MemoryStore(), ...options });
}

function run(service, key, body = {}) {
  return service.startPurchase({ idempotencyKey: key, request: Object.prototype.hasOwnProperty.call(body, 'request') ? body.request : 'I want a mouse', scenario: body.scenario || 'happy' });
}

function assertNoPurchase(projection) {
  assert.equal(projection.customerOutcome.purchaseEntered, false);
  assert.equal(projection.customerOutcome.sideEffects.payment.status, 'not_started');
  assert.equal(projection.customerOutcome.sideEffects.order.status, 'not_started');
  assert.equal(projection.customerOutcome.sideEffects.receipt.status, 'not_started');
  assert.equal(projection.customerOutcome.sideEffects.delivery.status, 'not_started');
  assert.ok(projection.progress.filter((item) => ['payment', 'order', 'fulfillment', 'delivery', 'receipt'].includes(item.stage)).every((item) => ['skipped', 'not_started'].includes(item.status)));
}

test('customer outcome projection is versioned and describes processing, delivery, and side effects', () => {
  const service = makeService();
  const created = service.createTask({ request: 'I want a mouse' });
  const processing = service.getTaskProjection(created.id);
  assert.equal(processing.customerOutcome.version, 1);
  assert.equal(processing.customerOutcome.code, 'processing');
  assert.equal(processing.customerOutcome.tone, 'warning');
  assert.match(processing.customerOutcome.message, /next update/i);
  assert.equal(processing.customerOutcome.sideEffects.payment.status, 'not_started');
  assert.equal(processing.customerOutcome.sideEffects.order.status, 'not_started');
  assert.ok(processing.customerOutcome.sideEffectsSummary.length >= 5);

  const delivered = run(service, 'outcome-delivered');
  assert.equal(delivered.body.projection.customerOutcome.code, 'delivered');
  assert.equal(delivered.body.projection.customerOutcome.sideEffects.payment.status, 'paid');
  assert.equal(delivered.body.projection.customerOutcome.sideEffects.order.status, 'confirmed');
  assert.equal(delivered.body.projection.customerOutcome.sideEffects.delivery.status, 'delivered');
  assert.equal(delivered.body.projection.customerOutcome.sideEffects.receipt.status, 'ready');
});

test('delivery pending and delivery failure remain distinct from a delivered purchase', () => {
  const pendingService = makeService({
    adapters: {
      delivery: {
        deliver() {
          return { status: 'pending', reference: 'DELIVERY-PENDING', trackingReference: null, attemptedAt: new Date().toISOString(), deliveredAt: null };
        }
      }
    }
  });
  const pending = run(pendingService, 'outcome-delivery-pending');
  assert.equal(pending.body.projection.customerOutcome.code, 'delivery_pending');
  assert.match(pending.body.projection.customerOutcome.title, /delivery pending/i);
  assert.equal(pending.body.projection.customerOutcome.sideEffects.delivery.status, 'pending');
  assert.equal(pending.body.projection.customerOutcome.sideEffects.order.status, 'confirmed');

  const failed = run(makeService(), 'outcome-delivery-failed', { scenario: 'delivery-failure' });
  assert.equal(failed.body.projection.customerOutcome.code, 'delivery_failed');
  assert.equal(failed.body.projection.customerOutcome.sideEffects.payment.status, 'paid');
  assert.equal(failed.body.projection.customerOutcome.sideEffects.order.status, 'confirmed');
  assert.equal(failed.body.projection.customerOutcome.sideEffects.delivery.status, 'failed');
});

test('unknown payment tells the customer what is safe and exposes only reconciliation', () => {
  const service = makeService();
  const result = run(service, 'outcome-unknown', { scenario: 'unknown-payment' });
  const projection = result.body.projection;
  assert.equal(projection.customerOutcome.code, 'payment_unknown');
  assert.match(projection.customerOutcome.message, /automatic retry/i);
  assert.equal(projection.customerOutcome.sideEffects.payment.status, 'needs_confirmation');
  assert.equal(projection.customerOutcome.sideEffects.order.status, 'not_started');
  assert.equal(projection.customerOutcome.sideEffects.receipt.status, 'not_started');
  assert.deepEqual(projection.nextActions.filter((action) => action.enabled).map((action) => action.id), ['new_purchase', 'reconcile_payment', 'view_details']);
  assert.equal(projection.nextActions.find((action) => action.id === 'reconcile_payment').label, 'Check payment status');
  assert.match(projection.nextActions.find((action) => action.id === 'reconcile_payment').policyReason, /retry/i);
});

test('refund and reversal keep original receipt facts separate from current payment adjustment', () => {
  for (const [kind, code] of [['refund', 'refund'], ['reversal', 'reversal']]) {
    const service = makeService();
    const completed = run(service, `outcome-${kind}`);
    const taskId = completed.body.task.id;
    const originalTotal = completed.body.task.quote.totalMinor;
    const adjusted = service.refundPayment(taskId, `adjust-${kind}`, kind);
    const projection = adjusted.body.projection;
    assert.equal(projection.customerOutcome.code, code);
    assert.equal(projection.receipt.captureSnapshot.amountMinor, originalTotal);
    assert.equal(projection.receipt.captureSnapshot.paymentStatus, 'authorized');
    assert.equal(projection.receipt.adjustment.kind, kind);
    assert.equal(projection.receipt.adjustment.netChargedMinor, 0);
    assert.equal(projection.financial.netChargedMinor, 0);
    assert.equal(projection.customerOutcome.adjustment.netChargedMinor, 0);
  }
});

test('no-purchase outcomes are explicit and never inherit another task financial state', () => {
  const cases = [
    ['no-match', { request: 'Find a quantum toaster', scenario: 'no-match' }, 'no_match'],
    ['ambiguity', { request: 'Find a keyboard', scenario: 'ambiguity' }, 'ambiguity'],
    ['over-budget', { request: 'Find a keyboard', scenario: 'over-budget' }, 'over_budget'],
    ['out-of-stock', { request: 'Find a Razer mouse', scenario: 'out-of-stock' }, 'out_of_stock'],
    ['insufficient-funds', { request: 'Find a keyboard', scenario: 'insufficient-funds' }, 'insufficient_funds'],
    ['declined', { request: 'Find a keyboard', scenario: 'payment-decline' }, 'declined_payment'],
    ['invalid', { request: '', scenario: 'happy' }, 'invalid_request']
  ];
  for (const [key, body, expectedCode] of cases) {
    const service = makeService();
    const result = run(service, `outcome-${key}`, body);
    assert.equal(result.body.projection.customerOutcome.code, expectedCode, key);
    if (expectedCode !== 'declined_payment') assertNoPurchase(result.body.projection);
    const expectedBalance = ['insufficient_funds', 'declined_payment'].includes(expectedCode) ? 50000 : null;
    assert.equal(result.body.projection.financial.finalBalanceMinor, expectedBalance, key);
    assert.equal(result.body.projection.wallet?.finalBalanceMinor ?? null, expectedBalance, key);
    assert.ok(result.body.projection.nextActions.every((action) => action.id && action.enabled !== undefined && action.policyReason), key);
  }
});

test('payment returned after an order failure is truthful without claiming a receipt or order', () => {
  const result = run(makeService(), 'outcome-compensated', { request: 'I want a keyboard', scenario: 'order-failure' });
  const projection = result.body.projection;
  assert.equal(projection.customerOutcome.code, 'payment_returned');
  assert.equal(projection.customerOutcome.sideEffects.payment.status, 'returned');
  assert.equal(projection.customerOutcome.sideEffects.order.status, 'not_confirmed');
  assert.equal(projection.customerOutcome.sideEffects.receipt.status, 'not_started');
  assert.equal(projection.receipt, null);
});
