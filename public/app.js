const state = { tasks: [], task: null, projection: null, discovery: null, wallet: null, ledger: [], audit: [], busy: false, error: null, targetSite: '' };
const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(minor, currency = 'XSGD') {
  if (!Number.isFinite(minor)) return 'Not available';
  return `${currency} ${(minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortId(value) {
  if (!value) return 'Not available';
  return value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
}

function modeBadge(label = 'SIMULATED') {
  return `<span class="mode-badge mode-badge-light"><span class="mode-dot"></span>${escapeHtml(label)}</span>`;
}

function discoveryView(task = state.task) {
  const quote = state.projection?.quote || task?.quote;
  const taskDiscovery = state.projection?.discovery;
  if (taskDiscovery) return taskDiscovery;
  if (quote?.discoveryStatus?.status === 'unavailable') return { source: 'seeded_catalog_fallback', label: 'Seeded catalog fallback', explanation: 'Browser discovery was unavailable, so NaviPay used its seeded local catalog instead.' };
  if (quote?.mode === 'read-only Playwright fixture') return { source: 'local_browser_fixture', label: 'Local browser fixture', explanation: 'A read-only local browser fixture recommended this item. It cannot provide the authoritative quote, inventory, or payment.' };
  return state.discovery || { source: 'seeded_catalog', label: 'Seeded catalog', explanation: 'NaviPay matched this request against its seeded local merchant catalog.' };
}

function discoveryBadge(view = discoveryView()) {
  const tone = view.source === 'local_browser_fixture' ? 'browser' : view.source === 'seeded_catalog_fallback' ? 'fallback' : 'seeded';
  return `<span class="discovery-badge ${tone}"><span class="mode-dot"></span>${escapeHtml(view.label || 'Discovery')}</span>`;
}

const statusLabels = {
  completed: 'Complete',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
  fulfilled: 'Ready',
  authorized: 'Paid',
  reserved: 'Reserved',
  committed: 'Confirmed',
  failed: 'Could not complete',
  declined: 'Not paid',
  out_of_stock: 'Out of stock',
  unknown: 'Needs confirmation',
  reconciliation_required: 'Needs confirmation',
  awaiting_selection: 'Needs a choice',
  pending: 'In progress',
  compensated: 'Reversed',
  refunded: 'Refunded',
  reversed: 'Reversed',
  retired: 'Card retired',
  captured: 'Captured',
  active: 'Issued',
  not_issued: 'Not issued',
  not_started: 'Not started'
};

function statusTone(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'committed', 'authorized', 'retired', 'captured', 'active', 'refunded', 'reversed'].includes(value)) return 'success';
  if (['failed', 'declined', 'out_of_stock'].includes(value)) return 'danger';
  if (['unknown', 'reconciliation_required', 'awaiting_selection', 'pending'].includes(value)) return 'warning';
  return 'neutral';
}

function statusPill(value) {
  const label = statusLabels[value] || String(value || 'pending').replaceAll('_', ' ');
  return `<span class="status-pill ${statusTone(value)}">${escapeHtml(label)}</span>`;
}

function dataCell(label, value, note = '') {
  return `<div class="data-cell"><span class="data-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function failureMessage(task) {
  const code = task.failure?.code;
  if (task.state === 'awaiting_selection') return task.quote?.recommendationOnly ? 'There is no single best browser match. Choose one of the tied results in Advanced details so NaviPay can cross-check the authoritative local quote before purchase.' : 'We found more than one good match. Choose the item you want in Advanced details to continue.';
  if (task.state === 'reconciliation_required') return 'The payment result is unclear. Nothing will be tried again until you confirm what happened in Advanced details.';
  if (code === 'INSUFFICIENT_FUNDS') return 'There is not enough fake balance for this purchase. Nothing was charged.';
  if (code === 'OUT_OF_STOCK') return 'The approved source has no in-stock item for this request. Nothing was charged.';
  if (code === 'SPENDING_CEILING_EXCEEDED') return 'Every available match is over the task ceiling. Nothing was charged.';
  if (code === 'AUTHORITATIVE_QUOTE_MISMATCH') return 'The browser price did not match the approved local quote. Nothing was charged.';
  if (code === 'PAYMENT_DECLINED' || code === 'PAYMENT_DECLINED_RECONCILED') return 'The payment did not go through. Nothing was charged.';
  if (code === 'DELIVERY_FAILED') return 'The purchase is confirmed, but delivery could not be completed.';
  if (code === 'FULFILLMENT_FAILED') return 'The purchase is confirmed, but the order could not be prepared.';
  if (code === 'INVALID_PURCHASE_REQUEST') return 'Tell us what you would like to buy, such as “I want a keyboard”.';
  if (code === 'DISCOVERY_DOMAIN_BLOCKED') return 'That target site is not approved. NaviPay did not fetch it and used the seeded local catalog instead.';
  if (code === 'DISCOVERY_NO_MATCH') return 'The approved site had no matching item. NaviPay used the seeded local catalog instead.';
  if (code === 'DISCOVERY_TIMEOUT') return 'The approved site took too long to answer. NaviPay used the seeded local catalog instead.';
  if (code === 'MALFORMED_DISCOVERY_DATA' || code === 'STALE_DISCOVERY_DATA' || code === 'CONTRADICTORY_DISCOVERY_DATA') return 'The approved site returned unsafe or stale product data. NaviPay used the seeded local catalog instead.';
  if (code === 'INVALID_TARGET_SITE') return 'Enter an http or https target site URL without a username or password.';
  return 'We could not complete this purchase. No unconfirmed payment was left behind.';
}

