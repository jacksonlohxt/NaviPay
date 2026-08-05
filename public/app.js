const state = {
  tasks: [],
  task: null,
  projection: null,
  discovery: null,
  funding: null,
  ledger: [],
  audit: [],
  busy: false,
  error: null,
  targetSite: '',
  request: '',
  drawerOpen: false,
  drawerTrigger: null,
  pendingRequest: ''
};

const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(minor, currency = 'XSGD') {
  if (!Number.isFinite(minor)) return 'Not available';
  return `${currency} ${(minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSnapshotMoney(minor, currency = 'XSGD', fallback = 'No task snapshot') {
  return Number.isFinite(minor) ? formatMoney(minor, currency) : fallback;
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

const statusLabels = {
  completed: 'Complete',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
  fulfilled: 'Ready',
  authorized: 'Paid',
  reserved: 'Held',
  committed: 'Confirmed',
  failed: 'Not complete',
  declined: 'Not paid',
  out_of_stock: 'Out of stock',
  unknown: 'Needs confirmation',
  reconciliation_required: 'Needs confirmation',
  awaiting_selection: 'Choose an item',
  pending: 'In progress',
  pending_reconciliation: 'Needs confirmation',
  expired: 'Expired',
  compensated: 'Payment undone',
  refunded: 'Refunded',
  reversed: 'Reversed',
  retired: 'Retired',
  captured: 'Paid',
  active: 'Ready',
  approved: 'Approved',
  paused: 'Paused',
  rejected: 'Not approved',
  not_issued: 'Not issued',
  not_started: 'Not started',
  skipped: 'Not needed',
  no_match: 'No match',
  over_budget: 'Over limit',
  low_balance: 'Not enough balance',
  compensation_failed: 'Needs review',
  stopped: 'Stopped safely'
};

function statusTone(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'committed', 'authorized', 'retired', 'captured', 'active', 'approved'].includes(value)) return 'success';
  if (['failed', 'declined', 'rejected', 'out_of_stock', 'no_match', 'over_budget', 'low_balance', 'compensation_failed'].includes(value)) return 'attention';
  if (['unknown', 'reconciliation_required', 'awaiting_selection', 'pending', 'pending_reconciliation', 'expired', 'paused', 'refunded', 'reversed', 'compensated'].includes(value)) return 'warning';
  return 'neutral';
}

function statusPill(value, label = statusLabels[value] || String(value || 'pending').replaceAll('_', ' ')) {
  return `<span class="status-pill ${statusTone(value)}">${escapeHtml(label)}</span>`;
}

function modeBadge(label = 'Local demo') {
  return `<span class="mode-badge mode-badge-light"><span class="mode-dot"></span>${escapeHtml(label)}</span>`;
}

function dataCell(label, value, note = '') {
  return `<div class="data-cell"><span class="data-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function detailValue(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function taskRequest(task) {
  return task?.request?.raw || task?.request || 'Purchase instruction';
}

function taskProjection(task = state.task) {
  if (!task) return {};
  return state.projection?.taskId === task.id ? state.projection : state.projection || {};
}

function taskQuote(task = state.task) {
  return taskProjection(task).quote || task?.quote || {};
}

function taskFinancial(task = state.task) {
  return taskProjection(task).financial || task?.financial || {};
}

function taskPayment(task = state.task) {
  return taskProjection(task).payment || task?.payment || {};
}

function taskCard(task = state.task) {
  const projection = taskProjection(task);
  return projection.card || task?.card || task?.instrument || null;
}

function discoveryView(task = state.task) {
  const quote = taskQuote(task);
  const taskDiscovery = taskProjection(task).discovery;
  if (taskDiscovery) return taskDiscovery;
  if (quote?.discoveryStatus?.status === 'unavailable') return { source: 'seeded_catalog_fallback', label: 'Seeded catalog fallback', explanation: 'Browser discovery was unavailable, so NaviPay used its seeded local catalog instead.' };
  if (quote?.mode === 'read-only Playwright fixture') return { source: 'local_browser_fixture', label: 'Local browser fixture', explanation: 'A read-only local browser fixture recommended this item. It cannot provide the authoritative quote, inventory, or payment.' };
  return state.discovery || { source: 'seeded_catalog', label: 'Seeded catalog', explanation: 'NaviPay matched this request against its seeded local merchant catalog.' };
}

function discoveryBadge(view = discoveryView()) {
  const tone = view.source === 'local_browser_fixture' ? 'browser' : view.source === 'seeded_catalog_fallback' ? 'fallback' : 'seeded';
  return `<span class="discovery-badge ${tone}"><span class="mode-dot"></span>${escapeHtml(view.label || 'Discovery')}</span>`;
}

function customerOutcome(task = state.task) {
  return taskProjection(task).customerOutcome || {
    tone: 'warning',
    code: 'processing',
    title: 'Purchase in progress',
    message: 'NaviPay is preparing the next update.',
    sideEffects: {}
  };
}

function nextActions(task = state.task) {
  return taskProjection(task).nextActions || [];
}

function paymentOutcome(task) {
  const payment = taskPayment(task);
  if (payment.status === 'refunded') return 'refunded';
  if (payment.status === 'reversed') return 'reversed';
  return payment.status;
}

function outcome(task) {
  const value = customerOutcome(task);
  const tone = ['success', 'warning', 'attention'].includes(value.tone) ? value.tone : 'warning';
  return `<section class="outcome-banner ${tone}" role="status" aria-live="polite"><div class="outcome-icon" aria-hidden="true">${tone === 'success' ? '✓' : tone === 'warning' ? '?' : '!'}</div><div><h2 id="outcome-title" tabindex="-1">${escapeHtml(value.title)}</h2><p>${escapeHtml(value.message)}</p></div></section>`;
}

