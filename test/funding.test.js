const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { NaviPaySandboxService } = require('../src/sandbox');
const { JsonStore, MemoryStore } = require('../src/store');
const { FUNDING_ASSET, FUNDING_NETWORK, FUNDING_PROVIDER_ID, LocalMockXsgdFundingProvider, FundingProviderContract } = require('../src/funding');
const { KYC_PROVIDER_ID, KYC_STATES, LocalMockKycProvider, KycProviderContract } = require('../src/kyc');

function makeService(store = new MemoryStore(), clock = () => new Date('2026-01-01T10:00:00.000Z')) {
  return new NaviPaySandboxService({ store, clock });
}

function approve(service, key = 'kyc-approve') {
  return service.simulateKycDecision(key, 'approve');
}

function createIntent(service, key = 'funding-create', amount = '25.00') {
  return service.createFundingIntent({ idempotencyKey: key, amount });
}

test('funding and KYC adapters expose replaceable provider-neutral seams', () => {
  assert.ok(new FundingProviderContract().createFundingIntent);
  assert.ok(new LocalMockXsgdFundingProvider().receiveProviderEvent);
  assert.ok(new LocalMockKycProvider().receiveDecision);
  assert.deepEqual(KYC_STATES, ['approved', 'pending', 'rejected']);
  const service = makeService();
  assert.equal(service.getFundingProjection().provider.id, 'local-mock-xsgd-avalanche');
  assert.equal(service.getFundingProjection().provider.live, false);
  assert.equal(service.getKycProjection().providerMode, 'local_mock');
});

test('normalized provider seams reject omitted and mismatched identities', () => {
  const service = makeService();
  const kycReference = service.getKycProjection().providerReference;
  for (const providerId of [undefined, FUNDING_PROVIDER_ID, 'unexpected-kyc-provider']) {
    assert.throws(() => service.receiveKycDecision({ idempotencyKey: `seam-kyc-${String(providerId)}`, decision: { providerId, providerReference: kycReference, decisionId: `seam-kyc-event-${String(providerId)}`, action: 'approve' } }), (error) => error.code === 'KYC_PROVIDER_MISMATCH');
  }
  approve(service, 'seam-approval');
  const intent = createIntent(service, 'seam-funding').body.intent;
  const event = { eventId: 'seam-funding-event', providerReference: intent.providerReference, action: 'confirm', asset: FUNDING_ASSET, network: FUNDING_NETWORK, amountMinor: intent.amountMinor };
  for (const providerId of [undefined, KYC_PROVIDER_ID, 'unexpected-funding-provider']) {
    assert.throws(() => service.receiveFundingEvent({ idempotencyKey: `seam-funding-${String(providerId)}`, event: { ...event, providerId } }), (error) => error.code === 'FUNDING_PROVIDER_MISMATCH');
  }
});

test('pending, rejected, and approved KYC decisions gate funding creation', () => {
  const service = makeService();
  assert.equal(service.getKycProjection().status, 'pending');
  assert.throws(() => createIntent(service), (error) => error.code === 'KYC_NOT_APPROVED');
  assert.throws(() => service.simulateKycDecision('kyc-raw-reason', 'reject', 'passport-number-should-never-be-stored'), (error) => error.code === 'INVALID_KYC_REASON');
  const pending = service.simulateKycDecision('kyc-pending', 'pending');
  assert.equal(pending.body.kyc.status, 'pending');
  const rejected = service.simulateKycDecision('kyc-reject', 'reject', 'simulated_rejection');
  assert.equal(rejected.body.kyc.status, 'rejected');
  assert.throws(() => createIntent(service, 'blocked-rejected'), (error) => error.code === 'KYC_NOT_APPROVED');

  const approvedService = makeService();
  const approved = approve(approvedService);
  assert.equal(approved.body.kyc.status, 'approved');
  const duplicate = approvedService.simulateKycDecision('kyc-approve', 'approve');
  assert.equal(duplicate.replayed, true);
  assert.equal(approvedService.getKycProjection().decisionReference, approved.body.kyc.decisionReference);
  assert.equal(createIntent(approvedService).body.intent.status, 'pending');
});

test('confirmed funding credits the authoritative wallet exactly once and duplicate webhook is harmless', () => {
  const service = makeService();
  approve(service);
  const created = createIntent(service);
  const intent = created.body.intent;
  const event = {
    eventId: 'provider-event-confirm-once',
    providerId: 'local-mock-xsgd-avalanche',
    providerReference: intent.providerReference,
    action: 'confirm',
    asset: FUNDING_ASSET,
    network: FUNDING_NETWORK,
    amountMinor: intent.amountMinor,
    confirmationEvidence: {
      type: 'mock_confirmation',
      transactionReference: 'MOCK-TX-ONE',
      confirmationCount: 3,
      observedAt: '2026-01-01T10:01:00.000Z',
      note: 'Local test evidence only.'
    }
  };
  const first = service.receiveFundingEvent({ idempotencyKey: 'webhook-first', event });
  assert.equal(first.body.intent.status, 'confirmed');
  assert.equal(first.body.intent.confirmationEvidence.transactionReference, 'MOCK-TX-ONE');
  assert.equal(service.getWallet().balanceMinor, 52500);
  assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'funding').length, 2);
  const duplicate = service.receiveFundingEvent({ idempotencyKey: 'webhook-second', event });
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.body.duplicateEvent, true);
  assert.equal(service.getWallet().balanceMinor, 52500);
  assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'funding').length, 2);
});

