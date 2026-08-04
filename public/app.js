const state = { tasks: [], task: null, projection: null, discovery: null, wallet: null, funding: null, ledger: [], audit: [], busy: false, error: null, targetSite: '' };
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
  compensation_failed: 'Refund failed'
};

function statusTone(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'committed', 'authorized', 'retired', 'captured', 'active', 'approved', 'refunded', 'reversed'].includes(value)) return 'success';
  if (['failed', 'declined', 'rejected', 'out_of_stock'].includes(value)) return 'danger';
  if (['unknown', 'reconciliation_required', 'awaiting_selection', 'pending', 'expired', 'paused'].includes(value)) return 'warning';
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
  if (task.state === 'awaiting_selection') return task.quote?.recommendationOnly && task.quote?.mode === 'read-only Playwright fixture' ? 'There is no single best browser match. Choose one of the tied results in Advanced details so NaviPay can cross-check the authoritative local quote before purchase.' : 'We found more than one good local match. Choose the item you want in Advanced details to continue.';
  if (task.state === 'reconciliation_required') return 'The payment result is unclear. Nothing will be tried again until you confirm what happened in Advanced details.';
  if (code === 'NO_LOCAL_MATCHES' || code === 'DISCOVERY_NO_MATCH') return 'No matching local item was found. No inventory was reserved and nothing was charged.';
  if (code === 'INSUFFICIENT_FUNDS') return 'There is not enough fake balance for this purchase. Nothing was charged.';
  if (code === 'OUT_OF_STOCK') return 'The exact requested item is out of stock. NaviPay did not substitute another brand. Nothing was charged.';
  if (code === 'SPENDING_CEILING_EXCEEDED') return 'Every available match is over the task budget. Nothing was charged.';
  if (code === 'QUOTE_EXPIRED') return 'The quote expired before payment. Nothing was charged.';
  if (code === 'ORDER_COMMIT_FAILED' || code === 'INVENTORY_COMMIT_FAILED') return 'Order and inventory confirmation failed safely. Payment was compensated and no confirmed order remains.';
  if (code === 'AMBIGUOUS_MATCH') return 'More than one exact match needs your choice. No inventory was reserved and nothing was charged.';
  if (code === 'AUTHORITATIVE_QUOTE_MISMATCH') return 'The browser price did not match the approved local quote. Nothing was charged.';
  if (code === 'PAYMENT_DECLINED' || code === 'PAYMENT_DECLINED_RECONCILED') return 'The payment did not go through. Nothing was charged.';
  if (code === 'DELIVERY_FAILED') return 'The purchase is confirmed, but delivery could not be completed.';
  if (code === 'FULFILLMENT_FAILED') return 'The purchase is confirmed, but the order could not be prepared.';
  if (code === 'INVALID_PURCHASE_REQUEST' || code === 'MISSING_PRODUCT_TYPE') return 'Name a concrete product type, such as “buy a Logitech mouse”.';
  if (code === 'KYC_NOT_APPROVED') return 'Mock KYC approval is required before NaviPay can authorize or issue a card. Nothing was charged.';
  if (code === 'INSUFFICIENT_FUNDS') return 'There is not enough fake XSGD balance for the exact quoted total. No card was issued.';
  if (code === 'MERCHANT_CATEGORY_NOT_ALLOWED' || code === 'POLICY_BLOCKED') return 'This merchant or category is outside the approved local purchase scope. No card was issued.';
  if (code === 'DUPLICATE_INSTRUCTION') return 'This instruction was identified as a duplicate. No second authorization was created.';
  if (code === 'QUOTE_EXPIRED') return 'The authoritative quote is stale. NaviPay stopped before card issuance.';
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
    title = task.quote?.recommendationOnly && task.quote?.mode === 'read-only Playwright fixture' ? 'Recommendation ready' : 'Choose an item to continue';
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
  return `<section class="request-card"><div class="request-copy"><span class="overline">NaviPay local purchase</span><h1>What should we buy?</h1><p>Start with a plain instruction. NaviPay uses its seeded local merchant catalog and local merchant gateway by default.</p><p class="local-disclosure">Local simulation only: fake wallet, seeded inventory, mock KYC, and fixture delivery. No real funds or credentials.</p></div><form id="request-form" novalidate><label for="request-input">Purchase instruction</label><div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="Find an Apple Magic Keyboard" required><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${state.busy ? 'Running…' : 'Discover and purchase'}</button></div><p class="local-path"><span>Primary path</span><strong>Seeded local catalog and local merchant gateway</strong></p><details class="optional-discovery"><summary>Optional browser evidence <span>read-only and collapsed by default</span></summary><div class="optional-discovery-content"><label class="target-label" for="target-site">Approved target commerce site <span>(optional)</span></label><input id="target-site" name="targetSite" type="url" maxlength="2048" autocomplete="url" value="${targetValue}" placeholder="http://127.0.0.1:43123/competition/"><small>Only an already allowlisted local replay site may be fetched. Discovery cannot reserve inventory, authorize payment, or place an order.</small><p class="configured-site"><span>Configured site</span><strong>${escapeHtml(configuredSite.label || 'Not configured')}</strong></p><p class="discovery-config"><span>Evidence status</span>${discoveryBadge(discovery)} ${escapeHtml(discovery.explanation)}</p></div></details><p class="form-error" id="request-error" role="alert" hidden></p></form></section>`;
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
  const paymentUnknown = task.payment?.status === 'unknown';
  const recommendationOnly = Boolean(view.quote?.recommendationOnly || task.quote?.recommendationOnly);
  const amountSpent = recommendationOnly ? 'Recommendation only' : paymentWasMade ? expectedAmount : paymentUnknown ? 'Needs confirmation' : task.payment ? formatMoney(0, task.currency) : (Number.isFinite(amount) ? 'Not yet paid' : 'Not set');
  const amountNote = recommendationOnly ? 'No purchase authority' : paymentWasMade ? 'Confirmed payment' : paymentUnknown ? 'Capture result is unknown' : task.payment ? 'Nothing charged' : 'Expected total';
  const stockNote = displayItem?.variant || (recommendation?.reason || 'NaviPay is looking for a suitable item.');
  const itemLabel = item ? 'Item found' : fallbackItem ? 'Requested item' : 'Item';
  const breakdown = view.quote && Number.isFinite(view.quote.totalMinor) ? `<div class="quote-breakdown" aria-label="Quote breakdown">${dataCell('Subtotal', formatMoney(view.quote.subtotalMinor, view.quote.currency))}${dataCell('Shipping', formatMoney(view.quote.shippingMinor, view.quote.currency))}${dataCell('Tax', formatMoney(view.quote.taxMinor, view.quote.currency))}${dataCell('Total', formatMoney(view.quote.totalMinor, view.quote.currency))}</div>` : '';
  const rationale = displayItem?.matchReasons?.join('; ') || view.recommendation?.reason || recommendation?.reason || 'NaviPay is looking for a suitable item.';
  const receiptNote = view.receipt?.status === 'confirmed' ? `Receipt ${shortId(view.receipt.id)} is ready.` : '';
  const authorization = state.projection?.authorization?.decision || task.authorizationDecision;
  const authorizationLine = authorization ? `<p class="authorization-reason"><span>Authorization</span>${statusPill(authorization.status)} ${escapeHtml(authorization.reason || 'No reason recorded.')}</p>` : '';
  const discovery = discoveryView(task);
  const primaryDiscovery = discovery.source === 'local_browser_fixture' ? { source: 'seeded_catalog', label: 'Seeded local catalog', explanation: 'The authoritative local merchant quote controls inventory and checkout. Browser evidence is read-only in Advanced details.' } : discovery;
  return `<section class="panel product-panel"><div class="panel-heading"><div><span class="overline">${escapeHtml(itemLabel)}</span><h2>${escapeHtml(itemName)}</h2></div>${discoveryBadge(primaryDiscovery)}</div><div class="discovery-explanation"><strong>${escapeHtml(primaryDiscovery.label || 'Discovery')}</strong><span>${escapeHtml(primaryDiscovery.explanation || '')}</span></div><div class="product-highlight"><div><span class="product-label">Merchant</span><strong>${escapeHtml(merchant)}</strong><small>${escapeHtml(stockNote)}</small><small class="selection-reason">Why this item: ${escapeHtml(rationale)}</small></div><div class="product-amount"><span class="product-label">Amount spent</span><strong>${escapeHtml(amountSpent)}</strong><small>${escapeHtml(amountNote)}</small></div></div>${authorizationLine}${breakdown}${receiptNote ? `<p class="receipt-note">✓ ${escapeHtml(receiptNote)}</p>` : ''}</section>`;
}

