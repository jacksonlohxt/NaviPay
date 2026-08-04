const state = {
  tasks: [],
  task: null,
  projection: null,
  discovery: null,
  wallet: null,
  funding: null,
  ledger: [],
  audit: [],
  busy: false,
  error: null,
  targetSite: '',
  activeRequest: '',
  cardOpen: false
};

const app = document.querySelector('#app');
const EXAMPLES = ['Find an Apple Magic Keyboard', 'I want a mouse', 'I want earphones'];

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
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 14)}…${text.slice(-10)}` : text;
}

function moneyFor(value, currency) {
  return Number.isFinite(value) ? formatMoney(value, currency) : 'Not available';
}

function modeBadge(label = 'SIMULATED ONLY') {
  return `<span class="mode-badge"><span class="mode-dot"></span>${escapeHtml(label)}</span>`;
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
  pending_reconciliation: 'Needs confirmation',
  awaiting_reconciliation: 'Needs confirmation',
  awaiting_selection: 'Needs a choice',
  pending: 'In progress',
  expired: 'Expired',
  compensated: 'Compensated',
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
  compensation_failed: 'Refund failed'
};

function statusLabel(value) {
  return statusLabels[value] || String(value || 'Not started').replaceAll('_', ' ');
}

function statusTone(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'committed', 'authorized', 'retired', 'captured', 'active', 'approved', 'refunded', 'reversed', 'compensated'].includes(value)) return 'success';
  return 'attention';
}

function statusPill(value) {
  return `<span class="status-pill ${statusTone(value)}">${escapeHtml(statusLabel(value))}</span>`;
}

function dataCell(label, value, note = '') {
  return `<div class="data-cell"><span class="data-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function detailValue(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function discoveryView(task = state.task) {
  const projection = state.projection || {};
  const quote = projection.quote || task?.quote;
  if (projection.discovery) return projection.discovery;
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
  if (task?.state === 'awaiting_selection') return 'More than one safe local match needs a choice before NaviPay can reserve stock or issue a card.';
  if (task?.state === 'reconciliation_required') return 'The payment result is unclear. NaviPay will not try it again until the result is confirmed.';
  const messages = {
    NO_LOCAL_MATCHES: 'No matching local item was found. No inventory was reserved and nothing was charged.',
    DISCOVERY_NO_MATCH: 'No matching local item was found. No inventory was reserved and nothing was charged.',
    INSUFFICIENT_FUNDS: 'There is not enough fake XSGD balance for the exact quoted total. No card was issued.',
    OUT_OF_STOCK: 'The exact requested item is out of stock. NaviPay did not substitute another brand. Nothing was charged.',
    SPENDING_CEILING_EXCEEDED: 'Every available match is over the task budget. Nothing was charged.',
    QUOTE_EXPIRED: 'The quote expired before payment. Nothing was charged.',
    ORDER_COMMIT_FAILED: 'Order and inventory confirmation failed safely. Payment was compensated and no confirmed order remains.',
    INVENTORY_COMMIT_FAILED: 'Order and inventory confirmation failed safely. Payment was compensated and no confirmed order remains.',
    AMBIGUOUS_MATCH: 'More than one exact match needs a choice. No inventory was reserved and nothing was charged.',
    AUTHORITATIVE_QUOTE_MISMATCH: 'The browser price did not match the approved local quote. Nothing was charged.',
    PAYMENT_DECLINED: 'The payment did not go through. Nothing was charged.',
    PAYMENT_DECLINED_RECONCILED: 'The payment was confirmed as declined. Nothing was charged.',
    DELIVERY_FAILED: 'The purchase is confirmed, but delivery could not be completed.',
    FULFILLMENT_FAILED: 'The purchase is confirmed, but the order could not be prepared.',
    INVALID_PURCHASE_REQUEST: 'Name a concrete product type, such as “buy a Logitech mouse”.',
    MISSING_PRODUCT_TYPE: 'Name a concrete product type. NaviPay will not guess a category from a brand alone.',
    KYC_NOT_APPROVED: 'Mock KYC approval is required before NaviPay can authorize or issue a card. Nothing was charged.',
    FUNDING_UNAVAILABLE: 'The fake wallet could not be verified. No card was issued and nothing was charged.',
    FUNDING_FAILED: 'The fake wallet could not be verified. No card was issued and nothing was charged.',
    MERCHANT_CATEGORY_NOT_ALLOWED: 'This merchant or category is outside the approved local purchase scope. No card was issued.',
    POLICY_BLOCKED: 'This purchase did not pass the local safety policy. No card was issued.',
    DUPLICATE_INSTRUCTION: 'This instruction was identified as a duplicate. No second authorization was created.',
    DISCOVERY_DOMAIN_BLOCKED: 'That target site is not approved. NaviPay used the seeded local catalog instead.',
    DISCOVERY_TIMEOUT: 'The approved site took too long to answer. NaviPay used the seeded local catalog instead.',
    DISCOVERY_UNAVAILABLE: 'The local catalog could not be searched. No inventory or payment action was attempted.',
    CHECKOUT_WORKER_CRASHED: 'The isolated checkout stopped before a payment result was confirmed. No blind retry was attempted.',
    CHECKOUT_WORKER_FAILED: 'The isolated checkout stopped safely. No blind retry was attempted.',
    CARD_CAPABILITY_UNAVAILABLE: 'The virtual card capability was unavailable after reload. No payment was attempted.',
    WRONG_MERCHANT: 'The checkout merchant did not match the one-use card scope. Nothing was charged.',
    AMOUNT_EXCEEDS_SCOPE: 'The checkout amount exceeded the one-use card scope. Nothing was charged.',
    CARD_EXPIRED: 'The one-use virtual card expired before checkout. Nothing was charged.',
    MERCHANT_CREDIT_FAILED: 'Merchant credit was not confirmed. Payment was compensated and no confirmed order remains.',
    ORDER_CREATION_FAILED: 'Order creation failed safely. Payment was compensated and inventory was released.',
    ORDER_COMMIT_FAILED: 'Order and inventory confirmation failed safely. Payment was compensated and no confirmed order remains.',
    RESERVATION_EXPIRED: 'The inventory lease expired after capture. Payment was compensated and no confirmed order remains.',
    QUANTITY_UNSUPPORTED: 'This purchase allows one unit per instruction. Nothing was charged.'
  };
  return messages[code] || task?.failure?.message || 'NaviPay could not complete this purchase. No unconfirmed payment was left behind.';
}

