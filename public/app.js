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
  reserved: 'Reserved',
  committed: 'Confirmed',
  failed: 'Could not complete',
  declined: 'Not paid',
  out_of_stock: 'Out of stock',
  unknown: 'Needs confirmation',
  reconciliation_required: 'Needs confirmation',
  awaiting_selection: 'Needs a choice',
  pending: 'In progress',
  pending_reconciliation: 'Needs confirmation',
  expired: 'Expired',
  compensated: 'Reversed',
  refunded: 'Refunded',
  reversed: 'Reversed',
  retired: 'Card retired',
  captured: 'Captured',
  active: 'Issued',
  approved: 'Approved',
  paused: 'Paused',
  rejected: 'Rejected',
  not_issued: 'Not issued',
  not_started: 'Not started',
  skipped: 'Skipped',
  no_match: 'No match',
  over_budget: 'Over budget',
  low_balance: 'Low balance',
  compensation_failed: 'Refund failed',
  stopped: 'Stopped safely'
};

function statusTone(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'committed', 'authorized', 'retired', 'captured', 'active', 'approved'].includes(value)) return 'success';
  if (['failed', 'declined', 'rejected', 'out_of_stock', 'no_match', 'over_budget', 'low_balance'].includes(value)) return 'attention';
  if (['unknown', 'reconciliation_required', 'awaiting_selection', 'pending', 'pending_reconciliation', 'expired', 'paused', 'refunded', 'reversed'].includes(value)) return 'warning';
  return 'neutral';
}

function statusPill(value, label = statusLabels[value] || String(value || 'pending').replaceAll('_', ' ')) {
  return `<span class="status-pill ${statusTone(value)}">${escapeHtml(label)}</span>`;
}

