const state = { tasks: [], task: null, wallet: null, audit: [], busy: false, error: null };
const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(minor, currency = 'XSGD') {
  if (!Number.isFinite(minor)) return '-';
  return `${currency} ${(minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortId(value) {
  if (!value) return '-';
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function modeBadge(label = 'SIMULATED') {
  return `<span class="mode-badge mode-badge-light"><span class="mode-dot"></span> ${escapeHtml(label)}</span>`;
}

function stateClass(value) {
  if (['completed', 'confirmed', 'delivered', 'fulfilled', 'reserved', 'authorized'].includes(value)) return 'success';
  if (['failed', 'declined', 'out_of_stock', 'compensated'].includes(value)) return 'danger';
  if (['unknown', 'reconciliation_required', 'pending', 'awaiting_selection'].includes(value)) return 'warning';
  return 'neutral';
}

function statusPill(value) {
  const label = String(value || 'pending').replaceAll('_', ' ');
  return `<span class="status-pill ${stateClass(value)}">${escapeHtml(label)}</span>`;
}

function dataCell(label, value, note = '') {
  return `<div class="data-cell"><span class="data-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function progressLabel(stage) {
  return ({ intent: 'Intent interpreted', funding: 'Wallet and funding facts', discovery: 'Merchant discovery', quote: 'Quote selected', inventory: 'Stock reserved', payment: 'Wallet payment', merchant_credit: 'Merchant credited', order: 'Order created', fulfillment: 'Fulfillment', delivery: 'Delivery', receipt: 'Receipt', audit: 'Audit evidence' })[stage] || stage;
}

function intentPanel(task) {
  const intent = task.request.intent;
  return `<section class="panel intent-panel"><div class="panel-heading"><div><span class="overline">Interpreted request</span><h2>${escapeHtml(task.request.raw)}</h2></div>${modeBadge('LOCAL PARSER')}</div><div class="intent-grid">${dataCell('Product category', intent.productCategory || 'Not detected')}${dataCell('Brand', intent.brand || 'Any brand')}${dataCell('Keywords', intent.keywords.join(', '))}${dataCell('Request reference', shortId(task.id))}</div><p class="muted">NaviPay uses a deterministic local parser. The interpreted intent is retained in the task record before discovery begins.</p></section>`;
}

function recommendationPanel(task) {
  const quote = task.quote;
  if (!quote) return `<section class="panel empty-panel"><span class="overline">Recommended item</span><h2>Waiting for discovery</h2><p class="muted">The local merchant sandbox will find an in-stock keyboard, mouse, or earphone after you run a request.</p></section>`;
  const chosen = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === task.recommendation?.candidateId) || quote.candidates[0];
  const recommendation = task.recommendation || quote.recommendation || {};
  return `<section class="panel recommendation-panel"><div class="panel-heading"><div><span class="overline">Recommended item</span><h2>${recommendation.status === 'clear' || recommendation.status === 'fallback_available' ? 'Best clear match' : 'Candidate review required'}</h2></div>${modeBadge('SEEDED MERCHANTS')}</div><div class="recommendation-main"><div><span class="product-kicker">${escapeHtml(chosen?.brand || 'Local catalog')} · ${escapeHtml(chosen?.productCategory || '')}</span><h3>${escapeHtml(chosen?.item || 'No item selected')}</h3><p>${escapeHtml(chosen?.variant || '')}</p><p class="merchant-line">${escapeHtml(chosen?.merchant || '')}</p></div><strong class="recommendation-price">${formatMoney(chosen?.totalMinor, chosen?.currency)}</strong></div><div class="recommendation-facts">${dataCell('Stock', chosen?.availability === 'in_stock' ? `${chosen.stockQuantity} available` : 'Out of stock')}${dataCell('Merchant', chosen?.merchant || '-')}${dataCell('Quote total', formatMoney(chosen?.totalMinor, chosen?.currency))}${dataCell('Quote expiry', formatDate(chosen?.quoteExpiresAt))}</div><p class="recommendation-reason">${escapeHtml(recommendation.reason || chosen?.matchReasons?.join(' · ') || '')}</p><p class="disclosure">SIMULATED catalog evidence. Merchant IDs, SKU, variant, stock, price, and quote expiry are persisted with the run.</p></section>`;
}

