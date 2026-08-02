const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NaviPaySandboxService } = require('../src/sandbox');
const { createServer } = require('../src/server');
const { JsonStore, MemoryStore } = require('../src/store');

function makeService(store = new MemoryStore()) {
  return new NaviPaySandboxService({ store });
}

function run(service, request, scenario = 'happy', key = `${scenario}-${request}`) {
  return service.startPurchase({ idempotencyKey: key, request, scenario });
}

test('runs keyboard, mouse, and earphone requests through the complete local product lifecycle', () => {
  for (const [request, item, category] of [
    ['I want a keyboard', 'Logitech MX Keys Mini', 'keyboards'],
    ['I want a mouse', 'Logitech MX Master 3S', 'mice'],
    ['I want earphones', 'Apple AirPods 4', 'earphones']
  ]) {
    const service = makeService();
    const result = run(service, request);
    const task = result.body.task;
    assert.equal(result.statusCode, 201);
    assert.equal(task.state, 'completed');
    assert.equal(task.request.intent.productCategory, category);
    assert.equal(task.quote.item, item);
    assert.equal(task.inventory.reservation.status, 'committed');
    assert.equal(task.funding.status, 'verified');
    assert.equal(task.funding.asset, 'XSGD');
    assert.equal(task.wallet.balanceAfterMinor, task.wallet.balanceMinor - task.quote.totalMinor);
    assert.equal(task.payment.status, 'authorized');
    assert.equal(task.merchantCredit.status, 'confirmed');
    assert.equal(task.order.status, 'confirmed');
    assert.equal(task.fulfillment.status, 'fulfilled');
    assert.equal(task.delivery.status, 'delivered');
    assert.equal(task.receipt.status, 'confirmed');
    assert.equal(task.customer.name, 'Demo Customer');
    assert.equal(task.customer.address.label, 'Fixture delivery address');
    assert.deepEqual(task.progress.map((itemProgress) => itemProgress.status), Array(12).fill('completed'));
  }
});

test('debits the fake wallet with balanced ledger legs and never repeats idempotent effects', () => {
  const service = makeService();
  const first = run(service, 'I want a mouse', 'happy', 'ledger-run');
  const task = first.body.task;
  const amount = task.quote.totalMinor;
  assert.equal(service.getWallet().balanceMinor, 50000 - amount);
  const legs = service.getWalletLedger();
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((leg) => leg.entry), ['debit', 'credit']);
  assert.equal(legs[0].transactionReference, legs[1].transactionReference);
  assert.equal(legs[0].amountMinor, legs[1].amountMinor);
  assert.equal(service.store.data.inventory[task.inventory.reservation.inventoryKey].availableQuantity, 3);
  const replay = run(service, 'I want a mouse', 'happy', 'ledger-run');
  assert.equal(replay.replayed, true);
  assert.equal(service.getWalletLedger().length, 2);
  assert.equal(service.store.data.inventory[task.inventory.reservation.inventoryKey].availableQuantity, 3);
});

test('insufficient funds and payment decline release inventory without a debit or order', () => {
  for (const scenario of ['insufficient-funds', 'payment-decline']) {
    const service = makeService();
    const result = run(service, 'I want a keyboard', scenario);
    const task = result.body.task;
    assert.equal(result.statusCode, 402);
    assert.equal(task.state, 'failed');
    assert.equal(task.order, null);
    assert.equal(task.inventory.reservation.status, 'released');
    assert.equal(service.getWallet().balanceMinor, 50000);
    assert.equal(service.getWalletLedger().length, 0);
  }
});

test('unknown payment holds stock and reconciles once without a blind retry', () => {
  const service = makeService();
  const unknown = run(service, 'I want earphones', 'unknown-payment');
  const task = unknown.body.task;
  assert.equal(task.state, 'reconciliation_required');
  assert.equal(task.payment.status, 'unknown');
  assert.equal(task.inventory.reservation.status, 'reserved');
  assert.equal(service.getWalletLedger().length, 0);
  const resolved = service.reconcilePayment(task.id, 'reconcile-once', 'authorized');
  assert.equal(resolved.body.task.state, 'completed');
  assert.equal(resolved.body.task.payment.status, 'authorized');
  assert.equal(service.getWalletLedger().length, 2);
  const replay = service.reconcilePayment(task.id, 'reconcile-once', 'authorized');
  assert.equal(replay.replayed, true);
  assert.equal(service.getWalletLedger().length, 2);
});

test('order and merchant-credit failures persist truthful compensation snapshots', () => {
  for (const scenario of ['order-failure', 'merchant-credit-failure']) {
    const service = makeService();
    const result = run(service, 'I want a keyboard', scenario);
    const task = result.body.task;
    assert.equal(result.statusCode, 502);
    assert.equal(task.failure.code, scenario === 'order-failure' ? 'ORDER_CREATION_FAILED' : 'MERCHANT_CREDIT_FAILED');
    if (scenario === 'order-failure') assert.equal(task.order.status, 'failed');
    assert.equal(task.payment.status, 'compensated');
    assert.equal(task.compensation.status, 'compensated');
    assert.equal(task.financial.balanceBeforeMinor, 50000);
    assert.equal(task.financial.balanceAfterPaymentMinor, 50000 - task.quote.totalMinor);
    assert.equal(task.financial.finalBalanceMinor, 50000);
    assert.equal(task.financial.netChargedMinor, 0);
    assert.equal(task.financial.outcome, 'compensated');
    assert.equal(task.wallet.finalBalanceMinor, 50000);
    assert.equal(task.inventory.reservation.status, 'released');
    assert.equal(service.getWallet().balanceMinor, 50000);
    assert.equal(service.getWalletLedger().length, 4);
  }
});