function exceptionInfo(task) {
  if (task.state === 'awaiting_selection') {
    return { title: 'Choose the item to continue', message: failureMessage(task), action: 'selection' };
  }
  if (task.state === 'reconciliation_required') {
    return { title: 'Payment needs confirmation', message: failureMessage(task), action: 'reconciliation' };
  }
  if (task.state === 'completed' && task.receipt?.adjustment?.status === 'failed') {
    return { title: 'Purchase confirmed, settlement needs attention', message: 'The simulated refund or reversal failed. The original capture remains recorded and needs review.', action: 'details' };
  }
  if (task.state === 'completed' && task.delivery?.status === 'failed') {
    return { title: 'Purchase confirmed, delivery needs attention', message: failureMessage({ failure: { code: 'DELIVERY_FAILED' } }), action: 'details' };
  }
  if (task.state === 'completed' && task.fulfillment?.status === 'failed') {
    return { title: 'Purchase confirmed, order preparation needs attention', message: failureMessage({ failure: { code: 'FULFILLMENT_FAILED' } }), action: 'details' };
  }
  if (task.state === 'failed') {
    const needsCard = ['KYC_NOT_APPROVED', 'INSUFFICIENT_FUNDS', 'FUNDING_UNAVAILABLE', 'FUNDING_FAILED'].includes(task.failure?.code);
    return { title: 'Purchase not completed', message: failureMessage(task), action: needsCard ? 'card' : 'another' };
  }
  return null;
}

function projectStageStatus(projection, names, fallback = 'pending') {
  const entries = names.map((name) => projection?.progress?.find((entry) => entry.stage === name)).filter(Boolean);
  if (!entries.length) return fallback;
  if (entries.some((entry) => entry.status === 'failed')) return 'attention';
  if (entries.some((entry) => ['running', 'pending'].includes(entry.status))) return 'active';
  if (entries.every((entry) => entry.status === 'completed')) return 'complete';
  return 'pending';
}

function stageTracker(projection, busy = false) {
  const task = state.task;
  const discovery = projectStageStatus(projection, ['intent', 'discovery', 'quote'], busy ? 'active' : 'pending');
  const card = projection?.card?.status === 'not_issued'
    ? projectStageStatus(projection, ['funding', 'payment'], busy ? 'active' : 'pending')
    : ['failed', 'declined', 'pending_reconciliation'].includes(projection?.card?.status) ? 'attention' : 'complete';
  const purchase = projectStageStatus(projection, ['inventory', 'payment', 'merchant_credit', 'order', 'fulfillment', 'delivery', 'receipt'], busy ? 'active' : 'pending');
  const stateName = task?.state;
  const stages = [
    { label: 'Discovery', status: discovery, detail: discovery === 'complete' ? (projection?.discovery?.label || 'matched') : discovery === 'attention' ? 'needs attention' : discovery === 'active' ? 'searching catalog' : 'waiting' },
    { label: 'Virtual card', status: card, detail: card === 'complete' ? (projection?.card?.status === 'retired' ? 'issued and retired' : 'issued') : card === 'attention' ? 'needs attention' : card === 'active' ? 'checking card' : 'waiting' },
    { label: 'Purchase', status: purchase, detail: purchase === 'complete' ? 'paid and confirmed' : purchase === 'attention' ? 'needs attention' : purchase === 'active' ? 'confirming payment' : 'waiting' }
  ];
  if (stateName === 'awaiting_selection') stages[0] = { label: 'Discovery', status: 'attention', detail: 'choose an item' };
  if (stateName === 'reconciliation_required') stages[2] = { label: 'Purchase', status: 'attention', detail: 'confirm payment result' };
  if (busy) stages.forEach((stage, index) => { if (index > 0) stage.status = 'pending'; });
  return `<ol class="stage-tracker" aria-label="Purchase stages">${stages.map((stage, index) => `<li class="stage ${stage.status}"><span class="stage-number">${stage.status === 'complete' ? '✓' : index + 1}</span><span class="stage-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.detail)}</small></span></li>`).join('')}</ol>`;
}