function requestCard() {
  const discovery = state.discovery || { label: 'Seeded catalog', explanation: 'NaviPay is using its seeded local merchant catalog.' };
  const configuredSite = state.discovery?.configuredSite || { label: 'Seeded catalog is the default' };
  const targetValue = escapeHtml(state.targetSite);
  const submitLabel = state.busy ? 'Running…' : 'Run purchase';
  return `<section class="request-card"><div class="request-copy"><span class="overline">One instruction</span><h1>What should we buy<span class="accent-mark">?</span></h1><p>Type it once. NaviPay finds the item, pays, and keeps the order moving.</p><p class="local-disclosure">Local demo: simulated catalog, wallet, and delivery. No real money.</p></div><form id="request-form" novalidate><label for="request-input">Purchase instruction</label><div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="buy a Logitech mouse" value="${escapeHtml(state.request)}" required${state.busy ? ' disabled' : ''}><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${submitLabel}</button></div><div class="example-row" aria-label="Example requests"><button type="button" class="example-chip" data-example="buy an Apple Magic Keyboard">buy an Apple Magic Keyboard</button><button type="button" class="example-chip" data-example="buy a Logitech mouse">buy a Logitech mouse</button><button type="button" class="example-chip" data-example="buy earphones">buy earphones</button></div><p class="local-path"><span>Shopping with</span><strong>Seeded local merchants</strong></p><details class="optional-discovery"><summary>Optional product evidence <span>read-only and collapsed</span></summary><div class="optional-discovery-content"><label class="target-label" for="target-site">Approved target commerce site <span>(optional)</span></label><input id="target-site" name="targetSite" type="url" maxlength="2048" autocomplete="url" value="${targetValue}" placeholder="http://127.0.0.1:43123/competition/"><small>Only an allowlisted local replay site may be read. It cannot reserve stock, take payment, or place an order.</small><p class="configured-site"><span>Configured site</span><strong>${escapeHtml(configuredSite.label || 'Not configured')}</strong></p><p class="discovery-config"><span>Evidence status</span>${discoveryBadge(discovery)} ${escapeHtml(discovery.explanation || '')}</p></div></details><p class="form-error" id="request-error" role="alert" hidden></p></form><p class="composer-footnote">Find item <span>→</span> pay <span>→</span> order</p></section>`;
}

function emptyState() {
  return `<section class="empty-state"><span class="overline">Ready when you are</span><h2>One instruction. One clear result.</h2><p>NaviPay keeps the work behind the scenes and puts the item, order, and receipt first.</p></section>`;
}

function pendingRun() {
  const stages = [
    { label: 'Find item', status: 'active', detail: 'checking local merchants…' },
    { label: 'Payment', status: 'pending', detail: 'waiting' },
    { label: 'Order', status: 'pending', detail: 'waiting' }
  ];
  return `<section class="pending-run" aria-live="polite"><span class="overline">Working on it</span><h1>${escapeHtml(state.pendingRequest || state.request)}</h1><p class="run-log"><span aria-hidden="true">&gt;</span> checking the item and price<span class="caret" aria-hidden="true"></span></p>${stageTracker(stages)}</section>`;
}

function stageTracker(stages) {
  return `<ol class="stage-tracker" aria-label="Purchase stages">${stages.map((stage, index) => `<li class="stage-item ${escapeHtml(stage.status)}"><span class="stage-number" aria-hidden="true">${stage.status === 'complete' ? '✓' : index + 1}</span><span class="stage-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.detail || '')}</small></span></li>`).join('')}</ol>`;
}

function lifecycleStages(task) {
  if (!task) return [
    { label: 'Find item', status: 'pending', detail: 'waiting' },
    { label: 'Payment', status: 'pending', detail: 'waiting' },
    { label: 'Order', status: 'pending', detail: 'waiting' }
  ];
  const quote = taskQuote(task);
  const card = taskCard(task);
  const payment = taskPayment(task);
  const outcomeCode = customerOutcome(task).code;
  const progress = taskProjection(task).progress || task.progress || [];
  const progressStatus = (name) => progress.find((item) => item.stage === name)?.status;
  const discoveryFailed = ['no_match', 'invalid_request', 'over_budget', 'out_of_stock'].includes(outcomeCode) || progressStatus('discovery') === 'failed' || progressStatus('quote') === 'failed';
  const discoveryActive = task.state === 'awaiting_selection' || task.state === 'created' || task.state === 'running';
  const discoveryComplete = !discoveryFailed && !discoveryActive && (progressStatus('discovery') === 'completed' || progressStatus('quote') === 'completed' || quote.locked || quote.quoteStatus === 'locked');
  const itemStage = discoveryFailed
    ? { status: 'attention', detail: outcomeCode === 'over_budget' ? 'over purchase limit' : outcomeCode === 'no_match' ? 'no match found' : outcomeCode === 'out_of_stock' ? 'out of stock' : 'stopped safely' }
    : discoveryActive
      ? { status: 'active', detail: task.state === 'awaiting_selection' ? 'choose an item' : 'checking local merchants…' }
      : discoveryComplete ? { status: 'complete', detail: quote.item || 'item found' } : { status: 'pending', detail: 'waiting' };
  const paymentFailed = ['invalid_request', 'insufficient_funds', 'over_budget', 'out_of_stock', 'no_match', 'declined_payment'].includes(outcomeCode);
  const paymentComplete = payment.status && ['authorized', 'refunded', 'reversed', 'compensated'].includes(payment.status);
  const paymentStage = task.state === 'reconciliation_required' || payment.status === 'unknown'
    ? { status: 'active', detail: 'needs your confirmation' }
    : paymentFailed || ['declined', 'rejected'].includes(payment.status)
      ? { status: 'attention', detail: payment.status === 'declined' ? 'not paid' : 'not started' }
      : paymentComplete
        ? { status: 'complete', detail: paymentOutcome(task) === 'refunded' ? 'refunded' : paymentOutcome(task) === 'reversed' ? 'reversed' : 'paid' }
        : { status: 'pending', detail: card?.status ? 'preparing payment' : 'waiting' };
  const orderNeedsAttention = ['attention', 'failed'].includes(customerOutcome(task).sideEffects?.fulfillment?.status) || customerOutcome(task).sideEffects?.delivery?.status === 'failed';
  const orderComplete = ['completed', 'delivered', 'delivery_pending', 'delivery_failed', 'refund', 'reversal'].includes(outcomeCode) && payment.status !== 'unknown';
  const orderStage = orderComplete
    ? { status: orderNeedsAttention ? 'attention' : 'complete', detail: task.delivery?.status === 'failed' ? 'delivery needs attention' : task.fulfillment?.status === 'failed' ? 'preparation delayed' : 'confirmed' }
    : { status: 'pending', detail: task.order ? 'confirming order' : 'waiting' };
  return [
    { label: 'Find item', ...itemStage },
    { label: 'Payment', ...paymentStage },
    { label: 'Order', ...orderStage }
  ];
}