function balanceSummary(task) {
  const wallet = state.wallet || {};
  const financial = state.projection?.financial || task.financial || {};
  const starting = financial.balanceBeforeMinor;
  const afterPayment = financial.balanceAfterPaymentMinor;
  const finalBalance = financial.finalBalanceMinor;
  const currency = task.currency || wallet.currency || 'XSGD';
  const unknownPayment = task.payment?.status === 'unknown';
  return `<section class="panel balance-panel"><div class="panel-heading"><div><span class="overline">Task-scoped fake wallet</span><h2>This purchase balance</h2></div><span class="fixture-chip">NO REAL FUNDS</span></div><div class="balance-grid">${dataCell('Wallet before', starting == null ? 'Not started' : formatMoney(starting, currency), starting == null ? 'Funding was not entered' : 'Snapshot before this purchase')}${dataCell('After payment', unknownPayment ? 'Needs confirmation' : afterPayment == null ? (task.payment?.status === 'not_started' ? 'Not started' : 'Not charged') : formatMoney(afterPayment, currency), unknownPayment ? 'Issuer capture is unresolved' : afterPayment == null ? 'No confirmed debit' : 'Snapshot after the debit')}${dataCell('Final balance', unknownPayment ? 'Needs confirmation' : finalBalance == null ? 'Not started' : formatMoney(finalBalance, currency), unknownPayment ? 'Resolve the issuer result first' : finalBalance == null ? 'No task snapshot' : financial.outcome === 'compensated' ? 'After compensation' : 'Task snapshot')}</div></section>`;
}