function outcome(task) {
  let tone = 'success';
  let title = 'Purchase complete';
  let message = `${task.quote?.item || 'Your item'} is paid for and on its way.`;
  if (task.state === 'completed' && task.delivery?.status === 'failed') {
    tone = 'warning';
    title = 'Purchase confirmed, delivery needs attention';
    message = 'Your payment and order are safe, but delivery could not be completed.';
  } else if (task.state === 'completed' && task.fulfillment?.status === 'failed') {
    tone = 'warning';
    title = 'Purchase confirmed, order preparation needs attention';
    message = 'Your payment and order are safe, but preparation could not be completed.';
  } else if (task.state === 'reconciliation_required') {
    tone = 'warning';
    title = 'Payment needs your confirmation';
    message = failureMessage(task);
  } else if (task.state === 'awaiting_selection') {
    tone = 'warning';
    title = task.quote?.recommendationOnly ? 'Recommendation ready' : 'Choose an item to continue';
    message = failureMessage(task);
  } else if (task.state === 'failed') {
    tone = 'danger';
    title = 'Purchase not completed';
    message = failureMessage(task);
  }
  return `<section class="outcome-banner ${tone}" role="status" aria-live="polite"><div class="outcome-icon">${tone === 'success' ? '✓' : tone === 'warning' ? '?' : '!'}</div><div><h2 id="outcome-title" tabindex="-1">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></section>`;
}

function requestCard() {
  const discovery = state.task ? discoveryView(state.task) : state.discovery || { label: 'Seeded catalog', explanation: 'NaviPay is using its seeded local merchant catalog.' };
  const configuredSite = state.discovery?.configuredSite || { label: 'Seeded catalog is the default' };
  const targetValue = escapeHtml(state.targetSite);
  return `<section class="request-card"><div class="request-copy"><span class="overline">NaviPay purchase</span><h1>What should we buy?</h1><p>Give NaviPay a plain instruction and an approved commerce site. It will discover a match, then complete the local simulated purchase.</p></div><form id="request-form" novalidate><label for="request-input">Purchase instruction</label><div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="Find an Apple Magic Keyboard" required><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${state.busy ? 'Running…' : 'Discover and purchase'}</button></div><label class="target-label" for="target-site">Target commerce site <span>(optional when configured)</span></label><input id="target-site" name="targetSite" type="url" maxlength="2048" autocomplete="url" value="${targetValue}" placeholder="http://127.0.0.1:43123/competition/"><small>Use the local replay fixture URL, or leave blank to use the configured challenge site. Unapproved sites are never fetched.</small><p class="configured-site"><span>Configured site</span><strong>${escapeHtml(configuredSite.label || 'Not configured')}</strong></p><p class="discovery-config"><span>Discovery status</span>${discoveryBadge(discovery)} ${escapeHtml(discovery.explanation)}</p><p class="form-error" id="request-error" role="alert" hidden></p></form></section>`;
}

