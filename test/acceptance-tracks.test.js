const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles-calm-overrides.css'), 'utf8');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex) : source.length;
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('acceptance track: customer mode is default, calm, and redacted', () => {
  assert.match(index, /data-presentation-mode="customer" aria-pressed="true"/);
  assert.match(index, /data-presentation-mode="developer" aria-pressed="false"/);
  assert.match(frontend, /readPresentationMode/);
  assert.match(frontend, /savePresentationMode/);
  assert.match(frontend, /Display preference only/);
  assert.match(frontend, /Simulation only\. No real money, order, or delivery is used\./);

  const customerSurface = section(frontend, 'function advancedDetails', 'function developerLifecycle');
  assert.doesNotMatch(customerSurface, /KYC|funding intent|MCC|issuer|authorization|capture|ledger|webhook|operation ID|provider reference|Quote ID|Cart ID/i);
  assert.match(customerSurface, /Payment details/);
  assert.match(customerSurface, /Order and delivery/);
  assert.match(frontend, /isDeveloperMode\(\) \? developerEvidence\(task\) : advancedDetails\(task\)/);
});

test('acceptance track: developer mode exposes only safe review evidence', () => {
  assert.match(frontend, /async function loadReviewer/);
  assert.match(frontend, /\/reviewer/);
  assert.match(frontend, /function developerEvidence/);
  const developerSurface = section(frontend, 'function developerLifecycle', 'function fundingPanel');
  for (const marker of [
    'Request, candidate, and rationale',
    'Quote ID',
    'Cart ID',
    'Freshness',
    'Inventory reservation',
    'Funding, KYC, and authorization',
    'Issuer state',
    'Order, fulfillment, and delivery',
    'Idempotency / replay',
    'Agent and simulation provenance'
  ]) assert.match(developerSurface, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `developer evidence missing ${marker}`);
  assert.doesNotMatch(developerSurface, /\b(PAN|CVV|private key|rawProviderPayload|cardNumber|secret)\b/i);
  assert.match(styles, /developer-evidence/);
  assert.match(styles, /presentation-mode/);
});

test('acceptance track: market research implementation keeps the canonical lifecycle and receipt', () => {
  const lifecycle = section(frontend, 'function pendingRun', 'function requestInterpretation');
  for (const boundary of ['Purchase', 'Order', 'Fulfillment', 'Delivery']) assert.match(lifecycle, new RegExp(boundary));
  assert.match(lifecycle, /aria-label="Purchase lifecycle"/);

  const receipt = section(frontend, 'function receiptPanel', 'function taskFacts');
  assert.match(receipt, /canonical-order-card/);
  assert.match(frontend, /function compactStatusRow/);
  assert.match(receipt, /receipt\.item/);
  assert.match(receipt, /receipt\.merchant/);
  assert.match(receipt, /receipt\.totalMinor/);
  assert.match(receipt, /isDeveloperMode\(\)/);

  const run = section(frontend, 'function runView', 'function updateHeader');
  assert.match(run, /hasReceipt/);
  assert.match(run, /showStages/);
  assert.match(run, /created.*running.*awaiting_selection.*reconciliation_required/s);
  assert.doesNotMatch(run, /purchaseSummary|orderStatus|What happens next/);
  assert.match(frontend, /customerOutcome/);
  assert.match(frontend, /nextActions/);
  assert.match(styles, /stage-tracker \{ grid-template-columns: repeat\(4/);
});