function requestInterpretation(task) {
  const intent = task?.request?.intent || {};
  const categoryLabels = { mice: 'mouse', keyboards: 'keyboard', earphones: 'earphones' };
  return [intent.brand, intent.product || categoryLabels[intent.productCategory] || intent.productCategory, intent.quantity > 1 ? `${intent.quantity} items` : ''].filter(Boolean).join(' ') || taskRequest(task);
}

function selectedCandidate(task) {
  const quote = taskQuote(task);
  return quote.lockedSnapshot || quote.candidates?.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates?.find((candidate) => candidate.id === quote.recommendedCandidateId) || quote;
}

function purchaseFacts(task) {
  const receipt = taskProjection(task).receipt || task.receipt;
  const candidate = selectedCandidate(task) || {};
  return {
    item: receipt?.item || candidate.item || '',
    merchant: receipt?.merchant || candidate.merchant || '',
    variant: receipt?.variant || candidate.variant || '',
    total: receipt?.totalMinor ?? candidate.totalMinor,
    currency: receipt?.currency || candidate.currency || task.currency || 'XSGD'
  };
}

function matchReason(task) {
  const candidate = selectedCandidate(task) || {};
  const reasons = candidate.matchReasons || taskQuote(task).recommendation?.reason || task.recommendation?.reason;
  return Array.isArray(reasons) ? reasons.join('; ') : reasons || '';
}

function selectionDetails(task, { open = false, includeCandidates = false } = {}) {
  const interpretation = requestInterpretation(task);
  const reason = matchReason(task);
  const source = discoveryView(task);
  const provenance = source.source === 'local_browser_fixture'
    ? `${source.label} - read-only local replay evidence`
    : `${source.label || 'Seeded catalog'} - deterministic local match`;
  if (!interpretation && !reason && !includeCandidates) return '';
  return `<details class="evidence-group selection-details"${open ? ' open' : ''}><summary>How this was chosen <span>Interpretation and rationale</span></summary><div class="evidence-content"><dl class="detail-list">${detailValue('Interpreted as', interpretation)}${detailValue('Matched because', reason || 'Request matched the selected item')}${detailValue('Source', provenance)}</dl>${includeCandidates ? candidateDetails(task) : ''}</div></details>`;
}

function statusToneFor(effect) {
  if (['paid', 'confirmed', 'delivered', 'prepared', 'ready'].includes(effect?.status)) return 'complete';
  if (['needs_confirmation', 'pending', 'processing'].includes(effect?.status)) return 'active';
  if (['failed', 'attention', 'not_paid', 'not_confirmed'].includes(effect?.status)) return 'attention';
  return 'pending';
}

