const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NaviPayService, TASK_CEILING_MINOR } = require('../src/domain');
const { createServer } = require('../src/server');
const { JsonStore, MemoryStore } = require('../src/store');
const { MockCheckoutAdapter, MockDiscoveryAdapter, MockFundingAdapter, MockIssuerAdapter } = require('../src/adapters');

function makeClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 10, 0, tick++));
}

function makeService({ checkoutAdapter, issuerAdapter } = {}) {
  const clock = makeClock();
  const adapters = {
    funding: new MockFundingAdapter({ clock }),
    discovery: new MockDiscoveryAdapter({ clock }),
    issuer: issuerAdapter || new MockIssuerAdapter({ clock }),
    checkout: checkoutAdapter || new MockCheckoutAdapter({ clock })
  };
  const service = new NaviPayService({
    store: new MemoryStore(),
    clock,
    fundingAdapter: adapters.funding,
    discoveryAdapter: adapters.discovery,
    issuerAdapter: adapters.issuer,
    checkoutAdapter: adapters.checkout
  });
  return { service, adapters };
}

function body(result) {
  assert.ok(result.body, 'action should return a response body');
  return result.body;
}

async function httpJson(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

function runToQuote(service, task, prefix = 'run') {
  service.openTask(task.id, `${prefix}-open`);
  service.verifyFunding(task.id, `${prefix}-funding`);
  service.discover(task.id, `${prefix}-discover`);
  return service.getTask(task.id);
}

function runToInstrument(service, task, prefix = 'run') {
  const quoted = runToQuote(service, task, prefix);
  service.lockQuote(task.id, `${prefix}-lock`, quoted.quote.recommendedCandidateId);
  const approval = service.approvePolicy(task.id, `${prefix}-policy`);
  assert.equal(approval.statusCode, 200);
  const issued = service.issueInstrument(task.id, `${prefix}-issue`);
  assert.equal(issued.statusCode, 200);
  return service.getTask(task.id);
}

test('runs the complete backend lifecycle and keeps audit evidence redacted', () => {
  const { service, adapters } = makeService();
  const task = service.createTask();
  assert.equal(task.state, 'created');
  service.openTask(task.id, 'lifecycle-open');

  const afterFunding = body(service.verifyFunding(task.id, 'same-funding-key')).task;
  assert.equal(afterFunding.state, 'funded');
  assert.equal(afterFunding.funding.onChain.status, 'verified');
  assert.equal(afterFunding.funding.settlement.status, 'simulated-ready');
  assert.notEqual(afterFunding.funding.onChain, afterFunding.funding.settlement);

  const quoted = runToQuote(service, task, 'lifecycle');
  assert.equal(quoted.state, 'quoted');
  assert.equal(quoted.quote.locked, false);
  service.lockQuote(task.id, 'lifecycle-lock', quoted.quote.recommendedCandidateId);
  const locked = service.getTask(task.id);
  assert.equal(locked.quote.locked, true);
  assert.equal(locked.quote.lockedSnapshot.merchant, 'Harbor Supply');

  const policy = service.approvePolicy(task.id, 'lifecycle-policy');
  assert.equal(policy.statusCode, 200);
  assert.equal(body(policy).task.state, 'policy_approved');
  const instrument = service.issueInstrument(task.id, 'lifecycle-issue');
  assert.equal(instrument.statusCode, 200);
  assert.equal(body(instrument).task.instrument.scope.reusable, false);
  assert.equal(body(instrument).task.instrument.scope.maxCaptures, 1);

  const result = service.executeCheckout(task.id, 'lifecycle-checkout');
  assert.equal(result.statusCode, 200);
  const completed = body(result).task;
  assert.equal(completed.state, 'completed');
  assert.equal(completed.outcome.status, 'confirmed');
  assert.equal(completed.instrument.status, 'retired');
  assert.equal(adapters.checkout.calls, 1);

  const events = service.getAudit(task.id);
  assert.deepEqual(events.map((event) => event.type), [
    'task.created',
    'task.opened',
    'funding.verified',
    'discovery.started',
    'discovery.quoted',
    'quote.locked',
    'policy.approved',
    'instrument.issuing',
    'instrument.issued',
    'checkout.started',
    'checkout.authorized',
    'task.completed'
  ]);
  assert.doesNotMatch(JSON.stringify(completed), /pan|cvv|private.?key|wallet.?key|transcript/i);
});

test('enforces the immutable 1,000 XSGD task ceiling before issuance', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ scenario: 'over-cap' });
  runToQuote(service, task, 'cap');
  const quote = service.getTask(task.id);
  assert.equal(quote.quote.locked, false);
  service.lockQuote(task.id, 'cap-lock', quote.quote.recommendedCandidateId);

  const result = service.approvePolicy(task.id, 'cap-policy');
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.code, 'SPENDING_CEILING_EXCEEDED');
  assert.match(result.body.error.message, /immutable task ceiling/i);
  assert.equal(result.body.task.state, 'failed');
  assert.equal(result.body.task.policy.status, 'declined');
  assert.equal(result.body.task.instrument, null);
  assert.equal(adapters.issuer.calls, 0);
  assert.equal(TASK_CEILING_MINOR, 100000);
  assert.ok(result.body.task.quote.lockedSnapshot.totalMinor > TASK_CEILING_MINOR);
});

