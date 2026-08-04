const test = require('node:test');
const assert = require('node:assert/strict');
const { NaviPaySandboxService } = require('../src/sandbox');
const { createServer } = require('../src/server');
const { MemoryStore } = require('../src/store');

function makeService() {
  return new NaviPaySandboxService({ store: new MemoryStore(), clock: () => new Date('2026-01-01T10:00:00.000Z') });
}

const unsupportedQuantityRequests = [
  ['bare numeric', 'buy 2 Logitech mice', 2],
  ['bare cardinal', 'buy two Logitech mice', 2],
  ['quantity', 'buy quantity 2 Logitech mouse', 2],
  ['qty', 'buy qty 2 Logitech mouse', 2],
  ['zero', 'buy 0 Logitech mouse', 0],
  ['cardinal zero', 'buy zero Logitech mouse', 0],
  ['negative', 'buy -1 Logitech mouse', -1],
  ['decimal', 'buy 1.5 Logitech mouse', 1.5],
  ['unit', 'buy 2 units Logitech mouse', 2],
  ['item', 'buy 2 items Logitech mouse', 2]
];

function assertSafelyRejected(service, result, request, requestedQuantity) {
  const task = result.body.task;
  const projection = result.body.projection;
  assert.equal(result.statusCode, 409, request);
  assert.equal(task.state, 'failed', request);
  assert.equal(task.failure.code, 'QUANTITY_UNSUPPORTED', request);
  assert.equal(task.request.intent.quantity, requestedQuantity, request);
  assert.equal(task.quote, null, `${request} must stop before discovery`);
  assert.equal(task.inventory, null, `${request} must stop before inventory`);
  assert.equal(task.wallet, null, `${request} must stop before funding verification`);
  assert.equal(task.card, null, `${request} must stop before card issuance`);
  assert.equal(task.payment, null, `${request} must stop before payment`);
  assert.equal(task.order, null, `${request} must stop before order creation`);
  assert.equal(service.getWalletLedger().length, 0, `${request} must not debit the wallet`);
  assert.equal(Object.keys(service.store.data.kycEvents || {}).length, 0, `${request} must stop before KYC bootstrap`);
  assert.equal(projection.authorization.envelope.normalizedConstraints.quantity, requestedQuantity, request);
  assert.deepEqual(projection.authorization.decision.quantityDecision, {
    requested: requestedQuantity,
    authorized: 1,
    status: 'failed',
    code: 'QUANTITY_UNSUPPORTED',
    reason: 'This authorization permits exactly one unit; the requested quantity was not authorized.'
  }, request);
  assert.equal(projection.authorization.decision.checks.quantityPolicy.status, 'failed', request);
}

test('service parses every explicit quantity form and rejects unsupported quantities before side effects', () => {
  for (const [label, request, requestedQuantity] of unsupportedQuantityRequests) {
    const service = makeService();
    const result = service.startPurchase({ idempotencyKey: `quantity-${label}`, request });
    assertSafelyRejected(service, result, request, requestedQuantity);
  }
});

test('the existing one-unit policy still permits implicit and explicit one-unit requests', () => {
  for (const [label, request] of [
    ['implicit', 'buy a Logitech mouse'],
    ['numeric one', 'buy 1 Logitech mouse'],
    ['cardinal one', 'buy one Logitech mouse'],
    ['unit one', 'buy 1 unit Logitech mouse'],
    ['item one', 'buy 1 item Logitech mouse'],
    ['quantity one', 'buy quantity 1 Logitech mouse'],
    ['qty one', 'buy qty 1 Logitech mouse']
  ]) {
    const service = makeService();
    const result = service.startPurchase({ idempotencyKey: `one-${label}`, request });
    assert.equal(result.statusCode, 201, request);
    assert.equal(result.body.task.request.intent.quantity, 1, request);
    assert.equal(result.body.task.state, 'completed', request);
    assert.equal(result.body.projection.authorization.decision.quantityDecision.status, 'passed', request);
    assert.equal(service.getWalletLedger().length, 2, request);
  }
});

test('HTTP purchase run returns a redacted quantity rejection with no side effects', async () => {
  const service = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/purchases/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'quantity-http-e2e' },
      body: JSON.stringify({ request: 'buy 2 Logitech mice' })
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assertSafelyRejected(service, { statusCode: response.status, body: payload }, 'buy 2 Logitech mice', 2);
    assert.equal(payload.projection.authorization.decision.candidate, null);
    assert.doesNotMatch(JSON.stringify(payload), /pan|cvv|cardNumber|credentials/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