function compactStatusCell(label, effect, detail = '') {
  const value = effect?.label || 'Not available';
  return `<div class="receipt-status-cell ${statusToneFor(effect)}" role="listitem" aria-label="${escapeHtml(`${label}: ${value}`)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function compactStatusRow(task) {
  const effects = customerOutcome(task).sideEffects || {};
  const fulfillment = effects.fulfillment || {};
  const preparationRelevant = ['processing', 'attention'].includes(fulfillment.status);
  const orderDetail = preparationRelevant ? `Preparation: ${fulfillment.label}` : '';
  const deliveryDetail = effects.delivery?.status === 'failed' ? 'Delivery could not be completed.' : '';
  return `<div class="receipt-status-row" role="list" aria-label="Payment, order, and delivery status">${compactStatusCell('Payment', effects.payment)}${compactStatusCell('Order', effects.order, orderDetail)}${compactStatusCell('Delivery', effects.delivery, deliveryDetail)}</div>`;
}

// Unknown-payment safety remains explicit in the outcome projection: No automatic retry will occur.
function nextActionControls(task, { receiptVisible = false } = {}) {
  const actions = nextActions(task).filter((action) => action.enabled && !(receiptVisible && action.id === 'view_receipt'));
  if (!actions.length) return '';
  const controls = actions.map((action) => {
    if (action.id === 'reconcile_payment') {
      return `<div class="next-action-choice"><strong>${escapeHtml(action.label)}</strong><small>Choose the result that actually occurred.</small><div class="choice-actions"><button type="button" class="secondary-button" data-resolution="authorized">Payment was approved</button><button type="button" class="quiet-button" data-resolution="declined">Payment was declined</button></div></div>`;
    }
    if (action.id === 'choose_item') return `<button type="button" class="secondary-button" data-open-details="selection">${escapeHtml(action.label)}</button>`;
    if (action.id === 'view_details') return `<button type="button" class="quiet-button" data-open-details="purchase">${escapeHtml(action.label)}</button>`;
    if (action.id === 'new_purchase') return `<button type="button" class="quiet-button" data-new-purchase>${escapeHtml(action.label)}</button>`;
    return '';
  }).join('');
  return `<footer class="receipt-footer" aria-label="Next action"><span class="overline">Next action</span><div class="next-actions-list">${controls}</div></footer>`;
}

function terminalDisclosure() {
  return '<p class="terminal-disclosure">Local demo. No real money or delivery is used.</p>';
}

function attemptedPurchasePanel(task) {
  const outcomeValue = customerOutcome(task);
  const facts = purchaseFacts(task);
  const hasFacts = facts.item || Number.isFinite(facts.total);
  const title = facts.item || (outcomeValue.purchaseEntered ? 'Purchase details' : 'No purchase record');
  const merchantLine = facts.merchant ? `${facts.merchant}${facts.variant ? ` · ${facts.variant}` : ''}` : 'No item was selected';
  const amount = Number.isFinite(facts.total) ? `<strong class="receipt-total">${formatMoney(facts.total, facts.currency)}</strong>` : statusPill(task.state);
  const choiceOpen = task.state === 'awaiting_selection';
  const receiptStatus = outcomeValue.sideEffects?.receipt;
  const receiptNote = receiptStatus?.status === 'not_started' ? '<p class="attempted-purchase-note">No receipt was issued.</p>' : '';
  return `<section class="attempted-purchase-panel" aria-labelledby="attempted-purchase-title"><div class="panel-heading"><div><span class="overline">${hasFacts ? 'Purchase details' : 'Purchase record'}</span><h2 id="attempted-purchase-title">${escapeHtml(title)}</h2><p class="merchant-line">${escapeHtml(merchantLine)}</p></div>${amount}</div>${compactStatusRow(task)}${receiptNote}${selectionDetails(task, { open: choiceOpen, includeCandidates: choiceOpen })}${nextActionControls(task)}${terminalDisclosure()}</section>`;
}

function receiptAdjustment(adjustment, currency) {
  if (!adjustment) return '';
  const statusLabel = adjustment.status === 'failed' ? 'Payment update needs review' : adjustment.kind === 'reversal' ? 'Payment reversed' : 'Payment refunded';
  const netCharged = formatMoney(adjustment.netChargedMinor, currency);
  return `<div class="receipt-adjustment"><div class="panel-heading"><div><span class="overline">Current payment update</span><h3>${escapeHtml(statusLabel)}</h3></div>${statusPill(adjustment.status, adjustment.status === 'failed' ? 'Needs review' : statusLabel)}</div><p class="receipt-adjustment-note">The receipt above is the immutable original purchase record. This update shows the current payment status and net amount.</p><div class="balance-grid">${dataCell('Payment now', statusLabels[adjustment.currentPaymentStatus] || adjustment.currentPaymentStatus || 'Not available')}${dataCell('Net payment', netCharged)}${dataCell('Returned', formatMoney(adjustment.netRefundedMinor, currency))}</div><details class="receipt-details"><summary>Payment reference</summary><dl class="detail-list">${detailValue('Update reference', shortId(adjustment.reference))}${detailValue('Recorded', formatDate(adjustment.occurredAt))}</dl></details></div>`;
}

function receiptPanel(task) {
  const receipt = taskProjection(task).receipt || task.receipt;
  if (!receipt || receipt.status !== 'confirmed') return '';
  const currency = receipt.currency || task.currency || 'XSGD';
  const paymentStatus = paymentOutcome(task) || receipt.paymentStatus;
  return `<section class="receipt-panel canonical-order-card" aria-labelledby="receipt-title"><div class="panel-heading"><div><span class="overline">Your receipt</span><h2 id="receipt-title">Purchase confirmed</h2></div>${statusPill(paymentStatus === 'refunded' || paymentStatus === 'reversed' ? paymentStatus : receipt.status, paymentStatus === 'refunded' ? 'Refunded' : paymentStatus === 'reversed' ? 'Reversed' : 'Confirmed')}</div><div class="receipt-heading"><div><strong>${escapeHtml(receipt.item || 'Item')}</strong><small>${escapeHtml(receipt.merchant || 'Merchant')}${receipt.variant ? ` · ${escapeHtml(receipt.variant)}` : ''}</small></div><strong>${formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency)}</strong></div><p class="receipt-capture-note">Original payment recorded on ${escapeHtml(formatDate(receipt.issuedAt))}. This receipt keeps the original purchase facts.</p>${compactStatusRow(task)}<details class="receipt-details"><summary>View price details</summary><div class="quote-breakdown">${dataCell('Item', formatMoney(receipt.subtotalMinor, currency))}${dataCell('Shipping', formatMoney(receipt.shippingMinor, currency))}${dataCell('Tax', formatMoney(receipt.taxMinor, currency))}${dataCell('Total', formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency))}</div></details>${selectionDetails(task)}${receiptAdjustment(receipt.adjustment, currency)}<details class="receipt-details receipt-references"><summary>Receipt references</summary><dl class="detail-list">${detailValue('Receipt reference', shortId(receipt.id))}${detailValue('Payment reference', shortId(receipt.paymentReference))}${detailValue('Order reference', shortId(receipt.orderReference))}${detailValue('Purchase record', `${shortId(receipt.quoteId)} / ${shortId(receipt.cartId)}`)}${detailValue('Issued', formatDate(receipt.issuedAt))}</dl></details>${nextActionControls(task, { receiptVisible: true })}${terminalDisclosure()}</section>`;
}

function taskFacts() {
  return '';
}

function candidateDetails(task) {
  const quote = taskQuote(task);
  if (!quote?.candidates?.length) return '';
  const recommendationOnly = Boolean(quote.recommendationOnly);
  const browserRecommendation = recommendationOnly && quote.mode === 'read-only Playwright fixture';
  const needsChoice = task.state === 'awaiting_selection';
  const selected = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === quote.recommendedCandidateId);
  const selectedEvidence = selected && (selected.sourceUrl || selected.evidence?.observedAt || selected.matchReasons?.length) ? `<div class="selection-evidence"><h4>Selected item evidence</h4><dl class="detail-list">${detailValue('Source URL', selected.sourceUrl || 'Seeded catalog - no browser URL')}${detailValue('Observed', formatDate(selected.evidence?.observedAt))}${detailValue('Match rationale', (selected.matchReasons || []).join('; ') || 'No additional rationale recorded')}</dl></div>` : '';
  const heading = browserRecommendation && needsChoice ? 'Select a discovery result' : needsChoice ? 'Choose an item' : 'Discovery details';
  const help = browserRecommendation && needsChoice ? 'Browser discovery is read-only. Select a result to cross-check it against the approved local quote before any stock or payment action.' : needsChoice ? 'Several local items fit your request. Choose one to continue. This is the only decision NaviPay needs from you.' : browserRecommendation ? 'This browser result is read-only evidence. It cannot authorize money or inventory.' : '';
  return `<div class="advanced-block"><h3>${heading}</h3>${help ? `<p class="advanced-help">${escapeHtml(help)}</p>` : ''}<div class="candidate-list">${quote.candidates.map((candidate) => `<div class="candidate-row ${candidate.id === quote.selectedCandidateId ? 'selected' : ''}"><div><strong>${escapeHtml(candidate.item)}</strong><span>${escapeHtml(candidate.merchant)} · ${escapeHtml(candidate.variant)}</span></div><div class="candidate-end"><strong>${formatMoney(candidate.totalMinor, candidate.currency)}</strong><small>${candidate.availability === 'in_stock' ? 'In stock' : 'Out of stock'}</small>${needsChoice && candidate.availability === 'in_stock' ? `<button type="button" class="secondary-button" data-candidate-id="${escapeHtml(candidate.id)}">Select for purchase</button>` : ''}</div></div>`).join('')}</div>${selectedEvidence}</div>`;
}

function ledgerDetails(task) {
  const legs = state.ledger.filter((leg) => leg.taskId === task.id);
  if (!legs.length) return '<p class="advanced-help">No ledger legs were recorded for this purchase.</p>';
  return `<div class="ledger-list">${legs.map((leg) => `<div class="ledger-row"><span><strong>${escapeHtml(leg.entry)} · ${escapeHtml(leg.kind)}</strong><small>${escapeHtml(leg.accountId)}</small></span><strong>${formatMoney(leg.amountMinor, leg.currency)}</strong></div>`).join('')}</div>`;
}

function customerActivitySummary(event) {
  if (event.type?.startsWith('delivery.')) return event.status === 'success' ? 'Delivery update recorded.' : 'Delivery needs attention.';
  if (event.type?.startsWith('fulfillment.')) return event.status === 'success' ? 'Order preparation update recorded.' : 'Order preparation needs attention.';
  if (event.type?.startsWith('order.')) return event.status === 'success' ? 'Order update recorded.' : 'Order confirmation needs attention.';
  if (event.type?.startsWith('payment.')) return event.status === 'success' ? 'Payment update recorded.' : 'Payment needs attention.';
  if (event.type?.startsWith('receipt.')) return 'Receipt update recorded.';
  if (event.type?.startsWith('discovery.')) return 'Item search update recorded.';
  return 'Purchase update recorded.';
}

function auditDetails() {
  if (!state.audit.length) return '<p class="advanced-help">No activity details are available yet.</p>';
  return `<ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event"><span class="audit-dot" aria-hidden="true"></span><span><strong>${escapeHtml(customerActivitySummary(event))}</strong><small>Purchase update${event.reference ? ` · ${escapeHtml(shortId(event.reference))}` : ''}</small></span><time>${formatDate(event.occurredAt)}</time></li>`).join('')}</ol>`;
}

