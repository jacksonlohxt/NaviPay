const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { NaviPaySandboxService } = require('../src/sandbox');
const { JsonStore, MemoryStore } = require('../src/store');

const local = { 'X-NaviPay-Local-Simulation': 'true' };

async function start(service) {
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, payload: await response.json() };
}

function inventoryItem(resources, sku) {
  return resources.inventory.find((item) => item.sku === sku);
}

test('simulation resources projection unifies the fake wallet and seeded inventory without secrets', async () => {
  const { server, base } = await start(new NaviPaySandboxService({ store: new MemoryStore() }));
  try {
    const result = await request(base, '/api/simulation/resources');
    assert.equal(result.status, 200);
    assert.equal(result.payload.simulationResources.name, 'Simulation resources');
    assert.equal(result.payload.simulationResources.wallet.balanceMinor, 50000);
    assert.equal(inventoryItem(result.payload.simulationResources, 'sku-razer-deathadder-v3').availableQuantity, 0);
    assert.match(result.payload.simulationResources.disclosure, /simulation/i);
    assert.doesNotMatch(JSON.stringify(result.payload), /pan|cvv|private.?key|raw.?provider|secret/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('simulated inventory restock is loopback-authorized, bounded, idempotent, audited, and preserves purchase boundaries', async () => {
  const service = new NaviPaySandboxService({ store: new MemoryStore() });
  const { server, base } = await start(service);
  try {
    const unauthorized = await request(base, '/api/simulation/resources/restock', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'restock-unauthorized' },
      body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: 5 })
    });
    assert.equal(unauthorized.status, 403);
    assert.equal(unauthorized.payload.error.code, 'LOCAL_SIMULATION_ONLY');

    for (const [index, input] of [
      { sku: 'sku-razer-deathadder-v3', quantity: 0 },
      { sku: 'sku-razer-deathadder-v3', quantity: -1 },
      { sku: 'sku-razer-deathadder-v3', quantity: 1.5 },
      { sku: 'sku-razer-deathadder-v3', quantity: '1e2' },
      { sku: 'sku-razer-deathadder-v3', quantity: 101 },
      { sku: 'sku-not-seeded', quantity: 1 },
      { sku: 'sku-razer-deathadder-v3', quantity: 'five' }
    ].entries()) {
      const invalid = await request(base, '/api/simulation/resources/restock', {
        method: 'POST',
        headers: { ...local, 'Idempotency-Key': `restock-invalid-${index}` },
        body: JSON.stringify(input)
      });
      assert.equal(invalid.status, 422, JSON.stringify(input));
      assert.match(invalid.payload.error.message, /seeded|positive|whole|units|quantity/i);
    }

    const first = await request(base, '/api/simulation/resources/restock', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'restock-once' },
      body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: '5' })
    });
    assert.equal(first.status, 201);
    assert.equal(first.payload.replayed, false);
    assert.equal(first.payload.restock.item, 'Razer DeathAdder V3');
    assert.equal(first.payload.restock.availableBeforeQuantity, 0);
    assert.equal(first.payload.restock.availableAfterQuantity, 5);
    assert.equal(inventoryItem(first.payload.simulationResources, 'sku-razer-deathadder-v3').availableQuantity, 5);
    assert.equal(first.payload.simulationResources.restocks.length, 1);
    assert.equal(service.store.data.operations[first.payload.restock.operationId].stage, 'simulation_resources');
    assert.equal(service.store.data.auditEvents.filter((event) => event.type === 'inventory.restock').length, 1);
    assert.doesNotMatch(JSON.stringify(first.payload), /pan|cvv|private.?key|raw.?provider|secret/i);

    const replay = await request(base, '/api/simulation/resources/restock', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'restock-once' },
      body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: '5' })
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.payload.replayed, true);
    assert.equal(inventoryItem(replay.payload.simulationResources, 'sku-razer-deathadder-v3').availableQuantity, 5);
    assert.equal(service.store.data.auditEvents.filter((event) => event.type === 'inventory.restock').length, 1);

    const reused = await request(base, '/api/simulation/resources/restock', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'restock-once' },
      body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: '10' })
    });
    assert.equal(reused.status, 409);
    assert.equal(reused.payload.error.code, 'IDEMPOTENCY_KEY_REUSED');

    const completed = await request(base, '/api/purchases/run', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'restock-does-not-change-order' },
      body: JSON.stringify({ request: 'buy a Logitech mouse' })
    });
    assert.equal(completed.status, 201);
    const orderReference = completed.payload.task.order.reference;
    const afterOrderRestock = await request(base, '/api/simulation/resources/restock', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'restock-independent-item' },
      body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: 1 })
    });
    assert.equal(afterOrderRestock.status, 201);
    const unchangedTask = await request(base, `/api/tasks/${completed.payload.task.id}`);
    assert.equal(unchangedTask.payload.task.order.reference, orderReference);
    assert.equal(unchangedTask.payload.task.payment.status, 'authorized');
    assert.equal(unchangedTask.payload.task.inventory.reservation.status, 'committed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('restocked sandbox inventory persists across reload and recovers a truthful out-of-stock purchase', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-restock-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const firstService = new NaviPaySandboxService({ store: new JsonStore(filePath) });
    const firstServer = await start(firstService);
    try {
      const outOfStock = await request(firstServer.base, '/api/purchases/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'public-out-of-stock' },
        body: JSON.stringify({ request: 'buy a Razer mouse' })
      });
      assert.equal(outOfStock.status, 409);
      assert.equal(outOfStock.payload.task.failure.code, 'OUT_OF_STOCK');
      assert.equal(outOfStock.payload.task.payment, null);
      assert.equal(outOfStock.payload.task.order, null);
      assert.ok(outOfStock.payload.task.inventory === null || outOfStock.payload.task.inventory.reservation?.status === 'declined');

      const restocked = await request(firstServer.base, '/api/simulation/resources/restock', {
        method: 'POST',
        headers: { ...local, 'Idempotency-Key': 'public-recovery-restock' },
        body: JSON.stringify({ sku: 'sku-razer-deathadder-v3', quantity: 1 })
      });
      assert.equal(restocked.status, 201);
      assert.equal(restocked.payload.restock.availableBeforeQuantity, 0);
      assert.equal(restocked.payload.restock.availableAfterQuantity, 1);
    } finally {
      await new Promise((resolve) => firstServer.server.close(resolve));
    }

    const reloadedService = new NaviPaySandboxService({ store: new JsonStore(filePath) });
    const reloadedServer = await start(reloadedService);
    try {
      const resources = await request(reloadedServer.base, '/api/simulation/resources');
      assert.equal(inventoryItem(resources.payload.simulationResources, 'sku-razer-deathadder-v3').availableQuantity, 1);
      assert.equal(resources.payload.simulationResources.restocks[0].availableAfterQuantity, 1);

      const recovered = await request(reloadedServer.base, '/api/purchases/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'public-recovered-purchase' },
        body: JSON.stringify({ request: 'buy a Razer mouse' })
      });
      assert.equal(recovered.status, 201);
      assert.equal(recovered.payload.task.state, 'completed');
      assert.equal(recovered.payload.task.payment.status, 'authorized');
      assert.equal(recovered.payload.task.order.status, 'confirmed');
      assert.equal(recovered.payload.task.inventory.reservation.status, 'committed');
      assert.equal(inventoryItem((await request(reloadedServer.base, '/api/simulation/resources')).payload.simulationResources, 'sku-razer-deathadder-v3').availableQuantity, 0);
    } finally {
      await new Promise((resolve) => reloadedServer.server.close(resolve));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