function emptyState() {
  return `<section class="empty-start"><div class="empty-orbit" aria-hidden="true">⌁</div><span class="overline">Ready when you are</span><h2>A calmer way to buy</h2><p>Start with a simple request. NaviPay will take care of the rest using local simulated products and a fake wallet.</p><div class="example-row" aria-label="Example requests"><span>I want a keyboard</span><span>I want a mouse</span><span>I want earphones</span></div></section>`;
}

function productSummary(task) {
  const view = state.projection || {};
  const item = task.quote?.lockedSnapshot || task.quote?.candidates?.find((candidate) => candidate.id === task.quote?.selectedCandidateId) || null;
  const fallbackItem = !item ? task.quote?.candidates?.find((candidate) => candidate.id === (task.quote?.recommendedCandidateId || task.recommendation?.candidateId)) || (task.failure?.code === 'OUT_OF_STOCK' ? task.quote?.candidates?.[0] : null) : null;
  const displayItem = item || fallbackItem;
  const recommendation = task.recommendation;
  const itemName = displayItem?.item || (task.state === 'awaiting_selection' ? 'Choose an item below' : 'Not selected');
  const merchant = displayItem?.merchant || (recommendation?.status === 'unavailable' ? 'No available merchant' : 'Not selected');
  const amount = task.quote?.totalMinor ?? displayItem?.totalMinor;
  const expectedAmount = Number.isFinite(amount) ? formatMoney(amount, task.currency) : 'Not set';
  const paymentWasMade = task.payment?.status === 'authorized';
  const recommendationOnly = Boolean(view.quote?.recommendationOnly || task.quote?.recommendationOnly);
  const amountSpent = recommendationOnly ? 'Recommendation only' : paymentWasMade ? expectedAmount : task.payment ? formatMoney(0, task.currency) : (Number.isFinite(amount) ? 'Not yet paid' : 'Not set');
  const amountNote = recommendationOnly ? 'No purchase authority' : paymentWasMade ? 'Confirmed payment' : task.payment ? 'Nothing charged' : 'Expected total';
  const stockNote = displayItem?.variant || (recommendation?.reason || 'NaviPay is looking for a suitable item.');
  const itemLabel = item ? 'Item found' : fallbackItem ? 'Requested item' : 'Item';
  const breakdown = view.quote && Number.isFinite(view.quote.totalMinor) ? `<div class="quote-breakdown" aria-label="Quote breakdown">${dataCell('Subtotal', formatMoney(view.quote.subtotalMinor, view.quote.currency))}${dataCell('Shipping', formatMoney(view.quote.shippingMinor, view.quote.currency))}${dataCell('Tax', formatMoney(view.quote.taxMinor, view.quote.currency))}${dataCell('Total', formatMoney(view.quote.totalMinor, view.quote.currency))}</div>` : '';
  const rationale = displayItem?.matchReasons?.join('; ') || view.recommendation?.reason || recommendation?.reason || 'NaviPay is looking for a suitable item.';
  const receiptNote = view.receipt?.status === 'confirmed' ? `Receipt ${shortId(view.receipt.id)} is ready.` : '';
  const discovery = discoveryView(task);
  return `<section class="panel product-panel"><div class="panel-heading"><div><span class="overline">${escapeHtml(itemLabel)}</span><h2>${escapeHtml(itemName)}</h2></div>${discoveryBadge(discovery)}</div><div class="discovery-explanation"><strong>${escapeHtml(discovery.label || 'Discovery')}</strong><span>${escapeHtml(discovery.explanation || '')}</span></div><div class="product-highlight"><div><span class="product-label">Merchant</span><strong>${escapeHtml(merchant)}</strong><small>${escapeHtml(stockNote)}</small><small class="selection-reason">Why this item: ${escapeHtml(rationale)}</small></div><div class="product-amount"><span class="product-label">Amount spent</span><strong>${escapeHtml(amountSpent)}</strong><small>${escapeHtml(amountNote)}</small></div></div>${breakdown}${receiptNote ? `<p class="receipt-note">✓ ${escapeHtml(receiptNote)}</p>` : ''}</section>`;
}

