const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DomainError, NaviPayService } = require('./domain');
const { NaviPaySandboxService, SandboxDomainError } = require('./sandbox');
const { JsonStore } = require('./store');
const { FUNDING_PROVIDER_ID } = require('./funding');
const { KYC_PROVIDER_ID } = require('./kyc');

const root = path.resolve(__dirname, '..');
const publicDirectory = path.join(root, 'public');
const dataFile = process.env.NAVIPAY_DATA_FILE || path.join(root, '.data', 'navipay.json');

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

function sendError(res, error) {
  const statusCode = error instanceof DomainError || error instanceof SandboxDomainError ? error.statusCode : 500;
  json(res, statusCode, {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'NaviPay could not complete that request.' : error.message,
      details: error.details
    }
  });
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 100_000) throw new DomainError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function idempotencyKey(req, fallback) {
  return req.headers['idempotency-key'] || fallback;
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function localSimulationAuthorized(req) {
  return req.headers['x-navipay-local-simulation'] === 'true' && isLoopbackAddress(req.socket?.remoteAddress);
}

function secretMatches(candidate, configured) {
  if (!candidate || !configured || typeof candidate !== 'string' || typeof configured !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(configured);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function providerIdFromPayload(body, nestedKey) {
  const nested = body?.[nestedKey];
  if (body && Object.prototype.hasOwnProperty.call(body, 'providerId')) return body.providerId;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested.providerId : null;
}

function authorizeFundingWebhook(service, req, body) {
  const expectedProviderId = service.fundingProvider?.providerId || FUNDING_PROVIDER_ID;
  const providerId = providerIdFromPayload(body, 'event');
  if (!providerId) throw new SandboxDomainError(403, 'FUNDING_PROVIDER_ID_REQUIRED', 'Funding provider events must identify the configured funding provider.');
  if (providerId !== expectedProviderId) throw new SandboxDomainError(403, 'FUNDING_PROVIDER_MISMATCH', 'The funding event provider does not match the configured funding provider.');
  if (secretMatches(req.headers['x-navipay-funding-webhook-secret'], service.fundingWebhookSecret)) return;
  if (providerId === FUNDING_PROVIDER_ID && (service.fundingProvider?.providerMode || 'local_mock') === 'local_mock' && localSimulationAuthorized(req)) return;
  throw new SandboxDomainError(403, 'FUNDING_WEBHOOK_UNAUTHORIZED', 'Funding provider events require the configured server-side webhook secret or the explicit local simulation header.');
}

function authorizeKycWebhook(service, req, body) {
  const expectedProviderId = service.kycProvider?.providerId || KYC_PROVIDER_ID;
  const providerId = providerIdFromPayload(body, 'decision');
  if (!providerId) throw new SandboxDomainError(403, 'KYC_PROVIDER_ID_REQUIRED', 'KYC provider decisions must identify the configured KYC provider.');
  if (providerId !== expectedProviderId) throw new SandboxDomainError(403, 'KYC_PROVIDER_MISMATCH', 'The KYC decision provider does not match the configured KYC provider.');
  if (secretMatches(req.headers['x-navipay-kyc-webhook-secret'], service.kycWebhookSecret)
    || secretMatches(req.headers['x-navipay-funding-webhook-secret'], service.fundingWebhookSecret)) return;
  if (providerId === KYC_PROVIDER_ID && service.kycProvider?.providerMode === 'local_mock' && localSimulationAuthorized(req)) return;
  throw new SandboxDomainError(403, 'KYC_WEBHOOK_UNAUTHORIZED', 'KYC provider decisions require the configured server-side webhook secret or the explicit local simulation header.');
}

function makeService() {
  return new NaviPaySandboxService({ store: new JsonStore(dataFile) });
}

function routeSandboxApi(service, req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const method = req.method || 'GET';
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'reset' && method === 'POST') {
    return readBody(req).then(() => json(res, 200, service.reset()));
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'funding' && method === 'GET') {
    return json(res, 200, { funding: service.getFundingProjection() });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'kyc' && method === 'GET') {
    return json(res, 200, { kyc: service.getKycProjection(), funding: service.getFundingProjection() });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'kyc' && segments[3] === 'simulate' && method === 'POST') {
    if (!localSimulationAuthorized(req)) throw new SandboxDomainError(403, 'LOCAL_SIMULATION_ONLY', 'This route is reserved for the explicit local KYC simulation path.');
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_KYC_DECISION', 'KYC simulation input must be a JSON object.');
      const result = service.simulateKycDecision(idempotencyKey(req, null), body.action || body.status, body.reasonCode || body.reason);
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'kyc' && ['webhook', 'webhooks'].includes(segments[3]) && method === 'POST') {
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_KYC_DECISION', 'KYC provider decision must be a JSON object.');
      authorizeKycWebhook(service, req, body);
      const decisionBody = body.decision && typeof body.decision === 'object' && !Array.isArray(body.decision) ? body.decision : body;
      const decision = { ...decisionBody, providerId: decisionBody.providerId || body.providerId };
      const result = service.receiveKycDecision({ idempotencyKey: idempotencyKey(req, decision.decisionId || null), decision });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'intents' && method === 'POST') {
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_FUNDING_INTENT', 'Funding intent input must be a JSON object.');
      const result = service.createFundingIntent({ idempotencyKey: idempotencyKey(req, null), amount: body.amount, amountMinor: body.amountMinor, asset: body.asset, network: body.network, providerId: body.providerId });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'intents' && method === 'GET') {
    return json(res, 200, { intent: service.getFundingStatus(segments[3]), funding: service.getFundingProjection() });
  }
  if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'intents' && segments[4] === 'simulate' && method === 'POST') {
    if (!localSimulationAuthorized(req)) throw new SandboxDomainError(403, 'LOCAL_SIMULATION_ONLY', 'This route is reserved for the explicit local funding simulation path.');
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_FUNDING_SIMULATION', 'Funding simulation input must be a JSON object.');
      const action = body.action || body.status;
      const result = service.simulateFundingIntent(segments[3], idempotencyKey(req, null), action);
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'funding' && ['webhook', 'webhooks'].includes(segments[2]) && method === 'POST') {
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_FUNDING_EVENT', 'Funding provider event must be a JSON object.');
      authorizeFundingWebhook(service, req, body);
      const eventBody = body.event && typeof body.event === 'object' && !Array.isArray(body.event) ? body.event : body;
      const event = { ...eventBody, providerId: eventBody.providerId || body.providerId };
      const result = service.receiveFundingEvent({ idempotencyKey: idempotencyKey(req, event.eventId || null), event });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'funding' && method === 'POST'
    && ((segments[2] === 'reconcile' && segments.length === 3)
      || (segments[2] === 'references' && segments.length === 5 && segments[4] === 'reconcile'))) {
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_FUNDING_RECONCILIATION', 'Funding reconciliation input must be a JSON object.');
      const providerReference = segments[2] === 'reconcile' ? body.providerReference : decodeURIComponent(segments[3]);
      const input = { ...body, providerReference };
      authorizeFundingWebhook(service, req, input);
      const key = idempotencyKey(req, `funding-reconcile-${crypto.createHash('sha256').update(providerReference || '').digest('hex')}`);
      const result = service.reconcileFundingReference({ idempotencyKey: key, providerId: input.providerId, providerReference });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'funding' && segments[2] === 'kyc' && method === 'POST'
    && ((segments[3] === 'reconcile' && segments.length === 4)
      || (segments[3] === 'references' && segments.length === 6 && segments[5] === 'reconcile'))) {
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_KYC_RECONCILIATION', 'KYC reconciliation input must be a JSON object.');
      const providerReference = segments[3] === 'reconcile' ? body.providerReference : decodeURIComponent(segments[4]);
      const input = { ...body, providerReference };
      authorizeKycWebhook(service, req, input);
      const key = idempotencyKey(req, `kyc-reconcile-${crypto.createHash('sha256').update(providerReference || '').digest('hex')}`);
      const result = service.reconcileKycReference({ idempotencyKey: key, providerId: input.providerId, providerReference });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'discovery' && method === 'GET') {
    return json(res, 200, { discovery: service.getDiscoveryProjection() });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'simulation' && segments[2] === 'resources' && method === 'GET') {
    return json(res, 200, { simulationResources: service.getSimulationResourcesProjection() });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'simulation' && segments[2] === 'resources' && segments[3] === 'restock' && method === 'POST') {
    if (!localSimulationAuthorized(req)) throw new SandboxDomainError(403, 'LOCAL_SIMULATION_ONLY', 'This route is reserved for the explicit local inventory simulation path.');
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_SIMULATED_RESTOCK', 'Simulated inventory restock input must be a JSON object.');
      const result = service.restockSimulationInventory({ idempotencyKey: idempotencyKey(req, null), sku: body.sku, quantity: body.quantity });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'GET') {
    const tasks = service.listTasks();
    return json(res, 200, { tasks, projections: tasks.map((task) => service.getTaskProjection(task.id)), simulationResources: service.getSimulationResourcesProjection(), wallet: service.getWallet(), walletTopups: service.getWalletTopups(), walletAudit: service.getWalletAudit(), funding: service.getFundingProjection(), discovery: service.getDiscoveryProjection(), mode: 'simulated local sandbox' });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'POST') {
    return readBody(req).then((body) => {
      const input = body || {};
      if (typeof input !== 'object' || Array.isArray(input)) throw new SandboxDomainError(400, 'INVALID_TASK_REQUEST', 'Task request must be a JSON object.');
      const task = service.createTask({ request: input.request, targetSite: input.targetSite ?? input.targetUrl, scenario: input.scenario || 'happy', paymentMode: input.paymentMode || 'issuer_authorization', agentMode: input.agentMode || undefined });
      return json(res, 201, { task, projection: service.getTaskProjection(task.id) });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'purchases' && segments[2] === 'run' && method === 'POST') {
    return readBody(req).then((body) => {
      const input = body || {};
      if (typeof input !== 'object' || Array.isArray(input)) throw new SandboxDomainError(400, 'INVALID_PURCHASE_RUN', 'Purchase run input must be a JSON object.');
      const fallback = `sandbox-browser-${crypto.createHash('sha256').update(JSON.stringify({ request: input.request, targetSite: input.targetSite ?? input.targetUrl, scenario: input.scenario || 'happy' })).digest('hex')}`;
      const result = service.startPurchase({ idempotencyKey: idempotencyKey(req, fallback), request: input.request, targetSite: input.targetSite ?? input.targetUrl, scenario: input.scenario || 'happy', origin: input.origin || 'operator', paymentMode: input.paymentMode || 'issuer_authorization', agentMode: input.agentMode || undefined });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'run' && method === 'POST') {
    return readBody(req).then((body) => {
      const input = body || {};
      if (typeof input !== 'object' || Array.isArray(input)) throw new SandboxDomainError(400, 'INVALID_PURCHASE_RUN', 'Purchase run input must be a JSON object.');
      const result = service.resumePurchase(segments[2], idempotencyKey(req, `sandbox-resume-${segments[2]}-${input.candidateId || 'auto'}`), input.candidateId || null);
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'GET') {
    return json(res, 200, { task: service.getTask(segments[2]), projection: service.getTaskProjection(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'projection' && method === 'GET') {
    return json(res, 200, { projection: service.getTaskProjection(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'reviewer' && method === 'GET') {
    return json(res, 200, { reviewer: service.getReviewerProjection(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'events' && method === 'GET') {
    return json(res, 200, { events: service.getAgentEvents(segments[2]) });
  }
  if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'agent' && segments[4] === 'events' && method === 'GET') {
    return json(res, 200, { events: service.getAgentEvents(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'checkpoint' && method === 'GET') {
    return json(res, 200, { checkpoint: service.getAgentCheckpoint(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'reviewer' && method === 'GET') {
    return json(res, 200, { reviewer: service.getReviewerProjectionByRun(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'reviewer' && segments[2] === 'runs' && method === 'GET') {
    return json(res, 200, { reviewer: service.getReviewerProjectionByRun(segments[3]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'audit' && method === 'GET') {
    return json(res, 200, { events: service.getAudit(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'receipt' && method === 'GET') {
    return json(res, 200, { receipt: service.getReceipt(segments[2]) });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'wallet' && segments[2] === 'simulated-top-up' && method === 'POST') {
    if (!localSimulationAuthorized(req)) throw new SandboxDomainError(403, 'LOCAL_SIMULATION_ONLY', 'This route is reserved for the explicit local wallet simulation path.');
    return readBody(req).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SandboxDomainError(400, 'INVALID_SIMULATED_TOP_UP', 'Simulated wallet funding input must be a JSON object.');
      const result = service.addSimulatedFunds({ idempotencyKey: idempotencyKey(req, null), amount: body.amount, amountMinor: body.amountMinor, asset: body.currency ?? body.asset ?? 'XSGD' });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'wallet' && method === 'GET') {
    return json(res, 200, { wallet: service.getWallet(), ledger: service.getWalletLedger(), topups: service.getWalletTopups(), audit: service.getWalletAudit() });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'catalog' && method === 'GET') {
    return json(res, 200, { catalog: service.getCatalog() });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'cards' && method === 'GET') {
    return json(res, 200, { card: service.getCardStatus(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'checkout' && segments[2] === 'sessions' && method === 'GET') {
    return json(res, 200, { session: service.getCheckoutSession(segments[3]) });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'checkout' && segments[2] === 'webhooks' && method === 'GET') {
    return json(res, 200, { webhooks: service.getCheckoutWebhooks(url.searchParams.get('sessionId')) });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'operations' && method === 'GET') {
    return json(res, 200, { operation: service.lookupOperation(segments[2]), walletTransfer: service.lookupWalletTransfer(segments[2]) });
  }
  if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'payment' && segments[4] === 'reconcile' && method === 'POST') {
    return readBody(req).then((body) => {
      const result = service.reconcilePayment(segments[2], idempotencyKey(req, `sandbox-reconcile-${segments[2]}`), body?.resolution);
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'payment' && ['refund', 'reverse'].includes(segments[4]) && method === 'POST') {
    return readBody(req).then(() => {
      const action = segments[4] === 'reverse' ? 'reversal' : 'refund';
      const result = service.refundPayment(segments[2], idempotencyKey(req, `sandbox-${action}-${segments[2]}`), action);
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'card' && method === 'GET') {
    return json(res, 200, { card: service.getCardStatus(service.getTask(segments[2]).card?.cardId) });
  }
  if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'card' && segments[4] === 'revoke' && method === 'POST') {
    return readBody(req).then((body) => {
      const result = service.revokeCard(segments[2], idempotencyKey(req, `sandbox-revoke-card-${segments[2]}`), body?.reason || 'operator');
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  throw new SandboxDomainError(404, 'ROUTE_NOT_FOUND', 'API route not found.');
}

function routeApi(service, req, res, url) {
  if (service.kind === 'sandbox') return routeSandboxApi(service, req, res, url);
  const segments = url.pathname.split('/').filter(Boolean);
  const method = req.method || 'GET';
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'reset' && method === 'POST') {
    return readBody(req).then(() => json(res, 200, { task: service.reset() }));
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'GET') {
    return json(res, 200, { tasks: service.listTasks() });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'POST') {
    return readBody(req).then((body) => {
      if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
        throw new DomainError(400, 'INVALID_TASK_REQUEST', 'Task request must be a JSON object.');
      }
      const request = body || {};
      if (request.currency !== undefined && request.currency !== 'XSGD') {
        throw new DomainError(422, 'UNSUPPORTED_CURRENCY', 'NaviPay local tasks use XSGD only.');
      }
      const task = service.createTask({
        scenario: request.scenario === undefined ? 'happy' : request.scenario,
        origin: request.origin || 'operator',
        request: request.request,
        merchant: request.merchant,
        item: request.item,
        amount: request.amount,
        amountMinor: request.amountMinor
      });
      return json(res, 201, { task });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'purchases' && segments[2] === 'run' && method === 'POST') {
    return readBody(req).then((body) => {
      if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
        throw new DomainError(400, 'INVALID_PURCHASE_RUN', 'Purchase run input must be a JSON object.');
      }
      const input = body || {};
      if (input.currency !== undefined && input.currency !== 'XSGD') {
        throw new DomainError(422, 'UNSUPPORTED_CURRENCY', 'NaviPay local runs use XSGD only.');
      }
      const fallback = `browser-run-${crypto.createHash('sha256').update(JSON.stringify({ request: input.request, merchant: input.merchant, item: input.item, amount: input.amount, scenario: input.scenario || 'happy', candidateId: input.candidateId || null })).digest('hex')}`;
      const result = service.startPurchase({
        idempotencyKey: idempotencyKey(req, fallback),
        scenario: input.scenario === undefined ? 'happy' : input.scenario,
        origin: input.origin || 'operator',
        request: input.request,
        merchant: input.merchant,
        item: input.item,
        amount: input.amount,
        amountMinor: input.amountMinor,
        candidateId: input.candidateId || null
      });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'run' && method === 'POST') {
    return readBody(req).then((body) => {
      if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
        throw new DomainError(400, 'INVALID_PURCHASE_RUN', 'Purchase run input must be a JSON object.');
      }
      const input = body || {};
      const result = service.orchestrateTask(segments[2], idempotencyKey(req, `browser-run-${segments[2]}-${input.candidateId || 'auto'}`), { candidateId: input.candidateId || null });
      return json(res, result.statusCode, { ...result.body, replayed: result.replayed });
    });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'replay' && method === 'POST') {
    return readBody(req).then(() => {
      const result = service.replayTask(segments[2], idempotencyKey(req, `browser-replay-${segments[2]}`));
      return json(res, result.statusCode, result.body);
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'GET') {
    return json(res, 200, { task: service.getTask(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'audit' && method === 'GET') {
    return json(res, 200, { events: service.getAudit(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'receipt' && method === 'GET') {
    return json(res, 200, { receipt: service.getReceipt(segments[2]) });
  }
  if (segments.length < 4 || segments[0] !== 'api' || segments[1] !== 'tasks' || method !== 'POST') {
    throw new DomainError(404, 'ROUTE_NOT_FOUND', 'API route not found.');
  }

  const taskId = segments[2];
  const action = segments.slice(3).join('/');
  const key = idempotencyKey(req, `browser-${action}`);
  return readBody(req).then((body) => {
    let result;
    switch (action) {
      case 'open':
        result = service.openTask(taskId, key);
        break;
      case 'funding/verify':
        result = service.verifyFunding(taskId, key);
        break;
      case 'discovery':
        result = service.discover(taskId, key);
        break;
      case 'quote/lock':
        result = service.lockQuote(taskId, key, body?.candidateId);
        break;
      case 'policy/approve':
        result = service.approvePolicy(taskId, key);
        break;
      case 'instrument/issue':
        result = service.issueInstrument(taskId, key);
        break;
      case 'checkout/execute':
        result = service.executeCheckout(taskId, key);
        break;
      case 'checkout/reconcile':
        result = service.reconcileCheckout(taskId, key, body?.resolution);
        break;
      default:
        throw new DomainError(404, 'ROUTE_NOT_FOUND', 'API route not found.');
    }
    return json(res, result.statusCode, result.body);
  });
}

function staticFile(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : ['/merchant-checkout/', '/checkout/'].includes(pathname) ? '/merchant-checkout.html' : pathname;
  const isArchitectureDocument = requested === '/docs/architecture.md';
  const filePath = isArchitectureDocument ? path.resolve(root, 'docs', 'architecture.md') : path.resolve(publicDirectory, `.${requested}`);
  if (!isArchitectureDocument && !filePath.startsWith(`${publicDirectory}${path.sep}`)) return false;
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function createServer({ service = makeService() } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    Promise.resolve()
      .then(() => {
        if (url.pathname.startsWith('/api/')) return routeApi(service, req, res, url);
        if (req.method !== 'GET' || !staticFile(res, url.pathname)) {
          if (!res.headersSent) json(res, 404, { error: { code: 'NOT_FOUND', message: 'Page not found.' } });
        }
      })
      .catch((error) => {
        if (!res.headersSent) sendError(res, error);
      });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`NaviPay demo running at http://127.0.0.1:${port}`);
    console.log(`Persistent local store: ${dataFile}`);
  });
}

module.exports = { createServer, makeService };