test('locks merchant, item, amount, currency, and expiry against later selections', () => {
  const { service } = makeService();
  const task = service.createTask();
  runToQuote(service, task, 'lock');
  const beforeLock = service.getTask(task.id);
  const firstCandidate = beforeLock.quote.candidates[0];
  const secondCandidate = beforeLock.quote.candidates[1];
  service.lockQuote(task.id, 'lock-first', firstCandidate.id);
  const locked = service.getTask(task.id);

  const attemptedChange = service.lockQuote(task.id, 'lock-second', secondCandidate.id);
  assert.equal(attemptedChange.statusCode, 200);
  const afterAttempt = service.getTask(task.id);
  assert.deepEqual(afterAttempt.quote.lockedSnapshot, locked.quote.lockedSnapshot);
  assert.equal(afterAttempt.quote.selectedCandidateId, firstCandidate.id);
});

test('rejects an idempotency key reused with different action input', () => {
  const { service } = makeService();
  const task = service.createTask();
  runToQuote(service, task, 'idempotency-conflict');
  const quote = service.getTask(task.id);
  const firstCandidate = quote.quote.candidates[0];
  const secondCandidate = quote.quote.candidates[1];
  assert.equal(service.lockQuote(task.id, 'same-lock-key', firstCandidate.id).statusCode, 200);
  const conflict = service.lockQuote(task.id, 'same-lock-key', secondCandidate.id);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(service.getTask(task.id).quote.selectedCandidateId, firstCandidate.id);
});

test('replays an idempotent action without calling its adapter twice', () => {
  const { service, adapters } = makeService();
  const task = service.createTask();
  service.openTask(task.id, 'idem-open');
  const first = service.verifyFunding(task.id, 'idem-funding');
  const second = service.verifyFunding(task.id, 'idem-funding');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(adapters.funding.calls, 1);
  assert.deepEqual(second.body.task, first.body.task);
});

test('unknown checkout stops for reconciliation and never blind retries', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ scenario: 'unknown-checkout' });
  runToInstrument(service, task, 'unknown');
  const first = service.executeCheckout(task.id, 'unknown-execute');
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.task.state, 'reconciliation_required');
  assert.equal(first.body.task.outcome.status, 'unknown');
  assert.match(first.body.task.outcome.nextAction, /will not replay/i);

  const replayAttempt = service.executeCheckout(task.id, 'different-key');
  assert.equal(replayAttempt.statusCode, 200);
  assert.equal(replayAttempt.body.task.state, 'reconciliation_required');
  assert.equal(adapters.checkout.calls, 1);

  const resolved = service.reconcileCheckout(task.id, 'reconcile-key', 'authorized');
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.task.state, 'completed');
  assert.equal(resolved.body.task.instrument.status, 'retired');
  assert.ok(service.getAudit(task.id).some((event) => event.type === 'checkout.reconciled'));
});

