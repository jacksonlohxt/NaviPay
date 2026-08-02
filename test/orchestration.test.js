const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NaviPayService } = require('../src/domain');
const { createServer } = require('../src/server');
const { JsonStore, MemoryStore } = require('../src/store');
const { MockCheckoutAdapter, MockDiscoveryAdapter, MockFundingAdapter, MockIssuerAdapter } = require('../src/adapters');

function makeService({ checkoutAdapter } = {}) {
  const adapters = {
    funding: new MockFundingAdapter(),
    discovery: new MockDiscoveryAdapter(),
    issuer: new MockIssuerAdapter(),
    checkout: checkoutAdapter || new MockCheckoutAdapter()
  };
  return {
    adapters,
    service: new NaviPayService({
      store: new MemoryStore(),
      fundingAdapter: adapters.funding,
      discoveryAdapter: adapters.discovery,
      issuerAdapter: adapters.issuer,
      checkoutAdapter: adapters.checkout
    })
  };
}

async function httpJson(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, payload: await response.json() };
}

test('orchestrates the Apple request to a persisted receipt in one idempotent run', () => {
  const { service, adapters } = makeService();
  const first = service.startPurchase({ idempotencyKey: 'apple-run', request: 'I want Apple earphones' });
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.task.state, 'completed');
  assert.equal(first.body.task.automation.status, 'completed');
  assert.equal(first.body.task.automation.automatic, true);
  assert.equal(first.body.task.quote.recommendation.autoSelectable, true);
  assert.equal(first.body.task.quote.lockedSnapshot.item, 'Apple AirPods 4');
  assert.equal(first.body.task.receipt.item, 'Apple AirPods 4');
  assert.match(first.body.task.receipt.disclosure, /DEMO \/ MOCK/);
  assert.equal(adapters.checkout.calls, 1);
  const replay = service.startPurchase({ idempotencyKey: 'apple-run', request: 'I want Apple earphones' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.body.task.id, first.body.task.id);
  assert.equal(adapters.checkout.calls, 1);
  assert.ok(service.getAudit(first.body.task.id).some((event) => event.type === 'task.completed'));
  assert.equal(service.getReceipt(first.body.task.id).captureReference, first.body.task.receipt.captureReference);
});

test('pauses only ambiguous requests and resumes after candidate selection', () => {
  const { service } = makeService();
  const started = service.startPurchase({ idempotencyKey: 'ambiguous-run', request: 'I want earphones' });
  const task = started.body.task;
  assert.equal(task.state, 'quoted');
  assert.equal(task.automation.status, 'awaiting_selection');
  assert.equal(task.quote.locked, false);
  assert.equal(task.quote.recommendation.status, 'ambiguous');
  const selected = task.quote.candidates[1];
  const resumed = service.orchestrateTask(task.id, 'ambiguous-selection', { candidateId: selected.id });
  assert.equal(resumed.statusCode, 200);
  assert.equal(resumed.body.task.state, 'completed');
  assert.equal(resumed.body.task.quote.selectedCandidateId, selected.id);
  assert.equal(resumed.body.task.receipt.item, selected.item);
});

test('keeps over-cap automation safe until the operator confirms the quote, then stops at policy', () => {
  const { service } = makeService();
  const started = service.startPurchase({ idempotencyKey: 'cap-run', scenario: 'over-cap' });
  const task = started.body.task;
  assert.equal(task.state, 'quoted');
  assert.equal(task.automation.status, 'awaiting_selection');
  const resumed = service.orchestrateTask(task.id, 'cap-selection', { candidateId: task.quote.candidates[0].id });
  assert.equal(resumed.statusCode, 422);
  assert.equal(resumed.body.task.state, 'failed');
  assert.equal(resumed.body.task.failure.code, 'SPENDING_CEILING_EXCEEDED');
  assert.equal(resumed.body.task.receipt, null);
});

test('orchestrated unknown checkout is persisted for reconciliation without retry', () => {
  const { service, adapters } = makeService();
  const started = service.startPurchase({ idempotencyKey: 'unknown-run', scenario: 'unknown-checkout' });
  const task = started.body.task;
  assert.equal(task.state, 'reconciliation_required');
  assert.equal(task.automation.status, 'awaiting_reconciliation');
  assert.equal(task.receipt, null);
  const replay = service.orchestrateTask(task.id, 'unknown-run-again');
  assert.equal(replay.body.task.state, 'reconciliation_required');
  assert.equal(adapters.checkout.calls, 1);
  const resolved = service.reconcileCheckout(task.id, 'unknown-resolve', 'authorized');
  assert.equal(resolved.body.task.state, 'completed');
  assert.equal(resolved.body.task.automation.status, 'completed');
  assert.equal(resolved.body.task.receipt.status, 'confirmed');
  assert.equal(adapters.checkout.calls, 1);
});

test('orchestration stops safely at every deterministic provider exception', () => {
  for (const scenario of ['funding-failure', 'discovery-failure', 'issuer-failure', 'checkout-failure']) {
    const { service } = makeService();
    const result = service.startPurchase({ idempotencyKey: `failure-${scenario}`, scenario });
    assert.equal(result.body.task.state, 'failed', scenario);
    assert.equal(result.body.task.automation.status, 'stopped', scenario);
    assert.equal(result.body.task.receipt, null, scenario);
  }
});

test('HTTP run endpoint supports reload, receipt retrieval, and idempotent requests', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-orchestration-'));
  const filePath = path.join(directory, 'state.json');
  const service = new NaviPayService({ store: new JsonStore(filePath) });
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await httpJson(base, '/api/purchases/run', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'http-apple-run' },
      body: JSON.stringify({ request: 'I want Apple earphones' })
    });
    assert.equal(first.status, 201);
    assert.equal(first.payload.task.state, 'completed');
    assert.equal(first.payload.run.status, 'completed');
    const replay = await httpJson(base, '/api/purchases/run', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'http-apple-run' },
      body: JSON.stringify({ request: 'I want Apple earphones' })
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.payload.replayed, true);
    assert.equal(replay.payload.task.id, first.payload.task.id);
    const reloaded = new NaviPayService({ store: new JsonStore(filePath) });
    assert.equal(reloaded.getTask(first.payload.task.id).state, 'completed');
    const receipt = await httpJson(base, `/api/tasks/${first.payload.task.id}/receipt`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.payload.receipt.item, 'Apple AirPods 4');
    const audit = await httpJson(base, `/api/tasks/${first.payload.task.id}/audit`);
    assert.ok(audit.payload.events.some((event) => event.type === 'task.completed'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