function fundingPanel() {
  const funding = state.funding || {};
  const kyc = funding.kyc || { status: 'pending' };
  const latest = funding.intents?.[0] || null;
  const approved = kyc.status === 'approved';
  const kycControls = kyc.status === 'approved'
    ? '<button type="button" class="quiet-button" data-kyc-action="pending">Simulate re-review</button><button type="button" class="quiet-button" data-kyc-action="reject">Simulate rejection</button>'
    : kyc.status === 'rejected'
      ? '<button type="button" class="secondary-button" data-kyc-action="approve">Approve local gate</button>'
      : '<button type="button" class="secondary-button" data-kyc-action="approve">Approve local gate</button><button type="button" class="quiet-button" data-kyc-action="reject">Reject local gate</button>';
  let simulationControls = '';
  if (latest?.status === 'pending') simulationControls = '<div class="choice-actions"><button type="button" class="secondary-button" data-funding-action="confirm">Confirm deposit</button><button type="button" class="quiet-button" data-funding-action="fail">Simulate failure</button><button type="button" class="quiet-button" data-funding-action="expire">Expire intent</button></div>';
  if (latest?.status === 'confirmed') simulationControls = '<div class="choice-actions"><button type="button" class="quiet-button" data-funding-action="reverse">Simulate reversal</button></div>';
  const evidence = latest?.confirmationEvidence;
  const latestDetails = latest ? `<div class="funding-intent"><div class="panel-heading"><div><span class="overline">Latest deposit intent</span><strong>${escapeHtml(latest.amount)}</strong></div>${statusPill(latest.status)}</div><div class="funding-instructions">${dataCell('Mock destination', latest.depositInstructions?.destination || 'Not available', 'Not a wallet or blockchain address')}${dataCell('Memo', latest.depositInstructions?.memo || 'Not available', 'Use only in this local simulation')}${dataCell('Provider reference', shortId(latest.providerReference), 'Safe reference')}${dataCell('Confirmation reference', evidence?.transactionReference || 'Pending', evidence ? 'Mock evidence only' : 'No confirmation yet')}</div>${simulationControls}${latest.status === 'pending' ? `<small class="funding-expiry">Intent expires ${formatDate(latest.expiresAt)}.</small>` : ''}${latest.failureReason ? `<p class="funding-reason">${escapeHtml(latest.failureReason)}</p>` : ''}</div>` : '<p class="advanced-help">Create a local deposit intent after the mock KYC gate is approved.</p>';
  const summary = `${statusLabels[kyc.status] || kyc.status} KYC · ${formatMoney(funding.availableBalanceMinor, funding.asset || 'XSGD')} available`;
  return `<details class="panel funding-panel"><summary><span><span class="overline">Local simulation and funding</span><strong>Mock KYC, seeded fake wallet, and gateway disclosure</strong><small>${escapeHtml(summary)}</small></span><span class="fixture-chip">LOCAL ONLY</span></summary><div class="funding-content"><div class="funding-overview">${dataCell('Available balance', formatMoney(funding.availableBalanceMinor, funding.asset || 'XSGD'), 'Authoritative seeded fake wallet')}${dataCell('Asset / network', `${funding.asset || 'XSGD'} · ${funding.network || 'Avalanche Fuji'}`, 'Local fixture')}</div><div class="funding-gate"><div><span class="product-label">Mock KYC gate</span><strong>${statusPill(kyc.status)} <span>${escapeHtml(kyc.providerReference ? `Reference ${shortId(kyc.providerReference)}` : 'Safe status only')}</span></strong><small>${escapeHtml(kyc.reasonCode || 'Approval is required before a mock XSGD intent can be created or credited.')}</small></div><div class="choice-actions">${kycControls}</div></div><form id="funding-form" novalidate><label for="funding-amount">Seeded fake funding amount</label><div class="funding-form-row"><input id="funding-amount" name="amount" type="text" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="25.00" value="25.00"${!approved || state.busy ? ' disabled' : ''}><button type="submit" class="secondary-button"${!approved || state.busy ? ' disabled' : ''}>Create mock deposit intent</button></div><small class="funding-disclosure">${escapeHtml(funding.disclosure || 'LOCAL SIMULATION ONLY - no real funds or blockchain activity.')}</small></form>${latestDetails}<p class="gateway-disclosure">Local merchant gateway: read-only discovery and checkout worker are separate. No external merchant checkout or real payment credentials are used.</p></div></details>`;
}