test('provider checkout decline is terminal without retry', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ scenario: 'checkout-failure' });
  runToInstrument(service, task, 'decline');
  const result = service.executeCheckout(task.id, 'decline-execute');
  assert.equal(result.body.task.state, 'failed');
  assert.equal(result.body.task.outcome.status, 'declined');
  assert.equal(result.body.task.instrument.status, 'retired');
  assert.equal(adapters.checkout.calls, 1);
  const second = service.executeCheckout(task.id, 'decline-new-key');
  assert.equal(second.body.task.state, 'failed');
  assert.equal(adapters.checkout.calls, 1);
});

test('funding and discovery failures stop at their own adapter boundary', () => {
  const { service: fundingService, adapters: fundingAdapters } = makeService();
  const fundingTask = fundingService.createTask({ scenario: 'funding-failure' });
  fundingService.openTask(fundingTask.id, 'funding-failure-open');
  const fundingResult = fundingService.verifyFunding(fundingTask.id, 'funding-failure-verify');
  assert.equal(fundingResult.statusCode, 502);
  assert.equal(fundingResult.body.task.state, 'failed');
  assert.equal(fundingResult.body.task.failure.stage, 'funding');
  assert.equal(fundingAdapters.discovery.calls, 0);

  const { service: discoveryService, adapters: discoveryAdapters } = makeService();
  const discoveryTask = discoveryService.createTask({ scenario: 'discovery-failure' });
  discoveryService.openTask(discoveryTask.id, 'discovery-failure-open');
  assert.equal(discoveryService.verifyFunding(discoveryTask.id, 'discovery-failure-verify').statusCode, 200);
  const discoveryResult = discoveryService.discover(discoveryTask.id, 'discovery-failure-discover');
  assert.equal(discoveryResult.statusCode, 502);
  assert.equal(discoveryResult.body.task.state, 'failed');
  assert.equal(discoveryResult.body.task.failure.stage, 'discovery');
  assert.equal(discoveryResult.body.task.quote, null);
  assert.equal(discoveryAdapters.issuer.calls, 0);
});

test('issuer failure does not expose an instrument or allow checkout', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ scenario: 'issuer-failure' });
  const quoted = runToQuote(service, task, 'issuer-failure');
  service.lockQuote(task.id, 'issuer-failure-lock', quoted.quote.recommendedCandidateId);
  assert.equal(service.approvePolicy(task.id, 'issuer-failure-policy').statusCode, 200);
  const result = service.issueInstrument(task.id, 'issuer-failure-issue');
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'ISSUER_UNAVAILABLE');
  assert.equal(result.body.task.state, 'failed');
  assert.equal(result.body.task.instrument, null);
  assert.equal(adapters.issuer.calls, 1);
  assert.equal(service.getAudit(task.id).at(-1).type, 'instrument.failed');
});

test('unknown reconciliation retires the authority without replaying checkout', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ scenario: 'unknown-checkout' });
  runToInstrument(service, task, 'unknown-decline');
  const unknown = service.executeCheckout(task.id, 'unknown-decline-execute');
  assert.equal(unknown.body.task.instrument.status, 'pending_reconciliation');
  const resolved = service.reconcileCheckout(task.id, 'unknown-decline-reconcile', 'declined');
  assert.equal(resolved.body.task.state, 'failed');
  assert.equal(resolved.body.task.instrument.status, 'retired');
  assert.equal(adapters.checkout.calls, 1);
});