test('failure does not credit, reversal debits once, and insufficient reversal is safe', () => {
  const failedService = makeService();
  approve(failedService);
  const failed = createIntent(failedService, 'funding-failed');
  const failure = failedService.simulateFundingIntent(failed.body.intent.id, 'simulate-failure', 'fail');
  assert.equal(failure.body.intent.status, 'failed');
  assert.equal(failedService.getWallet().balanceMinor, 50000);
  assert.equal(failedService.getWalletLedger().length, 0);
  assert.throws(() => failedService.simulateFundingIntent(failed.body.intent.id, 'confirm-after-failure', 'confirm'), (error) => error.code === 'INVALID_FUNDING_TRANSITION');

  const service = makeService();
  approve(service);
  const created = createIntent(service, 'funding-reversal', '100.00');
  service.simulateFundingIntent(created.body.intent.id, 'reverse-confirm', 'confirm');
  const reversed = service.simulateFundingIntent(created.body.intent.id, 'reverse-once', 'reverse');
  assert.equal(reversed.body.intent.status, 'reversed');
  assert.equal(service.getWallet().balanceMinor, 50000);
  assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'funding_reversal').length, 2);
  const duplicate = service.simulateFundingIntent(created.body.intent.id, 'reverse-once', 'reverse');
  assert.equal(duplicate.replayed, true);
  assert.equal(service.getWalletLedger().filter((entry) => entry.kind === 'funding_reversal').length, 2);

  const insufficient = makeService();
  approve(insufficient, 'insufficient-kyc');
  const insufficientIntent = createIntent(insufficient, 'funding-insufficient-reversal', '100.00');
  insufficient.simulateFundingIntent(insufficientIntent.body.intent.id, 'insufficient-confirm', 'confirm');
  insufficient.store.transaction((data) => { data.wallets['wallet-demo-customer'].balanceMinor = 0; });
  assert.throws(() => insufficient.simulateFundingIntent(insufficientIntent.body.intent.id, 'insufficient-reverse', 'reverse'), (error) => error.code === 'INSUFFICIENT_FUNDS_FOR_REVERSAL');
  assert.equal(insufficient.getWalletLedger().filter((entry) => entry.kind === 'funding_reversal').length, 0);
  assert.equal(insufficient.getFundingIntent(insufficientIntent.body.intent.id).status, 'confirmed');
});

test('wrong asset, wrong network, and malformed amounts are rejected', () => {
  const service = makeService();
  approve(service);
  for (const input of [
    { amount: '1.234' },
    { amount: 1.5 },
    { amount: '0.00' },
    { amount: '-1.00' },
    { amount: '01.00' }
  ]) assert.throws(() => service.createFundingIntent({ idempotencyKey: `bad-${JSON.stringify(input)}`, ...input }), (error) => error.code === 'MALFORMED_AMOUNT');
  assert.throws(() => service.createFundingIntent({ idempotencyKey: 'wrong-asset', amount: '1.00', asset: 'USDC' }), (error) => error.code === 'WRONG_FUNDING_ASSET');
  assert.throws(() => service.createFundingIntent({ idempotencyKey: 'wrong-network', amount: '1.00', network: 'Ethereum' }), (error) => error.code === 'WRONG_FUNDING_NETWORK');
});

test('KYC blocks a previously created intent from crediting after rejection', () => {
  const service = makeService();
  approve(service, 'credit-gate-approve');
  const created = createIntent(service, 'credit-gate-intent');
  assert.equal(service.simulateKycDecision('credit-gate-reject', 'reject').body.kyc.status, 'rejected');
  assert.throws(() => service.simulateFundingIntent(created.body.intent.id, 'credit-gate-confirm', 'confirm'), (error) => error.code === 'KYC_NOT_APPROVED');
  assert.equal(service.getFundingIntent(created.body.intent.id).status, 'pending');
  assert.equal(service.getWalletLedger().length, 0);
});

