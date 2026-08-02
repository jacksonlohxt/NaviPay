const STAGES = ['Entry', 'Funding', 'Discovery', 'Issuance', 'Execution', 'Outcome'];
const state = { task: null, audit: [], busy: false, error: null, selectedCandidate: null };
const app = document.querySelector('#app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(minor, currency = 'XSGD') {
  if (minor === null || minor === undefined) return '-';
  return `${currency} ${(minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function shortId(value) {
  if (!value) return '-';
  return value.length > 22 ? `${value.slice(0, 11)}…${value.slice(-7)}` : value;
}

function modeBadge(extra = '') {
  return `<span class="mode-badge mode-badge-light"><span class="mode-dot"></span> MOCK / SIMULATED${extra ? ` · ${escapeHtml(extra)}` : ''}</span>`;
}

function statePill(value) {
  const classes = value === 'completed' ? '' : (value === 'failed' ? ' error' : (value === 'reconciliation_required' ? ' warning' : ' neutral'));
  return `<span class="state-pill${classes}">${escapeHtml(value.replaceAll('_', ' '))}</span>`;
}

function dataCell(label, value, wrap = false) {
  return `<div class="data-cell"><div class="data-label">${escapeHtml(label)}</div><div class="data-value${wrap ? ' wrap' : ''}">${escapeHtml(value)}</div></div>`;
}

function actionButton(label, action, className = 'button-primary', disabled = false) {
  return `<button type="button" class="button ${className}" data-action="${escapeHtml(action)}"${disabled || state.busy ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
}

function currentStage(task) {
  if (task.state === 'completed' || task.state === 'failed' || task.state === 'reconciliation_required') return 5;
  if (task.state === 'instrument_issued' || task.state === 'executing' || task.state === 'authorized') return 4;
  if (task.state === 'policy_approved' || task.state === 'issuing') return 3;
  if (task.state === 'funded' || task.state === 'discovering' || task.state === 'quoted') return 2;
  if (task.entryOpened) return 1;
  return 0;
}

function stageRail(task) {
  const active = currentStage(task);
  return `<nav class="stage-rail" aria-label="Purchase lifecycle stages">${STAGES.map((label, index) => {
    const complete = index < active;
    const current = index === active;
    return `<div class="stage-item${complete ? ' is-complete' : ''}"${current ? ' aria-current="step"' : ''}>
      <span class="stage-number">${complete ? '✓' : String(index + 1).padStart(2, '0')}</span><span class="stage-label">${label}</span>
    </div>`;
  }).join('')}</nav>`;
}

function hero(task) {
  const active = currentStage(task);
  const titles = [
    ['Assigned purchase, bounded from the start', 'Review the single task authority before any provider action.'],
    ['Prove the funding, then separate the settlement truth', 'The chain observation is evidence. It is not silently treated as card spendable balance.'],
    ['Find one item. Lock one exact quote.', 'Discovery is simulated, deterministic, and expires. Nothing broad can be issued before the lock.'],
    ['Issue authority for this purchase only', 'The server policy receipt is the gate. The instrument cannot be reused or widened.'],
    ['Execute once, with a scrubbed activity trail', 'The mock merchant receives only the locked scope. Unknown results stop for reconciliation.'],
    ['Show what financially happened', 'Authorization, capture, retirement, and redacted audit evidence stay distinct.']
  ];
  return `<section class="hero"><div><p class="eyebrow">Operator console / stage ${String(active + 1).padStart(2, '0')} of 06</p><h1>${titles[active][0]}</h1><p class="lede">${titles[active][1]}</p></div><div class="hero-meta"><div class="hero-meta-label">Immutable task ceiling</div><div class="hero-meta-value">${formatMoney(task.spendingCeilingMinor, task.currency)}</div><div class="hero-meta-detail">One merchant · one capture · expires with the quote</div></div></section>`;
}

function notice() {
  return `<section class="notice" role="note"><span class="notice-icon" aria-hidden="true">i</span><div><strong>Honest demo mode</strong><p>On-chain evidence, issuer, and merchant checkout are deterministic local fixtures. No provider credentials are required. Every consequential card repeats the simulated label.</p></div></section>`;
}

function taskBrief(task) {
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">01 / Entry</div><h2>Assigned purchase brief</h2><p>A single task, with no wallet or reusable card surface.</p></div>${modeBadge('entry')}</div>
    <div class="brief-grid">${dataCell('Task reference', shortId(task.id))}${dataCell('Agent authority', 'Assigned purchase only')}${dataCell('Requested item', 'Anker 737 Power Bank')}${dataCell('Currency', task.currency)}${dataCell('Spending ceiling', formatMoney(task.spendingCeilingMinor, task.currency))}${dataCell('Task state', task.state.replaceAll('_', ' '))}</div>
    <div class="locked-callout"><strong>What will happen</strong><p>Verify the fixture evidence, choose one quote, pass server policy, issue one scoped instrument, then execute one mock checkout.</p></div>
    <div class="action-row">${actionButton('Open assigned task', 'open-task', 'button-lime')}<p class="action-help">Opening records an audit event. It does not authorize a payment.</p></div>
  </article>`;
}

function fundingPanel(task) {
  if (!task.funding) {
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">02 / Funding</div><h2>Verify funding evidence</h2><p>Read-only chain evidence and card settlement status are intentionally separate.</p></div>${modeBadge('funding')}</div>
      <div class="money-truths"><div class="truth-card on-chain"><h3>On-chain evidence</h3><div class="big">Awaiting verification</div><p>Network, token, recipient, amount, and receipt will be checked.</p><span class="truth-status">Not checked</span></div><div class="truth-card settlement"><h3>Card-spendable settlement</h3><div class="big">Not asserted</div><p>This status comes from the mock issuer ledger, not from the chain observation.</p><span class="truth-status">Separate truth</span></div></div>
      <div class="action-row">${actionButton('Verify fixture funding', 'verify-funding', 'button-lime')}<p class="action-help">This is a simulated verifier call.</p></div>
    </article>`;
  }
  const funding = task.funding;
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">02 / Funding</div><h2>Funding evidence recorded</h2><p>The two money truths are visible without collapsing them.</p></div>${modeBadge('funding')}</div>
    <div class="money-truths"><div class="truth-card on-chain"><h3>On-chain evidence</h3><div class="big">${escapeHtml(funding.onChain.asset)} ${((funding.onChain.amountMinor || 0) / 100).toLocaleString('en-SG', { minimumFractionDigits: 2 })}</div><p>${escapeHtml(funding.onChain.network)} · ${escapeHtml(funding.onChain.confirmations)} confirmations</p><span class="truth-status">✓ Verified fixture</span></div><div class="truth-card settlement"><h3>Card-spendable settlement</h3><div class="big">${escapeHtml(funding.settlement.status.replaceAll('-', ' '))}</div><p>${escapeHtml(funding.settlement.note)}</p><span class="truth-status">${funding.settlement.spendable ? '✓ Mock only' : 'Not spendable'}</span></div></div>
    <dl class="detail-list"><div class="detail-row"><dt>Transaction reference</dt><dd class="wrap">${escapeHtml(funding.onChain.transactionReference)}</dd></div><div class="detail-row"><dt>Observed</dt><dd>${formatDate(funding.onChain.observedAt)}</dd></div><div class="detail-row"><dt>Recipient</dt><dd>${escapeHtml(funding.onChain.recipient)}</dd></div></dl>
    <div class="action-row">${actionButton('Continue to discovery', 'go-discovery', 'button-lime')}<p class="action-help">Evidence is recorded; discovery remains a separate adapter call.</p></div>
  </article>`;
}

function quoteCard(task) {
  const quote = task.quote;
  if (!quote) {
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Discover the assigned item</h2><p>Return a small, normalized candidate set. No broad shopping authority is created.</p></div>${modeBadge('discovery')}</div><div class="locked-callout"><strong>Discovery is constrained</strong><p>The mock catalog will return one recommended item and one alternate from a single merchant. The quote will expire in 15 minutes.</p></div><div class="action-row">${actionButton('Discover item and quote', 'discover', 'button-lime')}<p class="action-help">Deterministic local catalog fixture.</p></div></article>`;
  }
  if (!quote.locked) {
    const selected = state.selectedCandidate || quote.recommendedCandidateId;
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Choose the exact purchase</h2><p>Select a candidate. Merchant, item, total, currency, and expiry lock together.</p></div>${modeBadge('quote')}</div><div class="candidate-list" role="radiogroup" aria-label="Quote candidates">${quote.candidates.map((candidate) => `<label class="candidate${selected === candidate.id ? ' selected' : ''}"><input type="radio" name="candidate" value="${escapeHtml(candidate.id)}" data-candidate="${escapeHtml(candidate.id)}"${selected === candidate.id ? ' checked' : ''}><span><h3>${escapeHtml(candidate.item)}</h3><p>${escapeHtml(candidate.variant)} · ${escapeHtml(candidate.merchant)} · expires ${formatDate(candidate.expiresAt)}</p><p class="candidate-reason">${escapeHtml(candidate.selectionReason)}</p></span><span class="candidate-total">${formatMoney(candidate.totalMinor, candidate.currency)}</span></label>`).join('')}</div><div class="action-row">${actionButton('Lock selected quote', 'lock-quote', 'button-lime')}<p class="action-help">Locking is immutable for this task.</p></div></article>`;
  }
  const locked = quote.lockedSnapshot;
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Quote locked for policy review</h2><p>This is the only purchase scope the server can approve.</p></div>${modeBadge('locked')}</div><div class="locked-callout"><strong>${escapeHtml(locked.item)} · ${formatMoney(locked.totalMinor, locked.currency)}</strong><p>${escapeHtml(locked.merchant)} · ${escapeHtml(locked.variant)} · expires ${formatDate(locked.expiresAt)}</p></div><dl class="detail-list"><div class="detail-row"><dt>Merchant</dt><dd>${escapeHtml(locked.merchantDomain)}</dd></div><div class="detail-row"><dt>Quote reference</dt><dd>${escapeHtml(locked.quoteId)}</dd></div><div class="detail-row"><dt>Locked at</dt><dd>${formatDate(quote.lockedAt)}</dd></div><div class="detail-row"><dt>Expiry</dt><dd>${formatDate(locked.expiresAt)}</dd></div></dl><div class="action-row">${actionButton('Run server policy approval', 'approve-policy', 'button-lime')}<p class="action-help">The hard ceiling is checked before any instrument exists.</p></div></article>`;
}