function commerceStatus(task) {
  const purchase = task.state === 'failed' ? 'failed' : task.state === 'reconciliation_required' ? 'reconciliation_required' : task.state === 'awaiting_selection' ? 'awaiting_selection' : task.purchaseStatus || task.state;
  const payment = task.payment?.status || 'not_started';
  const inventory = task.inventory?.status || 'not_started';
  const order = task.order?.status || 'not_started';
  const fulfillment = task.fulfillment?.status && task.fulfillment.status !== 'pending' ? task.fulfillment.status : 'not_started';
  const delivery = task.delivery?.status && task.delivery.status !== 'pending' ? task.delivery.status : 'not_started';
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
  if (entries.length && entries.every((item) => ['not_started', 'pending', 'skipped'].includes(item.status))) return 'skipped';
  if (task.automation?.status === 'running' || task.automation?.status === 'awaiting_selection' || task.automation?.status === 'awaiting_reconciliation') return 'active';
  return 'pending';
}

function bandDetail(task, band, stateName) {
  if (stateName === 'success') return 'Done';
  if (stateName === 'warning') return task.state === 'reconciliation_required' && band.label === 'Pay' ? 'Needs confirmation' : 'Needs attention';
  if (stateName === 'skipped') return 'Skipped';
  if (task.state === 'awaiting_selection' && band.label === 'Find an item') return task.quote?.recommendationOnly && task.quote?.mode === 'read-only Playwright fixture' ? 'Recommendation ready' : 'Choose an item';
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
  const browserRecommendation = recommendationOnly && quote.mode === 'read-only Playwright fixture';
  const needsChoice = task.state === 'awaiting_selection';
  const selected = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === quote.recommendedCandidateId);
  const selectedEvidence = selected && (selected.sourceUrl || selected.evidence?.observedAt || selected.matchReasons?.length) ? `<div class="selection-evidence"><h4>Selected item evidence</h4><dl class="detail-list">${detailValue('Source URL', selected.sourceUrl || 'Seeded catalog - no browser URL')}${detailValue('Observed', formatDate(selected.evidence?.observedAt))}${detailValue('Match rationale', (selected.matchReasons || []).join('; ') || 'No additional rationale recorded')}</dl></div>` : '';
  const heading = browserRecommendation && needsChoice ? 'Select a discovery result' : needsChoice ? 'Choose an item' : 'Discovery details';
  const help = browserRecommendation && needsChoice ? '<p class="advanced-help">Browser discovery is read-only. Select a result to cross-check it against the approved local quote before any stock or payment action.</p>' : needsChoice ? '<p class="advanced-help">Several local items fit your request. Choose one to continue. This is the only decision NaviPay needs from you.</p>' : browserRecommendation ? '<p class="advanced-help">This browser result is read-only evidence. It cannot authorize money or inventory.</p>' : '';
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
  return `<details class="advanced-details"${open}><summary>Advanced details <span>References, safeguards, and activity</span></summary><div class="advanced-content">${candidateDetails(task)}${paymentUnknown ? `<div class="advanced-block attention-block"><h3>Confirm the payment result</h3><p class="advanced-help">NaviPay will not try the payment again. Tell us whether the fake wallet approved or declined it.</p><div class="choice-actions"><button type="button" class="secondary-button" data-resolution="authorized">Payment was approved</button><button type="button" class="quiet-button" data-resolution="declined">Payment was declined</button></div></div>` : ''}<div class="advanced-block"><h3>Run information</h3><dl class="detail-list">${detailValue('Request interpretation', [task.request?.intent?.brand, task.request?.intent?.product, task.request?.intent?.productCategory, `quantity ${task.request?.intent?.quantity ?? 1}`].filter(Boolean).join(' · ') || 'Not detected')}${detailValue('Authorization', (state.projection?.authorization?.decision || task.authorizationDecision)?.reason || 'Not decided')}${detailValue('Run state', task.state)}${detailValue('Automation', task.automation?.status || 'Not started')}${detailValue('Next action', task.automation?.nextAction || 'None')}${task.failure ? detailValue('Recorded issue', `${task.failure.code}: ${task.failure.message}`) : ''}${detailValue('Task reference', shortId(task.id))}</dl></div><div class="advanced-block"><h3>Purchase evidence</h3><dl class="detail-list">${detailValue('Discovery source', discoveryView(task).label || 'Not available')}${detailValue('Product SKU', task.quote?.lockedSnapshot?.sku || 'Not selected')}${detailValue('Variant', task.quote?.lockedSnapshot?.variantId || 'Not selected')}${detailValue('Inventory reservation', task.inventory?.reservation?.reference || 'None')}${detailValue('Card reference', task.card?.maskedReference || task.instrument?.maskedReference || 'None')}${detailValue('Card status', task.card?.status || 'Not issued')}${detailValue('Authorization reference', task.checkout?.authorizationReference || 'None')}${detailValue('Capture reference', task.checkout?.captureReference || 'None')}${detailValue('Payment reference', task.payment?.reference || 'None')}${detailValue('Ledger transaction', task.payment?.transactionReference || 'None')}${detailValue('Settlement status', task.payment?.adjustmentStatus || 'Not adjusted')}${detailValue('Adjustment reference', task.payment?.adjustmentReference || 'None')}${detailValue('Adjustment transaction', task.payment?.adjustmentTransactionReference || 'None')}${detailValue('Checkout cleanup', task.checkoutWorker?.cleanup || 'Pending')}${detailValue('Order reference', task.order?.reference || 'None')}${detailValue('Delivery reference', task.delivery?.trackingReference || 'None')}${detailValue('Chain evidence', task.funding?.transactionReference || 'None')}${detailValue('Receipt reference', task.receipt?.id || 'None')}${detailValue('Authorization decision', task.authorizationDecision?.decisionId || 'None')}</dl></div><div class="advanced-block"><h3>Ledger legs</h3>${ledgerDetails(task)}</div><div class="advanced-block"><h3>Activity trail</h3><p class="advanced-help">These records are safe, simulated evidence for checking what happened behind the purchase.</p>${auditDetails()}</div></div></details>`;
}