function requestForm() {
  const discovery = state.task ? discoveryView(state.task) : state.discovery || { label: 'Seeded catalog', explanation: 'NaviPay is using its seeded local merchant catalog.' };
  const configuredSite = state.discovery?.configuredSite || { label: 'Seeded catalog is the default' };
  const targetValue = escapeHtml(state.targetSite);
  const requestValue = escapeHtml(state.activeRequest);
  return `<section class="hero-flow" aria-labelledby="purchase-heading">
    <span class="overline">One instruction</span>
    <h1 id="purchase-heading">What should we buy<span>?</span></h1>
    <p class="hero-copy">Type it once. NaviPay finds the item, issues a one-use card, and closes the purchase.</p>
    <form id="request-form" novalidate>
      <label class="sr-only" for="request-input">Purchase instruction</label>
      <div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" value="${requestValue}" placeholder="Find an Apple Magic Keyboard" required${state.busy ? ' disabled' : ''}><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${state.busy ? 'Running' : 'Run purchase'}</button></div>
      ${state.error ? `<p class="form-error" role="alert">${escapeHtml(state.error.message)}</p>` : ''}
    </form>
    <div class="example-chips" aria-label="Example requests">${EXAMPLES.map((example) => `<button type="button" class="chip" data-example="${escapeHtml(example)}"${state.busy ? ' disabled' : ''}>${escapeHtml(example.toLowerCase())}</button>`).join('')}</div>
    <details class="dark-disclosure"><summary>Local simulation only <span>fake wallet, seeded inventory, mock KYC</span></summary><p>Local simulation only: fake wallet, seeded inventory, mock KYC, and fixture delivery. No real funds or credentials.</p></details>
    <details class="dark-disclosure optional-discovery"><summary>Optional browser evidence <span>read-only and collapsed by default</span></summary><div class="disclosure-content"><label for="target-site">Approved target commerce site <span>(optional)</span></label><input id="target-site" name="targetSite" type="url" maxlength="2048" autocomplete="url" value="${targetValue}" placeholder="http://127.0.0.1:43123/competition/"><small>Only an already allowlisted local replay site may be fetched. Discovery cannot reserve inventory, authorize payment, or place an order.</small><p class="configured-site"><span>Configured site</span><strong>${escapeHtml(configuredSite.label || 'Not configured')}</strong></p><p class="discovery-config"><span>Evidence status</span>${discoveryBadge(discovery)} ${escapeHtml(discovery.explanation || '')}</p></div></details>
  </section>`;
}

function runningView() {
  const request = state.activeRequest || state.task?.request?.raw || 'Purchase request';
  return `<section class="run-flow" aria-live="polite"><span class="overline">Running</span><h1>${escapeHtml(request)}</h1><p class="run-line"><span class="pulse-dot"></span> NaviPay is running the local purchase</p>${stageTracker(null, true)}</section>`;
}

function candidateRow(candidate, selectable) {
  const selected = candidate.id === state.projection?.quote?.selectedCandidateId || candidate.id === state.task?.quote?.selectedCandidateId;
  return `<div class="candidate-row${selected ? ' selected' : ''}"><div><strong>${escapeHtml(candidate.item || 'Item')}</strong><span>${escapeHtml(candidate.merchant || 'Merchant')} · ${escapeHtml(candidate.variant || '')}</span></div><div class="candidate-end"><strong>${moneyFor(candidate.totalMinor, candidate.currency || state.task?.currency)}</strong><small>${escapeHtml(candidate.availability === 'in_stock' ? 'In stock' : 'Out of stock')}</small>${selectable && candidate.availability === 'in_stock' ? `<button type="button" class="small-button" data-candidate-id="${escapeHtml(candidate.id)}">Select this item</button>` : ''}</div></div>`;
}

function candidateDetails(task, visible = false) {
  const quote = state.projection?.quote || task?.quote;
  if (!quote?.candidates?.length) return '';
  const needsChoice = task.state === 'awaiting_selection';
  const browserRecommendation = Boolean(quote.recommendationOnly && quote.mode === 'read-only Playwright fixture');
  const selected = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === quote.recommendedCandidateId);
  const selectedEvidence = selected && (selected.sourceUrl || selected.evidence?.observedAt || selected.matchReasons?.length) ? `<div class="evidence-block"><h3>Selected item evidence</h3><dl class="detail-list">${detailValue('Source URL', selected.sourceUrl || 'Seeded catalog - no browser URL')}${detailValue('Observed', formatDate(selected.evidence?.observedAt))}${detailValue('Match rationale', (selected.matchReasons || []).join('; ') || 'No additional rationale recorded')}</dl></div>` : '';
  const help = browserRecommendation ? 'Browser discovery is read-only. A selected result must match the approved local quote before any stock or payment action.' : needsChoice ? 'Several local items fit this request. Choose one to continue.' : 'The authoritative catalog candidate used for this purchase.';
  const content = `${browserRecommendation ? '<p class="detail-help">Browser discovery is read-only.</p>' : ''}<p class="detail-help">${escapeHtml(help)}</p><div class="candidate-list">${quote.candidates.map((candidate) => candidateRow(candidate, needsChoice)).join('')}</div>${selectedEvidence}`;
  if (visible) return `<section class="choice-card" aria-labelledby="choice-heading"><span class="overline">Action needed</span><h2 id="choice-heading">Choose an item</h2>${content}</section>`;
  return `<details class="disclosure"><summary>Discovery evidence <span>${escapeHtml(discoveryView(task).label || 'Seeded catalog')}</span></summary><div class="disclosure-content">${content}</div></details>`;
}