function balanceSummary(task) {
  const wallet = state.wallet || {};
  const financial = state.projection?.financial || task.financial || {};
  const starting = financial.balanceBeforeMinor ?? task.wallet?.balanceMinor ?? wallet.initialBalanceMinor;
  const afterPayment = financial.balanceAfterPaymentMinor;
  const finalBalance = financial.finalBalanceMinor ?? task.wallet?.balanceAfterMinor ?? wallet.balanceMinor ?? starting;
  const currency = task.currency || wallet.currency;
  return `<section class="panel balance-panel"><div class="panel-heading"><div><span class="overline">Fake wallet</span><h2>Your balance</h2></div><span class="fixture-chip">NO REAL FUNDS</span></div><div class="balance-grid">${dataCell('Wallet before', formatMoney(starting, currency), 'Before this purchase')}${dataCell('After payment', afterPayment == null ? 'Not charged' : formatMoney(afterPayment, currency), afterPayment == null ? 'No confirmed debit' : 'After the debit')}${dataCell('Final balance', formatMoney(finalBalance, currency), financial.outcome === 'compensated' ? 'After compensation' : 'Current spendable balance')}</div></section>`;
}

function commerceStatus(task) {
  const purchase = task.state === 'failed' ? 'failed' : task.state === 'reconciliation_required' ? 'reconciliation_required' : task.state === 'awaiting_selection' ? 'awaiting_selection' : task.purchaseStatus || task.state;
  const payment = task.payment?.status || 'pending';
  const inventory = task.inventory?.status || 'not_started';
  const order = task.order?.status || (task.state === 'failed' ? 'not_started' : 'pending');
  const fulfillment = task.fulfillment?.status || 'not_started';
  const delivery = task.delivery?.status || (task.order ? 'pending' : 'not_started');
  return `<section class="panel commerce-panel"><div class="panel-heading"><div><span class="overline">At a glance</span><h2>Where things stand</h2></div>${statusPill(purchase)}</div><div class="commerce-grid">${dataCell('Inventory', statusLabels[inventory] || inventory)}${dataCell('Payment', statusLabels[payment] || payment)}${dataCell('Order', statusLabels[order] || order)}${dataCell('Fulfillment', statusLabels[fulfillment] || fulfillment)}${dataCell('Delivery', statusLabels[delivery] || delivery)}</div></section>`;
}

function cardStatus(task) {
  const projection = state.projection || {};
  const card = projection.card || task.card;
  const checkout = projection.checkout || task.checkout;
  if (!card || card.status === 'not_issued') return '';
  const safeReferenceValue = card.maskedReference || card.reference || 'Safe reference pending';
  const checkoutLabel = checkout?.status === 'authorized' ? 'Checkout captured' : checkout?.status === 'unknown' ? 'Authorization needs confirmation' : checkout?.status === 'declined' ? 'Checkout declined' : 'Checkout in progress';
  return `<section class="panel card-panel"><div class="panel-heading"><div><span class="overline">Disposable card</span><h2>Disposable card issued</h2></div>${statusPill(card.status)}</div><div class="card-status-grid">${dataCell('Safe last four / reference', safeReferenceValue, 'Credential never shown')}${dataCell('Checkout', checkoutLabel, checkout?.checkoutReference ? `Checkout ${shortId(checkout.checkoutReference)}` : 'Fresh isolated checkout context')}${dataCell('Authorization', checkout?.authorizationReference || 'Pending', 'Issuer reference only')}${dataCell('Capture', checkout?.captureReference || 'Pending', card.status === 'retired' ? 'Card retired after one capture' : 'One capture maximum')}</div></section>`;
}

const progressBands = [
  { label: 'Find an item', stages: ['intent', 'discovery', 'quote'] },
  { label: 'Pay', stages: ['inventory', 'funding', 'payment', 'merchant_credit'] },
  { label: 'Prepare order', stages: ['order', 'fulfillment'] },
  { label: 'Deliver', stages: ['delivery', 'receipt', 'audit'] }
];

