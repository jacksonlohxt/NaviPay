const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('frontend contract keeps the calm purchase path and safe secondary surfaces', () => {
  assert.match(index, /topbar-controls/);
  assert.match(index, /styles-calm-overrides/);
  assert.match(frontend, /data-example/);
  assert.match(frontend, /stage-tracker/);
  assert.match(frontend, /Find item/);
  assert.match(frontend, /Payment/);
  assert.match(frontend, /Purchase confirmed/);
  assert.match(frontend, /What happens next/);
  assert.match(frontend, /Your receipt/);
  assert.match(frontend, /Payment summary/);
  assert.match(frontend, /data-open-drawer/);
  assert.doesNotMatch(frontend, /secondary-payment-summary/);
  assert.doesNotMatch(frontend, /data-cell\('Remaining demo balance'/);
  assert.match(frontend, /Task-scoped demo balance/);
  assert.match(frontend, /never the global wallet balance/);
  assert.match(frontend, /data-payment-action="refund"/);
  assert.match(frontend, /data-payment-action="reverse"/);
  assert.match(frontend, /data-resolution="authorized"/);
  assert.match(frontend, /data-resolution="declined"/);
  assert.match(frontend, /How this purchase was chosen/);
  assert.match(frontend, /Order and delivery/);
  assert.match(frontend, /customerOutcome/);
  assert.match(frontend, /nextActions/);
  assert.match(frontend, /Purchase effects/);
  assert.doesNotMatch(frontend, /progressBands/);
});

test('frontend contract retains truthful failure language and accessible visual behavior', () => {
  for (const marker of ['no_match', 'out_of_stock', 'over_budget', 'insufficient_funds', 'declined_payment', 'payment_unknown', 'delivery_failed', 'delivery_pending', 'refunded', 'reversed']) {
    assert.match(frontend, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')));
  }
  assert.match(frontend, /No automatic retry will occur/);
  assert.match(stylesheet, /:focus-visible/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.match(stylesheet, /grid-template-columns: repeat\(3, 1fr\)/);
});