function receiptPanel(task) {
  const receipt = state.projection?.receipt || task.receipt;
  if (!receipt || receipt.status !== 'confirmed') return '';
  const currency = receipt.currency || task.currency || 'XSGD';
  const balance = receipt.finalBalanceMinor ?? receipt.balanceAfterPaymentMinor;
  return `<section class="receipt-card" aria-labelledby="receipt-heading"><div class="receipt-top"><div><span class="overline ink-overline">Receipt</span><h2 id="receipt-heading">${escapeHtml(receipt.item || 'Item')}</h2><p>${escapeHtml(receipt.merchant || 'Merchant')}${receipt.variant ? ` · ${escapeHtml(receipt.variant)}` : ''}</p></div><strong class="receipt-total">${moneyFor(receipt.totalMinor ?? receipt.amountMinor, currency)}</strong></div><div class="receipt-facts">${dataCell('Item', moneyFor(receipt.subtotalMinor, currency))}${dataCell('Shipping + tax', `${moneyFor(receipt.shippingMinor, currency)} + ${moneyFor(receipt.taxMinor, currency)}`)}${dataCell('Balance left', moneyFor(balance, currency), `before ${moneyFor(receipt.balanceBeforeMinor, currency)}`)}</div><p class="receipt-result"><span>✓</span> Paid and confirmed <span class="receipt-reference">${escapeHtml(shortId(receipt.id))}</span></p><p class="receipt-disclosure">${escapeHtml(receipt.disclosure || 'SIMULATED receipt - local fake wallet and merchant gateway only.')}</p></section>`;
}

function purchaseDetails(task) {
  const projection = state.projection || {};
  const authorization = projection.authorization?.decision || task.authorizationDecision;
  const card = projection.card || task.card || {};
  const payment = projection.payment || task.payment || {};
  const order = projection.order || task.order || {};
  const fulfillment = projection.fulfillment || task.fulfillment || {};
  const delivery = projection.delivery || task.delivery || {};
  const receipt = projection.receipt || task.receipt || {};
  const paymentDetail = payment.captureReference || payment.reference || payment.code || (payment.status === 'authorized' ? 'Capture confirmed' : 'No payment result');
  const kycCheck = authorization?.checks?.approvedKyc;
  const kycLabel = kycCheck?.status === 'passed' ? 'Approved' : /pending/i.test(kycCheck?.reason || '') ? 'Pending' : kycCheck ? 'Rejected' : 'Not run';
  return `<details id="purchase-details" class="disclosure"><summary>Purchase details <span>authorization, card, payment, and order states</span></summary><div class="disclosure-content"><div class="state-grid">${dataCell('Authorization', statusLabel(authorization?.status || 'not_started'), authorization?.reason || 'No decision recorded')}${dataCell('KYC gate', kycLabel, kycCheck?.reason || 'No KYC check recorded')}${dataCell('Virtual card', statusLabel(card.status || 'not_issued'), card.maskedReference || 'No card reference')}${dataCell('Payment', statusLabel(payment.status || 'not_started'), shortId(paymentDetail))}${dataCell('Order', statusLabel(order.status || 'not_started'), shortId(order.reference))}${dataCell('Fulfillment', statusLabel(fulfillment.status || 'not_started'), fulfillment.code || 'Local merchant state')}${dataCell('Delivery', statusLabel(delivery.status || 'not_started'), delivery.trackingReference ? shortId(delivery.trackingReference) : 'Local delivery state')}${dataCell('Receipt', statusLabel(receipt.status || 'not_started'), receipt.id ? shortId(receipt.id) : 'No receipt')}</div>${task.failure ? `<p class="detail-help">Recorded issue: ${escapeHtml(task.failure.code)} - ${escapeHtml(task.failure.message || '')}</p>` : ''}</div></details>`;
}

