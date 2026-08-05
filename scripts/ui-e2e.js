const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer } = require('../src/server');
const { NaviPaySandboxService } = require('../src/sandbox');
const { MemoryStore } = require('../src/store');

const execFileAsync = promisify(execFile);
const session = `navipay-ui-e2e-${process.pid}`;
const axiEnvironment = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: session };

async function axi(args) {
  const result = await execFileAsync('chrome-devtools-axi', args, { env: axiEnvironment, maxBuffer: 2_000_000 });
  return `${result.stdout}\n${result.stderr}`;
}

async function snapshot() {
  return axi(['snapshot']);
}

function refFor(snapshotText, pattern) {
  const line = snapshotText.split('\n').find((candidate) => pattern.test(candidate));
  assert.ok(line, `Could not find browser control matching ${pattern}`);
  const match = line.match(/uid=([^\s]+)/);
  assert.ok(match, `Could not find a browser ref in: ${line}`);
  return `@${match[1]}`;
}

async function waitForServer(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function main() {
  const service = new NaviPaySandboxService({ store: new MemoryStore() });
  const server = createServer({ service });
  const base = await waitForServer(server);
  try {
    await axi(['open', base]);
    await axi(['wait', '300']);
    let page = await snapshot();
    assert.match(page, /heading "What should we buy\?"/);
    assert.match(page, /button "Run purchase"/);
    assert.match(page, /Optional product evidence read-only and collapsed/);
    assert.doesNotMatch(page, /At a glance|Automatic progress|Disposable card issued/);

    await axi(['eval', "() => { window.__navipayFetch = window.fetch.bind(window); window.fetch = (...args) => String(args[0]).includes('/api/purchases/run') ? new Promise((resolve) => setTimeout(() => window.__navipayFetch(...args).then(resolve), 3000)) : window.__navipayFetch(...args); return 'run delay installed'; }"]);
    let control = refFor(page, /textbox "Purchase instruction"/);
    await axi(['fill', control, 'buy a Logitech mouse']);
    page = await snapshot();
    control = refFor(page, /button "Run purchase"/);
    await axi(['click', control]);
    const running = await snapshot();
    assert.match(running, /StaticText "WORKING ON IT"/);
    assert.match(running, /StaticText "Find item"/);
    await axi(['wait', '3500']);
    page = await snapshot();
    assert.match(page, /heading "Logitech MX Master 3S"/);
    assert.match(page, /XSGD 121\.50/);
    assert.match(page, /Purchase delivered/);
    assert.match(page, /DisclosureTriangle "More about this purchase/);
    assert.doesNotMatch(page, /At a glance|Automatic progress|Disposable card issued/);

    control = refFor(page, /button "Payment Summary/);
    await axi(['click', control]);
    page = await snapshot();
    assert.match(page, /dialog "Payment summary"/);
    assert.match(page, /Task-scoped demo balance/i);
    assert.match(page, /Payment status/i);
    const close = refFor(page, /button "Close payment summary"/);
    await axi(['click', close]);

    await axi(['eval', "fetch('/api/reset',{method:'POST'}).then(() => location.reload())"]);
    await axi(['wait', '350']);
    await axi(['resize', '420', '900']);
    page = await snapshot();
    assert.match(page, /heading "What should we buy\?"/);
    assert.match(page, /button "Run purchase"/);

    control = refFor(page, /textbox "Purchase instruction"/);
    await axi(['fill', control, 'buy a quantum toaster']);
    page = await snapshot();
    control = refFor(page, /button "Run purchase"/);
    await axi(['click', control]);
    await axi(['wait', '500']);
    page = await snapshot();
    assert.match(page, /No matching item found/);
    assert.match(page, /PURCHASE EFFECTS/);
    assert.match(page, /No order/);
    assert.match(page, /No receipt/);
    console.log(`UI E2E passed: idle, running, success, no-match, drawer, desktop, narrow (${base})`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