function advancedDetails(task) {
  const open = task.state === 'awaiting_selection' ? ' open' : '';
  const payment = taskPayment(task);
  const projection = taskProjection(task);
  const quote = taskQuote(task);
  const card = taskCard(task);
  const checkout = projection.checkout || task.checkout || {};
  const authorization = projection.authorization?.decision || task.authorizationDecision;
  const paymentDetails = `<details class="evidence-group"><summary>Payment details <span>Payment status and safeguards</span></summary><div class="evidence-content"><dl class="detail-list">${detailValue('Payment status', statusLabels[payment.status] || payment.status || 'Not started')}${detailValue('Amount', payment.amountMinor ? formatMoney(payment.amountMinor, payment.currency || task.currency) : formatSnapshotMoney(quote.totalMinor, task.currency || 'XSGD', 'Not available'))}${detailValue('Payment method', card ? 'One-use payment method' : 'Not available')}${detailValue('Safe reference', shortId(card?.maskedReference || payment.reference || 'None'))}${detailValue('Adjustment', statusLabels[payment.adjustmentStatus] || payment.adjustmentStatus || 'Not adjusted')}</dl><details class="receipt-details"><summary>More payment references</summary><dl class="detail-list">${detailValue('Payment approval reference', checkout.authorizationReference || 'None')}${detailValue('Payment completion reference', checkout.captureReference || 'None')}${detailValue('Payment reference', payment.reference || 'None')}${detailValue('Payment update reference', payment.adjustmentReference || 'None')}${detailValue('Decision', authorization?.decisionId || 'None')}</dl></details></div></details>`;
  const orderDetails = `<details class="evidence-group"><summary>Order and delivery <span>Preparation, delivery, and references</span></summary><div class="evidence-content"><dl class="detail-list">${detailValue('Order reference', task.order?.reference || 'None')}${detailValue('Order status', task.order?.status || 'Not placed')}${detailValue('Item hold', task.inventory?.reservation?.reference || 'None')}${detailValue('Preparation', task.fulfillment?.status || 'Not started')}${detailValue('Delivery', task.delivery?.status || 'Not started')}${detailValue('Tracking reference', task.delivery?.trackingReference || 'None')}${detailValue('Purchase preparation', task.checkoutWorker?.cleanup || 'Pending')}</dl></div></details>`;
  const activityDetails = `<details class="evidence-group"><summary>Activity <span>What NaviPay recorded</span></summary><div class="evidence-content"><dl class="detail-list">${detailValue('Run state', task.state)}${detailValue('Automation', task.automation?.status || 'Not started')}${detailValue('Next action', task.automation?.nextAction || 'None')}${task.failure ? detailValue('Recorded issue', customerOutcome(task).message) : ''}${detailValue('Task reference', shortId(task.id))}</dl>${auditDetails()}</div></details>`;
  return `<details class="advanced-details"${open}><summary>More about this purchase <span>Evidence, references, and activity</span></summary><div class="advanced-content">${paymentDetails}${orderDetails}${activityDetails}</div></details>`;
}