test('funding intent expiry and KYC plus funding state survive reload without raw identity data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-funding-'));
  const filePath = path.join(directory, 'state.json');
  let current = Date.parse('2026-01-01T10:00:00.000Z');
  const clock = () => new Date(current);
  try {
    const first = makeService(new JsonStore(filePath), clock);
    approve(first, 'reload-kyc');
    const created = createIntent(first, 'reload-funding', '12.50');
    first.simulateFundingIntent(created.body.intent.id, 'reload-confirm', 'confirm');
    const taskId = created.body.intent.id;
    const reloaded = makeService(new JsonStore(filePath), clock);
    assert.equal(reloaded.getKycProjection().status, 'approved');
    assert.equal(reloaded.getFundingIntent(taskId).status, 'confirmed');
    assert.equal(reloaded.getWallet().balanceMinor, 51250);
    const safe = JSON.stringify({ funding: reloaded.getFundingProjection(), state: reloaded.store.data });
    assert.doesNotMatch(safe, /identityDocument|passport|nationalId|raw.?document|biometric|private.?key|secret/i);
    assert.match(safe, /LOCAL SIMULATION ONLY/);

    const expiry = makeService(new MemoryStore(), clock);
    approve(expiry, 'expiry-kyc');
    const pending = createIntent(expiry, 'expiry-funding', '4.00');
    current += 31 * 60 * 1000;
    assert.equal(expiry.getFundingIntent(pending.body.intent.id).status, 'expired');
    assert.equal(expiry.getWallet().balanceMinor, 50000);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP funding routes expose safe status and enforce local simulation authorization', async () => {
  const service = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, options = {}) {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    return { status: response.status, payload: await response.json() };
  }
  try {
    const initial = await request('/api/funding');
    assert.equal(initial.status, 200);
    assert.equal(initial.payload.funding.kyc.status, 'pending');
    const unauthorizedKyc = await request('/api/funding/kyc/simulate', { method: 'POST', headers: { 'Idempotency-Key': 'http-kyc-no-auth' }, body: JSON.stringify({ action: 'approve' }) });
    assert.equal(unauthorizedKyc.status, 403);
    const approved = await request('/api/funding/kyc/simulate', { method: 'POST', headers: { 'Idempotency-Key': 'http-kyc-approve', 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action: 'approve' }) });
    assert.equal(approved.status, 200);
    const created = await request('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': 'http-funding-create' }, body: JSON.stringify({ amount: '7.50' }) });
    assert.equal(created.status, 201);
    const unauthorizedSimulation = await request(`/api/funding/intents/${created.payload.intent.id}/simulate`, { method: 'POST', headers: { 'Idempotency-Key': 'http-funding-no-auth' }, body: JSON.stringify({ action: 'confirm' }) });
    assert.equal(unauthorizedSimulation.status, 403);
    const unauthorizedWebhook = await request('/api/funding/webhooks', { method: 'POST', headers: { 'Idempotency-Key': 'http-funding-webhook-no-auth' }, body: JSON.stringify({ eventId: 'http-event-no-auth', providerReference: created.payload.intent.providerReference, action: 'confirm', asset: 'XSGD', network: 'Avalanche Fuji', amountMinor: 750 }) });
    assert.equal(unauthorizedWebhook.status, 403);
    const confirmed = await request(`/api/funding/intents/${created.payload.intent.id}/simulate`, { method: 'POST', headers: { 'Idempotency-Key': 'http-funding-confirm', 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action: 'confirm' }) });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.payload.intent.status, 'confirmed');
    assert.equal(confirmed.payload.intent.asset, 'XSGD');
    assert.equal(confirmed.payload.intent.network, 'Avalanche Fuji');
    assert.doesNotMatch(JSON.stringify(confirmed.payload), /rawProviderPayload|identityDocument|passport|private.?key|secret/i);
    const status = await request(`/api/funding/intents/${created.payload.intent.id}`);
    assert.equal(status.payload.intent.status, 'confirmed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP provider boundaries require the exact provider identity and strict local header', async () => {
  const service = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, options = {}) {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    return { status: response.status, payload: await response.json() };
  }
  try {
    const kycReference = (await request('/api/funding/kyc')).payload.kyc.providerReference;
    const kycEvent = { providerReference: kycReference, decisionId: 'provider-boundary-kyc', action: 'approve' };
    for (const [providerId, headerValue] of [[FUNDING_PROVIDER_ID, 'true'], [KYC_PROVIDER_ID, 'TRUE']]) {
      const rejected = await request('/api/funding/kyc/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': headerValue }, body: JSON.stringify({ ...kycEvent, providerId }) });
      assert.equal(rejected.status, 403);
    }
    const omitted = await request('/api/funding/kyc/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify(kycEvent) });
    assert.equal(omitted.status, 403);
    const approved = await request('/api/funding/kyc/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ ...kycEvent, providerId: KYC_PROVIDER_ID }) });
    assert.equal(approved.status, 200);

    const created = await request('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': 'provider-boundary-funding' }, body: JSON.stringify({ amount: '2.00' }) });
    const fundingEvent = { eventId: 'provider-boundary-funding-event', providerReference: created.payload.intent.providerReference, action: 'confirm', asset: FUNDING_ASSET, network: FUNDING_NETWORK, amountMinor: 200 };
    for (const [providerId, headerValue] of [['local-mock-kyc', 'true'], [FUNDING_PROVIDER_ID, 'TRUE']]) {
      const rejected = await request('/api/funding/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': headerValue }, body: JSON.stringify({ ...fundingEvent, providerId }) });
      assert.equal(rejected.status, 403);
    }
    const fundingOmitted = await request('/api/funding/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify(fundingEvent) });
    assert.equal(fundingOmitted.status, 403);
    const confirmed = await request('/api/funding/webhooks', { method: 'POST', headers: { 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ ...fundingEvent, providerId: FUNDING_PROVIDER_ID }) });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.payload.intent.status, 'confirmed');
    assert.doesNotMatch(JSON.stringify(confirmed.payload), /rawProviderPayload|credentials|identityDocument|passport/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP funding and KYC reference reconciliation is safe, normalized, and replayable', async () => {
  const service = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, options = {}) {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    return { status: response.status, payload: await response.json() };
  }
  const local = { 'X-NaviPay-Local-Simulation': 'true' };
  try {
    const kycReference = (await request('/api/funding/kyc')).payload.kyc.providerReference;
    const kycBase = { providerId: KYC_PROVIDER_ID, providerReference: kycReference };
    const missingKyc = await request('/api/funding/kyc/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ ...kycBase, providerReference: 'missing-kyc-reference' }) });
    assert.equal(missingKyc.status, 404);
    const wrongKycProvider = await request('/api/funding/kyc/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ ...kycBase, providerId: FUNDING_PROVIDER_ID }) });
    assert.equal(wrongKycProvider.status, 403);
    const kycFirst = await request('/api/funding/kyc/references/' + encodeURIComponent(kycReference) + '/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: KYC_PROVIDER_ID }) });
    assert.equal(kycFirst.status, 200);
    assert.equal(kycFirst.payload.status.providerReference, kycReference);
    assert.equal(kycFirst.payload.status.status, 'pending');
    const kycReplay = await request('/api/funding/kyc/reconcile', { method: 'POST', headers: local, body: JSON.stringify(kycBase) });
    assert.equal(kycReplay.status, 200);
    assert.equal(kycReplay.payload.replayed, true);
    assert.equal(service.kycProvider.calls.reconcile, 1);

    const approved = await request('/api/funding/kyc/webhooks', { method: 'POST', headers: local, body: JSON.stringify({ providerId: KYC_PROVIDER_ID, providerReference: kycReference, decisionId: 'reconcile-approval', action: 'approve' }) });
    assert.equal(approved.status, 200);
    const created = await request('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': 'reconcile-funding-create' }, body: JSON.stringify({ amount: '3.00' }) });
    const fundingReference = created.payload.intent.providerReference;
    const missingFunding = await request('/api/funding/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: FUNDING_PROVIDER_ID, providerReference: 'missing-funding-reference' }) });
    assert.equal(missingFunding.status, 404);
    const wrongFunding = await request('/api/funding/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: FUNDING_PROVIDER_ID, providerReference: kycReference }) });
    assert.equal(wrongFunding.status, 404);
    const wrongFundingProvider = await request('/api/funding/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: KYC_PROVIDER_ID, providerReference: fundingReference }) });
    assert.equal(wrongFundingProvider.status, 403);
    const fundingFirst = await request('/api/funding/references/' + encodeURIComponent(fundingReference) + '/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: FUNDING_PROVIDER_ID }) });
    assert.equal(fundingFirst.status, 200);
    assert.equal(fundingFirst.payload.status.providerReference, fundingReference);
    assert.equal(fundingFirst.payload.status.status, 'pending');
    const fundingReplay = await request('/api/funding/reconcile', { method: 'POST', headers: local, body: JSON.stringify({ providerId: FUNDING_PROVIDER_ID, providerReference: fundingReference }) });
    assert.equal(fundingReplay.status, 200);
    assert.equal(fundingReplay.payload.replayed, true);
    assert.equal(service.fundingProvider.calls.reconcile, 1);
    assert.doesNotMatch(JSON.stringify({ kycFirst, fundingFirst }), /rawProviderPayload|credentials|secret|identityDocument|passport/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('frontend funding surface keeps KYC, funding references, and local disclosure visible', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(frontend, /fundingPanel/);
  assert.match(frontend, /KYC gate/);
  assert.match(frontend, /confirmationEvidence/);
  assert.match(frontend, /LOCAL SIMULATION ONLY/);
  assert.match(frontend, /X-NaviPay-Local-Simulation/);
  assert.match(frontend, /Mock destination/);
});