function policyChecks(policy) {
  if (!policy) return '';
  return `<div class="check-list" aria-label="Policy checks">${policy.checks.map((check) => `<div class="check${check.status === 'failed' ? ' failed' : ''}"><span class="check-icon">${check.status === 'passed' ? '✓' : '!'}</span><span><strong>${escapeHtml(check.label)}</strong></span><span class="check-detail">${escapeHtml(check.detail)}</span></div>`).join('')}</div>`;
}

function issuancePanel(task) {
  const scope = task.quote.lockedSnapshot;
  if (!task.instrument) {
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">04 / Issuance</div><h2>Policy passed. Issue narrow authority.</h2><p>The issuer receives a frozen scope, not a reusable payment credential.</p></div>${modeBadge('issuance')}</div>${policyChecks(task.policy)}<div class="scope-card"><div class="scope-heading"><strong>Proposed one-use scope</strong><span class="scope-lock">LOCKED</span></div><dl class="detail-list"><div class="detail-row"><dt>Merchant</dt><dd>${escapeHtml(scope.merchantDomain)}</dd></div><div class="detail-row"><dt>Item</dt><dd>${escapeHtml(scope.item)} / ${escapeHtml(scope.variant)}</dd></div><div class="detail-row"><dt>Exact amount</dt><dd>${formatMoney(scope.totalMinor, scope.currency)}</dd></div><div class="detail-row"><dt>Capture limit</dt><dd>1 successful capture</dd></div><div class="detail-row"><dt>Credentials</dt><dd>Provider-controlled and redacted</dd></div></dl></div><div class="action-row">${actionButton('Issue mock scoped instrument', 'issue-instrument', 'button-lime')}<p class="action-help">No sensitive payment material enters this console.</p></div></article>`;
  }
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">04 / Issuance</div><h2>Scoped instrument is ready</h2><p>One task, one merchant, one amount, one successful capture.</p></div>${modeBadge('issued')}</div><div class="scope-card"><div class="scope-heading"><strong>${escapeHtml(task.instrument.reference)}</strong><span class="scope-lock">ACTIVE · ONE USE</span></div><dl class="detail-list"><div class="detail-row"><dt>Merchant</dt><dd>${escapeHtml(task.instrument.scope.merchantDomain)}</dd></div><div class="detail-row"><dt>Exact amount</dt><dd>${formatMoney(task.instrument.scope.amountMinor, task.instrument.scope.currency)}</dd></div><div class="detail-row"><dt>Expires</dt><dd>${formatDate(task.instrument.scope.expiresAt)}</dd></div><div class="detail-row"><dt>Reuse</dt><dd>Blocked</dd></div></dl></div><div class="action-row">${actionButton('Continue to execution', 'go-execution', 'button-lime')}<p class="action-help">The next action is one checkout attempt.</p></div></article>`;
}