function progressPanel(task) {
  return `<section class="panel progress-panel"><div class="panel-heading"><div><span class="overline">Automatic orchestration</span><h2>One run, correlated evidence</h2></div>${statusPill(task.automation.status)}</div><ol class="progress-list">${task.progress.map((item) => `<li class="progress-item ${stateClass(item.status)}"><span class="progress-mark">${item.status === 'completed' ? '✓' : item.status === 'failed' ? '!' : item.status === 'unknown' ? '?' : item.status === 'running' ? '•' : ''}</span><span><strong>${escapeHtml(progressLabel(item.stage))}</strong><small>${escapeHtml(item.detail || item.status.replaceAll('_', ' '))}${item.reference ? ` · ${escapeHtml(shortId(item.reference))}` : ''}</small></span>${statusPill(item.status)}</li>`).join('')}</ol><p class="muted progress-note">The server advances each boundary without manual stage controls. Every reference is correlated to this purchase.</p></section>`;
}

function statusPanel(task) {
  const reservationStatus = task.inventory?.reservation?.status || (task.failure?.stage === 'inventory' ? 'out_of_stock' : 'pending');
  const orderStatus = task.order?.status || 'pending';
  const fulfillmentStatus = task.fulfillment?.status || 'pending';
  const deliveryStatus = task.delivery?.status || 'pending';
  return `<section class="panel status-panel"><div class="panel-heading"><div><span class="overline">Commerce status</span><h2>What happened</h2></div>${modeBadge('CORRELATED')}</div><div class="status-grid"><div class="status-card"><span>Stock reservation</span>${statusPill(reservationStatus)}<small>${escapeHtml(task.inventory?.reservation?.reference ? shortId(task.inventory.reservation.reference) : 'No lease')}</small></div><div class="status-card"><span>Payment</span>${statusPill(task.payment?.status || 'pending')}<small>${escapeHtml(task.payment?.reference ? shortId(task.payment.reference) : 'No debit')}</small></div><div class="status-card"><span>Order</span>${statusPill(orderStatus)}<small>${escapeHtml(task.order?.reference ? shortId(task.order.reference) : 'Not created')}</small></div><div class="status-card"><span>Fulfillment</span>${statusPill(fulfillmentStatus)}<small>${escapeHtml(task.fulfillment?.reference ? shortId(task.fulfillment.reference) : 'Not started')}</small></div><div class="status-card"><span>Delivery</span>${statusPill(deliveryStatus)}<small>${escapeHtml(task.delivery?.trackingReference ? shortId(task.delivery.trackingReference) : 'Not started')}</small></div><div class="status-card"><span>Purchase</span>${statusPill(task.purchaseStatus)}<small>${escapeHtml(task.state.replaceAll('_', ' '))}</small></div></div></section>`;
}

function walletPanel(task) {
  const wallet = state.wallet || {};
  const after = task.wallet?.balanceAfterMinor;
  const chain = task.funding;
  return `<section class="panel wallet-panel"><div class="panel-heading"><div><span class="overline">Spendable source</span><h2>Fake wallet balance</h2></div>${modeBadge('XSGD LEDGER')}</div><div class="wallet-balance">${formatMoney(after ?? wallet.balanceMinor, wallet.currency)}<small>current balance</small></div><div class="wallet-meta"><span>${escapeHtml(wallet.name || 'NaviPay Demo Wallet')}</span><span>${escapeHtml(wallet.ownerName || 'Demo Customer')}</span></div><div class="wallet-ledger-fact"><span class="fact-icon">↔</span><span><strong>Double-entry transfer</strong><small>${task.payment?.transactionReference ? escapeHtml(shortId(task.payment.transactionReference)) : 'Debit and merchant credit appear here after a confirmed payment.'}</small></span></div>${chain ? `<div class="chain-fact"><span class="chain-fact-label">Separate chain evidence</span><strong>${formatMoney(chain.amountMinor, chain.asset)}</strong><small>${escapeHtml(chain.network)} · ${escapeHtml(chain.transactionReference)}</small></div>` : ''}<p class="disclosure">Seeded fake wallet only. This balance is the spendable source. Chain evidence above is a separate simulated fact.</p></section>`;
}