function fundingPanel() {
  const funding = state.funding || {};
  const kyc = funding.kyc || { status: 'pending' };
  const latest = funding.intents?.[0] || null;
  const approved = kyc.status === 'approved';
  const financial = state.task ? taskFinancial(state.task) : {};
  const taskHasSnapshot = Number.isFinite(financial.balanceBeforeMinor);
  const kycControls = kyc.status === 'approved'
    ? '<button type="button" class="quiet-button" data-kyc-action="pending">Simulate re-review</button><button type="button" class="quiet-button" data-kyc-action="reject">Simulate rejection</button>'
    : kyc.status === 'rejected'
      ? '<button type="button" class="secondary-button" data-kyc-action="approve">Approve local gate</button>'
      : '<button type="button" class="secondary-button" data-kyc-action="approve">Approve local gate</button><button type="button" class="quiet-button" data-kyc-action="reject">Reject local gate</button>';
  let simulationControls = '';
  if (latest?.status === 'pending') simulationControls = '<div class="choice-actions"><button type="button" class="secondary-button" data-funding-action="confirm">Confirm deposit</button><button type="button" class="quiet-button" data-funding-action="fail">Simulate failure</button><button type="button" class="quiet-button" data-funding-action="expire">Expire intent</button></div>';
  if (latest?.status === 'confirmed') simulationControls = '<div class="choice-actions"><button type="button" class="quiet-button" data-funding-action="reverse">Simulate reversal</button></div>';
  const evidence = latest?.confirmationEvidence;
  const latestDetails = latest ? `<div class="funding-intent"><div class="panel-heading"><div><span class="overline">Latest deposit intent</span><strong>${escapeHtml(latest.amount || formatMoney(latest.amountMinor, latest.asset || 'XSGD'))}</strong></div>${statusPill(latest.status)}</div><div class="funding-instructions">${dataCell('Mock destination', latest.depositInstructions?.destination || 'Not available', 'Not a wallet or blockchain address')}${dataCell('Memo', latest.depositInstructions?.memo || 'Not available', 'Use only in this local simulation')}${dataCell('Provider reference', shortId(latest.providerReference), 'Safe reference')}${dataCell('Confirmation reference', evidence?.transactionReference || 'Pending', evidence ? 'Mock evidence only' : 'No confirmation yet')}</div>${simulationControls}${latest.status === 'pending' ? `<small class="funding-expiry">Intent expires ${formatDate(latest.expiresAt)}.</small>` : ''}${latest.failureReason ? `<p class="funding-reason">${escapeHtml(latest.failureReason)}</p>` : ''}</div>` : '<p class="advanced-help">Create a local deposit intent after the mock KYC gate is approved.</p>';
  const visibleBalance = taskHasSnapshot ? formatMoney(financial.balanceBeforeMinor, state.task.currency || 'XSGD') : 'No task snapshot';
  const summary = `${statusLabels[kyc.status] || kyc.status} KYC · ${visibleBalance}`;
  return `<details class="advanced-details simulation-details"><summary><span>Local demo settings <small>Optional testing tools</small></span><span class="fixture-chip">For testing</span></summary><div class="advanced-content"><p class="simulation-disclosure">SIMULATED ONLY. Fake wallet, mock KYC, seeded inventory, and fixture delivery. No real funds, credentials, or blockchain activity.</p><div class="funding-overview">${dataCell('Task balance snapshot', visibleBalance, taskHasSnapshot ? 'Authoritative before this purchase' : 'Not shown without a task financial snapshot')}${dataCell('KYC gate', statusLabels[kyc.status] || kyc.status, summary)}</div><div class="funding-gate"><div><span class="product-label">Mock KYC gate</span><strong>${statusPill(kyc.status)} <span>${escapeHtml(kyc.providerReference ? `Reference ${shortId(kyc.providerReference)}` : 'Safe status only')}</span></strong><small>${escapeHtml(kyc.reasonCode || 'Approval is required before a mock XSGD intent can be created or credited.')}</small></div><div class="choice-actions">${kycControls}</div></div><form id="funding-form" novalidate><label for="funding-amount">Seeded fake funding amount</label><div class="funding-form-row"><input id="funding-amount" name="amount" type="text" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="25.00" value="25.00"${!approved || state.busy ? ' disabled' : ''}><button type="submit" class="secondary-button"${!approved || state.busy ? ' disabled' : ''}>Create mock deposit intent</button></div><small class="funding-disclosure">${escapeHtml(funding.disclosure || 'LOCAL SIMULATION ONLY - no real funds or blockchain activity.')}</small></form>${latestDetails}<p class="gateway-disclosure">Local merchant gateway: read-only discovery and checkout worker are separate. No external merchant checkout or real payment credentials are used.</p><div class="simulation-footer"><button type="button" class="quiet-button" data-reset-sandbox${state.busy ? ' disabled' : ''}>Reset local sandbox</button><span>Clears saved tasks and restores the seeded fixture.</span></div></div></details>`;
}