function modeBadge(label = 'SIMULATED ONLY') {
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

function failureMessage(task) {
  const code = task?.failure?.code;
  if (task?.state === 'awaiting_selection') return task.quote?.recommendationOnly && task.quote?.mode === 'read-only Playwright fixture' ? 'There is no single best browser match. Choose one of the tied results so NaviPay can cross-check the authoritative local quote before purchase.' : 'More than one local match fits this request. Choose the item to continue.';
  if (task?.state === 'reconciliation_required') return 'The payment result is unclear. NaviPay will not try it again until you confirm what happened.';
  if (code === 'NO_LOCAL_MATCHES' || code === 'DISCOVERY_NO_MATCH') return 'No matching local item was found. No inventory was reserved and nothing was charged.';
  if (code === 'INSUFFICIENT_FUNDS') return 'There is not enough fake XSGD balance for the exact quoted total. No card was issued and nothing was charged.';
  if (code === 'OUT_OF_STOCK') return 'The exact requested item is out of stock. NaviPay did not substitute another brand. Nothing was charged.';
  if (code === 'SPENDING_CEILING_EXCEEDED') return 'Every available match is over the task budget. Nothing was charged.';
  if (code === 'QUOTE_EXPIRED') return 'The quote expired before payment. No card was issued and nothing was charged.';
  if (code === 'ORDER_COMMIT_FAILED' || code === 'INVENTORY_COMMIT_FAILED' || code === 'ORDER_CREATION_FAILED') return 'Order and inventory confirmation failed safely. Payment was compensated and no confirmed order remains.';
  if (code === 'AMBIGUOUS_MATCH') return 'More than one exact match needs your choice. No inventory was reserved and nothing was charged.';
  if (code === 'AUTHORITATIVE_QUOTE_MISMATCH') return 'The browser price did not match the approved local quote. Nothing was charged.';
  if (code === 'PAYMENT_DECLINED' || code === 'PAYMENT_DECLINED_RECONCILED') return 'The payment did not go through. Nothing was charged.';
  if (code === 'DELIVERY_FAILED') return 'The purchase is confirmed, but delivery could not be completed.';
  if (code === 'FULFILLMENT_FAILED') return 'The purchase is confirmed, but the order could not be prepared.';
  if (code === 'INVALID_PURCHASE_REQUEST' || code === 'MISSING_PRODUCT_TYPE') return 'Name a concrete product type, such as “buy a Logitech mouse”.';
  if (code === 'KYC_NOT_APPROVED') return 'Mock KYC approval is required before NaviPay can authorize or issue a card. Nothing was charged.';
  if (code === 'MERCHANT_CATEGORY_NOT_ALLOWED' || code === 'POLICY_BLOCKED') return 'This merchant or category is outside the approved local purchase scope. No card was issued.';
  if (code === 'DUPLICATE_INSTRUCTION') return 'This instruction was identified as a duplicate. No second authorization was created.';
  if (code === 'DISCOVERY_DOMAIN_BLOCKED') return 'That target site is not approved. NaviPay did not fetch it and used the seeded local catalog instead.';
  if (code === 'DISCOVERY_TIMEOUT') return 'The approved site took too long to answer. NaviPay used the seeded local catalog instead.';
  if (code === 'MALFORMED_DISCOVERY_DATA' || code === 'STALE_DISCOVERY_DATA' || code === 'CONTRADICTORY_DISCOVERY_DATA') return 'The approved site returned unsafe or stale product data. NaviPay used the seeded local catalog instead.';
  if (code === 'INVALID_TARGET_SITE') return 'Enter an http or https target site URL without a username or password.';
  return 'NaviPay could not complete this purchase. No unconfirmed payment was left behind.';
}

function paymentOutcome(task) {
  const payment = taskPayment(task);
  if (payment.status === 'refunded') return 'refunded';
  if (payment.status === 'reversed') return 'reversed';
  return payment.status;
}

function outcome(task) {
  let tone = 'success';
  let title = 'Purchase complete';
  let message = `${taskQuote(task)?.item || 'Your item'} is paid for and confirmed.`;
  const paymentStatus = paymentOutcome(task);
  if (paymentStatus === 'refunded') {
    tone = 'warning';
    title = 'Purchase refunded';
    message = 'The fake payment was refunded. Net charged is XSGD 0.00.';
  } else if (paymentStatus === 'reversed') {
    tone = 'warning';
    title = 'Purchase reversed';
    message = 'The fake payment was reversed. Net charged is XSGD 0.00.';
  } else if (task.state === 'completed' && task.delivery?.status === 'failed') {
    tone = 'warning';
    title = 'Purchase confirmed, delivery needs attention';
    message = 'Payment and order are safe, but delivery could not be completed.';
  } else if (task.state === 'completed' && task.fulfillment?.status === 'failed') {
    tone = 'warning';
    title = 'Purchase confirmed, order preparation needs attention';
    message = 'Payment and order are safe, but preparation could not be completed.';
  } else if (task.state === 'reconciliation_required') {
    tone = 'warning';
    title = 'Payment needs your confirmation';
    message = failureMessage(task);
  } else if (task.state === 'awaiting_selection') {
    tone = 'warning';
    title = 'Choose an item to continue';
    message = failureMessage(task);
  } else if (task.state === 'failed') {
    tone = 'attention';
    title = 'Purchase not completed';
    message = failureMessage(task);
  }
  return `<section class="outcome-banner ${tone}" role="status" aria-live="polite"><div class="outcome-icon" aria-hidden="true">${tone === 'success' ? '✓' : tone === 'warning' ? '?' : '!'}</div><div><h2 id="outcome-title" tabindex="-1">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></section>`;
}

function requestCard() {
  const discovery = state.discovery || { label: 'Seeded catalog', explanation: 'NaviPay is using its seeded local merchant catalog.' };
  const configuredSite = state.discovery?.configuredSite || { label: 'Seeded catalog is the default' };
  const targetValue = escapeHtml(state.targetSite);
  const submitLabel = state.busy ? 'Running…' : 'Run purchase';
  return `<section class="request-card"><div class="request-copy"><span class="overline">One instruction</span><h1>What should we buy<span class="accent-mark">?</span></h1><p>Type it once. NaviPay finds the item, issues a one-use card, and closes the purchase.</p><p class="local-disclosure">Local simulation only: fake wallet, seeded inventory, mock KYC, and fixture delivery. No real funds or credentials.</p></div><form id="request-form" novalidate><label for="request-input">Purchase instruction</label><div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="buy a Logitech mouse" value="${escapeHtml(state.request)}" required${state.busy ? ' disabled' : ''}><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${submitLabel}</button></div><div class="example-row" aria-label="Example requests"><button type="button" class="example-chip" data-example="buy an Apple Magic Keyboard">buy an Apple Magic Keyboard</button><button type="button" class="example-chip" data-example="buy a Logitech mouse">buy a Logitech mouse</button><button type="button" class="example-chip" data-example="buy earphones">buy earphones</button></div><p class="local-path"><span>Primary path</span><strong>Seeded local catalog and local merchant gateway</strong></p><details class="optional-discovery"><summary>Optional browser evidence <span>read-only and collapsed by default</span></summary><div class="optional-discovery-content"><label class="target-label" for="target-site">Approved target commerce site <span>(optional)</span></label><input id="target-site" name="targetSite" type="url" maxlength="2048" autocomplete="url" value="${targetValue}" placeholder="http://127.0.0.1:43123/competition/"><small>Only an already allowlisted local replay site may be fetched. Discovery cannot reserve inventory, authorize payment, or place an order.</small><p class="configured-site"><span>Configured site</span><strong>${escapeHtml(configuredSite.label || 'Not configured')}</strong></p><p class="discovery-config"><span>Evidence status</span>${discoveryBadge(discovery)} ${escapeHtml(discovery.explanation || '')}</p></div></details><p class="form-error" id="request-error" role="alert" hidden></p></form><p class="composer-footnote">Discovery <span>→</span> virtual card <span>→</span> purchase · local simulation only</p></section>`;
}

function emptyState() {
  return `<section class="empty-state"><span class="overline">Ready when you are</span><h2>One instruction. One clear result.</h2><p>NaviPay keeps the local work behind the scenes and makes the receipt the success artifact.</p></section>`;
}

function pendingRun() {
  const stages = [
    { label: 'Discovery', status: 'active', detail: 'matching seeded catalog…' },
    { label: 'Virtual card', status: 'pending', detail: 'waiting' },
    { label: 'Purchase', status: 'pending', detail: 'waiting' }
  ];
  return `<section class="pending-run" aria-live="polite"><span class="overline">Running</span><h1>${escapeHtml(state.pendingRequest || state.request)}</h1><p class="run-log"><span aria-hidden="true">&gt;</span> matching request against seeded catalog<span class="caret" aria-hidden="true"></span></p>${stageTracker(stages)}</section>`;
}

function stageTracker(stages) {
  return `<ol class="stage-tracker" aria-label="Purchase stages">${stages.map((stage, index) => `<li class="stage-item ${escapeHtml(stage.status)}"><span class="stage-number" aria-hidden="true">${stage.status === 'complete' ? '✓' : index + 1}</span><span class="stage-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.detail || '')}</small></span></li>`).join('')}</ol>`;
}

function lifecycleStages(task) {
  if (!task) return [
    { label: 'Discovery', status: 'pending', detail: 'waiting' },
    { label: 'Virtual card', status: 'pending', detail: 'waiting' },
    { label: 'Purchase', status: 'pending', detail: 'waiting' }
  ];
  const quote = taskQuote(task);
  const card = taskCard(task);
  const payment = taskPayment(task);
  const financial = taskFinancial(task);
  const failureCode = task.failure?.code;
  const progress = taskProjection(task).progress || task.progress || [];
  const progressStatus = (name) => progress.find((item) => item.stage === name)?.status;
  const discoveryFailed = ['NO_LOCAL_MATCHES', 'DISCOVERY_NO_MATCH', 'DISCOVERY_DOMAIN_BLOCKED', 'DISCOVERY_TIMEOUT', 'MALFORMED_DISCOVERY_DATA', 'STALE_DISCOVERY_DATA', 'CONTRADICTORY_DISCOVERY_DATA', 'MISSING_PRODUCT_TYPE', 'INVALID_PURCHASE_REQUEST', 'SPENDING_CEILING_EXCEEDED', 'QUOTE_EXPIRED'].includes(failureCode) || ['failed'].includes(progressStatus('discovery')) || (failureCode && progressStatus('quote') === 'failed');
  const discoveryActive = task.state === 'awaiting_selection' || task.state === 'created' || task.state === 'running';
  const discoveryComplete = !discoveryFailed && !discoveryActive && (progressStatus('discovery') === 'completed' || progressStatus('quote') === 'completed' || quote.locked || quote.quoteStatus === 'locked');
  const discovery = discoveryFailed
    ? { status: 'attention', detail: failureCode === 'SPENDING_CEILING_EXCEEDED' ? 'budget check stopped the run' : failureCode === 'NO_LOCAL_MATCHES' ? 'no local match' : 'stopped safely' }
    : discoveryActive
      ? { status: 'active', detail: task.state === 'awaiting_selection' ? 'choose an item' : 'matching catalog…' }
      : discoveryComplete ? { status: 'complete', detail: quote.item || 'item matched' } : { status: 'pending', detail: 'waiting' };

  const cardAttention = ['KYC_NOT_APPROVED', 'INSUFFICIENT_FUNDS', 'MERCHANT_CATEGORY_NOT_ALLOWED', 'POLICY_BLOCKED', 'RISK_BLOCKED', 'SPENDING_CEILING_EXCEEDED', 'QUOTE_EXPIRED', 'NO_LOCAL_MATCHES', 'OUT_OF_STOCK', 'MISSING_PRODUCT_TYPE'].includes(failureCode);
  const cardComplete = card && ['active', 'captured', 'retired', 'revoked', 'expired'].includes(card.status);
  const cardActive = task.state === 'card_issued' || ['pending', 'pending_reconciliation', 'issuing'].includes(card?.status);
  const virtualCard = cardAttention
    ? { status: 'attention', detail: card?.status ? statusLabels[card.status] || card.status : 'no card issued' }
    : cardComplete ? { status: 'complete', detail: card.status === 'retired' ? 'issued · retired' : statusLabels[card.status] || 'issued' }
      : cardActive ? { status: 'active', detail: card?.status === 'pending_reconciliation' ? 'issued · awaiting result' : 'issuing card…' }
        : { status: 'pending', detail: 'waiting' };

  const deliveryNeedsAttention = task.delivery?.status === 'failed' || task.fulfillment?.status === 'failed';
  const purchaseComplete = task.state === 'completed' && payment.status !== 'unknown';
  const purchaseAttention = ['failed', 'declined', 'rejected'].includes(payment.status) || (task.state === 'failed' && !['KYC_NOT_APPROVED', 'INSUFFICIENT_FUNDS'].includes(failureCode)) || failureCode === 'ORDER_CREATION_FAILED' || failureCode === 'ORDER_COMMIT_FAILED';
  const purchase = task.state === 'reconciliation_required' || payment.status === 'unknown'
    ? { status: 'active', detail: 'confirm payment result' }
    : purchaseAttention
      ? { status: 'attention', detail: payment.status === 'declined' ? 'payment declined' : 'stopped safely' }
      : purchaseComplete
        ? { status: deliveryNeedsAttention ? 'attention' : 'complete', detail: paymentOutcome(task) === 'refunded' ? 'refunded' : paymentOutcome(task) === 'reversed' ? 'reversed' : deliveryNeedsAttention ? 'confirmed · needs attention' : 'paid · confirmed' }
        : { status: 'pending', detail: financial?.outcome === 'compensated' ? 'payment reversed' : 'waiting' };
  return [
    { label: 'Discovery', ...discovery },
    { label: 'Virtual card', ...virtualCard },
    { label: 'Purchase', ...purchase }
  ];
}

function cardPurchaseSummary(task) {
  const card = taskCard(task);
  const cardValue = card ? statusLabels[card.status] || String(card.status).replaceAll('_', ' ') : 'Not issued';
  const purchaseValue = paymentOutcome(task) ? statusLabels[paymentOutcome(task)] || paymentOutcome(task) : statusLabels[task.state] || task.state;
  return `<div class="run-summary">${dataCell('Card status', cardValue, card ? 'One-use disposable card' : 'No card capability was created')}${dataCell('Purchase status', purchaseValue, task.state === 'completed' ? 'Task result' : 'Task result is not a success')}</div>`;
}

function receiptAdjustment(adjustment, currency) {
  if (!adjustment) return '';
  const statusLabel = adjustment.status === 'failed' ? 'Refund or reversal failed' : adjustment.kind === 'reversal' ? 'Reversal completed' : 'Refund completed';
  const compensationLabel = adjustment.compensation?.status === 'compensated' ? 'Compensated' : 'Needs review';
  return `<div class="receipt-adjustment"><div class="panel-heading"><div><span class="overline">Current settlement</span><h3>${escapeHtml(statusLabel)}</h3></div>${statusPill(adjustment.status)}</div><p class="receipt-adjustment-note">The capture snapshot above is immutable. This section records the latest simulated ${escapeHtml(adjustment.kind)} outcome without rewriting the order or delivery history.</p><div class="balance-grid">${dataCell('Current payment', statusLabels[adjustment.currentPaymentStatus] || adjustment.currentPaymentStatus || 'Not available')}${dataCell('Net charged', formatMoney(adjustment.netChargedMinor, currency))}${dataCell('Net refunded', formatMoney(adjustment.netRefundedMinor, currency))}${dataCell('Compensation', compensationLabel)}</div><dl class="detail-list receipt-references">${detailValue('Adjustment reference', shortId(adjustment.reference))}${detailValue('Ledger transaction', shortId(adjustment.transactionReference))}${detailValue('Requested', formatDate(adjustment.requestedAt))}${detailValue('Recorded', formatDate(adjustment.occurredAt))}${adjustment.failureCode ? detailValue('Outcome', adjustment.failureCode) : ''}</dl></div>`;
}

function receiptPanel(task) {
  const receipt = taskProjection(task).receipt || task.receipt;
  if (!receipt || receipt.status !== 'confirmed') return '';
  const financial = taskFinancial(task);
  const currency = receipt.currency || task.currency || 'XSGD';
  const paymentStatus = paymentOutcome(task) || receipt.paymentStatus;
  const finalBalance = Number.isFinite(financial.finalBalanceMinor) ? financial.finalBalanceMinor : receipt.finalBalanceMinor;
  const netCharged = Number.isFinite(financial.netChargedMinor) ? financial.netChargedMinor : receipt.netChargedMinor;
  return `<section class="receipt-panel" aria-labelledby="receipt-title"><div class="panel-heading"><div><span class="overline">Primary success artifact</span><h2 id="receipt-title">Receipt</h2></div>${statusPill(paymentStatus === 'refunded' || paymentStatus === 'reversed' ? paymentStatus : receipt.status, paymentStatus === 'refunded' ? 'Refunded' : paymentStatus === 'reversed' ? 'Reversed' : 'Confirmed')}</div><div class="receipt-heading"><div><strong>${escapeHtml(receipt.item || 'Item')}</strong><small>${escapeHtml(receipt.merchant || 'Merchant')} · ${escapeHtml(receipt.variant || '')}</small></div><strong>${formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency)}</strong></div><p class="receipt-capture-note">Original capture snapshot - issued ${escapeHtml(formatDate(receipt.issuedAt))}. Payment and commerce statuses here describe what was captured at purchase time.</p><div class="quote-breakdown">${dataCell('Item', formatMoney(receipt.subtotalMinor, currency))}${dataCell('Shipping', formatMoney(receipt.shippingMinor, currency))}${dataCell('Tax', formatMoney(receipt.taxMinor, currency))}${dataCell('Total', formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency))}</div><div class="balance-grid receipt-balances">${dataCell('Balance before', formatSnapshotMoney(financial.balanceBeforeMinor ?? receipt.balanceBeforeMinor, currency))}${dataCell('After payment', formatSnapshotMoney(financial.balanceAfterPaymentMinor ?? receipt.balanceAfterPaymentMinor, currency))}${dataCell('Final balance', formatSnapshotMoney(finalBalance, currency))}${dataCell('Net charged', formatSnapshotMoney(netCharged, currency))}</div><div class="commerce-grid receipt-statuses">${dataCell('Captured payment', statusLabels[receipt.paymentStatus] || receipt.paymentStatus || 'Not available')}${dataCell('Order', statusLabels[receipt.orderStatus] || receipt.orderStatus || 'Not available')}${dataCell('Fulfillment', statusLabels[receipt.fulfillmentStatus] || receipt.fulfillmentStatus || 'Not available')}${dataCell('Delivery', statusLabels[receipt.deliveryStatus] || receipt.deliveryStatus || 'Not available')}</div>${receiptAdjustment(receipt.adjustment, currency)}<dl class="detail-list receipt-references">${detailValue('Receipt reference', shortId(receipt.id))}${detailValue('Capture reference', shortId(receipt.captureReference))}${detailValue('Order reference', shortId(receipt.orderReference))}${detailValue('Payment reference', shortId(receipt.paymentReference))}${detailValue('Quote / cart', `${shortId(receipt.quoteId)} / ${shortId(receipt.cartId)}`)}${detailValue('Issued', formatDate(receipt.issuedAt))}</dl><p class="receipt-disclosure">${escapeHtml(receipt.disclosure || 'SIMULATED receipt - local fake wallet and merchant gateway only.')}</p></section>`;
}

function taskFacts(task) {
  const receipt = taskProjection(task).receipt || task.receipt;
  if (receipt?.status === 'confirmed') return '';
  const quote = taskQuote(task);
  const financial = taskFinancial(task);
  const item = quote.lockedSnapshot?.item || quote.item || quote.candidates?.find((candidate) => candidate.id === quote.selectedCandidateId)?.item || (task.failure?.code === 'OUT_OF_STOCK' ? quote.candidates?.[0]?.item : null);
  const amount = quote.totalMinor ?? quote.lockedSnapshot?.totalMinor;
  if (!item && !Number.isFinite(amount) && !Number.isFinite(financial.balanceBeforeMinor)) return '';
  const currency = task.currency || quote.currency || 'XSGD';
  return `<section class="task-facts"><div class="panel-heading"><div><span class="overline">Run snapshot</span><h2>What NaviPay knows</h2></div></div><div class="fact-grid">${dataCell('Selected item', item || 'Not selected')}${dataCell('Quoted price', formatSnapshotMoney(amount, currency, 'Not set'))}${dataCell('Balance before', formatSnapshotMoney(financial.balanceBeforeMinor, currency))}${dataCell('Final balance', formatSnapshotMoney(financial.finalBalanceMinor, currency))}</div></section>`;
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

function auditDetails() {
  if (!state.audit.length) return '<p class="advanced-help">No activity details are available yet.</p>';
  return `<ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event"><span class="audit-dot" aria-hidden="true"></span><span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.type)}${event.reference ? ` · ${escapeHtml(shortId(event.reference))}` : ''}</small></span><time>${formatDate(event.occurredAt)}</time></li>`).join('')}</ol>`;
}

function advancedDetails(task) {
  const open = ['awaiting_selection', 'reconciliation_required'].includes(task.state) ? ' open' : '';
  const payment = taskPayment(task);
  const paymentUnknown = task.state === 'reconciliation_required' && payment.status === 'unknown';
  const projection = taskProjection(task);
  const quote = taskQuote(task);
  const card = taskCard(task);
  const checkout = projection.checkout || task.checkout || {};
  const authorization = projection.authorization?.decision || task.authorizationDecision;
  return `<details class="advanced-details"${open}><summary>Advanced details <span>Safeguards, evidence, and activity</span></summary><div class="advanced-content">${candidateDetails(task)}${paymentUnknown ? `<div class="advanced-block attention-block"><h3>Confirm the payment result</h3><p class="advanced-help">NaviPay will not try the payment again. Tell us whether the fake wallet approved or declined it.</p><div class="choice-actions"><button type="button" class="secondary-button" data-resolution="authorized">Payment was approved</button><button type="button" class="quiet-button" data-resolution="declined">Payment was declined</button></div></div>` : ''}<div class="advanced-block"><h3>Run information</h3><dl class="detail-list">${detailValue('Request interpretation', [task.request?.intent?.brand, task.request?.intent?.product, task.request?.intent?.productCategory, `quantity ${task.request?.intent?.quantity ?? 1}`].filter(Boolean).join(' · ') || 'Not detected')}${detailValue('Authorization', authorization?.reason || 'Not decided')}${detailValue('Run state', task.state)}${detailValue('Automation', task.automation?.status || 'Not started')}${detailValue('Next action', task.automation?.nextAction || 'None')}${task.failure ? detailValue('Recorded issue', `${task.failure.code}: ${task.failure.message}`) : ''}${detailValue('Task reference', shortId(task.id))}</dl></div><div class="advanced-block"><h3>Purchase evidence</h3><dl class="detail-list">${detailValue('Discovery source', discoveryView(task).label || 'Not available')}${detailValue('Product SKU', quote.lockedSnapshot?.sku || 'Not selected')}${detailValue('Variant', quote.lockedSnapshot?.variantId || 'Not selected')}${detailValue('Inventory reservation', task.inventory?.reservation?.reference || 'None')}${detailValue('Card reference', card?.maskedReference || 'None')}${detailValue('Card status', card?.status || 'Not issued')}${detailValue('Authorization reference', checkout.authorizationReference || 'None')}${detailValue('Capture reference', checkout.captureReference || 'None')}${detailValue('Payment reference', payment.reference || 'None')}${detailValue('Ledger transaction', payment.transactionReference || 'None')}${detailValue('Settlement status', payment.adjustmentStatus || 'Not adjusted')}${detailValue('Adjustment reference', payment.adjustmentReference || 'None')}${detailValue('Adjustment transaction', payment.adjustmentTransactionReference || 'None')}${detailValue('Checkout cleanup', task.checkoutWorker?.cleanup || 'Pending')}${detailValue('Order reference', task.order?.reference || 'None')}${detailValue('Delivery reference', task.delivery?.trackingReference || 'None')}${detailValue('Chain evidence', task.funding?.transactionReference || 'None')}${detailValue('Receipt reference', task.receipt?.id || 'None')}${detailValue('Authorization decision', authorization?.decisionId || 'None')}</dl></div><div class="advanced-block"><h3>Ledger legs</h3>${ledgerDetails(task)}</div><div class="advanced-block"><h3>Activity trail</h3><p class="advanced-help">These records are safe, simulated evidence for checking what happened behind the purchase.</p>${auditDetails()}</div></div></details>`;
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
  return `<details class="advanced-details simulation-details"><summary><span>Local simulation controls <small>Mock KYC, funding, and safe reset</small></span><span class="fixture-chip">SIMULATED ONLY</span></summary><div class="advanced-content"><p class="simulation-disclosure">SIMULATED ONLY. Fake wallet, mock KYC, seeded inventory, and fixture delivery. No real funds, credentials, or blockchain activity.</p><div class="funding-overview">${dataCell('Task balance snapshot', visibleBalance, taskHasSnapshot ? 'Authoritative before this purchase' : 'Not shown without a task financial snapshot')}${dataCell('KYC gate', statusLabels[kyc.status] || kyc.status, summary)}</div><div class="funding-gate"><div><span class="product-label">Mock KYC gate</span><strong>${statusPill(kyc.status)} <span>${escapeHtml(kyc.providerReference ? `Reference ${shortId(kyc.providerReference)}` : 'Safe status only')}</span></strong><small>${escapeHtml(kyc.reasonCode || 'Approval is required before a mock XSGD intent can be created or credited.')}</small></div><div class="choice-actions">${kycControls}</div></div><form id="funding-form" novalidate><label for="funding-amount">Seeded fake funding amount</label><div class="funding-form-row"><input id="funding-amount" name="amount" type="text" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="25.00" value="25.00"${!approved || state.busy ? ' disabled' : ''}><button type="submit" class="secondary-button"${!approved || state.busy ? ' disabled' : ''}>Create mock deposit intent</button></div><small class="funding-disclosure">${escapeHtml(funding.disclosure || 'LOCAL SIMULATION ONLY - no real funds or blockchain activity.')}</small></form>${latestDetails}<p class="gateway-disclosure">Local merchant gateway: read-only discovery and checkout worker are separate. No external merchant checkout or real payment credentials are used.</p><div class="simulation-footer"><button type="button" class="quiet-button" data-reset-sandbox${state.busy ? ' disabled' : ''}>Reset local sandbox</button><span>Clears saved tasks and restores the seeded fixture.</span></div></div></details>`;
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
  const hasSnapshot = Number.isFinite(financial.balanceBeforeMinor) || Number.isFinite(financial.finalBalanceMinor);
  const balance = Number.isFinite(financial.finalBalanceMinor) ? formatMoney(financial.finalBalanceMinor, currency) : hasSnapshot ? formatSnapshotMoney(financial.balanceBeforeMinor, currency) : 'No task snapshot';
  const cardStatus = card?.status ? statusLabels[card.status] || card.status : 'No card issued';
  const canCompensate = payment.status === 'authorized' && !['refunded', 'reversed', 'compensated'].includes(payment.status) && task.state === 'completed';
  return `<div class="drawer-backdrop" data-close-drawer><aside class="virtual-card-drawer" role="dialog" aria-modal="true" aria-labelledby="virtual-card-title" data-stop-drawer><div class="drawer-heading"><div><span class="overline">Secondary view</span><h2 id="virtual-card-title">Virtual card</h2></div><button type="button" class="close-button" data-close-drawer aria-label="Close virtual card">✕</button></div><div class="drawer-balance"><span class="data-label">Task balance snapshot</span><strong>${escapeHtml(balance)}</strong><small>${hasSnapshot ? 'This purchase snapshot only' : 'No financial snapshot is attached to this task'}</small></div><div class="drawer-facts">${dataCell('Card status', cardStatus, card ? 'Disposable capability' : 'No card was issued')}${dataCell('Payment status', statusLabels[paymentOutcome(task)] || paymentOutcome(task) || 'Not started', payment.status === 'unknown' ? 'Issuer result needs confirmation' : 'Task-owned payment state')}${dataCell('Asset', currency, 'Fake wallet only')}</div>${task && payment.status === 'unknown' ? '<div class="drawer-alert"><strong>Payment needs confirmation</strong><p>NaviPay will not retry this capture.</p><button type="button" class="secondary-button" data-open-advanced>Open advanced details</button></div>' : ''}${canCompensate ? `<div class="drawer-actions"><span class="data-label">Local simulation controls</span><p>Refund or reverse the confirmed fake payment. This does not affect real funds.</p><div class="choice-actions"><button type="button" class="secondary-button" data-payment-action="refund">Simulate refund</button><button type="button" class="quiet-button" data-payment-action="reverse">Simulate reversal</button></div></div>` : payment.status === 'refunded' || payment.status === 'reversed' ? `<div class="drawer-alert"><strong>${escapeHtml(statusLabels[payment.status])}</strong><p>The task snapshot is restored to XSGD 0.00 net charged.</p></div>` : ''}<p class="drawer-disclosure">SIMULATED ONLY. Card credentials are never shown or persisted.</p></aside></div>`;
}

function runView(task) {
  const stages = lifecycleStages(task);
  return `<section class="run-view"><div class="run-heading"><div><span class="overline">Current instruction</span><h1>${escapeHtml(taskRequest(task))}</h1></div><div class="run-actions">${modeBadge('SIMULATED ONLY')}<button type="button" class="quiet-dark-button" data-new-purchase>New purchase</button></div></div>${outcome(task)}<section class="stage-card"><div class="panel-heading"><div><span class="overline">Three-stage lifecycle</span><h2>NaviPay keeps the work bounded</h2></div><span class="stage-caption">${task.state === 'awaiting_selection' || task.state === 'reconciliation_required' ? 'Action needed below' : 'Local run'}</span></div>${stageTracker(stages)}</section>${cardPurchaseSummary(task)}${receiptPanel(task)}${taskFacts(task)}${advancedDetails(task)}${fundingPanel()}${historyDetails()}<p class="footer-note">NaviPay is a local-only simulation. No real money, products, deliveries, or funding are involved.</p></section>`;
}

function updateHeader() {
  const controls = document.querySelector('#topbar-controls');
  if (!controls) return;
  const financial = taskFinancial(state.task);
  const card = taskCard(state.task);
  const hasSnapshot = state.task && (Number.isFinite(financial.finalBalanceMinor) || Number.isFinite(financial.balanceBeforeMinor));
  const value = hasSnapshot ? formatSnapshotMoney(financial.finalBalanceMinor ?? financial.balanceBeforeMinor, state.task.currency || 'XSGD') : state.task ? 'No snapshot' : 'No active task';
  const cardLabel = card?.status ? statusLabels[card.status] || card.status : 'Virtual card';
  controls.innerHTML = `<span class="mode-badge mode-badge-dark"><span class="mode-dot"></span>SIMULATED ONLY</span><button type="button" class="virtual-card-button" data-open-drawer><span>Virtual card</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(cardLabel)}</small></button>`;
}

function render() {
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  updateHeader();
  let content;
  if (!state.task && state.busy) content = `${requestCard()}${pendingRun()}${fundingPanel()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
  else if (!state.task) content = `${requestCard()}${fundingPanel()}${emptyState()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
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

function bindDrawerEvents() {
  document.querySelector('[data-stop-drawer]')?.addEventListener('click', (event) => event.stopPropagation());
  document.querySelectorAll('[data-close-drawer]').forEach((node) => node.addEventListener('click', () => { state.drawerOpen = false; render(); }));
  document.querySelectorAll('[data-payment-action]').forEach((button) => button.addEventListener('click', () => { state.drawerOpen = false; refundPayment(button.dataset.paymentAction); }));
  document.querySelector('[data-open-advanced]')?.addEventListener('click', () => { state.drawerOpen = false; render(); document.querySelector('.advanced-details')?.setAttribute('open', ''); document.querySelector('.advanced-details')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
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
  document.querySelectorAll('[data-open-drawer]').forEach((button) => button.addEventListener('click', () => { state.drawerOpen = true; render(); }));
  document.querySelectorAll('[data-new-purchase]').forEach((button) => button.addEventListener('click', showNewPurchase));
  document.querySelectorAll('[data-reset-sandbox]').forEach((button) => button.addEventListener('click', resetSandbox));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.drawerOpen) { state.drawerOpen = false; render(); }
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