function bandState(task, band) {
  const entries = band.stages.map((name) => task.progress?.find((item) => item.stage === name)).filter(Boolean);
  if (entries.some((item) => ['failed', 'unknown'].includes(item.status))) return 'warning';
  if (entries.every((item) => item.status === 'completed')) return 'success';
  if (task.automation?.status === 'running' || task.automation?.status === 'awaiting_selection' || task.automation?.status === 'awaiting_reconciliation') return 'active';
  return 'pending';
}

function bandDetail(task, band, stateName) {
  if (stateName === 'success') return 'Done';
  if (stateName === 'warning') return task.state === 'reconciliation_required' && band.label === 'Pay' ? 'Needs confirmation' : 'Needs attention';
  if (task.state === 'awaiting_selection' && band.label === 'Find an item') return task.quote?.recommendationOnly ? 'Recommendation ready' : 'Choose an item';
  if (task.state === 'reconciliation_required' && band.label === 'Pay') return 'Confirm the result';
  if (stateName === 'active') return 'In progress';
  return 'Waiting';
}

function progressPanel(task) {
  const needsAction = ['awaiting_selection', 'reconciliation_required'].includes(task.state);
  const caption = needsAction ? 'Action needed in Advanced details' : 'Runs automatically';
  return `<section class="panel progress-panel"><div class="panel-heading"><div><span class="overline">Automatic progress</span><h2>${task.state === 'completed' ? 'All done' : 'NaviPay is on it'}</h2></div><span class="progress-caption">${caption}</span></div><ol class="progress-track">${progressBands.map((band, index) => { const stateName = bandState(task, band); return `<li class="progress-step ${stateName}"><span class="progress-number">${stateName === 'success' ? '✓' : index + 1}</span><span><strong>${escapeHtml(band.label)}</strong><small>${escapeHtml(bandDetail(task, band, stateName))}</small></span></li>`; }).join('')}</ol></section>`;
}

function detailValue(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function candidateDetails(task) {
  const quote = state.projection?.quote || task.quote;
  if (!quote?.candidates?.length) return '';
  const recommendationOnly = Boolean(quote.recommendationOnly);
  const needsChoice = task.state === 'awaiting_selection';
  const selected = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === quote.recommendedCandidateId);
  const selectedEvidence = selected && (selected.sourceUrl || selected.evidence?.observedAt || selected.matchReasons?.length) ? `<div class="selection-evidence"><h4>Selected item evidence</h4><dl class="detail-list">${detailValue('Source URL', selected.sourceUrl || 'Seeded catalog - no browser URL')}${detailValue('Observed', formatDate(selected.evidence?.observedAt))}${detailValue('Match rationale', (selected.matchReasons || []).join('; ') || 'No additional rationale recorded')}</dl></div>` : '';
  const heading = recommendationOnly && needsChoice ? 'Select a discovery result' : needsChoice ? 'Choose an item' : 'Discovery details';
  const help = recommendationOnly && needsChoice ? '<p class="advanced-help">Browser discovery is read-only. Select a result to cross-check it against the approved local quote before any stock or payment action.</p>' : needsChoice ? '<p class="advanced-help">Several items fit your request. Choose one to continue. This is the only decision NaviPay needs from you.</p>' : recommendationOnly ? '<p class="advanced-help">This browser result is read-only evidence. It cannot authorize money or inventory.</p>' : '';
  return `<div class="advanced-block"><h3>${heading}</h3>${help}<div class="candidate-list">${quote.candidates.map((candidate) => `<div class="candidate-row ${candidate.id === quote.selectedCandidateId ? 'selected' : ''}"><div><strong>${escapeHtml(candidate.item)}</strong><span>${escapeHtml(candidate.merchant)} · ${escapeHtml(candidate.variant)}</span></div><div class="candidate-end"><strong>${formatMoney(candidate.totalMinor, candidate.currency)}</strong>${candidate.availability === 'in_stock' ? '<small>In stock</small>' : '<small>Out of stock</small>'}${needsChoice && candidate.availability === 'in_stock' ? `<button type="button" class="secondary-button" data-candidate-id="${escapeHtml(candidate.id)}">Select for purchase</button>` : ''}</div></div>`).join('')}</div>${selectedEvidence}</div>`;
}