function receiptAdjustment(task) {
  const receipt = state.projection?.receipt || task.receipt;
  const adjustment = receipt?.adjustment;
  if (!receipt || !task.payment || task.payment.status === 'not_started') return '';
  const currency = receipt.currency || task.currency || 'XSGD';
  const canAdjust = task.state === 'completed' && task.payment.status === 'authorized' && !adjustment;
  const adjustmentBody = adjustment
    ? `<p class="detail-help">The original capture snapshot remains unchanged. This records the current simulated settlement.</p><div class="state-grid">${dataCell('Current payment', statusLabel(adjustment.currentPaymentStatus))}${dataCell('Net charged', moneyFor(adjustment.netChargedMinor, currency))}${dataCell('Net refunded', moneyFor(adjustment.netRefundedMinor, currency))}${dataCell('Adjustment', statusLabel(adjustment.status))}</div><dl class="detail-list">${detailValue('Adjustment reference', shortId(adjustment.reference))}${detailValue('Ledger transaction', shortId(adjustment.transactionReference))}${detailValue('Recorded', formatDate(adjustment.occurredAt))}</dl>`
    : canAdjust ? `<p class="detail-help">Refund or reverse this simulated capture once. The immutable receipt keeps the original capture values.</p><div class="choice-actions"><button type="button" class="small-button" data-payment-action="refund">Refund payment</button><button type="button" class="quiet-button" data-payment-action="reversal">Reverse payment</button></div>`
      : '<p class="detail-help">No settlement adjustment is available for this payment state.</p>';
  return `<details class="disclosure"><summary>Settlement adjustments <span>${adjustment ? statusLabel(adjustment.status) : 'refund or reversal'}</span></summary><div class="disclosure-content">${adjustmentBody}</div></details>`;
}

function ledgerDetails(task) {
  const legs = state.ledger.filter((leg) => leg.taskId === task.id);
  if (!legs.length) return '<p class="detail-help">No ledger legs were recorded for this purchase.</p>';
  return `<div class="ledger-list">${legs.map((leg) => `<div class="ledger-row"><span><strong>${escapeHtml(leg.entry)} · ${escapeHtml(leg.kind)}</strong><small>${escapeHtml(leg.accountId)}</small></span><strong>${moneyFor(leg.amountMinor, leg.currency)}</strong></div>`).join('')}</div>`;
}