function historyDetails() {
  if (!state.tasks.length) return '';
  return `<details class="advanced-details history-details"><summary>Previous purchases <span>${state.tasks.length} saved</span></summary><div class="history-grid">${state.tasks.map((task) => `<button type="button" class="history-item${task.id === state.task?.id ? ' current' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.request.raw)}</strong><small>${escapeHtml(task.quote?.item || 'No item selected')}</small></span>${statusPill(task.state)}</button>`).join('')}</div></details>`;
}

function receiptAdjustment(adjustment, currency) {
  if (!adjustment) return '';
  const statusLabel = adjustment.status === 'failed' ? 'Refund or reversal failed' : adjustment.kind === 'reversal' ? 'Reversal completed' : 'Refund completed';
  const compensationLabel = adjustment.compensation?.status === 'compensated' ? 'Compensated' : 'Needs review';
  return `<div class="receipt-adjustment"><div class="panel-heading"><div><span class="overline">Current settlement</span><h3>${escapeHtml(statusLabel)}</h3></div>${statusPill(adjustment.status)}</div><p class="receipt-adjustment-note">The capture snapshot above is immutable. This section records the latest simulated ${escapeHtml(adjustment.kind)} outcome without rewriting the order or delivery history.</p><div class="balance-grid">${dataCell('Current payment', statusLabels[adjustment.currentPaymentStatus] || adjustment.currentPaymentStatus || 'Not available')}${dataCell('Net charged', formatMoney(adjustment.netChargedMinor, currency))}${dataCell('Net refunded', formatMoney(adjustment.netRefundedMinor, currency))}${dataCell('Compensation', compensationLabel)}</div><dl class="detail-list receipt-references">${detailValue('Adjustment reference', shortId(adjustment.reference))}${detailValue('Ledger transaction', shortId(adjustment.transactionReference))}${detailValue('Requested', formatDate(adjustment.requestedAt))}${detailValue('Recorded', formatDate(adjustment.occurredAt))}${adjustment.failureCode ? detailValue('Outcome', adjustment.failureCode) : ''}</dl></div>`;
}