function executionPanel(task) {
  const scope = task.instrument.scope;
  if (!task.checkout) {
    return `<article class="card execution-card"><div class="execution-head"><div class="panel-label" style="color:#b8f36b">05 / Execution · simulated</div><h2>One compact checkout run</h2><p>Only scrubbed verbs, merchant domain, and exact amount are shown. No browser secrets are exposed.</p></div><div class="card-pad"><div class="brief-grid">${dataCell('Merchant', scope.merchantDomain)}${dataCell('Amount', formatMoney(scope.amountMinor, scope.currency))}${dataCell('Item', scope.item)}${dataCell('Authority', 'One capture, then retire')}</div><div class="activity-list"><div class="activity"><span class="activity-dot"></span><span>Scope checked against locked quote</span><time>ready</time></div><div class="activity"><span class="activity-dot"></span><span>Mock merchant checkout awaits operator action</span><time>ready</time></div></div><div class="action-row">${actionButton('Authorize payment once', 'execute-checkout', 'button-coral')}<p class="action-help">Unknown results stop here for reconciliation - never blind retry.</p></div></div></article>`;
  }
  return `<article class="card execution-card"><div class="execution-head"><div class="panel-label" style="color:#b8f36b">05 / Execution · recorded</div><h2>Checkout attempt recorded</h2><p>${escapeHtml(task.checkout.status === 'unknown' ? 'No definitive result. Reconciliation is required before any further action.' : 'The merchant response is recorded and the next lifecycle screen has the result.')}</p></div><div class="activity-list"><div class="activity"><span class="activity-dot"></span><span>Scope checked against locked quote</span><time>passed</time></div><div class="activity"><span class="activity-dot"></span><span>Merchant domain: ${escapeHtml(task.checkout.merchantDomain)}</span><time>${formatMoney(task.checkout.amountMinor, task.checkout.currency)}</time></div><div class="activity"><span class="activity-dot"></span><span>Provider response: ${escapeHtml(task.checkout.status)}</span><time>${formatDate(task.checkout.attemptedAt)}</time></div></div></article>`;
}