test('rejects an issuer result that widens the locked scope', () => {
  const issuerAdapter = {
    issue({ scope }) {
      return {
        mode: 'test',
        reference: 'TEST-WIDENED',
        status: 'active',
        issuedAt: '2026-01-01T10:00:00.000Z',
        scope: { ...scope, amountMinor: scope.amountMinor + 1 }
      };
    }
  };
  const { service } = makeService({ issuerAdapter });
  const task = service.createTask();
  const quoted = runToQuote(service, task, 'issuer-scope-mismatch');
  service.lockQuote(task.id, 'issuer-scope-mismatch-lock', quoted.quote.recommendedCandidateId);
  assert.equal(service.approvePolicy(task.id, 'issuer-scope-mismatch-policy').statusCode, 200);
  const result = service.issueInstrument(task.id, 'issuer-scope-mismatch-issue');
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'INVALID_ISSUER_RESULT');
  assert.equal(result.body.task.state, 'failed');
  assert.equal(result.body.task.instrument, null);
});

test('rejects a checkout result that widens the locked scope', () => {
  const checkoutAdapter = {
    execute({ scope }) {
      return {
        mode: 'test',
        status: 'authorized',
        merchantDomain: 'other.test',
        amountMinor: scope.amountMinor,
        currency: scope.currency,
        attemptedAt: '2026-01-01T10:00:00.000Z',
        checkoutReference: 'TEST-WIDENED'
      };
    }
  };
  const { service } = makeService({ checkoutAdapter });
  const task = service.createTask();
  runToInstrument(service, task, 'scope-mismatch');
  const result = service.executeCheckout(task.id, 'scope-mismatch-checkout');
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'CHECKOUT_SCOPE_MISMATCH');
  assert.equal(result.body.task.state, 'failed');
  assert.equal(result.body.task.checkout, null);
  assert.equal(result.body.task.instrument.status, 'retired');
});

test('reset returns one seeded task and clears prior audit and idempotency state', () => {
  const { service } = makeService();
  const first = service.createTask();
  service.openTask(first.id, 'reset-open');
  const seeded = service.reset();
  assert.equal(seeded.origin, 'seed');
  assert.equal(seeded.state, 'created');
  assert.equal(service.listTasks().length, 1);
  assert.equal(service.getAudit(seeded.id).length, 1);
  assert.equal(Object.keys(service.store.data.idempotency).length, 0);
});

test('JSON store persists valid state and rejects malformed state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-store-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const first = new JsonStore(filePath);
    first.transaction((data) => { data.tasks.example = { id: 'example' }; });
    const second = new JsonStore(filePath);
    assert.deepEqual(second.data.tasks.example, { id: 'example' });
    second.reset();
    assert.deepEqual(new JsonStore(filePath).data.tasks, {});

    fs.writeFileSync(filePath, '{not-json');
    assert.throws(() => new JsonStore(filePath), /not valid JSON/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP API serves the console and preserves backend error and reset semantics', async () => {
  const { service } = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NaviPay/);

    const created = await httpJson(base, '/api/tasks', { method: 'POST', body: 'null' });
    assert.equal(created.status, 201);
    assert.equal(created.payload.task.scenario, 'happy');

    const invalidScenario = await httpJson(base, '/api/tasks', { method: 'POST', body: JSON.stringify({ scenario: 'not-a-real-scenario' }) });
    assert.equal(invalidScenario.status, 400);
    assert.equal(invalidScenario.payload.error.code, 'INVALID_SCENARIO');

    const malformed = await httpJson(base, '/api/tasks', { method: 'POST', body: '{not-json' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.payload.error.code, 'INVALID_JSON');

    const reset = await httpJson(base, '/api/reset', { method: 'POST', body: '{}' });
    assert.equal(reset.status, 200);
    assert.equal(reset.payload.task.origin, 'seed');
    assert.equal(reset.payload.task.state, 'created');
    const audit = await httpJson(base, `/api/tasks/${reset.payload.task.id}/audit`);
    assert.equal(audit.status, 200);
    assert.equal(audit.payload.events.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