function receiptPanel(task) {
  const receipt = state.projection?.receipt || task.receipt;
  if (!receipt || receipt.status !== 'confirmed') return '';
  const currency = receipt.currency || task.currency || 'XSGD';
  return `<section class="panel receipt-panel"><div class="panel-heading"><div><span class="overline">Primary success artifact</span><h2>Receipt</h2></div>${statusPill(receipt.status)}</div><div class="receipt-heading"><div><strong>${escapeHtml(receipt.item || 'Item')}</strong><small>${escapeHtml(receipt.merchant || 'Merchant')} · ${escapeHtml(receipt.variant || '')}</small></div><strong>${formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency)}</strong></div><p class="receipt-capture-note">Original capture snapshot - issued ${escapeHtml(formatDate(receipt.issuedAt))}. Payment and commerce statuses here describe what was captured at purchase time.</p><div class="quote-breakdown">${dataCell('Item', formatMoney(receipt.subtotalMinor, currency))}${dataCell('Shipping', formatMoney(receipt.shippingMinor, currency))}${dataCell('Tax', formatMoney(receipt.taxMinor, currency))}${dataCell('Total', formatMoney(receipt.totalMinor ?? receipt.amountMinor, currency))}</div><div class="balance-grid receipt-balances">${dataCell('Balance before', formatMoney(receipt.balanceBeforeMinor, currency))}${dataCell('After payment', formatMoney(receipt.balanceAfterPaymentMinor, currency))}${dataCell('Final balance', formatMoney(receipt.finalBalanceMinor, currency))}${dataCell('Net charged', formatMoney(receipt.netChargedMinor, currency))}</div><div class="commerce-grid receipt-statuses">${dataCell('Captured payment', statusLabels[receipt.paymentStatus] || receipt.paymentStatus || 'Not available')}${dataCell('Order', statusLabels[receipt.orderStatus] || receipt.orderStatus || 'Not available')}${dataCell('Fulfillment', statusLabels[receipt.fulfillmentStatus] || receipt.fulfillmentStatus || 'Not available')}${dataCell('Delivery', statusLabels[receipt.deliveryStatus] || receipt.deliveryStatus || 'Not available')}</div>${receiptAdjustment(receipt.adjustment, currency)}<dl class="detail-list receipt-references">${detailValue('Receipt reference', shortId(receipt.id))}${detailValue('Capture reference', shortId(receipt.captureReference))}${detailValue('Order reference', shortId(receipt.orderReference))}${detailValue('Payment reference', shortId(receipt.paymentReference))}${detailValue('Quote / cart', `${shortId(receipt.quoteId)} / ${shortId(receipt.cartId)}`)}${detailValue('Issued', formatDate(receipt.issuedAt))}</dl><p class="receipt-disclosure">${escapeHtml(receipt.disclosure || 'SIMULATED receipt - local fake wallet and merchant gateway only.')}</p></section>`;
}

