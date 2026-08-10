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
  const source = pattern.toString();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = pageText();
    if (pattern.test(text)) return text;
    // chrome-devtools-axi truncates large eval results. Check the live DOM when
    // the returned text is truncated so a larger developer surface cannot make
    // a truthful browser assertion disappear from the test output.
    if (/truncated|chars omitted|Result was truncated/i.test(text)) {
      const liveMatch = runChrome(['eval', `() => ${source}.test(document.body.innerText)`]);
      if (/true/.test(liveMatch)) {
        const liveContext = runChrome(['eval', `() => { const value = document.body.innerText; const index = value.search(${source}); return value.slice(Math.max(0, index - 2000), index + 5000); }`]);
        return `${text}\n${liveContext}`;
      }
    }
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
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Connection: 'close', ...headers },
      body: JSON.stringify(body)
    });
    return { response, payload: await response.json() };
  } catch (error) {
    throw new Error(`POST ${baseUrl}${pathname} failed: ${error.cause?.code || error.message}`, { cause: error });
  }
}

function assertDefaultSurface(text, label) {
  assert.match(text, /Payment|Purchase/ , `${label}: customer payment or purchase result is missing`);
  for (const jargon of ['KYC', 'funding intent', 'MCC', 'issuer', 'authorization', 'capture', 'ledger', 'webhook', 'operation ID', 'provider reference', 'SIMULATED ONLY', 'NO REAL FUNDS']) {
    assert.doesNotMatch(text, new RegExp(`\\b${jargon}\\b`, 'i'), `${label}: technical jargon leaked into the default surface: ${jargon}`);
  }
  const domText = runChrome(['eval', '() => document.body.textContent']);
  for (const jargon of ['PAN', 'CVV', 'private key', 'raw provider payload', 'MCC', 'ledger', 'webhook', 'issuer-secret', 'adapter']) {
    assert.doesNotMatch(domText, new RegExp(jargon, 'i'), `${label}: technical jargon leaked into the customer DOM: ${jargon}`);
  }
  const overflow = runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "no-overflow" : `overflow-${document.documentElement.scrollWidth}`']);
  assert.match(overflow, /no-overflow/, `${label}: horizontal overflow`);
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
  runChrome(['eval', '() => { localStorage.removeItem("navipay.presentation-mode"); location.reload(); return "customer-default"; }']);
  waitForText(/What should we buy/);

  let text = pageText();
  assert.match(text, /What should we buy/);
  assert.match(text, /One instruction/);
  assert.match(text, /Optional product evidence/);
  assert.match(text, /Customer/);
  assert.match(runChrome(['eval', '() => document.querySelector("[data-presentation-mode=customer]")?.getAttribute("aria-pressed")']), /true/);
  assert.match(runChrome(['eval', '() => document.querySelector("[data-presentation-mode=developer]")?.getAttribute("aria-pressed")']), /false/);
  assert.doesNotMatch(text, /Simulation resources|Sandbox inventory|Restock simulated stock|Simulated wallet|Add simulated funds|Amount in XSGD/);
  assertDefaultSurface(text, 'idle');

  // Hold the request long enough to assert the running state as a real user would see it.
  runChrome(['eval', '() => { const original = window.fetch; window.__navipayFetch = original; window.fetch = (...args) => new Promise(resolve => setTimeout(() => resolve(original(...args)), 350)); document.querySelector("#request-input").value = "buy a Logitech mouse"; document.querySelector("#request-form").requestSubmit(); return "submitted"; }']);
  text = pageText();
  assert.match(text, /Working on it|Running/);
  assert.match(text, /Purchase/);
  assert.match(text, /Order/);
  assert.match(text, /Fulfillment/);
  assert.match(text, /Delivery/);
  text = waitForText(/Purchase delivered|Purchase complete/);
  assert.match(text, /Purchase delivered/);
  assert.match(text, /Logitech MX Master 3S/);
  assert.match(text, /Harbor Supply/);
  assert.match(text, /XSGD 121\.50/);
  assert.match(text, /Confirmed/);
  assert.match(text, /Delivered/);
  assert.match(text, /Receipt/i);
  assert.doesNotMatch(text, /Your purchase/);
  assert.doesNotMatch(text, /Purchase steps|Purchase progress|What happens next|ORDER STATUS|View receipt/i);
  assert.doesNotMatch(text, /Agent mode|Developer evidence|recorded replay/i);
  assert.match(runChrome(['eval', '() => document.querySelectorAll(".receipt-status-row").length']), /1/);
  assert.match(runChrome(['eval', '() => document.querySelector(".selection-details")?.open || false']), /false/);
  runChrome(['eval', '() => { document.querySelector(".selection-details summary")?.click(); return "opened"; }']);
  text = pageText();
  assert.match(text, /Seeded catalog - deterministic local match/);
  runChrome(['eval', '() => { const details = document.querySelector(".selection-details"); if (details) details.open = false; return "closed"; }']);
  assertDefaultSurface(text, 'success');
  assert.doesNotMatch(text, /More about this purchase\nEvidence, references, and activity\n[^]*Ledger transaction/);
  assert.doesNotMatch(text, /Remaining demo balance|Task-scoped demo balance/);

  // The explicit developer view reveals safe server-owned evidence for the same run.
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=developer]").click(); return "developer-selected"; }']);
  text = waitForText(/Developer evidence/);
  for (const evidence of ['Interpreted request', 'Quote ID', 'KYC', 'issuer', 'Order, fulfillment, and delivery', 'reconciliation', 'recorded replay']) {
    assert.match(runChrome(['eval', `() => document.querySelector(".developer-evidence")?.innerText.includes(${JSON.stringify(evidence)})`]), /true/, `developer evidence missing: ${evidence}`);
  }
  assert.match(runChrome(['eval', '() => document.querySelector("[data-presentation-mode=developer]")?.getAttribute("aria-pressed")']), /true/);
  assert.match(runChrome(['eval', '() => !/PAN|CVV|private key|rawProviderPayload|credentials\\s*:/i.test(document.body.textContent)']), /true/);
  assert.match(runChrome(['eval', '() => localStorage.getItem("navipay.presentation-mode")']), /developer/);
  assert.match(runChrome(['eval', '() => JSON.stringify({label: Boolean(document.querySelector("label[for=top-up-amount]")), described: Boolean(document.querySelector("#top-up-amount[aria-describedby]")), noOverflow: document.documentElement.scrollWidth <= window.innerWidth})']), /label.*true/);
  assert.match(runChrome(['eval', '() => JSON.stringify({label: Boolean(document.querySelector("label[for=top-up-amount]")), described: Boolean(document.querySelector("#top-up-amount[aria-describedby]")), noOverflow: document.documentElement.scrollWidth <= window.innerWidth})']), /described.*true/);
  assert.match(text, /Simulation resources/);
  assert.match(text, /Sandbox inventory/);
  assert.match(text, /Razer DeathAdder V3/);
  assert.match(runChrome(['eval', '() => JSON.stringify({restockLabel: Boolean(document.querySelector("label[for=restock-sku]")), quantityLabel: Boolean(document.querySelector("label[for=restock-quantity]")), described: Boolean(document.querySelector("#restock-quantity[aria-describedby]")), noOverflow: document.documentElement.scrollWidth <= window.innerWidth})']), /restockLabel.*true/);
  assert.match(runChrome(['eval', '() => JSON.stringify({restockLabel: Boolean(document.querySelector("label[for=restock-sku]")), quantityLabel: Boolean(document.querySelector("label[for=restock-quantity]")), described: Boolean(document.querySelector("#restock-quantity[aria-describedby]")), noOverflow: document.documentElement.scrollWidth <= window.innerWidth})']), /quantityLabel.*true/);
  assert.match(runChrome(['eval', '() => JSON.stringify({restockLabel: Boolean(document.querySelector("label[for=restock-sku]")), quantityLabel: Boolean(document.querySelector("label[for=restock-quantity]")), described: Boolean(document.querySelector("#restock-quantity[aria-describedby]")), noOverflow: document.documentElement.scrollWidth <= window.innerWidth})']), /described.*true/);

  // Developer-only simulated funding validates input, credits the server wallet, and survives refresh.
  runChrome(['eval', '() => { const input = document.querySelector("#top-up-amount"); input.value = "0.00"; document.querySelector("#top-up-form").requestSubmit(); return "invalid-top-up"; }']);
  text = waitForText(/positive XSGD amount|simulated amount must be greater than zero/i);
  assert.match(text, /positive XSGD amount|simulated amount must be greater than zero/i);
  assert.doesNotMatch(text, /Added XSGD/);
  runChrome(['eval', `() => { document.querySelector('[data-top-up-preset="25.00"]').click(); document.querySelector('#top-up-form').requestSubmit(); return 'top-up-submitted'; }`]);
  text = waitForText(/Added XSGD 25\.00/);
  assert.match(text, /XSGD 25\.00/);
  assert.match(text, /Latest local top-up/i);
  runChrome(['eval', '() => { location.reload(); return "reloading-top-up"; }']);
  text = waitForText(/Latest local top-up/i);
  assert.match(text, /XSGD 25\.00/);
  runChrome(['eval', '() => { const input = document.querySelector("#restock-quantity"); input.value = "0"; document.querySelector("#restock-form").requestSubmit(); return "invalid-restock"; }']);
  text = waitForText(/positive whole number/i);
  assert.doesNotMatch(text, /Restocked .*available stock/);
  runChrome(['eval', '() => { const select = document.querySelector("#restock-sku"); select.value = "sku-razer-deathadder-v3"; select.dispatchEvent(new Event("change", { bubbles: true })); const input = document.querySelector("#restock-quantity"); input.value = "1"; document.querySelector("#restock-form").requestSubmit(); return "restock-submitted"; }']);
  text = waitForText(/Restocked Razer DeathAdder V3/);
  assert.match(text, /available stock 0 → 1/);
  runChrome(['eval', '() => { location.reload(); return "reloading-restock"; }']);
  text = waitForText(/Latest simulated restock/i);
  assert.match(text, /Razer DeathAdder V3/);
  assert.match(text, /0 → 1/);
  runChrome(['resize', '390', '844']);
  assert.match(runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "top-up-narrow-ok" : "overflow"']), /top-up-narrow-ok/);
  runChrome(['resize', '1440', '1000']);
  const duplicateTopUp = await post('/api/wallet/simulated-top-up', { amount: '10.00', currency: 'XSGD' }, { 'Idempotency-Key': 'ui-runner-duplicate-top-up', 'X-NaviPay-Local-Simulation': 'true' });
  const duplicateTopUpReplay = await post('/api/wallet/simulated-top-up', { amount: '10.00', currency: 'XSGD' }, { 'Idempotency-Key': 'ui-runner-duplicate-top-up', 'X-NaviPay-Local-Simulation': 'true' });
  assert.equal(duplicateTopUp.response.status, 201);
  assert.equal(duplicateTopUpReplay.response.status, 201);
  assert.equal(duplicateTopUpReplay.payload.replayed, true);
  const duplicateRestock = await post('/api/simulation/resources/restock', { sku: 'sku-razer-deathadder-v3', quantity: 2 }, { 'Idempotency-Key': 'ui-runner-duplicate-restock', 'X-NaviPay-Local-Simulation': 'true' });
  const duplicateRestockReplay = await post('/api/simulation/resources/restock', { sku: 'sku-razer-deathadder-v3', quantity: 2 }, { 'Idempotency-Key': 'ui-runner-duplicate-restock', 'X-NaviPay-Local-Simulation': 'true' });
  assert.equal(duplicateRestock.response.status, 201);
  assert.equal(duplicateRestockReplay.response.status, 201);
  assert.equal(duplicateRestockReplay.payload.replayed, true);

  // The presentation preference survives a refresh, and customer mode remains one click away.
  assert.match(runChrome(['eval', '() => document.querySelector("[data-presentation-mode=developer]")?.getAttribute("aria-pressed")']), /true/);
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=customer]").click(); return "customer-selected"; }']);
  text = waitForText(/Customer view/);
  assert.doesNotMatch(text, /Developer evidence|Quote ID|KYC|recorded replay|Simulation resources|Sandbox inventory|Simulated wallet|Add simulated funds/i);
  assert.match(runChrome(['eval', '() => document.querySelector("[data-presentation-mode=customer]")?.getAttribute("aria-pressed")']), /true/);

  // A truthful out-of-stock result recovers only after a Developer restock, then reruns the public purchase path.
  await resetAndOpen();
  runChrome(['open', baseUrl]);
  waitForText(/What should we buy/);
  runChrome(['eval', '() => { const input = document.querySelector("#request-input"); input.value = "buy a Razer mouse"; document.querySelector("#request-form").requestSubmit(); return "out-of-stock-run"; }']);
  text = waitForText(/Item is out of stock/);
  assert.match(text, /Nothing was reserved or paid/);
  assert.match(text, /No order/);
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=developer]").click(); return "developer-restock-recovery"; }']);
  text = waitForText(/Simulation resources/);
  assert.match(text, /Razer DeathAdder V3/);
  runChrome(['eval', '() => { const select = document.querySelector("#restock-sku"); select.value = "sku-razer-deathadder-v3"; select.dispatchEvent(new Event("change", { bubbles: true })); const input = document.querySelector("#restock-quantity"); input.value = "1"; document.querySelector("#restock-form").requestSubmit(); return "restock-recovery-submitted"; }']);
  text = waitForText(/Restocked Razer DeathAdder V3/);
  assert.match(text, /0 → 1/);
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=customer]").click(); return "customer-recovery"; }']);
  waitForText(/Customer view/);
  runChrome(['eval', '() => { document.querySelector("[data-new-purchase]").click(); document.querySelector("#request-input").value = "buy a Razer mouse"; document.querySelector("#request-form").requestSubmit(); return "recovered-purchase"; }']);
  text = waitForText(/Purchase delivered/);
  assert.match(text, /Razer DeathAdder V3/);
  assert.doesNotMatch(text, /Item is out of stock/);

  // The payment drawer is secondary, human-facing, safe, and keyboard dismissible.
  runChrome(['eval', '() => { window.fetch = window.__navipayFetch || window.fetch; document.querySelector("[data-open-drawer]").click(); return "drawer-open"; }']);
  text = pageText();
  assert.match(text, /Payment summary/);
  assert.match(text, /Payment status/i);
  assert.match(text, /Payment method/i);
  assert.match(text, /One-use payment method/i);
  assert.match(text, /Safe reference/i);
  assert.match(text, /Task-scoped demo balance/i);
  assert.match(text, /This task snapshot only - never the global wallet balance/i);
  assert.doesNotMatch(text, /Card outcome|Virtual card outcome|Refund payment|Reverse payment/);
  assert.doesNotMatch(text, /PAN|CVV|rawProviderPayload|secret/i);
  runChrome(['press', 'Escape']);

  // A narrow viewport keeps the purchase contract readable without horizontal overflow.
  runChrome(['resize', '390', '844']);
  const narrow = runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "narrow-ok" : `overflow-${document.documentElement.scrollWidth}`']);
  assert.match(narrow, /narrow-ok/);
  text = pageText();
  assert.match(text, /Purchase confirmed/);
  assert.doesNotMatch(text, /Purchase steps|Purchase progress|What happens next|Your purchase|View receipt/i);
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
  assert.match(text, /No matching item found/);
  assert.match(text, /No purchase record|Purchase details/);
  assert.match(text, /Nothing was reserved or paid/);
  assert.match(text, /No receipt/);
  assert.doesNotMatch(text, /Purchase confirmed|Purchase complete|Purchase steps|Purchase progress|Your purchase/);
  assertDefaultSurface(text, 'no-match');

  // Unknown payment is automatically actionable and explicitly non-retryable.
  await resetAndOpen();
  await post('/api/purchases/run', { request: 'buy a Logitech mouse', scenario: 'unknown-payment' }, { 'Idempotency-Key': `ui-unknown-${process.pid}` });
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Payment status needs confirmation/);
  assert.match(text, /No automatic retry will occur/);
  assert.match(text, /No order/);
  assert.match(text, /No receipt/);
  assert.match(text, /Payment was approved/);
  assert.match(text, /Payment was declined/);
  assert.match(text, /Purchase progress/i);
  assert.doesNotMatch(text, /Your purchase|What happened/);
  assert.match(runChrome(['eval', '() => document.querySelectorAll(".advanced-details[open]").length']), /0/);
  assertDefaultSurface(text, 'unknown payment');

  // Delivery attention preserves payment, order, and receipt truth.
  await resetAndOpen();
  await post('/api/purchases/run', { request: 'buy a Logitech mouse', scenario: 'delivery-failure' }, { 'Idempotency-Key': `ui-delivery-failure-${process.pid}` });
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Delivery needs attention/);
  assert.match(text, /Paid/);
  assert.match(text, /Confirmed/);
  assert.match(text, /Purchase confirmed/);
  assert.match(text, /Needs attention/);
  assert.doesNotMatch(text, /Purchase steps|Purchase progress|What happens next|Your purchase|View receipt/i);
  assertDefaultSurface(text, 'delivery failure');

  // No-purchase states expose the reason and explicit downstream side effects.
  for (const [label, body, expected] of [
    ['over budget', { request: 'buy a keyboard', scenario: 'over-budget' }, /over the purchase limit/],
    ['ambiguity', { request: 'buy a keyboard', scenario: 'ambiguity' }, /Choose an item to continue/],
    ['out of stock', { request: 'buy a Razer mouse', scenario: 'out-of-stock' }, /Item is out of stock/],
    ['insufficient funds', { request: 'buy a keyboard', scenario: 'insufficient-funds' }, /Not enough balance/],
    ['declined payment', { request: 'buy a keyboard', scenario: 'payment-decline' }, /Payment was declined/]
  ]) {
    await resetAndOpen();
    await post('/api/purchases/run', body, { 'Idempotency-Key': `ui-${label.replaceAll(' ', '-')}-${process.pid}` });
    runChrome(['open', baseUrl]);
    text = pageText();
    assert.match(text, expected, label);
    assert.match(text, /No purchase record|Purchase details/i, label);
    assert.match(text, /No order|No confirmed order/, label);
    assert.match(text, /No receipt/, label);
    assert.doesNotMatch(text, /Your purchase|What happens next|ORDER STATUS|Purchase progress/, label);
    assertDefaultSurface(text, label);
  }

  // A developer top-up recovers a canonical purchase after a terminal insufficient-funds result.
  await resetAndOpen();
  await post('/api/purchases/run', { request: 'buy an Apple Magic Keyboard', scenario: 'insufficient-funds' }, { 'Idempotency-Key': `ui-top-up-insufficient-${process.pid}` });
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Not enough balance/);
  assert.match(text, /No payment/);
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=developer]").click(); return "developer-top-up"; }']);
  text = waitForText(/Simulated wallet/);
  assert.match(text, /XSGD 500\.00/);
  assert.match(runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "top-up-no-overflow" : "overflow"']), /top-up-no-overflow/);
  runChrome(['eval', '() => { const input = document.querySelector("#top-up-amount"); input.value = "250.00"; document.querySelector("#top-up-form").requestSubmit(); return "recovery-top-up"; }']);
  text = waitForText(/Added XSGD 250\.00/);
  assert.match(text, /XSGD 750\.00/);
  runChrome(['eval', '() => { document.querySelector("[data-presentation-mode=customer]").click(); return "customer-recovery"; }']);
  waitForText(/Customer view/);
  runChrome(['eval', '() => { document.querySelector("[data-new-purchase]").click(); document.querySelector("#request-input").value = "buy an Apple Magic Keyboard"; document.querySelector("#request-form").requestSubmit(); return "canonical-recovery-purchase"; }']);
  text = waitForText(/Purchase delivered/);
  assert.match(text, /Purchase confirmed/);
  assert.doesNotMatch(text, /Not enough balance/);

  // Unknown payment survives a reload, then uses the authoritative idempotent reconciliation route.
  await resetAndOpen();
  const unknown = await post('/api/purchases/run', { request: 'buy a Logitech mouse', scenario: 'unknown-payment' }, { 'Idempotency-Key': `ui-reload-unknown-${process.pid}` });
  const unknownTaskId = unknown.payload.task.id;
  runChrome(['open', baseUrl]);
  assert.match(pageText(), /Payment status needs confirmation/);
  const reconciled = await post(`/api/tasks/${unknownTaskId}/payment/reconcile`, { resolution: 'authorized' }, { 'Idempotency-Key': `ui-reconcile-${process.pid}` });
  assert.equal(reconciled.response.status, 200);
  runChrome(['open', baseUrl]);
  text = pageText();
  assert.match(text, /Purchase delivered/);
  assert.doesNotMatch(text, /No automatic retry will occur/);
  assert.doesNotMatch(text, /Purchase steps|Purchase progress|Your purchase|View receipt/i);
  assertDefaultSurface(text, 'reconciled payment');

  // Refund and reversal keep the immutable original receipt visible next to the current update.
  for (const kind of ['refund', 'reverse']) {
    await resetAndOpen();
    const completed = await post('/api/purchases/run', { request: 'buy a Logitech mouse' }, { 'Idempotency-Key': `ui-${kind}-purchase-${process.pid}` });
    await post(`/api/tasks/${completed.payload.task.id}/payment/${kind}`, {}, { 'Idempotency-Key': `ui-${kind}-adjust-${process.pid}` });
    runChrome(['open', baseUrl]);
    text = pageText();
    assert.match(text, kind === 'refund' ? /Payment refunded/ : /Payment reversed/);
    assert.match(text, /immutable original purchase record/);
    assert.match(text, /CURRENT PAYMENT UPDATE/i);
    assert.match(text, /XSGD 0\.00/);
    assert.doesNotMatch(text, /Purchase steps|Your purchase|View receipt/i);
    assertDefaultSurface(text, `${kind} payment`);
  }

  runChrome(['resize', '390', '844']);
  const finalNarrow = runChrome(['eval', '() => document.documentElement.scrollWidth <= window.innerWidth ? "narrow-ok" : `overflow-${document.documentElement.scrollWidth}`']);
  assert.match(finalNarrow, /narrow-ok/);
  console.log('UI assertions passed: idle, running, success, delivery, failure states, unknown reload/reconcile, refund/reversal, drawer, and narrow.');
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
