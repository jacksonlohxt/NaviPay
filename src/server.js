const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DomainError, NaviPayService } = require('./domain');
const { NaviPaySandboxService, SandboxDomainError } = require('./sandbox');
const { JsonStore } = require('./store');

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

function makeService() {
  return new NaviPaySandboxService({ store: new JsonStore(dataFile) });
}

function routeSandboxApi(service, req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const method = req.method || 'GET';
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'reset' && method === 'POST') {
    return readBody(req).then(() => json(res, 200, service.reset()));
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'GET') {
    const tasks = service.listTasks();
    return json(res, 200, { tasks, projections: tasks.map((task) => service.getTaskProjection(task.id)), wallet: service.getWallet(), mode: 'simulated local sandbox' });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks' && method === 'POST') {
    return readBody(req).then((body) => {
      const input = body || {};
      if (typeof input !== 'object' || Array.isArray(input)) throw new SandboxDomainError(400, 'INVALID_TASK_REQUEST', 'Task request must be a JSON object.');
      const task = service.createTask({ request: input.request, scenario: input.scenario || 'happy' });
      return json(res, 201, { task, projection: service.getTaskProjection(task.id) });
    });
  }
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'purchases' && segments[2] === 'run' && method === 'POST') {
    return readBody(req).then((body) => {
      const input = body || {};
      if (typeof input !== 'object' || Array.isArray(input)) throw new SandboxDomainError(400, 'INVALID_PURCHASE_RUN', 'Purchase run input must be a JSON object.');
      const fallback = `sandbox-browser-${crypto.createHash('sha256').update(JSON.stringify({ request: input.request, scenario: input.scenario || 'happy' })).digest('hex')}`;
      const result = service.startPurchase({ idempotencyKey: idempotencyKey(req, fallback), request: input.request, scenario: input.scenario || 'happy', origin: input.origin || 'operator' });
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
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'audit' && method === 'GET') {
    return json(res, 200, { events: service.getAudit(segments[2]) });
  }
  if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'tasks' && segments[3] === 'receipt' && method === 'GET') {
    return json(res, 200, { receipt: service.getReceipt(segments[2]) });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'wallet' && method === 'GET') {
    return json(res, 200, { wallet: service.getWallet(), ledger: service.getWalletLedger() });
  }
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'catalog' && method === 'GET') {
    return json(res, 200, { catalog: service.getCatalog() });
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
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDirectory, `.${requested}`);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) return false;
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