function outcomePanel(task) {
  const unknown = task.state === 'reconciliation_required';
  const success = task.state === 'completed';
  const outcome = task.outcome || {};
  const title = success ? 'Purchase confirmed' : (unknown ? 'Checkout needs reconciliation' : 'Task stopped safely');
  const message = success
    ? 'The mock authorization was captured, and the one-use instrument was retired.'
    : unknown
      ? 'The provider result is unknown. NaviPay has blocked automatic replay. Confirm the provider result before resolving.'
      : (task.failure?.message || 'The lifecycle ended without an authorization.');
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">06 / Outcome + audit</div><h2>Financial truth, not a green guess</h2><p>Authorization, capture, retirement, and reconciliation remain explicit.</p></div>${modeBadge('outcome')}</div><div class="outcome-banner${success ? '' : (unknown ? ' warning' : ' error')}" role="status"><h2>${title}</h2><p>${escapeHtml(message)}</p></div><div class="outcome-meta">${dataCell('Lifecycle state', task.state.replaceAll('_', ' '))}${dataCell('Outcome', outcome.label || task.failure?.code || 'No authorization')}${dataCell('Checkout reference', shortId(task.checkout?.checkoutReference))}${dataCell('Authority status', task.instrument?.status || 'Not issued')}</div>${unknown ? `<div class="action-row"><button type="button" class="button button-lime" data-action="reconcile-authorized"${state.busy ? ' disabled' : ''}>Reconcile as authorized</button><button type="button" class="button button-secondary" data-action="reconcile-declined"${state.busy ? ' disabled' : ''}>Reconcile as declined</button><p class="action-help">Resolution records a new event. It never retries checkout.</p></div>` : ''}${task.policy ? `<div><div class="panel-label" style="margin-top:1.25rem">Policy receipt</div>${policyChecks(task.policy)}</div>` : ''}<div class="audit"><div class="audit-header"><div><div class="panel-label">Append-only audit timeline</div><h3>Redacted evidence trail</h3></div><p>${state.audit.length} events · no sensitive payment material</p></div><ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event event-${escapeHtml(event.status)}"><span class="event-dot"></span><span><div class="audit-summary">${escapeHtml(event.summary)}</div><div class="audit-type">${escapeHtml(event.type)}</div></span><time class="audit-time">${formatDate(event.occurredAt)}</time></li>`).join('')}</ol></div></article>`;
}