function customerPanel(task) {
  const address = task.customer.address;
  return `<section class="panel customer-panel"><div class="panel-heading"><div><span class="overline">Simulated customer</span><h2>${escapeHtml(task.customer.name)}</h2></div><span class="fixture-chip">FIXTURE</span></div><p class="address-label">${escapeHtml(address.label)}</p><address>${address.lines.map((line) => escapeHtml(line)).join('<br>')}</address><p class="muted">${escapeHtml(task.customer.disclosure)}</p></section>`;
}

function receiptPanel(task) {
  if (!task.receipt) return `<section class="panel receipt-panel empty-panel"><span class="overline">Receipt</span><h2>Not issued yet</h2><p class="muted">A confirmed receipt appears only after fake payment and order creation. Fulfillment and delivery are shown separately.</p></section>`;
  const receipt = task.receipt;
  return `<section class="panel receipt-panel"><div class="panel-heading"><div><span class="overline">Receipt</span><h2>Purchase confirmed</h2></div><span class="receipt-stamp">CONFIRMED</span></div><div class="receipt-product"><strong>${escapeHtml(receipt.item)}</strong><span>${escapeHtml(receipt.merchant)} · ${formatMoney(receipt.amountMinor, receipt.currency)}</span><small>${escapeHtml(receipt.variant)}</small></div><dl class="detail-list"><div><dt>Order</dt><dd>${escapeHtml(receipt.orderReference)}</dd></div><div><dt>Payment</dt><dd>${escapeHtml(receipt.paymentReference)}</dd></div><div><dt>Merchant credit</dt><dd>${escapeHtml(receipt.merchantCreditReference)}</dd></div><div><dt>Fulfillment</dt><dd>${statusPill(receipt.fulfillmentStatus)}</dd></div><div><dt>Delivery</dt><dd>${statusPill(receipt.deliveryStatus)}</dd></div></dl><p class="disclosure">${escapeHtml(receipt.disclosure)}</p></section>`;
}

