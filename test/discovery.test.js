const test = require('node:test');
const assert = require('node:assert/strict');
const { NaviPayService } = require('../src/domain');
const { createServer } = require('../src/server');
const { MemoryStore } = require('../src/store');
const {
  MockCheckoutAdapter,
  MockDiscoveryAdapter,
  MockFundingAdapter,
  MockIssuerAdapter,
  parsePurchaseRequest,
  rankCatalogCandidates
} = require('../src/adapters');

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
  return {
    adapters,
    service: new NaviPayService({
      store: new MemoryStore(),
      clock,
      fundingAdapter: adapters.funding,
      discoveryAdapter: adapters.discovery,
      issuerAdapter: adapters.issuer,
      checkoutAdapter: adapters.checkout
    })
  };
}

test('parses a natural request into a deterministic explainable intent', () => {
  const first = parsePurchaseRequest('I want Apple earphones');
  const second = parsePurchaseRequest('  I WANT apple earphones  ');
  assert.deepEqual(first, {
    normalized: 'i want apple earphones',
    brand: 'Apple',
    productCategory: 'earphones',
    keywords: ['apple', 'earphones']
  });
  assert.deepEqual(second, first);
  assert.throws(() => parsePurchaseRequest('please'), (error) => error.code === 'INVALID_PURCHASE_REQUEST');
});

test('ranks seeded local catalog candidates by brand, category, and keyword relevance', () => {
  const intent = parsePurchaseRequest('I want Apple earphones');
  const ranked = rankCatalogCandidates(intent);
  assert.equal(ranked[0].item, 'Apple AirPods 4');
  assert.equal(ranked[1].brand, 'Apple');
  assert.ok(ranked[0].relevanceScore > ranked[2].relevanceScore);
  assert.deepEqual(ranked[0].matchReasons, [
    'Brand match: Apple',
    'Product category match: earphones',
    'Keyword matches: apple, earphones'
  ]);
  assert.equal(ranked[0].availability, 'in_stock');
});

test('natural request candidates contain normalized quote, availability, evidence, and mock disclosure', () => {
  const { service } = makeService();
  const task = service.createTask({ request: 'I want Apple earphones' });
  service.openTask(task.id, 'request-open');
  service.verifyFunding(task.id, 'request-funding');
  const result = service.discover(task.id, 'request-discovery');
  assert.equal(result.statusCode, 200);
  const quote = result.body.task.quote;
  assert.equal(quote.recommendedCandidateId, 'catalog-apple-airpods-4-anc');
  assert.ok(quote.candidates.length >= 3);
  const candidate = quote.candidates[0];
  assert.equal(candidate.merchant, 'Orchard Electronics');
  assert.equal(candidate.item, 'Apple AirPods 4');
  assert.match(candidate.variant, /USB-C/);
  assert.equal(candidate.currency, 'XSGD');
  assert.equal(candidate.availability, 'in_stock');
  assert.equal(candidate.evidence.type, 'local-catalog-fixture');
  assert.match(candidate.evidence.note, /DEMO \/ MOCK/);
  assert.equal(result.body.task.request.intent.productCategory, 'earphones');
});

test('HTTP request-to-purchase flow uses persisted discovery and lifecycle routes', async () => {
  const { service } = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  async function post(route, body, key) {
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body)
    });
    return { status: response.status, payload: await response.json() };
  }
  try {
    const created = await post('/api/tasks', { request: 'I want Apple earphones' });
    assert.equal(created.status, 201);
    const taskId = created.payload.task.id;
    assert.equal(created.payload.task.request.intent.brand, 'Apple');
    assert.equal(created.payload.task.purchase, null);
    assert.equal((await post(`/api/tasks/${taskId}/open`, {}, 'http-natural-open')).status, 200);
    assert.equal((await post(`/api/tasks/${taskId}/funding/verify`, {}, 'http-natural-funding')).status, 200);
    const discovered = await post(`/api/tasks/${taskId}/discovery`, {}, 'http-natural-discovery');
    assert.equal(discovered.status, 200);
    const candidateId = discovered.payload.task.quote.candidates[0].id;
    assert.equal((await post(`/api/tasks/${taskId}/quote/lock`, { candidateId }, 'http-natural-lock')).status, 200);
    assert.equal((await post(`/api/tasks/${taskId}/policy/approve`, {}, 'http-natural-policy')).status, 200);
    assert.equal((await post(`/api/tasks/${taskId}/instrument/issue`, {}, 'http-natural-issue')).status, 200);
    const checkout = await post(`/api/tasks/${taskId}/checkout/execute`, {}, 'http-natural-checkout');
    assert.equal(checkout.status, 200);
    assert.equal(checkout.payload.task.state, 'completed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operator selection locks one natural quote before the existing payment lifecycle', () => {
  const { service, adapters } = makeService();
  const task = service.createTask({ request: 'I want Apple earphones' });
  service.openTask(task.id, 'natural-open');
  service.verifyFunding(task.id, 'natural-funding');
  service.discover(task.id, 'natural-discovery');
  const candidates = service.getTask(task.id).quote.candidates;
  const selected = candidates[1];
  assert.equal(service.lockQuote(task.id, 'natural-lock', selected.id).statusCode, 200);
  const locked = service.getTask(task.id);
  assert.equal(locked.quote.selectedCandidateId, selected.id);
  assert.deepEqual(locked.quote.lockedSnapshot, {
    quoteId: selected.id,
    brand: selected.brand,
    productCategory: selected.productCategory,
    merchant: selected.merchant,
    merchantDomain: selected.merchantDomain,
    item: selected.item,
    variant: selected.variant,
    totalMinor: selected.totalMinor,
    currency: selected.currency,
    availability: selected.availability,
    evidence: selected.evidence,
    expiresAt: selected.expiresAt
  });
  assert.equal(service.approvePolicy(task.id, 'natural-policy').statusCode, 200);
  assert.equal(service.issueInstrument(task.id, 'natural-issue').statusCode, 200);
  const completed = service.executeCheckout(task.id, 'natural-checkout');
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.task.state, 'completed');
  assert.equal(completed.body.task.outcome.status, 'confirmed');
  assert.equal(adapters.checkout.calls, 1);
  assert.ok(service.getAudit(task.id).some((event) => event.type === 'quote.locked'));
  assert.ok(service.getAudit(task.id).some((event) => event.type === 'task.completed'));
});