function ledgerDetails(task) {
  const legs = state.ledger.filter((leg) => leg.taskId === task.id);
  if (!legs.length) return '<p class="advanced-help">No ledger legs were recorded for this purchase.</p>';
  return `<div class="ledger-list">${legs.map((leg) => `<div class="ledger-row"><span><strong>${escapeHtml(leg.entry)} · ${escapeHtml(leg.kind)}</strong><small>${escapeHtml(leg.accountId)}</small></span><strong>${formatMoney(leg.amountMinor, leg.currency)}</strong></div>`).join('')}</div>`;
}

function auditDetails() {
  if (!state.audit.length) return '<p class="advanced-help">No activity details are available yet.</p>';
  return `<ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event"><span class="audit-dot"></span><span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.type)}${event.reference ? ` · ${escapeHtml(shortId(event.reference))}` : ''}</small></span><time>${formatDate(event.occurredAt)}</time></li>`).join('')}</ol>`;
}

function advancedDetails(task) {
  const open = ['awaiting_selection', 'reconciliation_required'].includes(task.state) ? ' open' : '';
  const paymentUnknown = task.state === 'reconciliation_required' && task.payment?.status === 'unknown';
  return `<details class="advanced-details"${open}><summary>Advanced details <span>References, safeguards, and activity</span></summary><div class="advanced-content">${candidateDetails(task)}${paymentUnknown ? `<div class="advanced-block attention-block"><h3>Confirm the payment result</h3><p class="advanced-help">NaviPay will not try the payment again. Tell us whether the fake wallet approved or declined it.</p><div class="choice-actions"><button type="button" class="secondary-button" data-resolution="authorized">Payment was approved</button><button type="button" class="quiet-button" data-resolution="declined">Payment was declined</button></div></div>` : ''}<div class="advanced-block"><h3>Run information</h3><dl class="detail-list">${detailValue('Request interpretation', task.request?.intent?.productCategory || 'Not detected')}${detailValue('Run state', task.state)}${detailValue('Automation', task.automation?.status || 'Not started')}${detailValue('Next action', task.automation?.nextAction || 'None')}${task.failure ? detailValue('Recorded issue', `${task.failure.code}: ${task.failure.message}`) : ''}${detailValue('Task reference', shortId(task.id))}</dl></div><div class="advanced-block"><h3>Purchase evidence</h3><dl class="detail-list">${detailValue('Discovery source', discoveryView(task).label || 'Not available')}${detailValue('Product SKU', task.quote?.lockedSnapshot?.sku || 'Not selected')}${detailValue('Variant', task.quote?.lockedSnapshot?.variantId || 'Not selected')}${detailValue('Inventory reservation', task.inventory?.reservation?.reference || 'None')}${detailValue('Card reference', task.card?.maskedReference || task.instrument?.maskedReference || 'None')}${detailValue('Card status', task.card?.status || 'Not issued')}${detailValue('Authorization reference', task.checkout?.authorizationReference || 'None')}${detailValue('Capture reference', task.checkout?.captureReference || 'None')}${detailValue('Payment reference', task.payment?.reference || 'None')}${detailValue('Ledger transaction', task.payment?.transactionReference || 'None')}${detailValue('Checkout cleanup', task.checkoutWorker?.cleanup || 'Pending')}${detailValue('Order reference', task.order?.reference || 'None')}${detailValue('Delivery reference', task.delivery?.trackingReference || 'None')}${detailValue('Chain evidence', task.funding?.transactionReference || 'None')}${detailValue('Receipt reference', task.receipt?.id || 'None')}</dl></div><div class="advanced-block"><h3>Ledger legs</h3>${ledgerDetails(task)}</div><div class="advanced-block"><h3>Activity trail</h3><p class="advanced-help">These records are safe, simulated evidence for checking what happened behind the purchase.</p>${auditDetails()}</div></div></details>`;
}

function historyDetails() {
  if (!state.tasks.length) return '';
  return `<details class="advanced-details history-details"><summary>Previous purchases <span>${state.tasks.length} saved</span></summary><div class="history-grid">${state.tasks.map((task) => `<button type="button" class="history-item${task.id === state.task?.id ? ' current' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.request.raw)}</strong><small>${escapeHtml(task.quote?.item || 'No item selected')}</small></span>${statusPill(task.state)}</button>`).join('')}</div></details>`;
}

function currentRun(task) {
  return `<div class="run-heading"><div><span class="overline">Current purchase</span><h2>${escapeHtml(task.request.raw)}</h2></div>${modeBadge('FAKE WALLET')}</div><div class="purchase-flow">${productSummary(task)}${balanceSummary(task)}${commerceStatus(task)}${progressPanel(task)}</div>${cardStatus(task)}${advancedDetails(task)}${historyDetails()}`;
}

function render() {
  const task = state.task;
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  if (!task) {
    app.innerHTML = `${requestCard()}${emptyState()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
    bindEvents();
    return;
  }
  app.innerHTML = `${requestCard()}${outcome(task)}${currentRun(task)}<p class="footer-note">NaviPay is a local-only simulation. No real money, products, or deliveries are involved.</p>`;
  bindEvents();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'NaviPay could not complete that request.');
    error.code = payload.error?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadAudit(taskId) {
  const audit = await api(`/api/tasks/${encodeURIComponent(taskId)}/audit`);
  state.audit = audit.events || [];
}