function historyDetails() {
  if (!state.tasks.length) return '';
  return `<details class="advanced-details history-details"><summary>Previous purchases <span>${state.tasks.length} saved</span></summary><div class="history-grid">${state.tasks.map((task) => `<button type="button" class="history-item${task.id === state.task?.id ? ' current' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(taskRequest(task))}</strong><small>${escapeHtml(taskQuote(task)?.item || 'No item selected')}</small></span>${statusPill(task.payment?.status || task.state)}</button>`).join('')}</div></details>`;
}

function virtualCardDrawer(task) {
  const card = taskCard(task);
  const payment = taskPayment(task);
  const financial = taskFinancial(task);
  const currency = task?.currency || 'XSGD';
  const balance = Number.isFinite(financial.finalBalanceMinor) ? formatMoney(financial.finalBalanceMinor, currency) : Number.isFinite(financial.balanceBeforeMinor) ? formatMoney(financial.balanceBeforeMinor, currency) : 'Not available';
  const paymentStatus = paymentOutcome(task);
  const safeReference = card?.maskedReference || payment.reference || 'Not available';
  return `<div class="drawer-backdrop" data-close-drawer><aside class="virtual-card-drawer" role="dialog" aria-modal="true" aria-labelledby="virtual-card-title" data-stop-drawer><div class="drawer-heading"><div><span class="overline">Payment</span><h2 id="virtual-card-title">Payment summary</h2></div><button type="button" class="close-button" data-close-drawer aria-label="Close payment summary">✕</button></div><div class="drawer-payment-amount"><span class="data-label">Amount</span><strong>${escapeHtml(task ? formatMoney(payment.amountMinor || taskQuote(task).totalMinor, currency) : 'Not started')}</strong><small>For this purchase only</small></div><div class="drawer-facts">${dataCell('Payment status', statusLabels[paymentStatus] || 'Not started', payment.status === 'unknown' ? 'Needs your confirmation' : 'Purchase payment')}${dataCell('Payment method', card ? 'One-use payment method' : 'Not available', 'Credentials are never shown')}${dataCell('Safe reference', shortId(safeReference), 'Safe reference only')}</div>${Number.isFinite(financial.finalBalanceMinor) ? `<div class="drawer-balance"><span class="data-label">Task-scoped demo balance</span><strong>${escapeHtml(balance)}</strong><small>This task snapshot only - never the global wallet balance</small></div>` : ''}<p class="drawer-disclosure">Local demo. Payment details are simulated and no real money is used.</p></aside></div>`;
}

function runView(task) {
  const stages = lifecycleStages(task);
  const hasReceipt = (taskProjection(task).receipt || task.receipt)?.status === 'confirmed';
  const outcomeCode = customerOutcome(task).code;
  const showStages = ['created', 'running', 'awaiting_selection', 'reconciliation_required'].includes(task.state) || outcomeCode === 'payment_unknown';
  const stagePanel = showStages ? `<section class="stage-card"><div class="panel-heading"><div><span class="overline">Purchase steps</span><h2>Simple, from item to order</h2></div><span class="stage-caption">${task.state === 'awaiting_selection' || task.state === 'reconciliation_required' ? 'Action needed below' : 'Updated now'}</span></div>${stageTracker(stages)}</section>` : '';
  const orderCard = hasReceipt ? receiptPanel(task) : attemptedPurchasePanel(task);
  return `<section class="run-view"><div class="run-heading"><div><span class="overline">Purchase status</span><h1>${escapeHtml(taskRequest(task))}</h1></div><div class="run-actions">${modeBadge()}<button type="button" class="quiet-dark-button" data-new-purchase>New purchase</button></div></div>${outcome(task)}${orderCard}${stagePanel}${taskFacts(task)}${advancedDetails(task)}${historyDetails()}</section>`;
}

function updateHeader() {
  const controls = document.querySelector('#topbar-controls');
  if (!controls) return;
  const payment = taskPayment(state.task);
  const paymentLabel = state.task ? statusLabels[paymentOutcome(state.task)] || 'Not started' : 'Ready';
  controls.innerHTML = `<span class="mode-badge mode-badge-dark"><span class="mode-dot"></span>Local demo</span><button type="button" class="virtual-card-button" data-open-drawer><span>Payment</span><strong>Summary</strong><small>${escapeHtml(paymentLabel)}</small></button>`;
}

function render() {
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  updateHeader();
  let content;
  if (!state.task && state.busy) content = `${requestCard()}${pendingRun()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
  else if (!state.task) content = `${requestCard()}${emptyState()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
  else content = `${runView(state.task)}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
  app.innerHTML = content;
  bindEvents();
  if (state.drawerOpen) {
    app.insertAdjacentHTML('beforeend', virtualCardDrawer(state.task));
    bindDrawerEvents();
    document.querySelector('.virtual-card-drawer .close-button')?.focus?.({ preventScroll: true });
  }
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

async function loadTaskEvidence(taskId) {
  await loadAudit(taskId);
  const walletDetails = await api('/api/wallet');
  state.ledger = walletDetails.ledger || [];
}

async function refresh() {
  const payload = await api('/api/tasks');
  state.tasks = payload.tasks || [];
  state.funding = payload.funding || state.funding;
  state.discovery = payload.discovery || state.discovery;
  if (state.task) {
    const current = state.tasks.find((task) => task.id === state.task.id);
    if (current) state.task = current;
    state.projection = (payload.projections || []).find((view) => view.taskId === state.task.id) || state.projection;
  }
  if (state.task) await loadTaskEvidence(state.task.id);
}

function runKey(prefix = 'browser') {
  return `${prefix}-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
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
  state.request = request;
  state.pendingRequest = request;
  state.targetSite = targetSite;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ request, ...(targetSite ? { targetSite } : {}) }) });
    state.task = payload.task;
    state.projection = payload.projection || null;
    state.request = '';
    state.pendingRequest = '';
    await refresh();
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      state.projection = error.payload.projection || null;
      state.request = '';
      state.pendingRequest = '';
      await refresh().catch(() => {});
    } else {
      state.task = null;
      state.projection = null;
      state.audit = [];
      state.ledger = [];
    }
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('#outcome-title')?.focus?.({ preventScroll: true });
  }
}