function currentRun(task) {
  return `<div class="run-heading"><div><span class="overline">Current purchase</span><h2>${escapeHtml(task.request.raw)}</h2></div>${modeBadge('FAKE WALLET')}</div>${receiptPanel(task)}<div class="purchase-flow">${productSummary(task)}${balanceSummary(task)}${commerceStatus(task)}${progressPanel(task)}</div>${cardStatus(task)}${advancedDetails(task)}${historyDetails()}`;
}

function render() {
  const task = state.task;
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  if (!task) {
    app.innerHTML = `${requestCard()}${fundingPanel()}${emptyState()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
    bindEvents();
    return;
  }
  app.innerHTML = `${requestCard()}${fundingPanel()}${outcome(task)}${currentRun(task)}<p class="footer-note">NaviPay is a local-only simulation. No real money, products, deliveries, or funding are involved.</p>`;
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
  state.funding = payload.funding || state.funding;
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
      state.projection = error.payload.projection || null;
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
    const payload = await api('/api/funding/intents', { method: 'POST', headers: { 'Idempotency-Key': `funding-${runKey()}` }, body: JSON.stringify({ amount }) });
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
    const payload = await api(`/api/funding/intents/${encodeURIComponent(intentId)}/simulate`, { method: 'POST', headers: { 'Idempotency-Key': `funding-sim-${runKey()}`, 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
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
    const payload = await api('/api/funding/kyc/simulate', { method: 'POST', headers: { 'Idempotency-Key': `kyc-sim-${runKey()}`, 'X-NaviPay-Local-Simulation': 'true' }, body: JSON.stringify({ action }) });
    state.funding = payload.funding || state.funding;
    await refresh();
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
  document.querySelector('#funding-form')?.addEventListener('submit', createFunding);
  document.querySelectorAll('[data-funding-action]').forEach((button) => button.addEventListener('click', () => simulateFunding(button.dataset.fundingAction)));
  document.querySelectorAll('[data-kyc-action]').forEach((button) => button.addEventListener('click', () => simulateKyc(button.dataset.kycAction)));
  document.querySelectorAll('[data-candidate-id]').forEach((button) => button.addEventListener('click', () => resumeTask(button.dataset.candidateId)));
  document.querySelectorAll('[data-resolution]').forEach((button) => button.addEventListener('click', () => reconcilePayment(button.dataset.resolution)));
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
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
