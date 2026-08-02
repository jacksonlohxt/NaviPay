const STAGES = ['Entry', 'Funding', 'Discovery', 'Issuance', 'Execution', 'Outcome'];
const SCENARIOS = [
  ['happy', 'Happy path'],
  ['over-cap', 'Over-cap policy failure'],
  ['unknown-checkout', 'Unknown checkout / reconcile'],
  ['checkout-failure', 'Merchant decline'],
  ['issuer-failure', 'Issuer failure'],
  ['funding-failure', 'Funding verifier failure'],
  ['discovery-failure', 'Discovery failure']
];
const TASK_CEILING_MINOR = 100000;
const state = { task: null, tasks: [], audit: [], busy: false, error: null, selectedCandidate: null };
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
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortId(value) {
  if (!value) return '-';
  return value.length > 22 ? `${value.slice(0, 11)}…${value.slice(-7)}` : value;
}

function modeBadge(extra = '') {
  return `<span class="mode-badge mode-badge-light"><span class="mode-dot"></span> DEMO / MOCK${extra ? ` · ${escapeHtml(extra)}` : ''}</span>`;
}

function scenarioLabel(scenario) {
  return SCENARIOS.find(([value]) => value === scenario)?.[1] || 'Unknown scenario';
}

function scenarioOptions(selected) {
  return SCENARIOS.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function purchaseFor(task) {
  if (task.purchase) return task.purchase;
  return {
    merchant: task.quote?.lockedSnapshot?.merchant || 'Discovery pending',
    item: task.quote?.lockedSnapshot?.item || task.request?.raw || 'Item request not set',
    amountMinor: task.quote?.lockedSnapshot?.totalMinor ?? null,
    currency: task.currency
  };
}

function requestIntentSummary(task) {
  const intent = task.request?.intent;
  if (!intent) return '';
  const fields = [intent.brand, intent.productCategory, intent.keywords?.length ? `keywords: ${intent.keywords.join(', ')}` : ''].filter(Boolean);
  return fields.join(' · ');
}

function taskOutcomeLabel(task) {
  if (task.outcome?.label) return task.outcome.label;
  if (task.failure?.message) return task.failure.message;
  if (task.state === 'created') return 'Ready to open';
  if (task.state === 'reconciliation_required') return 'Reconciliation required';
  return task.state.replaceAll('_', ' ');
}

function parseAmountMinor(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const minor = Math.round(Number(value.trim()) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
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

function failedStage(task) {
  if (task.state !== 'failed') return null;
  return { funding: 1, discovery: 2, policy: 3, issuance: 3, checkout: 4 }[task.failure?.stage] ?? 5;
}

function stageRail(task) {
  const active = currentStage(task);
  const failed = failedStage(task);
  return `<nav class="stage-rail" aria-label="Purchase lifecycle stages">${STAGES.map((label, index) => {
    const complete = failed === null ? index < active : index < failed;
    const current = index === active;
    const isFailed = index === failed;
    const pending = failed !== null && index > failed && index < active;
    const classes = [complete ? 'is-complete' : '', isFailed ? 'is-failed' : '', pending ? 'is-pending' : ''].filter(Boolean).join(' ');
    return `<div class="stage-item ${classes}"${current ? ' aria-current="step"' : ''}>
      <span class="stage-number">${complete ? '✓' : (isFailed ? '!' : String(index + 1).padStart(2, '0'))}</span><span class="stage-label">${label}</span>
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
  return `<section class="hero" aria-labelledby="page-title"><div><p class="eyebrow">Operator console / stage ${String(active + 1).padStart(2, '0')} of 06</p><h1 id="page-title" tabindex="-1">${titles[active][0]}</h1><p class="lede">${titles[active][1]}</p></div><div class="hero-meta"><div class="hero-meta-label">Immutable task ceiling</div><div class="hero-meta-value">${formatMoney(task.spendingCeilingMinor, task.currency)}</div><div class="hero-meta-detail">${escapeHtml(scenarioLabel(task.scenario))} · one merchant · one capture</div></div></section>`;
}

function notice() {
  return `<section class="notice" role="note"><span class="notice-icon" aria-hidden="true">i</span><div><strong>Honest demo mode</strong><p>Discovery catalog, on-chain evidence, issuer, and merchant checkout are deterministic local fixtures. No LLM, live web search, or provider credentials are used. Every consequential card repeats the DEMO / MOCK label.</p></div></section>`;
}

function workspace(task) {
  const purchase = purchaseFor(task);
  const terminal = ['completed', 'failed'].includes(task.state);
  const unknown = task.state === 'reconciliation_required' || task.outcome?.status === 'unknown';
  const taskItems = state.tasks.length ? state.tasks : [task];
  const currentDescription = task.request
    ? `Request: ${task.request.raw}`
    : `${purchase.item} · ${formatMoney(purchase.amountMinor, purchase.currency || task.currency)}`;
  return `<section class="workspace card" aria-labelledby="workspace-title">
    <div class="workspace-create">
      <div class="workspace-heading"><div class="panel-label">Operator workspace</div><h2 id="workspace-title">One bounded purchase</h2><p>Enter a request such as <strong>I want Apple earphones</strong>. NaviPay interprets it, ranks local candidates, auto-selects a clear in-budget match, and runs the safeguarded purchase end to end. Manual choice is only needed when the request or provider result is genuinely unclear.</p></div>
      <form id="request-form" class="request-form" novalidate>
        <div class="form-field"><label for="request-input">Purchase request</label><input id="request-input" name="request" type="text" maxlength="240" autocomplete="off" placeholder="I want Apple earphones" aria-describedby="request-hint" required><p class="field-hint" id="request-hint">Deterministic parsing only: brand, product category, and keywords. No LLM or live web search.</p></div>
        <div class="form-actions"><button class="button button-lime" type="submit"${state.busy ? ' disabled' : ''}>Create request task</button><p class="form-error" id="request-form-error" role="alert" hidden></p></div>
      </form>
      <details class="direct-entry"><summary>Use the direct merchant, item, and amount path</summary><p>Direct task creation remains available when an exact merchant and XSGD total are already known.</p>
        <form id="task-form" class="task-form" novalidate>
          <div class="form-field"><label for="merchant-input">Merchant</label><input id="merchant-input" name="merchant" type="text" maxlength="120" autocomplete="organization" placeholder="e.g. Harbor Supply" required></div>
          <div class="form-field"><label for="item-input">Item</label><input id="item-input" name="item" type="text" maxlength="180" autocomplete="off" placeholder="e.g. Anker 737 Power Bank" required></div>
          <div class="form-field amount-field"><label for="amount-input">Amount <span>(XSGD)</span></label><input id="amount-input" name="amount" type="text" inputmode="decimal" pattern="\\d+(?:\\.\\d{1,2})?" maxlength="12" placeholder="89.50" aria-describedby="amount-hint" required><p class="field-hint" id="amount-hint">Up to ${formatMoney(TASK_CEILING_MINOR, 'XSGD')}.</p></div>
          <div class="form-actions"><button class="button button-secondary" type="submit"${state.busy ? ' disabled' : ''}>Create direct task</button><p class="form-error" id="task-form-error" role="alert" hidden></p></div>
        </form>
      </details>
    </div>
    <div class="workspace-current" aria-label="Current task context"><div class="panel-label">Current task</div><div class="current-task-title"><strong>${escapeHtml(task.request ? 'Natural request' : purchase.merchant)}</strong><span>${statePill(task.state)}</span></div><p>${escapeHtml(currentDescription)}</p>${task.request ? `<p class="intent-summary">Parsed intent: ${escapeHtml(requestIntentSummary(task))}</p>` : ''}<div class="current-task-meta"><span>${escapeHtml(shortId(task.id))}</span><span>${formatDate(task.updatedAt)}</span></div>${task.automation?.status ? `<p class="run-status">Run: ${escapeHtml(task.automation.status.replaceAll('_', ' '))}${task.automation.nextAction && task.automation.nextAction !== 'none' ? ` · ${escapeHtml(task.automation.nextAction)}` : ''}</p>` : ''}${terminal && !unknown ? '<button type="button" class="button button-secondary button-small" data-action="replay-task">Safely replay as new task</button>' : ''}${unknown ? '<p class="safe-replay-note">Replay blocked until this unknown checkout is reconciled. The original checkout will never be repeated automatically.</p>' : ''}</div>
    <div class="workspace-history"><div class="history-heading"><div><div class="panel-label">Task history</div><h3>Persisted runs</h3></div><span class="history-count">${taskItems.length} task${taskItems.length === 1 ? '' : 's'}</span></div><p class="history-intro">Select any task to inspect its current lifecycle and redacted audit evidence. Completed outcomes stay here after reload.</p><ol class="task-list">${taskItems.map((item) => { const itemPurchase = purchaseFor(item); const itemTitle = item.request ? 'Natural request' : itemPurchase.merchant; const itemLabel = item.request ? item.request.raw : itemPurchase.item; return `<li><button type="button" class="task-list-item${item.id === task.id ? ' is-current' : ''}" data-task-id="${escapeHtml(item.id)}"${item.id === task.id ? ' aria-current="page"' : ''}><span class="task-list-main"><strong>${escapeHtml(itemTitle)}</strong><span>${escapeHtml(itemLabel)}</span></span><span class="task-list-side"><span>${formatMoney(itemPurchase.amountMinor, itemPurchase.currency || item.currency)}</span>${statePill(item.state)}<small>${escapeHtml(taskOutcomeLabel(item))}</small></span></button></li>`; }).join('')}</ol></div>
  </section>`;
}

function taskBrief(task) {
  const purchase = purchaseFor(task);
  const isRequest = Boolean(task.request);
  const heading = isRequest ? 'Natural purchase request' : (task.origin === 'seed' ? 'Seeded purchase brief' : (task.origin === 'replay' ? 'Safely replayed purchase brief' : 'Assigned purchase brief'));
  const details = isRequest
    ? `${dataCell('Task reference', shortId(task.id))}${dataCell('Run type', 'Operator natural request')}${dataCell('Parsed brand', task.request.intent.brand || 'Not detected')}${dataCell('Product category', task.request.intent.productCategory || 'Not detected')}${dataCell('Keywords', task.request.intent.keywords.join(', '), true)}${dataCell('Spending ceiling', formatMoney(task.spendingCeilingMinor, task.currency))}`
    : `${dataCell('Task reference', shortId(task.id))}${dataCell('Run type', task.origin === 'seed' ? 'Seeded local run' : (task.origin === 'replay' ? 'New task from prior result' : 'Operator-created run'))}${dataCell('Agent authority', 'Assigned purchase only')}${dataCell('Demo scenario', scenarioLabel(task.scenario))}${dataCell('Requested merchant', purchase.merchant)}${dataCell('Requested item', purchase.item)}${dataCell('Requested amount', formatMoney(purchase.amountMinor, task.currency))}${dataCell('Spending ceiling', formatMoney(task.spendingCeilingMinor, task.currency))}`;
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">01 / Entry</div><h2>${heading}</h2><p>${isRequest ? 'The request is parsed deterministically before any catalog result can become payment authority.' : 'A single task, with no wallet or reusable card surface.'}</p></div>${modeBadge('entry')}</div>
    ${isRequest ? `<div class="request-callout"><strong>${escapeHtml(task.request.raw)}</strong><p>${escapeHtml(requestIntentSummary(task))}</p></div>` : ''}<div class="brief-grid">${details}</div>
    <div class="locked-callout"><strong>Start here</strong><p>Verify fixture evidence, review ranked candidates, lock one quote, pass server policy, issue one scoped instrument, then execute one mock checkout. Opening records an audit event, but does not authorize a payment.</p></div>
    <div class="action-row">${actionButton('Open assigned task', 'open-task', 'button-lime')}<p class="action-help">The next step will verify funding evidence.</p></div>
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
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Find relevant candidates</h2><p>Search the seeded local catalog, rank by the parsed request, and return a small quote set. No broad shopping authority is created.</p></div>${modeBadge('discovery')}</div><div class="locked-callout"><strong>Request to candidates</strong><p>${escapeHtml(task.request?.raw || purchaseFor(task).item)}. Results are DEMO / MOCK local fixtures and expire in 15 minutes.</p></div><div class="action-row">${actionButton('Discover ranked candidates', 'discover', 'button-lime')}<p class="action-help">Deterministic parser and local catalog adapter.</p></div></article>`;
  }
  if (!quote.locked) {
    const selected = state.selectedCandidate || quote.recommendedCandidateId;
    return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Choose the exact purchase</h2><p>Select one candidate. Merchant, item, variant, total, currency, availability, evidence, and expiry lock together.</p></div>${modeBadge('quote')}</div><div class="candidate-list" role="radiogroup" aria-label="Quote candidates">${quote.candidates.map((candidate) => `<label class="candidate${selected === candidate.id ? ' selected' : ''}"><input type="radio" name="candidate" value="${escapeHtml(candidate.id)}" data-candidate="${escapeHtml(candidate.id)}"${selected === candidate.id ? ' checked' : ''}><span class="candidate-content"><div class="candidate-heading"><h3>${escapeHtml(candidate.item)}</h3><span class="availability ${candidate.availability === 'limited' ? 'limited' : ''}">${escapeHtml(candidate.availability.replaceAll('_', ' '))}</span></div><p>${escapeHtml(candidate.variant)} · ${escapeHtml(candidate.merchant)}</p><dl class="candidate-details"><div><dt>Merchant</dt><dd>${escapeHtml(candidate.merchant)}</dd></div><div><dt>Price</dt><dd>${formatMoney(candidate.totalMinor, candidate.currency)}</dd></div><div><dt>Currency</dt><dd>${escapeHtml(candidate.currency)}</dd></div><div><dt>Expiry</dt><dd>${formatDate(candidate.expiresAt)}</dd></div></dl><p class="candidate-reason">Why shown: ${escapeHtml(candidate.selectionReason)}</p><p class="candidate-evidence">Evidence: ${escapeHtml(candidate.evidence.source)} · ${escapeHtml(candidate.evidence.note)}</p></span><span class="candidate-total">${formatMoney(candidate.totalMinor, candidate.currency)}</span></label>`).join('')}</div><div class="action-row">${actionButton(task.automation?.status === 'awaiting_selection' ? 'Confirm selection and finish run' : 'Lock selected quote', 'lock-quote', 'button-lime')}<p class="action-help">${task.automation?.status === 'awaiting_selection' ? 'The server will lock this quote, run policy, issue scoped authority, and complete one mock checkout.' : 'Locking is immutable for this task.'}</p></div></article>`;
  }
  const locked = quote.lockedSnapshot;
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">03 / Discovery + quote lock</div><h2>Selected quote locked</h2><p>This is the only purchase scope the server can approve.</p></div>${modeBadge('locked')}</div><div class="locked-callout"><strong>${escapeHtml(locked.item)} · ${formatMoney(locked.totalMinor, locked.currency)}</strong><p>${escapeHtml(locked.merchant)} · ${escapeHtml(locked.variant)} · ${escapeHtml(locked.availability)} · expires ${formatDate(locked.expiresAt)}</p></div><dl class="detail-list"><div class="detail-row"><dt>Merchant</dt><dd>${escapeHtml(locked.merchant)} (${escapeHtml(locked.merchantDomain)})</dd></div><div class="detail-row"><dt>Item and variant</dt><dd>${escapeHtml(locked.item)} / ${escapeHtml(locked.variant)}</dd></div><div class="detail-row"><dt>Total and currency</dt><dd>${formatMoney(locked.totalMinor, locked.currency)} / ${escapeHtml(locked.currency)}</dd></div><div class="detail-row"><dt>Quote reference</dt><dd>${escapeHtml(locked.quoteId)}</dd></div><div class="detail-row"><dt>Evidence</dt><dd>${escapeHtml(locked.evidence?.source || 'Local catalog fixture')}</dd></div><div class="detail-row"><dt>Locked at</dt><dd>${formatDate(quote.lockedAt)}</dd></div><div class="detail-row"><dt>Expiry</dt><dd>${formatDate(locked.expiresAt)}</dd></div></dl><div class="action-row">${actionButton('Run server policy approval', 'approve-policy', 'button-lime')}<p class="action-help">The hard ceiling is checked before any instrument exists.</p></div></article>`;
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

function auditPanel(task) {
  return `<article class="card card-pad audit-inspector" aria-labelledby="audit-title"><div class="audit-header"><div><div class="panel-label">Redacted evidence</div><h2 id="audit-title">Inspect this task's audit</h2><p>Append-only lifecycle evidence. Payment credentials, keys, and sensitive provider material are never displayed.</p></div><span class="mode-badge mode-badge-light">${state.audit.length} events</span></div><div class="audit-truth-note"><strong>Evidence boundary</strong><span>Funding verification records on-chain evidence separately from card-spendable settlement. Neither field is a payment credential.</span></div><ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event event-${escapeHtml(event.status)}"><span class="event-dot"></span><span><div class="audit-summary">${escapeHtml(event.summary)}</div><div class="audit-type">${escapeHtml(event.type)}</div></span><time class="audit-time">${formatDate(event.occurredAt)}</time></li>`).join('')}</ol></article>`;
}

function runTimeline(task) {
  const stages = [
    ['Entry', ['task.created', 'task.opened']],
    ['Funding verified', ['funding.verified', 'funding.failed']],
    ['Candidates ranked', ['discovery.quoted', 'discovery.failed']],
    ['Quote and policy locked', ['quote.locked', 'policy.approved', 'policy.declined']],
    ['Scoped checkout', ['instrument.issued', 'instrument.failed', 'checkout.authorized', 'checkout.declined', 'checkout.unknown', 'checkout.failed']],
    ['Receipt and audit', ['task.completed', 'checkout.reconciled']]
  ];
  const events = state.audit;
  return `<ol class="run-timeline" aria-label="Backend purchase progress">${stages.map(([label, types]) => {
    const event = events.find((item) => types.includes(item.type));
    const failed = event?.status === 'error' || (task.failure && (label === 'Receipt and audit' || (label === 'Funding verified' && task.failure.stage === 'funding') || (label === 'Candidates ranked' && task.failure.stage === 'discovery') || (label === 'Quote and policy locked' && task.failure.stage === 'policy') || (label === 'Scoped checkout' && ['issuance', 'checkout'].includes(task.failure.stage))));
    const complete = Boolean(event) && !failed;
    const current = !complete && !failed;
    return `<li class="run-timeline-item${complete ? ' is-complete' : ''}${failed ? ' is-failed' : ''}${current ? ' is-current' : ''}"><span class="run-timeline-mark">${complete ? '✓' : (failed ? '!' : '•')}</span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(failed ? 'Stopped safely' : (complete ? 'Recorded' : 'Awaiting'))}</small></span></li>`;
  }).join('')}</ol>`;
}

function recommendationPanel(task) {
  const quote = task.quote;
  if (!quote?.candidates?.length) return '';
  const selected = quote.candidates.find((candidate) => candidate.id === quote.selectedCandidateId) || quote.candidates.find((candidate) => candidate.id === quote.recommendedCandidateId);
  const recommendation = quote.recommendation;
  return `<section class="recommendation-card"><div class="recommendation-heading"><div><div class="panel-label">Discovery result</div><h3>${recommendation?.status === 'clear' ? 'Best clear match selected automatically' : 'Candidate review required'}</h3></div>${modeBadge('local catalog')}</div><p class="recommendation-reason">${escapeHtml(recommendation?.reason || 'Ranked by the deterministic local catalog adapter.')}</p>${selected ? `<div class="recommendation-selected"><strong>${escapeHtml(selected.item)}</strong><span>${escapeHtml(selected.merchant)} · ${formatMoney(selected.totalMinor, selected.currency)}</span><small>${escapeHtml(selected.variant)} · ${escapeHtml(selected.availability.replaceAll('_', ' '))}</small></div>` : ''}<ul class="recommendation-list">${quote.candidates.slice(0, 4).map((candidate) => `<li class="${candidate.id === quote.selectedCandidateId ? 'is-selected' : ''}"><span>${candidate.id === quote.selectedCandidateId ? '✓' : '•'}</span><span><strong>${escapeHtml(candidate.item)}</strong><small>${escapeHtml(candidate.merchant)} · ${formatMoney(candidate.totalMinor, candidate.currency)} · score ${escapeHtml(candidate.relevanceScore)}</small></span></li>`).join('')}</ul><p class="recommendation-disclosure">DEMO / MOCK local fixture. Candidates are evidence-backed quotes, not live marketplace results.</p></section>`;
}

function receiptPanel(task) {
  const receipt = task.receipt;
  if (!receipt) return '';
  const capture = receipt.captureReference || 'Not returned by provider; resolution recorded';
  return `<section class="receipt-card" aria-labelledby="receipt-title"><div class="receipt-heading"><div><div class="panel-label">Final receipt</div><h3 id="receipt-title">Purchase receipt</h3></div><span class="receipt-status">CONFIRMED · MOCK</span></div><div class="receipt-main"><strong>${escapeHtml(receipt.item)}</strong><span>${escapeHtml(receipt.merchant)} · ${formatMoney(receipt.amountMinor, receipt.currency)}</span><small>${escapeHtml(receipt.variant)}</small></div><dl class="detail-list"><div class="detail-row"><dt>Receipt reference</dt><dd>${escapeHtml(receipt.id)}</dd></div><div class="detail-row"><dt>Checkout reference</dt><dd>${escapeHtml(receipt.checkoutReference)}</dd></div><div class="detail-row"><dt>Capture</dt><dd>${escapeHtml(capture)}</dd></div><div class="detail-row"><dt>Authority</dt><dd>${escapeHtml(receipt.authority)}</dd></div></dl><p class="receipt-disclosure">${escapeHtml(receipt.disclosure)}</p></section>`;
}

function outcomePanel(task) {
  const unknown = task.state === 'reconciliation_required';
  const success = task.state === 'completed';
  const outcome = task.outcome || {};
  const title = success ? 'Purchase confirmed' : (unknown ? 'Checkout needs reconciliation' : 'Task stopped safely');
  const message = success
    ? (outcome.label === 'Reconciled as authorized' ? 'The unknown provider result was reconciled as authorized. The one-use instrument was retired without a retry.' : 'The mock authorization was captured, the receipt was persisted, and the one-use instrument was retired.')
    : unknown
      ? 'The provider result is unknown. NaviPay has blocked automatic replay. Confirm the provider result before resolving.'
      : (task.failure?.message || 'The lifecycle ended without an authorization.');
  const failureTitles = { policy: 'Policy stopped before issuance', issuance: 'Scoped instrument was not issued', funding: 'Funding evidence could not be verified', discovery: 'Discovery could not return a quote', checkout: 'Checkout stopped safely' };
  const terminalTitle = failureTitles[task.failure?.stage] || 'Task stopped safely';
  return `<article class="card card-pad"><div class="card-header"><div><div class="panel-label">06 / Outcome + audit</div><h2>Financial truth, not a green guess</h2><p>Authorization, capture, retirement, receipt, and reconciliation remain explicit.</p></div>${modeBadge('outcome')}</div><div class="outcome-banner${success ? '' : (unknown ? ' warning' : ' error')}" role="${success || unknown ? 'status' : 'alert'}" aria-live="polite"><h2>${success ? title : (unknown ? title : terminalTitle)}</h2><p>${escapeHtml(message)}</p></div>${recommendationPanel(task)}${receiptPanel(task)}<div class="outcome-meta">${dataCell('Lifecycle state', task.state.replaceAll('_', ' '))}${dataCell('Outcome', outcome.label || task.failure?.code || 'No authorization')}${dataCell('Checkout reference', shortId(task.checkout?.checkoutReference))}${dataCell('Authority status', task.instrument?.status || 'Not issued')}</div>${unknown ? `<div class="action-row"><button type="button" class="button button-lime" data-action="reconcile-authorized"${state.busy ? ' disabled' : ''}>Reconcile as authorized</button><button type="button" class="button button-secondary" data-action="reconcile-declined"${state.busy ? ' disabled' : ''}>Reconcile as declined</button><p class="action-help">Resolution records a new event. It never retries checkout.</p></div>` : ''}${task.policy ? `<div><div class="panel-label" style="margin-top:1.25rem">Policy receipt</div>${policyChecks(task.policy)}</div>` : ''}<div class="timeline-wrap"><div class="audit-header"><div><div class="panel-label">Run timeline</div><h3>Backend-owned progress</h3></div><p>Each transition is persisted before the next begins.</p></div>${runTimeline(task)}</div><div class="audit"><div class="audit-header"><div><div class="panel-label">Append-only audit timeline</div><h3>Redacted evidence trail</h3></div><p>${state.audit.length} events · no sensitive payment material</p></div><ol class="audit-list">${state.audit.slice().reverse().map((event) => `<li class="audit-event event-${escapeHtml(event.status)}"><span class="event-dot"></span><span><div class="audit-summary">${escapeHtml(event.summary)}</div><div class="audit-type">${escapeHtml(event.type)}</div></span><time class="audit-time">${formatDate(event.occurredAt)}</time></li>`).join('')}</ol></div></article>`;
}

function guardrails(task) {
  const lockedTotal = task.quote?.lockedSnapshot?.totalMinor || 0;
  const ceiling = task.spendingCeilingMinor;
  const percentage = Math.min(100, Math.round((lockedTotal / ceiling) * 100));
  return `<aside class="guardrail-stack"><article class="card guardrail-card"><div class="panel-label">Server guardrails</div><h2>Bounded by design</h2><ul class="guardrail-list"><li><span>Immutable ${formatMoney(ceiling, task.currency)} ceiling</span></li><li><span>Exact merchant and quote scope</span></li><li><span>One successful capture maximum</span></li><li><span>Unknown results require reconciliation</span></li><li><span>Audit entries are redacted and append-only</span></li></ul><div class="ceiling-meter"><div class="ceiling-meter-head"><span>Locked quote / ceiling</span><strong>${formatMoney(lockedTotal, task.currency)} / ${formatMoney(ceiling, task.currency)}</strong></div><div class="meter-track" role="progressbar" aria-label="Locked quote against task ceiling" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><div class="meter-fill${lockedTotal > ceiling ? ' over' : ''}" style="width:${Math.max(lockedTotal ? 3 : 0, percentage)}%"></div></div></div></article><article class="card guardrail-card"><div class="panel-label">Mode disclosure</div><h2>What is simulated</h2><ul class="guardrail-list"><li><span>Funding verifier: Avalanche fixture</span></li><li><span>Discovery: local catalog fixture</span></li><li><span>Issuer: mock scoped instrument</span></li><li><span>Checkout: mock merchant</span></li></ul></article><article class="card guardrail-card scenario-card"><div class="panel-label">Judge scenarios</div><h2>Replay a known path</h2><p>Choose an isolated deterministic run. Reset clears the local store and seeds a fresh happy path.</p><label class="select-label" for="scenario-select">Scenario</label><select class="scenario-select" id="scenario-select">${scenarioOptions(task.scenario)}</select><div class="action-row">${actionButton('Start selected scenario', 'new-run', 'button-secondary')}<button type="button" class="button button-secondary" data-action="reset-demo"${state.busy ? ' disabled' : ''}>Reset local demo</button></div></article></aside>`;
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
  app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  app.innerHTML = `${workspace(task)}${hero(task)}${notice()}${state.error ? `<div class="error-banner" id="action-error" tabindex="-1" role="alert"><strong>${escapeHtml(state.error.code || 'Action unavailable')}</strong><p>${escapeHtml(state.error.message)}</p></div>` : ''}${stageRail(task)}<div class="console-grid"><div>${stagePanel(task)}${currentStage(task) < 5 ? auditPanel(task) : ''}<p class="footer-note">NaviPay demo mode · local-only fixture · credentials and sensitive payment data stay outside the operator console.</p></div>${guardrails(task)}</div>`;
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

async function refreshTasks() {
  const payload = await api('/api/tasks');
  state.tasks = payload.tasks || [];
  const current = state.tasks.find((task) => task.id === state.task?.id);
  if (current) state.task = current;
}

function showTaskFormError(message) {
  const error = document.querySelector('#task-form-error');
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function showRequestFormError(message) {
  const error = document.querySelector('#request-form-error');
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function newRunKey() {
  return `console-run-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function absorbTaskError(error) {
  if (!error.payload?.task) return;
  state.task = error.payload.task;
  await refreshTasks().catch(() => {});
  await refreshAudit().catch(() => {});
}

async function createRequestTask(event) {
  event.preventDefault();
  showRequestFormError('');
  const form = event.currentTarget;
  const request = form.elements.request.value.trim();
  if (!request || request.length > 240 || /[\u0000-\u001f\u007f]/.test(request)) return showRequestFormError('Enter a plain-language request between 1 and 240 characters.');
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': newRunKey() }, body: JSON.stringify({ request }) });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshTasks();
    await refreshAudit();
    form.reset();
  } catch (error) {
    await absorbTaskError(error);
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

async function createPurchaseTask(event) {
  event.preventDefault();
  showTaskFormError('');
  const form = event.currentTarget;
  const merchant = form.elements.merchant.value.trim();
  const item = form.elements.item.value.trim();
  const amount = form.elements.amount.value.trim();
  const amountMinor = parseAmountMinor(amount);
  if (!merchant || merchant.length > 120 || /[\u0000-\u001f\u007f]/.test(merchant)) return showTaskFormError('Enter a merchant name between 1 and 120 characters.');
  if (!item || item.length > 180 || /[\u0000-\u001f\u007f]/.test(item)) return showTaskFormError('Enter an item between 1 and 180 characters.');
  if (!amountMinor) return showTaskFormError('Enter a positive XSGD amount with at most two decimal places.');
  if (amountMinor > TASK_CEILING_MINOR) return showTaskFormError(`Amount cannot exceed ${formatMoney(TASK_CEILING_MINOR)}.`);
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': newRunKey() }, body: JSON.stringify({ merchant, item, amount }) });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshTasks();
    await refreshAudit();
    form.reset();
  } catch (error) {
    await absorbTaskError(error);
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

async function selectTask(taskId) {
  if (state.busy || taskId === state.task?.id) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.busy = true;
  state.error = null;
  state.task = task;
  state.selectedCandidate = null;
  render();
  try {
    await refreshAudit();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
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
    await refreshTasks();
    await refreshAudit();
  } catch (error) {
    if (error.payload?.task) {
      state.task = error.payload.task;
      await refreshTasks().catch(() => {});
      await refreshAudit().catch(() => {});
    }
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

async function startNewRun(scenario) {
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/purchases/run', { method: 'POST', headers: { 'Idempotency-Key': newRunKey() }, body: JSON.stringify({ scenario }) });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshTasks();
    await refreshAudit();
  } catch (error) {
    await absorbTaskError(error);
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

async function resetDemo() {
  if (!window.confirm('Reset local demo? This intentionally clears persisted tasks and audit history, then seeds one fresh task.')) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const payload = await api('/api/reset', { method: 'POST', body: '{}' });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshTasks();
    await refreshAudit();
  } catch (error) {
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

async function safelyReplayTask() {
  state.busy = true;
  state.error = null;
  render();
  try {
    const id = state.task.id;
    const payload = await api(`/api/tasks/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `console-${id}-replay` },
      body: '{}'
    });
    state.task = payload.task;
    state.selectedCandidate = null;
    await refreshTasks();
    await refreshAudit();
  } catch (error) {
    if (error.payload?.task) state.task = error.payload.task;
    state.error = { code: error.code, message: error.message };
  } finally {
    state.busy = false;
    render();
    focusAfterAction();
  }
}

function focusAfterAction() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  const target = document.querySelector('#action-error') || document.querySelector('#page-title');
  target?.focus?.({ preventScroll: true });
}

function alignStageRail() {
  const rail = document.querySelector('.stage-rail');
  const current = rail?.querySelector('[aria-current="step"]');
  if (!rail || !current || rail.scrollWidth <= rail.clientWidth) return;
  rail.scrollLeft = Math.max(0, current.offsetLeft - (rail.clientWidth - current.offsetWidth));
}

function bindEvents() {
  document.querySelector('#request-form')?.addEventListener('submit', createRequestTask);
  document.querySelector('#task-form')?.addEventListener('submit', createPurchaseTask);
  document.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => selectTask(button.dataset.taskId)));
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
    if (action === 'lock-quote') return perform(action, `/api/tasks/${id}/${state.task.automation?.status === 'awaiting_selection' ? 'run' : 'quote/lock'}`, { candidateId: state.selectedCandidate || state.task.quote.recommendedCandidateId });
    if (action === 'approve-policy') return perform(action, `/api/tasks/${id}/policy/approve`);
    if (action === 'issue-instrument') return perform(action, `/api/tasks/${id}/instrument/issue`);
    if (action === 'go-execution') return perform(action, `/api/tasks/${id}/instrument/issue`);
    if (action === 'execute-checkout') return perform(action, `/api/tasks/${id}/checkout/execute`);
    if (action === 'reconcile-authorized') return perform(action, `/api/tasks/${id}/checkout/reconcile`, { resolution: 'authorized' });
    if (action === 'reconcile-declined') return perform(action, `/api/tasks/${id}/checkout/reconcile`, { resolution: 'declined' });
    if (action === 'replay-task') return safelyReplayTask();
    if (action === 'new-run') return startNewRun(document.querySelector('#scenario-select')?.value || 'happy');
    if (action === 'reset-demo') return resetDemo();
  }));
  document.querySelector('#new-run')?.addEventListener('click', () => startNewRun(document.querySelector('#scenario-select')?.value || 'happy'));
  alignStageRail();
}

async function boot() {
  try {
    const payload = await api('/api/tasks');
    state.tasks = payload.tasks || [];
    state.task = state.tasks[0];
    if (!state.task) {
      const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ scenario: 'happy' }) });
      state.task = created.task;
      state.tasks = [created.task];
    }
    await refreshAudit();
    render();
  } catch (error) {
    app.innerHTML = `<section class="error-banner" role="alert"><strong>Unable to load NaviPay</strong><p>${escapeHtml(error.message)} Start the local server with <code>npm start</code> and reload.</p></section>`;
  }
}

window.addEventListener('resize', alignStageRail);
boot();