async function resumeTask(candidateId) {
  if (state.busy || !state.task) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/run`, { method: 'POST', headers: { 'Idempotency-Key': runKey('resume') }, body: JSON.stringify({ candidateId }) });
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
  if (state.busy || !state.task) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/payment/reconcile`, { method: 'POST', headers: { 'Idempotency-Key': runKey('reconcile') }, body: JSON.stringify({ resolution }) });
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

async function refundPayment(action) {
  if (state.busy || !state.task) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/payment/${action}`, { method: 'POST', headers: { 'Idempotency-Key': runKey(action) }, body: '{}' });
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

async function createFunding(event) {
  event.preventDefault();
  if (state.busy) return;
  const amount = event.currentTarget.elements.amount.value.trim();
  if (!amount) {
    state.error = { message: 'Enter an XSGD amount first.' };
    render();
    return;
  }
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': runKey('funding') }, body: JSON.stringify({ amount }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
  }
}

async function simulateFunding(action) {
  if (state.busy || !state.funding?.intents?.[0]) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const intentId = state.funding.intents[0].id;
    const payload = await api(`/api/funding/intents/${encodeURIComponent(intentId)}/simulate`, { method: 'POST', headers: { 'Idempotency-Key': runKey('funding-sim'), 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
  }
}

async function simulateKyc(action) {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/funding/kyc/simulate', { method: 'POST', headers: { 'Idempotency-Key': runKey('kyc-sim'), 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
  }
}

async function resetSandbox() {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/reset', { method: 'POST', body: '{}' });
    state.tasks = payload.tasks || [];
    state.task = null;
    state.projection = null;
    state.audit = [];
    state.ledger = [];
    state.funding = payload.funding || state.funding;
    state.targetSite = '';
    state.request = '';
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
  }
}

async function selectTask(taskId) {
  if (state.busy || taskId === state.task?.id) return;
  state.busy = true;
  state.error = null;
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    state.task = payload.task;
    state.projection = payload.projection || null;
    state.targetSite = payload.task.targetSite?.url || state.targetSite;
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function showNewPurchase() {
  state.task = null;
  state.projection = null;
  state.audit = [];
  state.ledger = [];
  state.error = null;
  state.drawerOpen = false;
  state.request = '';
  render();
  document.querySelector('#request-input')?.focus?.({ preventScroll: true });
}

function closeDrawer() {
  state.drawerOpen = false;
  state.drawerTrigger = null;
  render();
  document.querySelector('[data-open-drawer]')?.focus?.({ preventScroll: true });
}

function bindDrawerEvents() {
  document.querySelector('[data-stop-drawer]')?.addEventListener('click', (event) => event.stopPropagation());
  document.querySelectorAll('[data-close-drawer]').forEach((node) => node.addEventListener('click', closeDrawer));
  document.querySelectorAll('[data-payment-action]').forEach((button) => button.addEventListener('click', () => { closeDrawer(); refundPayment(button.dataset.paymentAction); }));
  document.querySelector('[data-open-advanced]')?.addEventListener('click', () => { closeDrawer(); document.querySelector('.advanced-details')?.setAttribute('open', ''); document.querySelector('.advanced-details')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}

function bindEvents() {
  document.querySelector('#request-form')?.addEventListener('submit', runPurchase);
  document.querySelector('#funding-form')?.addEventListener('submit', createFunding);
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
    state.request = button.dataset.example;
    const input = document.querySelector('#request-input');
    if (input) { input.value = state.request; input.focus(); }
  }));
  document.querySelectorAll('[data-funding-action]').forEach((button) => button.addEventListener('click', () => simulateFunding(button.dataset.fundingAction)));
  document.querySelectorAll('[data-kyc-action]').forEach((button) => button.addEventListener('click', () => simulateKyc(button.dataset.kycAction)));
  document.querySelectorAll('[data-candidate-id]').forEach((button) => button.addEventListener('click', () => resumeTask(button.dataset.candidateId)));
  document.querySelectorAll('[data-resolution]').forEach((button) => button.addEventListener('click', () => reconcilePayment(button.dataset.resolution)));
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
  document.querySelectorAll('[data-open-drawer]').forEach((button) => button.addEventListener('click', () => { state.drawerTrigger = button; state.drawerOpen = true; render(); }));
  document.querySelectorAll('[data-new-purchase]').forEach((button) => button.addEventListener('click', showNewPurchase));
  document.querySelectorAll('[data-open-details]').forEach((button) => button.addEventListener('click', () => {
    const details = document.querySelector('.advanced-details:not(.simulation-details)');
    if (!details) return;
    details.open = true;
    if (button.dataset.openDetails === 'selection') document.querySelector('.evidence-group')?.setAttribute('open', '');
    details.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.querySelectorAll('[data-scroll-to]').forEach((button) => button.addEventListener('click', () => {
    document.getElementById(button.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.querySelectorAll('[data-reset-sandbox]').forEach((button) => button.addEventListener('click', resetSandbox));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.drawerOpen) closeDrawer();
});

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.tasks = payload.tasks || [];
    state.funding = payload.funding || null;
    state.discovery = payload.discovery || null;
    state.task = state.tasks[0] || null;
    state.targetSite = state.task?.targetSite?.url || '';
    state.projection = (payload.projections || []).find((view) => view.taskId === state.task?.id) || null;
    if (state.task) await loadTaskEvidence(state.task.id);
    render();
  } catch (error) {
    app.innerHTML = `<div class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><span>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</span></div>`;
  }
}

boot();