function guardrails(task) {
  const lockedTotal = task.quote?.lockedSnapshot?.totalMinor || 0;
  const ceiling = task.spendingCeilingMinor;
  const percentage = Math.min(100, Math.round((lockedTotal / ceiling) * 100));
  return `<aside class="guardrail-stack"><article class="card guardrail-card"><div class="panel-label">Server guardrails</div><h2>Bounded by design</h2><ul class="guardrail-list"><li><span>Immutable ${formatMoney(ceiling, task.currency)} ceiling</span></li><li><span>Exact merchant and quote scope</span></li><li><span>One successful capture maximum</span></li><li><span>Unknown results require reconciliation</span></li><li><span>Audit entries are redacted and append-only</span></li></ul><div class="ceiling-meter"><div class="ceiling-meter-head"><span>Locked quote / ceiling</span><strong>${formatMoney(lockedTotal, task.currency)} / ${formatMoney(ceiling, task.currency)}</strong></div><div class="meter-track"><div class="meter-fill${lockedTotal > ceiling ? ' over' : ''}" style="width:${Math.max(lockedTotal ? 3 : 0, percentage)}%"></div></div></div></article><article class="card guardrail-card"><div class="panel-label">Mode disclosure</div><h2>What is simulated</h2><ul class="guardrail-list"><li><span>Funding verifier: Avalanche fixture</span></li><li><span>Discovery: local catalog fixture</span></li><li><span>Issuer: mock scoped instrument</span></li><li><span>Checkout: mock merchant</span></li></ul></article><article class="card guardrail-card scenario-card"><div class="panel-label">Judge scenarios</div><h2>Replay a known path</h2><p>New runs are isolated. The default happy path needs no credentials; failure fixtures prove stop conditions.</p><select class="scenario-select" id="scenario-select" aria-label="New demo scenario"><option value="happy">Happy path</option><option value="over-cap">Over-cap policy failure</option><option value="unknown-checkout">Unknown checkout / reconcile</option><option value="checkout-failure">Merchant decline</option><option value="issuer-failure">Issuer failure</option></select><div class="action-row">${actionButton('Start selected scenario', 'new-run', 'button-secondary')}</div></article></aside>`;
}