function auditDetails() {
  if (!state.audit.length) return '<p class="detail-help">No activity details are available yet.</p>';
  return `<ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event"><span class="audit-dot"></span><span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.type)}${event.reference ? ` · ${escapeHtml(shortId(event.reference))}` : ''}</small></span><time>${escapeHtml(formatDate(event.occurredAt))}</time></li>`).join('')}</ol>`;
}

function advancedDetails(task) {
  const projection = state.projection || {};
  const quote = projection.quote || task.quote || {};
  const financial = projection.financial || {};
  const authorization = projection.authorization?.decision || task.authorizationDecision;
  const payment = projection.payment || task.payment || {};
  return `<details class="disclosure safety-details"><summary>Safety and activity <span>references, safeguards, ledger, and audit</span></summary><div class="disclosure-content"><div class="advanced-block"><h3>Run information</h3><dl class="detail-list">${detailValue('Request interpretation', [projection.request?.interpreted?.brand, projection.request?.interpreted?.product, projection.request?.interpreted?.productCategory, `quantity ${projection.request?.interpreted?.quantity ?? 1}`].filter(Boolean).join(' · ') || 'Not detected')}${detailValue('Run state', task.state)}${detailValue('Next action', projection.nextAction || task.automation?.nextAction || 'None')}${detailValue('Budget', quote.budget?.status || task.budget?.status || 'Not specified')}${detailValue('Financial outcome', financial.outcome || 'Not started')}${task.failure ? detailValue('Recorded issue', `${task.failure.code}: ${task.failure.message}`) : ''}${detailValue('Task reference', shortId(task.id))}</dl></div><div class="advanced-block"><h3>Purchase evidence</h3><dl class="detail-list">${detailValue('Discovery source', discoveryView(task).label || 'Not available')}${detailValue('Product SKU', quote?.lineSnapshot?.[0]?.sku || task.quote?.lockedSnapshot?.sku || 'Not selected')}${detailValue('Inventory reservation', shortId(projection.inventory?.reservation?.reference || task.inventory?.reservation?.reference))}${detailValue('Card reference', shortId(projection.card?.maskedReference || task.card?.maskedReference))}${detailValue('Authorization reference', shortId(payment.authorizationReference || task.checkout?.authorizationReference))}${detailValue('Capture reference', shortId(payment.captureReference || task.checkout?.captureReference))}${detailValue('Order reference', shortId(projection.order?.reference || task.order?.reference))}${detailValue('Receipt reference', shortId(projection.receipt?.id || task.receipt?.id))}${detailValue('Authorization decision', authorization?.decisionId ? shortId(authorization.decisionId) : 'Not recorded')}</dl></div><div class="advanced-block"><h3>Ledger legs</h3>${ledgerDetails(task)}</div><div class="advanced-block"><h3>Activity trail</h3>${auditDetails()}</div></div></details>`;
}

function outcome(task) {
  const info = exceptionInfo(task);
  if (!info) return '';
  const action = info.action === 'reconciliation'
    ? `<div class="choice-actions"><button type="button" class="small-button" data-resolution="authorized">Payment was approved</button><button type="button" class="quiet-button" data-resolution="declined">Payment was declined</button></div>`
    : info.action === 'card'
      ? '<button type="button" class="small-button" data-open-card>Open virtual card</button>'
      : info.action === 'selection'
        ? ''
        : info.action === 'details'
          ? '<button type="button" class="inline-action" data-open-details>Review purchase details</button>'
          : '<button type="button" class="quiet-button" data-new-purchase>Run another purchase</button>';
  return `<section class="exception-message ${info.action === 'details' ? 'warning' : 'attention'}" role="status" aria-live="polite"><span class="exception-mark">${info.action === 'details' ? '!' : '?'}</span><div><h2 id="outcome-title" tabindex="-1">${escapeHtml(info.title)}</h2><p>${escapeHtml(info.message)}</p>${action}</div></section>`;
}

function historyDetails() {
  if (!state.tasks.length) return '';
  return `<details class="disclosure history-details"><summary>Previous purchases <span>${state.tasks.length} saved</span></summary><div class="disclosure-content history-list">${state.tasks.map((task) => `<button type="button" class="history-item${task.id === state.task?.id ? ' current' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.request?.raw || 'Purchase request')}</strong><small>${escapeHtml(task.quote?.item || task.failure?.code || 'No item selected')}</small></span>${statusPill(task.state)}</button>`).join('')}</div></details>`;
}

function currentRun(task) {
  const projection = state.projection || {};
  const info = exceptionInfo(task);
  const item = projection.quote?.item || task.quote?.item || task.quote?.lockedSnapshot?.item;
  const heading = task.state === 'completed' ? (item || task.request.raw) : task.request.raw;
  return `<section class="run-flow" aria-labelledby="run-heading"><div class="run-heading"><div><span class="overline">${task.state === 'completed' ? 'Purchase complete' : 'Current purchase'}</span><h1 id="run-heading">${escapeHtml(heading)}</h1></div>${modeBadge('LOCAL SIMULATION')}</div>${outcome(task)}${stageTracker(projection)}${info?.action === 'selection' ? candidateDetails(task, true) : ''}${receiptPanel(task)}${purchaseDetails(task)}${receiptAdjustment(task)}${info?.action !== 'selection' ? candidateDetails(task) : ''}${advancedDetails(task)}<button type="button" class="another-button" data-new-purchase>Run another purchase</button></section>`;
}

function render() {
  bootHeader();
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  if (state.cardOpen) document.body.classList.add('drawer-open');
  else document.body.classList.remove('drawer-open');
  const primary = state.busy && !state.task ? runningView() : state.task ? currentRun(state.task) : requestForm();
  app.innerHTML = `${primary}${!state.busy && state.task ? historyDetails() : ''}${!state.task && !state.busy ? historyDetails() : ''}${state.cardOpen ? cardDrawer() : ''}`;
  bindEvents();
}

function fundingPanel() {
  const funding = state.funding || {};
  const kyc = funding.kyc || { status: 'pending' };
  const latest = funding.intents?.[0] || null;
  return `<details class="drawer-disclosure"><summary>Mock KYC and funding <span>${escapeHtml(statusLabel(kyc.status))} KYC · ${escapeHtml(moneyFor(funding.availableBalanceMinor, funding.asset || 'XSGD'))} available</span></summary><div class="drawer-section"><div class="state-grid">${dataCell('KYC gate', statusLabel(kyc.status), kyc.reasonCode || 'Local approval only')}${dataCell('Wallet', moneyFor(funding.availableBalanceMinor, funding.asset || 'XSGD'), 'fake XSGD balance')}${dataCell('Mock destination', latest?.depositInstructions?.destination || 'Not created', 'Not a wallet or blockchain address')}${dataCell('Confirmation reference', latest?.confirmationEvidence?.transactionReference || 'Pending', 'Mock evidence only')}</div><div class="choice-actions">${kyc.status === 'approved' ? '<button type="button" class="quiet-button" data-kyc-action="pending">Simulate re-review</button><button type="button" class="quiet-button" data-kyc-action="reject">Simulate rejection</button>' : '<button type="button" class="small-button" data-kyc-action="approve">Approve local gate</button><button type="button" class="quiet-button" data-kyc-action="reject">Reject local gate</button>'}</div><form id="funding-form"><label for="funding-amount">Seeded fake funding amount</label><div class="funding-row"><input id="funding-amount" name="amount" type="text" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="25.00" value="25.00"${kyc.status !== 'approved' || state.busy ? ' disabled' : ''}><button type="submit" class="small-button"${kyc.status !== 'approved' || state.busy ? ' disabled' : ''}>Create mock deposit intent</button></div><small>LOCAL SIMULATION ONLY - no real funds or blockchain activity.</small></form>${latest ? `<div class="intent-row"><strong>${escapeHtml(latest.amount || moneyFor(latest.amountMinor, latest.asset || 'XSGD'))}</strong>${statusPill(latest.status)}<span>Memo ${escapeHtml(latest.depositInstructions?.memo || 'Not available')}</span><span>Provider reference ${escapeHtml(shortId(latest.providerReference))}</span>${latest.status === 'pending' ? '<div class="choice-actions"><button type="button" class="small-button" data-funding-action="confirm">Confirm deposit</button><button type="button" class="quiet-button" data-funding-action="fail">Simulate failure</button><button type="button" class="quiet-button" data-funding-action="expire">Expire intent</button></div>' : latest.status === 'confirmed' ? '<button type="button" class="quiet-button" data-funding-action="reverse">Simulate reversal</button>' : ''}</div>` : ''}<p class="drawer-note">Mock destination and confirmationEvidence are local provider references only. No real funds or credentials.</p></div></details>`;
}

function cardDrawer() {
  const wallet = state.wallet || {};
  const projection = state.projection || {};
  const card = projection.card || state.task?.card || {};
  const payment = projection.payment || state.task?.payment || {};
  const balance = Number.isFinite(wallet.balanceMinor) ? moneyFor(wallet.balanceMinor, wallet.currency || 'XSGD') : 'Not available';
  const taskCharge = Number.isFinite(payment.amountMinor) ? moneyFor(payment.amountMinor, payment.currency || state.task?.currency) : 'None yet';
  const cardStatus = card.status || 'not_issued';
  return `<div class="drawer-backdrop" data-close-drawer><aside class="card-drawer" role="dialog" aria-modal="true" aria-label="Virtual card" data-card-drawer><div class="drawer-heading"><div><span class="overline">Virtual card</span><h2 id="drawer-heading">${escapeHtml(balance)}</h2></div><button type="button" class="close-button" aria-label="Close virtual card" data-close-drawer>✕</button></div><div class="drawer-card"><span class="drawer-card-label">NaviPay local card</span><strong>${escapeHtml(card.maskedReference || 'Issued per purchase')}</strong><span>${escapeHtml(statusLabel(cardStatus))}</span></div><div class="drawer-facts">${dataCell('This purchase', taskCharge, payment.status === 'authorized' ? 'confirmed payment' : statusLabel(payment.status || 'not_started'))}${dataCell('Card status', statusLabel(cardStatus), card.captureCount != null ? `${card.captureCount} of ${card.maxCaptures || 1} captures` : 'one-use disposable card')}${dataCell('Asset', wallet.currency || state.task?.currency || 'XSGD', 'fake wallet - no real funds')}${dataCell('Wallet', balance, 'current local balance')}</div>${cardStatus === 'active' ? '<button type="button" class="quiet-button full-button" data-card-revoke>Revoke virtual card</button>' : ''}${fundingPanel()}<details class="drawer-disclosure"><summary>Local controls <span>reset saved history</span></summary><div class="drawer-section"><p class="drawer-note">Reset clears saved simulated purchases, inventory leases, funding intents, and the fake wallet returns to its seeded state.</p><button type="button" class="quiet-button full-button" data-reset>Reset local simulation</button></div></details></aside></div>`;
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
  state.funding = payload.funding || state.funding;
  state.discovery = payload.discovery || state.discovery;
  if (state.task) {
    const current = state.tasks.find((task) => task.id === state.task.id);
    if (current) state.task = current;
    state.projection = (payload.projections || []).find((view) => view.taskId === state.task.id) || state.projection;
    await loadAudit(state.task.id);
    const walletDetails = await api('/api/wallet');
    state.ledger = walletDetails.ledger || [];
  }
}

function runKey(prefix = 'browser') {
  return `${prefix}-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function runPurchase(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.currentTarget;
  const request = form.elements.request.value.trim();
  const targetSite = state.targetSite.trim();
  if (!request) {
    state.error = { message: 'Enter a plain-language request first.' };
    render();
    document.querySelector('#request-input')?.focus();
    return;
  }
  state.busy = true;
  state.error = null;
  state.activeRequest = request;
  state.targetSite = targetSite;
  state.task = null;
  state.projection = null;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ request, ...(targetSite ? { targetSite } : {}) }) });
    state.task = payload.task;
    state.projection = payload.projection || null;
    await refresh();
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      state.projection = error.payload.projection || null;
      await refresh().catch(() => {});
    } else {
      state.task = null;
      state.projection = null;
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

async function createFunding(event) {
  event.preventDefault();
  if (state.busy) return;
  const amount = event.currentTarget.elements.amount.value.trim();
  if (!amount) return;
  await withBusy(async () => {
    const payload = await api('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': `funding-${runKey()}` }, body: JSON.stringify({ amount }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  });
}

async function simulateFunding(action) {
  if (state.busy || !state.funding?.intents?.[0]) return;
  await withBusy(async () => {
    const intentId = state.funding.intents[0].id;
    const payload = await api(`/api/funding/intents/${encodeURIComponent(intentId)}/simulate`, { method: 'POST', headers: { 'Idempotency-Key': `funding-sim-${runKey()}`, 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  });
}

async function simulateKyc(action) {
  if (state.busy) return;
  await withBusy(async () => {
    const payload = await api('/api/funding/kyc/simulate', { method: 'POST', headers: { 'Idempotency-Key': `kyc-sim-${runKey()}`, 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
    state.funding = payload.funding || state.funding;
    await refresh();
  });
}

async function paymentAdjustment(kind) {
  if (state.busy || !state.task) return;
  await withBusy(async () => {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/payment/${kind}`, { method: 'POST', headers: { 'Idempotency-Key': runKey(kind) }, body: '{}' });
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    await refresh();
  });
}

async function revokeCard() {
  if (state.busy || !state.task) return;
  await withBusy(async () => {
    const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/card/revoke`, { method: 'POST', headers: { 'Idempotency-Key': runKey('revoke') }, body: '{}' });
    state.task = payload.task;
    state.projection = payload.projection || state.projection;
    await refresh();
  });
}

async function resetSimulation() {
  if (state.busy) return;
  await withBusy(async () => {
    const payload = await api('/api/reset', { method: 'POST', body: '{}' });
    state.tasks = payload.tasks || [];
    state.task = null;
    state.projection = null;
    state.audit = [];
    state.ledger = [];
    state.wallet = payload.wallet || null;
    state.funding = payload.funding || null;
    state.activeRequest = '';
    state.error = null;
    state.cardOpen = false;
  });
}

async function withBusy(operation) {
  state.busy = true;
  state.error = null;
  render();
  try {
    await operation();
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
  render();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    state.task = payload.task;
    state.projection = payload.projection || null;
    state.targetSite = payload.task.targetSite?.url || '';
    state.activeRequest = payload.task.request?.raw || '';
    await refresh();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function startAnother() {
  if (state.busy) return;
  state.task = null;
  state.projection = null;
  state.error = null;
  state.activeRequest = '';
  state.targetSite = '';
  state.cardOpen = false;
  render();
  document.querySelector('#request-input')?.focus();
}

function bindEvents() {
  document.querySelector('#request-form')?.addEventListener('submit', runPurchase);
  document.querySelector('#funding-form')?.addEventListener('submit', createFunding);
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
    state.activeRequest = button.dataset.example;
    render();
    document.querySelector('#request-input')?.focus();
  }));
  document.querySelectorAll('[data-funding-action]').forEach((button) => button.addEventListener('click', () => simulateFunding(button.dataset.fundingAction)));
  document.querySelectorAll('[data-kyc-action]').forEach((button) => button.addEventListener('click', () => simulateKyc(button.dataset.kycAction)));
  document.querySelectorAll('[data-candidate-id]').forEach((button) => button.addEventListener('click', () => resumeTask(button.dataset.candidateId)));
  document.querySelectorAll('[data-resolution]').forEach((button) => button.addEventListener('click', () => reconcilePayment(button.dataset.resolution)));
  document.querySelectorAll('[data-payment-action]').forEach((button) => button.addEventListener('click', () => paymentAdjustment(button.dataset.paymentAction)));
  document.querySelectorAll('[data-card-revoke]').forEach((button) => button.addEventListener('click', revokeCard));
  document.querySelectorAll('[data-reset]').forEach((button) => button.addEventListener('click', resetSimulation));
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
  document.querySelectorAll('[data-open-card]').forEach((button) => button.addEventListener('click', () => { state.cardOpen = true; render(); }));
  document.querySelectorAll('[data-card-open]').forEach((button) => button.addEventListener('click', () => { state.cardOpen = true; render(); }));
  document.querySelectorAll('[data-close-drawer]').forEach((button) => button.addEventListener('click', (event) => { if (event.target === button || button.classList.contains('close-button')) { state.cardOpen = false; render(); } }));
  document.querySelectorAll('[data-new-purchase]').forEach((button) => button.addEventListener('click', startAnother));
  document.querySelectorAll('[data-open-details]').forEach((button) => button.addEventListener('click', () => {
    const details = document.querySelector('#purchase-details');
    if (details) {
      details.open = true;
      details.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }));
  document.querySelector('#target-site')?.addEventListener('input', (event) => { state.targetSite = event.target.value; });
}

function headerButton() {
  const wallet = state.wallet || {};
  const amount = Number.isFinite(wallet.balanceMinor) ? formatMoney(wallet.balanceMinor, wallet.currency || 'XSGD') : 'Wallet unavailable';
  return `<button type="button" class="wallet-chip" data-card-open aria-label="Open virtual card drawer, current balance ${escapeHtml(amount)}">CARD <strong>${escapeHtml(amount)}</strong></button>`;
}

function bootHeader() {
  const header = document.querySelector('.topbar');
  if (!header) return;
  header.innerHTML = `<a class="brand" href="/" aria-label="NaviPay home"><span class="brand-mark">N</span><strong>NaviPay</strong></a><div class="topbar-right">${modeBadge()}${headerButton()}</div>`;
}

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.tasks = payload.tasks || [];
    state.wallet = payload.wallet || null;
    state.funding = payload.funding || null;
    state.discovery = payload.discovery || null;
    state.task = state.tasks[0] || null;
    state.targetSite = state.task?.targetSite?.url || '';
    state.activeRequest = state.task?.request?.raw || '';
    state.projection = (payload.projections || []).find((view) => view.taskId === state.task?.id) || null;
    if (state.task) {
      await loadAudit(state.task.id);
      const walletDetails = await api('/api/wallet');
      state.ledger = walletDetails.ledger || [];
    }
    bootHeader();
    render();
  } catch (error) {
    app.innerHTML = `<div class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><span>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</span></div>`;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.cardOpen) {
    state.cardOpen = false;
    render();
  }
});

boot();
