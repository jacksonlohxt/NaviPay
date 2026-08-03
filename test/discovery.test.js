const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NaviPayService } = require('../src/domain');
const { createServer } = require('../src/server');
const { MemoryStore } = require('../src/store');
const { LocalDiscoveryAdapter, NaviPaySandboxService } = require('../src/sandbox');
const {
  MockCheckoutAdapter,
  MockDiscoveryAdapter,
  MockFundingAdapter,
  MockIssuerAdapter,
  parsePurchaseRequest,
  rankCatalogCandidates
} = require('../src/adapters');
const {
  DEFAULT_LIMITS,
  PlaywrightDiscoveryAdapter,
  extractCandidatesFromHtml,
  isAllowedMethod,
  isApprovedUrl,
  isExplicitlyAllowlistedUrl,
  normalizeCandidate,
  selectClearWinner,
  validateExtractedCandidate
} = require('../src/playwright-discovery');

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

function browserCandidate(overrides = {}) {
  const observedAt = '2026-01-01T10:00:00.000Z';
  return {
    merchantId: 'merchant-fixture',
    merchant: 'Fixture Merchant',
    merchantDomain: 'fixture.test',
    sku: 'sku-fixture-keyboard',
    variantId: 'variant-fixture',
    brand: 'Logitech',
    productCategory: 'keyboards',
    item: 'Fixture Keyboard',
    variant: 'Wireless',
    availability: 'in_stock',
    currency: 'XSGD',
    subtotalMinor: 1000,
    shippingMinor: 100,
    taxMinor: 90,
    totalMinor: 1190,
    observedAt,
    expiresAt: '2026-01-01T10:15:00.000Z',
    sourceUrl: 'https://fixture.test/keyboard',
    evidence: { type: 'fixture-json', source: 'local fixture', observedAt, note: 'MOCK fixture.' },
    ...overrides
  };
}

test('read-only browser candidate extraction validates the complete quote schema', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'merchants', 'harbor-supply.html'), 'utf8');
  const candidates = extractCandidatesFromHtml(html, 'http://127.0.0.1:43123/harbor-supply.html', { now: new Date('2026-08-03T05:05:00.000Z'), replayClock: true });
  assert.equal(candidates[0].sku, 'sku-logitech-mx-keys-mini');
  assert.equal(candidates[0].sourceUrl, 'http://127.0.0.1:43123/harbor-supply.html');
  assert.equal(candidates[0].totalMinor, candidates[0].subtotalMinor + candidates[0].shippingMinor + candidates[0].taxMinor);
});

test('browser discovery policy allows local hosts and explicitly allowlisted domains only', () => {
  assert.equal(isApprovedUrl('http://127.0.0.1:43123/catalog', []), true);
  assert.equal(isApprovedUrl('https://fixture.test/catalog', ['fixture.test']), true);
  assert.equal(isApprovedUrl('https://not-approved.test/catalog', ['fixture.test']), false);
  assert.equal(isApprovedUrl('https://user:secret@fixture.test/catalog', ['fixture.test']), false);
  assert.equal(isAllowedMethod('GET'), true);
  assert.equal(isAllowedMethod('HEAD'), true);
  assert.equal(isAllowedMethod('POST'), false);
});

test('malformed, contradictory, stale, and policy-invalid browser data is rejected', () => {
  const now = new Date('2026-01-01T10:05:00.000Z');
  assert.throws(() => validateExtractedCandidate(browserCandidate({ totalMinor: 1191 }), { now, allowlist: ['fixture.test'] }), /total/);
  assert.throws(() => validateExtractedCandidate(browserCandidate({ expiresAt: '2026-01-01T09:59:00.000Z' }), { now, allowlist: ['fixture.test'] }), /stale/i);
  assert.throws(() => validateExtractedCandidate(browserCandidate({ sourceUrl: 'https://other.test/item' }), { now, allowlist: ['fixture.test'] }), /approved/i);
  assert.throws(() => normalizeCandidate(browserCandidate({ subtotalMinor: 1.5 }), { now, allowlist: ['fixture.test'] }), /integer/i);
});

