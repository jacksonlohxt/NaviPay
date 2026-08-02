const test = require('node:test');
const assert = require('node:assert/strict');
const { NaviPayService, TASK_CEILING_MINOR } = require('../src/domain');
const { MemoryStore } = require('../src/store');
const { MockCheckoutAdapter, MockDiscoveryAdapter, MockFundingAdapter, MockIssuerAdapter } = require('../src/adapters');

function makeClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 10, 0, tick++));
}

function makeService() {
  const clock = makeClock();
  const adapters = {
    funding: new MockFundingAdapter({ clock }),
    discovery: new MockDiscoveryAdapter({ clock }),
    issuer: new MockIssuerAdapter({ clock }),
    checkout: new MockCheckoutAdapter({ clock })
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
  assert.equal(adapters.checkout.calls, 1);
  const second = service.executeCheckout(task.id, 'decline-new-key');
  assert.equal(second.body.task.state, 'failed');
  assert.equal(adapters.checkout.calls, 1);
});