async function refresh() {
  const payload = await api('/api/tasks');
  state.tasks = payload.tasks || [];
  state.wallet = payload.wallet || null;
  state.discovery = payload.discovery || state.discovery;
  const projections = payload.projections || [];
  if (state.task) {
    const current = state.tasks.find((task) => task.id === state.task.id);
    if (current) state.task = current;
    state.projection = projections.find((view) => view.taskId === state.task.id) || state.projection;
  }
  if (state.task) {
    await loadAudit(state.task.id);
    const walletDetails = await api('/api/wallet');
    state.ledger = walletDetails.ledger || [];
  }
}

function runKey() {
  return `browser-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function runPurchase(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const request = form.elements.request.value.trim();
  const targetSite = form.elements.targetSite.value.trim();
  const errorNode = document.querySelector('#request-error');
  if (!request) {
    errorNode.textContent = 'Enter a plain-language request first.';
    errorNode.hidden = false;
    errorNode.focus?.();
    return;
  }
  state.busy = true;
  state.error = null;
  state.targetSite = targetSite;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ request, ...(targetSite ? { targetSite } : {}) }) });
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    await refresh();
    form.elements.request.value = '';
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      await refresh().catch(() => {});
    }
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('#outcome-title')?.focus?.({ preventScroll: true });
  }
}

async function resumeTask(candidateId) {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/run`, { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ candidateId }) });
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('#outcome-title')?.focus?.({ preventScroll: true });
  }
}

async function reconcilePayment(resolution) {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/payment/reconcile`, { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ resolution }) });
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('#outcome-title')?.focus?.({ preventScroll: true });
  }
}

async function selectTask(taskId) {
  if (state.busy || taskId === state.task?.id) return;
  state.busy = true;
  state.error = null;
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    state.targetSite = payload.task.targetSite?.url || state.targetSite;
    await loadAudit(taskId);
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function bindEvents() {
  document.querySelector('#request-form')?.addEventListener('submit', runPurchase);
  document.querySelectorAll('[data-candidate-id]').forEach((button) => button.addEventListener('click', () => resumeTask(button.dataset.candidateId)));
  document.querySelectorAll('[data-resolution]').forEach((button) => button.addEventListener('click', () => reconcilePayment(button.dataset.resolution)));
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
}

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.tasks = payload.tasks || [];
    state.wallet = payload.wallet || null;
    state.discovery = payload.discovery || null;
    state.task = state.tasks[0] || null;
    state.targetSite = state.task?.targetSite?.url || '';
    state.projection = (payload.projections || []).find((view) => view.taskId === state.task?.id) || null;
    if (state.task) {
      await loadAudit(state.task.id);
      const walletDetails = await api('/api/wallet');
      state.ledger = walletDetails.ledger || [];
    }
    render();
  } catch (error) {
    app.innerHTML = `<div class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><span>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</span></div>`;
  }
}

boot();