test('browser adapter uses the worker result when enabled and falls back safely on worker failure', () => {
  const fallback = new MockDiscoveryAdapter({ clock: () => new Date('2026-01-01T10:00:00.000Z') });
  const candidate = browserCandidate({ observedAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:15:00.000Z' });
  let workerInput;
  const adapter = new PlaywrightDiscoveryAdapter({
    enabled: true,
    allowlist: ['fixture.test'],
    startUrls: ['https://fixture.test/catalog'],
    clock: () => new Date('2026-01-01T10:05:00.000Z'),
    fallback,
    workerRunner: (input) => { workerInput = input; return { discoveredAt: candidate.observedAt, candidates: [candidate] }; }
  });
  const result = adapter.discover({ request: { intent: parsePurchaseRequest('I want Logitech keyboard') } });
  assert.equal(workerInput.limits.maxTabs, DEFAULT_LIMITS.maxTabs);
  assert.equal(result.mode, 'read-only Playwright fixture');
  assert.equal(result.candidates[0].merchantDomain, 'fixture.test');

  const failed = new PlaywrightDiscoveryAdapter({
    enabled: true,
    allowlist: ['fixture.test'],
    startUrls: ['https://fixture.test/catalog'],
    fallback,
    workerRunner: () => { throw new Error('timeout'); }
  }).discover({ request: { intent: parsePurchaseRequest('I want Logitech keyboard') } });
  assert.equal(failed.discoveryStatus.status, 'unavailable');
  assert.equal(failed.discoveryStatus.code, 'DISCOVERY_UNAVAILABLE');
  assert.match(failed.source, /MOCK FALLBACK/);
});

test('sandbox reports default seeded catalog discovery mode through the read API', async () => {
  const service = new NaviPaySandboxService({ store: new MemoryStore(), clock: () => new Date('2026-01-01T10:00:00.000Z') });
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/discovery`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.discovery.mode, 'seeded_catalog');
    assert.equal(payload.discovery.status, 'disabled');
    assert.equal(payload.discovery.readOnly, true);
    assert.equal(payload.discovery.fallback.source, 'seeded_catalog');
    assert.equal((await fetch(`${base}/api/tasks`).then((result) => result.json())).discovery.mode, 'seeded_catalog');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sandbox projection reports browser success and exposes only safe selected evidence', () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const fallback = new LocalDiscoveryAdapter({ clock });
  const candidate = browserCandidate({ merchantId: 'merchant-harbor-supply', sku: 'sku-logitech-mx-keys-mini', variantId: 'variant-wireless-compact', item: 'Logitech MX Keys Mini', variant: 'Wireless compact keyboard', subtotalMinor: 12900, shippingMinor: 350, taxMinor: 1060, totalMinor: 14310, observedAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:15:00.000Z' });
  const discovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/catalog'], clock, fallback, workerRunner: () => ({ discoveredAt: candidate.observedAt, candidates: [candidate] }) });
  const service = new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery } });
  const result = service.startPurchase({ idempotencyKey: 'browser-success', request: 'I want Logitech keyboard' });
  assert.equal(result.body.projection.discovery.source, 'local_browser_fixture');
  assert.equal(result.body.projection.discovery.recommendationOnly, false);
  assert.equal(result.body.projection.quote.rankingPolicy.winner, 'the eligible candidate with a unique highest score');
  const selected = result.body.projection.quote.candidates[0];
  assert.equal(result.body.task.state, 'completed');
  assert.equal(result.body.task.quote.item, 'Logitech MX Keys Mini');
  assert.equal(selected.sourceUrl, 'https://fixture.test/keyboard');
  assert.equal(selected.evidence.observedAt, candidate.observedAt);
  assert.deepEqual(selected.matchReasons, ['Brand match: Logitech', 'Category match: keyboards', 'Keyword matches: logitech, keyboard']);
  assert.doesNotMatch(JSON.stringify(result.body.projection), /workerRunner|credentials|password|rawPayload/i);
});

test('target-site discovery selects each competition replay product before the existing purchase lifecycle', () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const replayCandidates = extractCandidatesFromHtml(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'competition-site', 'index.html'), 'utf8'),
    'https://fixture.test/competition-site/',
    { now: clock(), replayClock: true, allowlist: ['fixture.test'] }
  );
  for (const [request, expectedItem] of [
    ['Find an Apple Magic Keyboard', 'Apple Magic Keyboard'],
    ['Find a Logitech MX Master 3S', 'Logitech MX Master 3S'],
    ['Find Apple AirPods 4', 'Apple AirPods 4']
  ]) {
    const fallback = new LocalDiscoveryAdapter({ clock });
    let workerInput;
    const discovery = new PlaywrightDiscoveryAdapter({
      enabled: true,
      allowlist: ['fixture.test'],
      startUrls: ['https://fixture.test/competition-site/'],
      clock,
      fallback,
      workerRunner: (input) => {
        workerInput = input;
        return { discoveredAt: clock().toISOString(), candidates: replayCandidates };
      }
    });
    const service = new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery } });
    const discovered = service.startPurchase({ idempotencyKey: `competition-${expectedItem}`, request, targetSite: 'https://fixture.test/competition-site/' });
    assert.equal(workerInput.startUrls[0], 'https://fixture.test/competition-site/');
    assert.equal(discovered.body.task.state, 'completed');
    const candidate = discovered.body.task.quote.candidates.find((item) => item.item === expectedItem);
    assert.ok(candidate, expectedItem);
    assert.equal(discovered.body.projection.discovery.source, 'local_browser_fixture');
    assert.equal(discovered.body.projection.quote.recommendationOnly, false);
    const completed = discovered;
    assert.equal(completed.body.task.state, 'completed');
    assert.equal(completed.body.task.quote.item, expectedItem);
    assert.equal(completed.body.task.inventory.reservation.status, 'committed');
    assert.equal(completed.body.task.payment.status, 'authorized');
    assert.equal(completed.body.task.order.status, 'confirmed');
    assert.equal(completed.body.task.delivery.status, 'delivered');
    assert.equal(completed.body.task.receipt.status, 'confirmed');
    assert.equal(completed.body.projection.quote.recommendationOnly, false);
    const projectedCandidate = completed.body.projection.quote.candidates.find((item) => item.id === candidate.id);
    assert.equal(projectedCandidate.sourceUrl, 'https://fixture.test/competition-site/');
    assert.equal(projectedCandidate.observedAt, candidate.observedAt);
    assert.equal(projectedCandidate.confidence > 0, true);
    assert.equal(projectedCandidate.matchReasons.length > 0, true);
  }
});

test('browser discovery auto-selects only a unique winner and pauses ties while no-match falls back safely', () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const fallback = new LocalDiscoveryAdapter({ clock });
  const first = browserCandidate({ sku: 'sku-tie-one', variantId: 'variant-tie-one' });
  const second = browserCandidate({ sku: 'sku-tie-two', variantId: 'variant-tie-two', item: 'Another Fixture Keyboard' });
  const tieDiscovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/catalog'], clock, fallback, workerRunner: () => ({ discoveredAt: first.observedAt, candidates: [first, second] }) });
  const tieService = new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery: tieDiscovery } });
  const tied = tieService.startPurchase({ idempotencyKey: 'browser-tie', request: 'I want a keyboard', targetSite: 'https://fixture.test/catalog' });
  assert.equal(selectClearWinner([first, second], { ceilingMinor: 100000 }).status, 'ambiguous');
  assert.equal(tied.body.task.state, 'awaiting_selection');
  assert.equal(tied.body.task.recommendation.status, 'ambiguous');
  assert.match(tied.body.task.automation.nextAction, /tied|Choose/i);
  assert.equal(tieService.getWalletLedger().length, 0);

  const noMatchDiscovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/catalog'], clock, fallback, workerRunner: () => ({ discoveredAt: first.observedAt, candidates: [first] }) });
  const noMatchService = new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery: noMatchDiscovery } });
  const noMatch = noMatchService.startPurchase({ idempotencyKey: 'browser-no-match', request: 'I want a mouse', targetSite: 'https://fixture.test/catalog' });
  assert.equal(noMatch.body.task.state, 'completed');
  assert.equal(noMatch.body.projection.discovery.source, 'seeded_catalog_fallback');
  assert.equal(noMatch.body.projection.quote.discoveryStatus.code, 'DISCOVERY_NO_MATCH');
});

test('HTTP target-site discovery runs the automatic safeguards', async () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const candidate = browserCandidate({
    merchantId: 'merchant-orchard-electronics',
    merchant: 'Orchard Electronics',
    merchantDomain: 'fixture.test',
    sku: 'sku-apple-magic-keyboard',
    variantId: 'variant-usb-c-rechargeable',
    brand: 'Apple',
    productCategory: 'keyboards',
    item: 'Apple Magic Keyboard',
    variant: 'Wireless keyboard with USB-C charging',
    subtotalMinor: 15900,
    shippingMinor: 0,
    taxMinor: 1272,
    totalMinor: 17172,
    sourceUrl: 'https://fixture.test/competition-site/'
  });
  const fallback = new LocalDiscoveryAdapter({ clock });
  const discovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/competition-site/'], clock, fallback, workerRunner: () => ({ discoveredAt: candidate.observedAt, candidates: [candidate] }) });
  const server = createServer({ service: new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery } }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(route, body, key) {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  }
  try {
    const discovered = await post('/api/purchases/run', { request: 'Find an Apple Magic Keyboard', targetSite: 'https://fixture.test/competition-site/' }, 'http-target-discovery');
    assert.equal(discovered.status, 201);
    assert.equal(discovered.payload.task.state, 'completed');
    const completed = discovered;
    assert.equal(completed.payload.task.state, 'completed');
    assert.equal(completed.payload.task.receipt.item, 'Apple Magic Keyboard');
    assert.equal(completed.payload.task.inventory.reservation.status, 'committed');
    assert.equal(completed.payload.task.payment.status, 'authorized');
    assert.equal(completed.payload.task.delivery.status, 'delivered');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP target-site API auto-purchases keyboard, mouse, and earphone winners', async () => {
  const replayCandidates = extractCandidatesFromHtml(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'competition-site', 'index.html'), 'utf8'),
    'https://fixture.test/competition-site/',
    { now: new Date('2026-01-01T10:05:00.000Z'), replayClock: true, allowlist: ['fixture.test'] }
  );
  for (const [request, expectedItem] of [
    ['I want a keyboard', 'Apple Magic Keyboard'],
    ['I want a mouse', 'Logitech MX Master 3S'],
    ['I want earphones', 'Apple AirPods 4']
  ]) {
    const clock = () => new Date('2026-01-01T10:05:00.000Z');
    const fallback = new LocalDiscoveryAdapter({ clock });
    const discovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/competition-site/'], clock, fallback, workerRunner: () => ({ discoveredAt: replayCandidates[0].observedAt, candidates: replayCandidates }) });
    const server = createServer({ service: new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery } }) });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${base}/api/purchases/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `auto-${expectedItem}` }, body: JSON.stringify({ request, targetSite: 'https://fixture.test/competition-site/' }) });
      const payload = await response.json();
      assert.equal(response.status, 201);
      assert.equal(payload.task.state, 'completed');
      assert.equal(payload.task.quote.item, expectedItem);
      assert.equal(payload.task.payment.status, 'authorized');
      assert.equal(payload.task.receipt.status, 'confirmed');
      assert.equal(payload.projection.discovery.source, 'local_browser_fixture');
      assert.equal(payload.projection.quote.recommendationOnly, false);
      assert.ok(payload.projection.progress.every((item) => item.status === 'completed'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('target-site policy rejects malformed URLs and falls back without fetching blocked hosts', () => {
  assert.equal(isExplicitlyAllowlistedUrl('https://fixture.test/catalog', ['fixture.test']), true);
  assert.equal(isExplicitlyAllowlistedUrl('http://127.0.0.1:43123/catalog', []), false);
  const service = new NaviPaySandboxService({ store: new MemoryStore(), clock: () => new Date('2026-01-01T10:00:00.000Z') });
  const blocked = service.startPurchase({ idempotencyKey: 'blocked-target', request: 'Find an Apple Magic Keyboard', targetSite: 'https://not-approved.example/catalog' });
  assert.equal(blocked.body.task.targetSite.status, 'blocked');
  assert.equal(blocked.body.task.targetSite.url, null);
  assert.equal(blocked.body.projection.discovery.source, 'seeded_catalog_fallback');
  assert.equal(blocked.body.projection.quote.discoveryStatus.code, 'DISCOVERY_DOMAIN_BLOCKED');
  assert.doesNotMatch(JSON.stringify(blocked.body.projection), /not-approved\.example/);
  assert.throws(() => service.startPurchase({ idempotencyKey: 'malformed-target', request: 'Find a mouse', targetSite: 'javascript:alert(1)' }), (error) => error.code === 'INVALID_TARGET_SITE');
});

test('stale, malformed, no-match, timeout, and worker failures all preserve the labelled local fallback', () => {
  const fallback = new LocalDiscoveryAdapter({ clock: () => new Date('2026-01-01T10:05:00.000Z') });
  const base = browserCandidate({ observedAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:15:00.000Z' });
  const cases = [
    { code: 'STALE_DISCOVERY_DATA', workerRunner: () => ({ candidates: [base] }), clock: () => new Date('2026-01-01T10:20:00.000Z') },
    { code: 'CONTRADICTORY_DISCOVERY_DATA', workerRunner: () => ({ candidates: [{ ...base, totalMinor: 1 }] }) },
    { code: 'DISCOVERY_NO_MATCH', workerRunner: () => ({ candidates: [{ ...base, brand: 'Unrelated', productCategory: 'mice', item: 'Unrelated Device', variant: 'Standard', sku: 'sku-unrelated' }] }) },
    { code: 'DISCOVERY_TIMEOUT', workerRunner: () => { throw Object.assign(new Error('private timeout detail'), { code: 'DISCOVERY_TIMEOUT' }); } },
    { code: 'DISCOVERY_UNAVAILABLE', workerRunner: () => { throw new Error('private worker detail'); } }
  ];
  for (const scenario of cases) {
    const adapter = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/catalog'], clock: scenario.clock || (() => new Date('2026-01-01T10:05:00.000Z')), fallback, workerRunner: scenario.workerRunner });
    const result = adapter.discover({ request: { intent: parsePurchaseRequest('I want a Logitech keyboard') } });
    assert.equal(result.discoveryStatus.status, 'unavailable');
    assert.equal(result.discoveryStatus.code, scenario.code);
    assert.equal(result.candidates[0].evidence.source.includes('MOCK FALLBACK'), true);
    assert.equal(result.candidates[0].sourceUrl, undefined);
    assert.match(result.discoveryStatus.message, /site|worker|catalog|data|deadline/i);
  }
});

test('sandbox reports unavailable browser discovery while safely using the seeded fallback', () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const fallback = new LocalDiscoveryAdapter({ clock });
  const discovery = new PlaywrightDiscoveryAdapter({ enabled: true, allowlist: ['fixture.test'], startUrls: ['https://fixture.test/catalog'], clock, fallback, workerRunner: () => { throw new Error('offline'); } });
  const service = new NaviPaySandboxService({ store: new MemoryStore(), clock, adapters: { discovery } });
  const result = service.startPurchase({ idempotencyKey: 'browser-fallback', request: 'I want an Apple Magic Keyboard' });
  assert.equal(result.body.projection.discovery.source, 'seeded_catalog_fallback');
  assert.equal(result.body.projection.discovery.status, 'unavailable');
  assert.equal(result.body.projection.quote.discoveryStatus.code, 'DISCOVERY_UNAVAILABLE');
  assert.equal(result.body.projection.quote.source, 'Seeded catalog fallback');
  assert.equal(result.body.task.state, 'completed');
});

test('default local purchase behavior remains seeded and supports the visible Apple keyboard request', () => {
  const clock = () => new Date('2026-01-01T10:05:00.000Z');
  const service = new NaviPaySandboxService({ store: new MemoryStore(), clock });
  const result = service.startPurchase({ idempotencyKey: 'local-apple-keyboard', request: 'I want an Apple Magic Keyboard' });
  assert.equal(result.body.task.state, 'completed');
  assert.equal(result.body.projection.discovery.source, 'seeded_catalog');
  assert.equal(result.body.projection.quote.item, 'Apple Magic Keyboard');
});

test('frontend uses the safe discovery projection for badges and advanced evidence', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(frontend, /discoveryBadge/);
  assert.match(frontend, /Local browser fixture/);
  assert.match(frontend, /Seeded catalog fallback/);
  assert.match(frontend, /Source URL/);
  assert.match(frontend, /Observed/);
  assert.match(frontend, /Match rationale/);
  assert.match(frontend, /recommendationOnly/);
  assert.match(frontend, /target-site/);
  assert.match(frontend, /Configured site/);
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
