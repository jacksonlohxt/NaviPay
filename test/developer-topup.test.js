const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { NaviPaySandboxService } = require('../src/sandbox');
const { JsonStore, MemoryStore } = require('../src/store');

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

const local = { 'X-NaviPay-Local-Simulation': 'true' };

test('simulated wallet top-up is explicit, validated, replay-safe, and server-owned', async () => {
  const { server, base } = await start(new NaviPaySandboxService({ store: new MemoryStore(), clock: () => new Date('2026-01-01T10:00:00.000Z') }));
  try {
    const unauthorized = await request(base, '/api/wallet/simulated-top-up', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'top-up-unauthorized' },
      body: JSON.stringify({ amount: '25.00', currency: 'XSGD' })
    });
    assert.equal(unauthorized.status, 403);
    assert.equal(unauthorized.payload.error.code, 'LOCAL_SIMULATION_ONLY');

    for (const [index, input] of [
      { amount: '0.00', currency: 'XSGD' },
      { amount: '-1.00', currency: 'XSGD' },
      { amount: '1.234', currency: 'XSGD' },
      { amount: '1e3', currency: 'XSGD' },
      { amount: '1000000.01', currency: 'XSGD' },
      { amount: '25.00', currency: 'USD' }
    ].entries()) {
      const invalid = await request(base, '/api/wallet/simulated-top-up', {
        method: 'POST',
        headers: { ...local, 'Idempotency-Key': `top-up-invalid-${index}` },
        body: JSON.stringify(input)
      });
      assert.equal(invalid.status, 422);
      assert.match(invalid.payload.error.message, /XSGD|positive|amount|limit/i);
    }

    const first = await request(base, '/api/wallet/simulated-top-up', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'top-up-once' },
      body: JSON.stringify({ amount: '25.00', currency: 'XSGD' })
    });
    assert.equal(first.status, 201);
    assert.equal(first.payload.replayed, false);
    assert.equal(first.payload.wallet.balanceMinor, 52500);
    assert.equal(first.payload.topup.amountMinor, 2500);
    assert.equal(first.payload.topup.mode, 'local_simulation');
    assert.equal(first.payload.ledger.filter((entry) => entry.kind === 'simulation_top_up').length, 2);
    assert.equal(first.payload.topups.length, 1);
    assert.equal(first.payload.audit.length, 1);
    assert.equal(first.payload.audit[0].type, 'wallet.top_up');
    assert.match(first.payload.topup.disclosure, /Local simulated funds only/);
    assert.doesNotMatch(JSON.stringify(first.payload), /pan|cvv|private.?key|raw.?provider|secret/i);

    const replay = await request(base, '/api/wallet/simulated-top-up', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'top-up-once' },
      body: JSON.stringify({ amount: '25.00', currency: 'XSGD' })
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.payload.replayed, true);
    assert.equal(replay.payload.wallet.balanceMinor, 52500);
    assert.equal(replay.payload.ledger.filter((entry) => entry.kind === 'simulation_top_up').length, 2);

    const reused = await request(base, '/api/wallet/simulated-top-up', {
      method: 'POST',
      headers: { ...local, 'Idempotency-Key': 'top-up-once' },
      body: JSON.stringify({ amount: '100.00', currency: 'XSGD' })
    });
    assert.equal(reused.status, 409);
    assert.equal(reused.payload.error.code, 'IDEMPOTENCY_KEY_REUSED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('simulated top-up persists across service reload and supports insufficient-funds recovery without retrying a failed task', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navipay-topup-'));
  const filePath = path.join(directory, 'state.json');
  let current = Date.parse('2026-01-01T10:00:00.000Z');
  const clock = () => new Date(current);
  try {
    const firstService = new NaviPaySandboxService({ store: new JsonStore(filePath), clock });
    const firstServer = await start(firstService);
    try {
      const topup = await request(firstServer.base, '/api/wallet/simulated-top-up', {
        method: 'POST',
        headers: { ...local, 'Idempotency-Key': 'persisted-top-up' },
        body: JSON.stringify({ amount: '100.00', currency: 'XSGD' })
      });
      assert.equal(topup.status, 201);
      assert.equal(topup.payload.wallet.balanceMinor, 60000);
    } finally {
      await new Promise((resolve) => firstServer.server.close(resolve));
    }

    const reloadedService = new NaviPaySandboxService({ store: new JsonStore(filePath), clock });
    const reloadedServer = await start(reloadedService);
    try {
      const wallet = await request(reloadedServer.base, '/api/wallet');
      assert.equal(wallet.payload.wallet.balanceMinor, 60000);
      assert.equal(wallet.payload.topups.length, 1);
      assert.equal(wallet.payload.audit.length, 1);
      assert.equal(wallet.payload.audit[0].type, 'wallet.top_up');
      assert.equal(wallet.payload.ledger.filter((entry) => entry.kind === 'simulation_top_up').length, 2);

      const insufficient = await request(reloadedServer.base, '/api/purchases/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'recovery-insufficient-purchase' },
        body: JSON.stringify({ request: 'buy an Apple Magic Keyboard', scenario: 'insufficient-funds' })
      });
      assert.equal(insufficient.status, 402);
      assert.equal(insufficient.payload.task.state, 'failed');
      assert.equal(insufficient.payload.task.failure.code, 'INSUFFICIENT_FUNDS');
      assert.equal(insufficient.payload.task.payment, null);
      assert.equal(insufficient.payload.task.progress.find((stage) => stage.stage === 'payment').status, 'skipped');
      assert.equal(insufficient.payload.task.automation.nextAction, 'Review the recorded result. No blind retry was attempted.');
      assert.equal((await request(reloadedServer.base, '/api/wallet')).payload.wallet.balanceMinor, 60000);

      const recovered = await request(reloadedServer.base, '/api/purchases/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'recovery-successful-purchase' },
        body: JSON.stringify({ request: 'buy an Apple Magic Keyboard' })
      });
      assert.equal(recovered.status, 201);
      assert.equal(recovered.payload.task.state, 'completed');
      assert.equal(recovered.payload.task.payment.status, 'authorized');
      const ledger = (await request(reloadedServer.base, '/api/wallet')).payload.ledger;
      assert.equal(ledger.filter((entry) => entry.kind === 'simulation_top_up').length, 2);
      assert.equal(ledger.filter((entry) => entry.kind === 'payment').length, 2);
      assert.equal((await request(reloadedServer.base, '/api/tasks')).payload.wallet.balanceMinor, 42828);
    } finally {
      await new Promise((resolve) => reloadedServer.server.close(resolve));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