function auditPanel(task) {
  return `<section class="panel audit-panel"><div class="panel-heading"><div><span class="overline">Audit evidence</span><h2>Redacted activity trail</h2></div><span class="event-count">${state.audit.length} events</span></div><p class="muted">Append-only records show each boundary and correlated reference. No credentials or raw provider payloads are sent to this browser.</p><ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event ${stateClass(event.status)}"><span class="audit-dot"></span><span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.type)}${event.reference ? ` · ${escapeHtml(shortId(event.reference))}` : ''}</small></span><time>${formatDate(event.occurredAt)}</time></li>`).join('')}</ol></section>`;
}

function outcome(task) {
  if (task.state === 'completed') {
    const deliveryNote = task.delivery?.status === 'failed' ? ' Delivery failed independently, but confirmed payment and order remain confirmed.' : '';
    return `<div class="outcome-banner success"><div class="outcome-icon">✓</div><div><strong>Purchase and order confirmed</strong><p>${escapeHtml(task.quote?.item || 'Item')} is confirmed in the simulated merchant sandbox.${escapeHtml(deliveryNote)}</p></div></div>`;
  }
  if (task.state === 'reconciliation_required') return `<div class="outcome-banner warning"><div class="outcome-icon">?</div><div><strong>Payment needs reconciliation</strong><p>The fake wallet returned an unknown result. No retry or duplicate debit is allowed. Use the API reconciliation contract to resolve it.</p></div></div>`;
  if (task.state === 'failed') return `<div class="outcome-banner danger"><div class="outcome-icon">!</div><div><strong>Run stopped safely</strong><p>${escapeHtml(task.failure?.message || 'No side effect was completed.')}</p>${task.compensation ? `<small>Compensation: ${escapeHtml(task.compensation.status)}</small>` : ''}</div></div>`;
  return '';
}

function historyPanel() {
  if (!state.tasks.length) return '';
  return `<section class="history"><div class="section-heading"><div><span class="overline">Local history</span><h2>Previous purchase runs</h2></div><span class="event-count">${state.tasks.length} saved</span></div><div class="history-grid">${state.tasks.map((task) => `<button type="button" class="history-item${task.id === state.task?.id ? ' current' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.request.raw)}</strong><small>${escapeHtml(task.quote?.item || 'No recommendation yet')}</small></span><span>${statusPill(task.state)}<small>${formatDate(task.updatedAt)}</small></span></button>`).join('')}</div></section>`;
}

function emptyState() {
  return `<section class="empty-start"><div class="empty-orbit"><span>⌁</span></div><span class="overline">Ready for a local run</span><h2>What would you like to buy?</h2><p>Type a plain request and NaviPay will interpret it, find a stocked local item, reserve it, pay from the seeded fake wallet, create the order, and simulate delivery.</p><div class="example-row"><span>I want a keyboard</span><span>I want a mouse</span><span>I want earphones</span></div></section>`;
}

function workspace() {
  return `<section class="request-card"><div><span class="overline">New purchase</span><h1>Buy something with NaviPay</h1><p>One normal run. No stage buttons. The sandbox handles discovery, stock, payment, order, fulfillment, delivery, receipt, and audit automatically.</p></div><form id="request-form" novalidate><label for="request-input">Your request</label><div class="request-row"><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="I want a keyboard" required><button type="submit" class="run-button"${state.busy ? ' disabled' : ''}>${state.busy ? 'Running…' : 'Run purchase'}</button></div><small>Try “I want a mouse” or “I want earphones”. Products, payment, customer, and delivery are simulated.</small><p class="form-error" id="request-error" role="alert" hidden></p></form></section>`;
}

function render() {
  const task = state.task;
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  if (!task) {
    app.innerHTML = `${workspace()}${emptyState()}${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error.message)}</div>` : ''}`;
    bindEvents();
    return;
  }
  app.innerHTML = `${workspace()}${state.error ? `<div class="error-banner" role="alert"><strong>${escapeHtml(state.error.code || 'Run stopped')}</strong><span>${escapeHtml(state.error.message)}</span></div>` : ''}${outcome(task)}<div class="run-heading"><div><span class="overline">Current run</span><h2>${escapeHtml(task.request.raw)}</h2></div>${modeBadge('ALL LOCAL FIXTURES')}</div><div class="dashboard"><div class="dashboard-main">${intentPanel(task)}${recommendationPanel(task)}${progressPanel(task)}${statusPanel(task)}${receiptPanel(task)}</div><aside class="dashboard-side">${walletPanel(task)}${customerPanel(task)}</aside></div>${auditPanel(task)}${historyPanel()}<p class="footer-note">NaviPay is a local-only product sandbox. Replaceable adapter boundaries are kept on the server; this browser receives normalized status and redacted evidence only.</p>`;
  bindEvents();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'The sandbox could not complete that request.');
    error.code = payload.error?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function refresh() {
  const payload = await api('/api/tasks');
  state.tasks = payload.tasks || [];
  state.wallet = payload.wallet || null;
  if (state.task) {
    const current = state.tasks.find((task) => task.id === state.task.id);
    if (current) state.task = current;
  }
  if (state.task) {
    const audit = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/audit`);
    state.audit = audit.events || [];
  }
}

function runKey() {
  return `browser-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function runPurchase(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const request = form.elements.request.value.trim();
  const errorNode = document.querySelector('#request-error');
  if (!request) {
    errorNode.textContent = 'Enter a plain-language request first.';
    errorNode.hidden = false;
    return;
  }
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': runKey() }, body: JSON.stringify({ request }) });
    state.task = payload.task;
    await refresh();
    form.reset();
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      await refresh().catch(() => {});
    }
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('#page-title')?.focus?.({ preventScroll: true });
  }
}

async function selectTask(taskId) {
  if (state.busy || taskId === state.task?.id) return;
  state.busy = true;
  state.error = null;
  try {
    state.task = (await api(`/api/tasks/${encodeURIComponent(taskId)}`)).task;
    const audit = await api(`/api/tasks/${encodeURIComponent(taskId)}/audit`);
    state.audit = audit.events || [];
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
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
}

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.tasks = payload.tasks || [];
    state.wallet = payload.wallet || null;
    state.task = state.tasks[0] || null;
    if (state.task) {
      const audit = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/audit`);
      state.audit = audit.events || [];
    }
    render();
  } catch (error) {
    app.innerHTML = `<div class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><span>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</span></div>`;
  }
}

boot();