function stagePanel(task) {
  const stage = currentStage(task);
  if (stage === 0) return taskBrief(task);
  if (stage === 1) return fundingPanel(task);
  if (stage === 2) return quoteCard(task);
  if (stage === 3) return issuancePanel(task);
  if (stage === 4) return executionPanel(task);
  return outcomePanel(task);
}

function render() {
  if (!state.task) return;
  const task = state.task;
  app.innerHTML = `${hero(task)}${notice()}${state.error ? `<div class="error-banner" role="alert"><strong>${escapeHtml(state.error.code || 'Action unavailable')}</strong><p>${escapeHtml(state.error.message)}</p></div>` : ''}${stageRail(task)}<div class="console-grid"><div>${stagePanel(task)}<p class="footer-note">NaviPay demo mode · local-only fixture · credentials and sensitive payment data stay outside the operator console.</p></div>${guardrails(task)}</div>`;
  bindEvents();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'The request could not be completed.');
    error.code = payload.error?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function refreshAudit() {
  const payload = await api(`/api/tasks/${encodeURIComponent(state.task.id)}/audit`);
  state.audit = payload.events || [];
}

async function perform(action, path, body = {}) {
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': `console-${state.task.id}-${action}` },
      body: JSON.stringify(body)
    });
    if (payload.task) state.task = payload.task;
    await refreshAudit();
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      await refreshAudit().catch(() => {});
    }
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    document.querySelector('h1')?.focus?.();
  }
}

async function startNewRun(scenario) {
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ scenario }) });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshAudit();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
  }
}

function bindEvents() {
  document.querySelectorAll('[data-candidate]').forEach((radio) => radio.addEventListener('change', (event) => {
    state.selectedCandidate = event.target.value;
    render();
  }));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    const id = state.task.id;
    if (action === 'open-task') return perform(action, `/api/tasks/${id}/open`);
    if (action === 'verify-funding') return perform(action, `/api/tasks/${id}/funding/verify`);
    if (action === 'go-discovery') return perform(action, `/api/tasks/${id}/discovery`);
    if (action === 'discover') return perform(action, `/api/tasks/${id}/discovery`);
    if (action === 'lock-quote') return perform(action, `/api/tasks/${id}/quote/lock`, { candidateId: state.selectedCandidate || state.task.quote.recommendedCandidateId });
    if (action === 'approve-policy') return perform(action, `/api/tasks/${id}/policy/approve`);
    if (action === 'issue-instrument') return perform(action, `/api/tasks/${id}/instrument/issue`);
    if (action === 'go-execution') return perform(action, `/api/tasks/${id}/instrument/issue`);
    if (action === 'execute-checkout') return perform(action, `/api/tasks/${id}/checkout/execute`);
    if (action === 'reconcile-authorized') return perform(action, `/api/tasks/${id}/checkout/reconcile`, { resolution: 'authorized' });
    if (action === 'reconcile-declined') return perform(action, `/api/tasks/${id}/checkout/reconcile`, { resolution: 'declined' });
    if (action === 'new-run') return startNewRun(document.querySelector('#scenario-select')?.value || 'happy');
  }));
  document.querySelector('#new-run')?.addEventListener('click', () => startNewRun(document.querySelector('#scenario-select')?.value || 'happy'));
}

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.task = payload.tasks?.[0];
    if (!state.task) {
      const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ scenario: 'happy' }) });
      state.task = created.task;
    }
    await refreshAudit();
    render();
  } catch (error) {
    app.innerHTML = `<section class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><p>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</p></section>`;
  }
}

boot();
