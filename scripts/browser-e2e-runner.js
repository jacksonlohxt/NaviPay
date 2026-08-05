const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 34000 + (process.pid % 500);
const dataFile = path.join(root, '.data', `ui-test-${process.pid}.json`);
const session = `navipay-ui-test-${process.pid}`;
const baseUrl = `http://127.0.0.1:${port}`;
const chromeEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: session };
let server;

function runChrome(args) {
  return require('node:child_process').execFileSync('chrome-devtools-axi', args, {
    cwd: root,
    env: chromeEnv,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
}

function pageText() {
  return runChrome(['eval', '() => document.body.innerText']);
}

function waitForText(pattern, attempts = 24) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = pageText();
    if (pattern.test(text)) return text;
    runChrome(['wait', '250']);
  }
  throw new Error(`Timed out waiting for ${pattern}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/tasks`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('NaviPay server did not start for UI tests.');
}

async function post(pathname, body = {}, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function assertDefaultSurface(text, label) {
  assert.match(text, /Payment|Purchase/ , `${label}: customer payment or purchase result is missing`);
  for (const jargon of ['KYC', 'funding intent', 'MCC', 'issuer', 'authorization', 'capture', 'ledger', 'webhook', 'operation ID', 'provider reference', 'SIMULATED ONLY', 'NO REAL FUNDS']) {
    assert.doesNotMatch(text, new RegExp(`\\b${jargon}\\b`, 'i'), `${label}: technical jargon leaked into the default surface: ${jargon}`);
  }
}

async function resetAndOpen() {
  await post('/api/reset');
  runChrome(['open', baseUrl]);
}

async function main() {
  fs.rmSync(dataFile, { force: true });
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NAVIPAY_DATA_FILE: dataFile },
    stdio: 'ignore'
  });
  await waitForServer();
  runChrome(['open', baseUrl]);
  runChrome(['resize', '1440', '1000']);

  let text = pageText();
  assert.match(text, /What should we buy/);
  assert.match(text, /One instruction/);
  assert.match(text, /Optional product evidence/);
  assertDefaultSurface(text, 'idle');

  // Hold the request long enough to assert the running state as a real user would see it.
  runChrome(['eval', '() => { const original = window.fetch; window.__navipayFetch = original; window.fetch = (...args) => new Promise(resolve => setTimeout(() => resolve(original(...args)), 350)); document.querySelector("#request-input").value = "buy a Logitech mouse"; document.querySelector("#request-form").requestSubmit(); return "submitted"; }']);
  text = pageText();
  assert.match(text, /Working on it|Running/);
  assert.match(text, /Find item/);
  text = waitForText(/Purchase complete/);
  assert.match(text, /Purchase complete/);
  assert.match(text, /Logitech MX Master 3S/);
  assert.match(text, /Harbor Supply/);
  assert.match(text, /XSGD 121\.50/);
  assert.match(text, /Order confirmed/);
  assert.match(text, /Delivered/);
  assert.match(text, /Receipt/);
  assert.match(text, /Technical overview/);
  assertDefaultSurface(text, 'success');
  assert.doesNotMatch(text, /More about this purchase\nEvidence, references, and activity\n[^]*Ledger transaction/);
  assert.doesNotMatch(text, /Remaining demo balance|Task-scoped demo balance/);

  // The payment drawer is secondary, human-facing, safe, and keyboard dismissible.
  runChrome(['eval', '() => { window.fetch = window.__navipayFetch || window.fetch; document.querySelector("[data-open-drawer]").click(); return "drawer-open"; }']);
  text = pageText();
  assert.match(text, /Payment summary/);
  assert.match(text, /Payment status/i);
  assert.match(text, /Card outcome/i);
  assert.match(text, /Credentials are never shown/);
  assert.match(text, /Task-scoped demo balance/i);
  assert.match(text, /This task snapshot only - never the global wallet balance/i);
  assert.doesNotMatch(text, /PAN|CVV|rawProviderPayload|secret/i);
  runChrome(['press', 'Escape']);

  // A narrow viewport keeps the purchase contract readable without horizontal overflow.
  runChrome(['resize', '390', '844']);
  const narrow = runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "narrow-ok" : `overflow-${document.documentElement.scrollWidth}`']);
  assert.match(narrow, /narrow-ok/);
  text = pageText();
  assert.match(text, /Purchase confirmed/);
  assert.match(text, /What happens next/);
  assert.doesNotMatch(text, /Remaining demo balance|Task-scoped demo balance/);
  runChrome(['eval', '() => { document.querySelector("[data-open-drawer]").click(); return "narrow-drawer-open"; }']);
  text = pageText();
  assert.match(text, /Task-scoped demo balance/i);
  runChrome(['press', 'Escape']);

  // No-match is a customer failure, not an empty technical dashboard.
  await resetAndOpen();
  await post('/api/purchases/run', { request: 'buy a holographic toaster', scenario: 'no-match' }, { 'Idempotency-Key': `ui-no-match-${process.pid}` });
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Purchase not completed/);
  assert.match(text, /No matching local item was found/);
  assert.match(text, /Nothing was reserved or paid/);
  assert.doesNotMatch(text, /Purchase confirmed|Purchase complete/);
  assertDefaultSurface(text, 'no-match');

  // Unknown payment is automatically actionable and explicitly non-retryable.
  await resetAndOpen();
  await post('/api/purchases/run', { request: 'buy a Logitech mouse', scenario: 'unknown-payment' }, { 'Idempotency-Key': `ui-unknown-${process.pid}` });
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Please confirm the payment/);
  assert.match(text, /No retry will happen/);
  assert.match(text, /Payment was approved/);
  assert.match(text, /Payment was declined/);
  assertDefaultSurface(text, 'unknown payment');

  console.log('UI assertions passed: idle, running, success, payment drawer, narrow, no-match, and unknown payment.');
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server && !server.killed) server.kill('SIGTERM');
    fs.rmSync(dataFile, { force: true });
    try {
      require('node:child_process').execFileSync('chrome-devtools-axi', ['stop'], { cwd: root, env: chromeEnv, stdio: 'ignore', timeout: 10_000 });
    } catch {}
  });