test('unknown authorized and declined reconciliation persist final financial outcomes', () => {
  const authorizedService = makeService();
  const authorized = run(authorizedService, 'I want earphones', 'unknown-payment');
  const authorizedTask = authorized.body.task;
  const authorizedResult = authorizedService.reconcilePayment(authorizedTask.id, 'reconcile-authorized', 'authorized');
  const completed = authorizedResult.body.task;
  assert.equal(completed.financial.balanceBeforeMinor, 50000);
  assert.equal(completed.financial.balanceAfterPaymentMinor, 50000 - completed.quote.totalMinor);
  assert.equal(completed.financial.finalBalanceMinor, 50000 - completed.quote.totalMinor);
  assert.equal(completed.financial.netChargedMinor, completed.quote.totalMinor);
  assert.equal(completed.financial.outcome, 'confirmed');

  const declinedService = makeService();
  const declined = run(declinedService, 'I want earphones', 'unknown-payment');
  const declinedResult = declinedService.reconcilePayment(declined.body.task.id, 'reconcile-declined', 'declined');
  const declinedTask = declinedResult.body.task;
  assert.equal(declinedTask.financial.balanceBeforeMinor, 50000);
  assert.equal(declinedTask.financial.balanceAfterPaymentMinor, null);
  assert.equal(declinedTask.financial.finalBalanceMinor, 50000);
  assert.equal(declinedTask.financial.netChargedMinor, 0);
  assert.equal(declinedTask.financial.outcome, 'declined');
  assert.equal(declinedService.getWalletLedger().length, 0);
});

test('financial snapshots and safe projection survive restart and reload', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-financial-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const service = makeService(new JsonStore(filePath));
    const result = run(service, 'I want a keyboard', 'order-failure', 'restart-compensation');
    const taskId = result.body.task.id;
    const reloaded = makeService(new JsonStore(filePath));
    const task = reloaded.getTask(taskId);
    const projection = reloaded.getTaskProjection(taskId);
    assert.equal(task.financial.finalBalanceMinor, 50000);
    assert.equal(projection.version, 1);
    assert.equal(projection.financial.netChargedMinor, 0);
    assert.equal(projection.timeline.some((event) => event.type === 'payment.compensated'), true);
    assert.equal(JSON.stringify(projection).includes('rawProviderPayload'), false);
    assert.equal(JSON.stringify(projection).includes('credentials'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('delivery failure preserves confirmed purchase and order status', () => {
  const service = makeService();
  const result = run(service, 'I want earphones', 'delivery-failure');
  const task = result.body.task;
  assert.equal(task.state, 'completed');
  assert.equal(task.purchaseStatus, 'confirmed');
  assert.equal(task.payment.status, 'authorized');
  assert.equal(task.order.status, 'confirmed');
  assert.equal(task.fulfillment.status, 'fulfilled');
  assert.equal(task.delivery.status, 'failed');
  assert.equal(task.receipt.status, 'confirmed');
  assert.ok(service.getAudit(task.id).some((event) => event.type === 'delivery.failed'));
});

test('out of stock stops before reservation and payment', () => {
  const service = makeService();
  const result = run(service, 'I want a mouse', 'out-of-stock');
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.task.failure.code, 'OUT_OF_STOCK');
  assert.equal(result.body.task.inventory, null);
  assert.equal(service.getWalletLedger().length, 0);
});

test('version 1 local state migrates and restart retains operations and receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-sandbox-'));
  const filePath = path.join(directory, 'state.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, tasks: {}, auditEvents: [], idempotency: {} }));
    const store = new JsonStore(filePath);
    assert.equal(store.data.version, 2);
    const service = makeService(store);
    const result = run(service, 'I want a keyboard', 'happy', 'restart-run');
    const reloaded = makeService(new JsonStore(filePath));
    assert.equal(reloaded.getTask(result.body.task.id).receipt.status, 'confirmed');
    assert.ok(reloaded.lookupOperation(result.body.task.progress.find((item) => item.stage === 'payment').operationId));
    assert.equal(reloaded.getWallet().balanceMinor, 50000 - result.body.task.quote.totalMinor);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP browser contract runs a natural request and exposes safe receipt and audit routes', async () => {
  const service = makeService();
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/api/purchases/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'http-browser-key' }, body: JSON.stringify({ request: 'I want a mouse' }) });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.task.state, 'completed');
    assert.equal(payload.task.receipt.item, 'Logitech MX Master 3S');
    assert.equal(payload.task.delivery.status, 'delivered');
    assert.equal(payload.projection.version, 1);
    assert.equal(payload.projection.quote.totalMinor, payload.task.quote.totalMinor);
    assert.equal(payload.projection.financial.finalBalanceMinor, payload.task.financial.finalBalanceMinor);
    assert.ok(payload.projection.timeline.some((event) => event.type === 'purchase.completed'));
    assert.doesNotMatch(JSON.stringify(payload.projection), /rawProviderPayload|private.?key|credentials|password|customer\.address\.lines/i);
    const projection = await fetch(`${base}/api/tasks/${payload.task.id}/projection`).then((value) => value.json());
    assert.equal(projection.projection.taskId, payload.task.id);
    const receipt = await fetch(`${base}/api/tasks/${payload.task.id}/receipt`).then((value) => value.json());
    const audit = await fetch(`${base}/api/tasks/${payload.task.id}/audit`).then((value) => value.json());
    assert.equal(receipt.receipt.status, 'confirmed');
    assert.ok(audit.events.some((event) => event.type === 'purchase.completed'));
    assert.doesNotMatch(JSON.stringify(payload), /private.?key|cvv|password|rawProviderPayload/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
