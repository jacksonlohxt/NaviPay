const crypto = require('node:crypto');
const { AdapterError, MockCheckoutAdapter, MockDiscoveryAdapter, MockFundingAdapter, MockIssuerAdapter, parsePurchaseRequest } = require('./adapters');

const TASK_CEILING_MINOR = 100000;
const CURRENCY = 'XSGD';
const DEFAULT_PURCHASE = {
  merchant: 'Harbor Supply',
  item: 'Anker 737 Power Bank',
  amountMinor: 8950
};
const SCENARIOS = new Set(['happy', 'over-cap', 'unknown-checkout', 'checkout-failure', 'issuer-failure', 'funding-failure', 'discovery-failure']);

class DomainError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultClock() {
  return new Date();
}

function newId(prefix = 'task') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function money(minor, currency = CURRENCY) {
  return `${currency} ${(minor / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseAmountMinor(value, field = 'amount') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) !== value * 100) {
      throw new DomainError(422, 'INVALID_AMOUNT', `${field} must be a positive XSGD amount with at most two decimal places.`);
    }
    return Math.round(value * 100);
  }
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new DomainError(422, 'INVALID_AMOUNT', `${field} must be a positive XSGD amount with at most two decimal places.`);
  }
  const minor = Math.round(Number(value.trim()) * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new DomainError(422, 'INVALID_AMOUNT', `${field} must be a positive XSGD amount with at most two decimal places.`);
  }
  return minor;
}

function validatePurchaseInput({ merchant, item, amount, amountMinor }) {
  if (!isText(merchant) || merchant.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(merchant)) {
    throw new DomainError(422, 'INVALID_MERCHANT', 'Merchant is required and must be 120 characters or fewer.');
  }
  if (!isText(item) || item.trim().length > 180 || /[\u0000-\u001f\u007f]/.test(item)) {
    throw new DomainError(422, 'INVALID_ITEM', 'Item is required and must be 180 characters or fewer.');
  }
  const minor = amountMinor !== undefined ? amountMinor : parseAmountMinor(amount, 'amount');
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new DomainError(422, 'INVALID_AMOUNT', 'amountMinor must be a positive integer amount of XSGD cents.');
  }
  if (minor > TASK_CEILING_MINOR) {
    throw new DomainError(422, 'AMOUNT_EXCEEDS_CEILING', `The amount cannot exceed the immutable task ceiling of ${money(TASK_CEILING_MINOR)}.`);
  }
  return {
    merchant: merchant.trim(),
    item: item.trim(),
    amountMinor: minor,
    currency: CURRENCY
  };
}

function isMinor(value) {
  return Number.isInteger(value) && value >= 0;
}

function isTimestamp(value) {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function contractError(code, message) {
  return new AdapterError(code, message);
}

function validateFundingEvidence(evidence, currency) {
  const onChain = evidence?.onChain;
  const settlement = evidence?.settlement;
  if (!evidence || !isText(evidence.mode) || !isText(evidence.source) || !onChain || onChain.status !== 'verified' || onChain.asset !== currency || !isMinor(onChain.amountMinor) || !isText(onChain.network) || !isText(onChain.transactionReference) || !isTimestamp(onChain.observedAt) || !settlement || !isText(settlement.status) || typeof settlement.spendable !== 'boolean') {
    throw contractError('INVALID_FUNDING_RESULT', 'The funding adapter returned incomplete verification evidence.');
  }
}

function validateCandidate(candidate, currency) {
  const availability = new Set(['in_stock', 'limited', 'out_of_stock']);
  const evidence = candidate?.evidence;
  return candidate && isText(candidate.id) && isText(candidate.brand) && isText(candidate.productCategory) && isText(candidate.merchant) && isText(candidate.merchantDomain) && isText(candidate.item) && isText(candidate.variant) && isMinor(candidate.subtotalMinor) && isMinor(candidate.shippingMinor) && isMinor(candidate.taxMinor) && isMinor(candidate.totalMinor) && candidate.totalMinor === candidate.subtotalMinor + candidate.shippingMinor + candidate.taxMinor && candidate.currency === currency && availability.has(candidate.availability) && Number.isFinite(candidate.relevanceScore) && Array.isArray(candidate.matchReasons) && candidate.matchReasons.length > 0 && isText(candidate.selectionReason) && evidence && isText(evidence.type) && isText(evidence.source) && isText(evidence.catalogId) && isTimestamp(evidence.observedAt) && isText(evidence.note) && isTimestamp(candidate.expiresAt);
}

function validateDiscoveryResult(result, currency) {
  if (!result || !isText(result.mode) || !isText(result.source) || !isTimestamp(result.discoveredAt) || !Array.isArray(result.candidates) || result.candidates.length === 0 || !isText(result.recommendedCandidateId) || !result.candidates.some((candidate) => candidate.id === result.recommendedCandidateId) || result.candidates.some((candidate) => !validateCandidate(candidate, currency))) {
    throw contractError('INVALID_DISCOVERY_RESULT', 'The discovery adapter returned an incomplete or inconsistent quote set.');
  }
}

function quoteRecommendation(task, candidates, now) {
  const candidate = candidates.find((item) => item.id === task.quote?.recommendedCandidateId) || candidates[0];
  const intent = task.request?.intent;
  const hasClearIntent = !task.request || Boolean(intent?.brand && intent?.productCategory);
  const available = candidate && candidate.availability !== 'out_of_stock';
  const unexpired = candidate && new Date(candidate.expiresAt).getTime() > now.getTime();
  const inBudget = candidate && candidate.totalMinor <= task.spendingCeilingMinor;
  let status = 'clear';
  let reason = 'The highest-ranked available local candidate is within the task ceiling.';
  let autoSelectable = true;
  if (!hasClearIntent) {
    status = 'ambiguous';
    reason = 'The request does not identify both a brand and product category; choose the exact candidate before quote lock.';
    autoSelectable = false;
  } else if (!available) {
    status = 'unavailable';
    reason = 'The highest-ranked candidate is not currently available; choose an available candidate before quote lock.';
    autoSelectable = false;
  } else if (!unexpired) {
    status = 'expired';
    reason = 'The recommended quote is already expired; choose a current candidate before quote lock.';
    autoSelectable = false;
  } else if (!inBudget) {
    status = 'over_cap';
    reason = `The recommended quote exceeds the immutable ${money(task.spendingCeilingMinor, task.currency)} task ceiling.`;
    autoSelectable = false;
  }
  return {
    status,
    candidateId: candidate?.id || null,
    reason,
    autoSelectable
  };
}

function validateIssuedInstrument(issued, locked) {
  const scope = issued?.scope;
  if (!issued || !isText(issued.mode) || !isText(issued.reference) || issued.status !== 'active' || !isTimestamp(issued.issuedAt) || !scope || scope.merchant !== locked.merchant || scope.merchantDomain !== locked.merchantDomain || scope.item !== locked.item || scope.variant !== locked.variant || scope.amountMinor !== locked.totalMinor || scope.currency !== locked.currency || scope.expiresAt !== locked.expiresAt || scope.maxCaptures !== 1 || scope.reusable !== false) {
    throw contractError('INVALID_ISSUER_RESULT', 'The issuer adapter returned an instrument outside the locked purchase scope.');
  }
}

function validateCheckoutResult(result, scope) {
  const validStatuses = new Set(['authorized', 'unknown', 'declined']);
  const baseValid = result && validStatuses.has(result.status) && isText(result.mode) && isText(result.merchantDomain) && isMinor(result.amountMinor) && isText(result.currency) && isTimestamp(result.attemptedAt) && isText(result.checkoutReference);
  if (!baseValid) throw contractError('INVALID_CHECKOUT_RESULT', 'The checkout adapter returned an unsupported or incomplete result.');
  if (result.merchantDomain !== scope.merchantDomain || result.amountMinor !== scope.amountMinor || result.currency !== scope.currency) {
    throw contractError('CHECKOUT_SCOPE_MISMATCH', 'The checkout result did not match the locked merchant, amount, or currency.');
  }
  if (result.status === 'authorized' && (!isText(result.authorizationReference) || !isText(result.captureReference) || !isTimestamp(result.capturedAt))) {
    throw contractError('INVALID_CHECKOUT_RESULT', 'An authorized checkout result must include authorization and capture references.');
  }
  if (result.status === 'unknown' && !isText(result.message)) {
    throw contractError('INVALID_CHECKOUT_RESULT', 'An unknown checkout result must explain why reconciliation is required.');
  }
  if (result.status === 'declined' && !isText(result.reason)) {
    throw contractError('INVALID_CHECKOUT_RESULT', 'A declined checkout result must include a reason.');
  }
}

function publicTask(task) {
  return clone(task);
}

function createReceipt(task, completedAt) {
  const locked = task.quote?.lockedSnapshot;
  const checkout = task.checkout;
  return {
    id: newId('receipt'),
    status: 'confirmed',
    mode: 'demo / mock',
    issuedAt: completedAt,
    merchant: locked?.merchant,
    merchantDomain: locked?.merchantDomain,
    item: locked?.item,
    variant: locked?.variant,
    amountMinor: checkout?.amountMinor ?? locked?.totalMinor,
    currency: checkout?.currency ?? locked?.currency,
    checkoutReference: checkout?.checkoutReference,
    authorizationReference: checkout?.authorizationReference || null,
    captureReference: checkout?.captureReference || null,
    authority: 'one-use scoped instrument retired',
    disclosure: 'DEMO / MOCK receipt; no live funds moved.'
  };
}

function appendAudit(data, taskId, clock, type, status, summary, details = {}) {
  const event = {
    id: newId('audit'),
    taskId,
    occurredAt: clock().toISOString(),
    type,
    status,
    summary,
    details
  };
  data.auditEvents.push(event);
  return event;
}

function taskResponse(task, extra = {}) {
  return { task: publicTask(task), ...extra };
}

function actionKey(taskId, action, key) {
  return `${taskId}:${action}:${key}`;
}

class NaviPayService {
  constructor({
    store,
    clock = defaultClock,
    fundingAdapter = new MockFundingAdapter({ clock }),
    discoveryAdapter = new MockDiscoveryAdapter({ clock }),
    issuerAdapter = new MockIssuerAdapter({ clock }),
    checkoutAdapter = new MockCheckoutAdapter({ clock })
  }) {
    this.store = store;
    this.clock = clock;
    this.fundingAdapter = fundingAdapter;
    this.discoveryAdapter = discoveryAdapter;
    this.issuerAdapter = issuerAdapter;
    this.checkoutAdapter = checkoutAdapter;
  }

  createTask({ scenario = 'happy', origin = 'operator', merchant, item, amount, amountMinor, request, replayOf } = {}) {
    if (!SCENARIOS.has(scenario)) {
      throw new DomainError(400, 'INVALID_SCENARIO', `Unknown demo scenario: ${scenario}.`);
    }
    const hasPurchaseInput = [merchant, item, amount, amountMinor].some((value) => value !== undefined);
    if (request !== undefined && hasPurchaseInput) {
      throw new DomainError(422, 'REQUEST_INPUT_CONFLICT', 'Provide either a natural purchase request or direct merchant, item, and amount fields.');
    }
    let purchase = null;
    let purchaseRequest = null;
    if (request !== undefined) {
      try {
        const intent = parsePurchaseRequest(request);
        purchaseRequest = { raw: request.trim(), intent };
      } catch (error) {
        throw new DomainError(422, error.code || 'INVALID_PURCHASE_REQUEST', error.message || 'Purchase request is invalid.');
      }
    } else {
      purchase = hasPurchaseInput
        ? validatePurchaseInput({ merchant, item, amount, amountMinor })
        : {
          ...DEFAULT_PURCHASE,
          amountMinor: scenario === 'over-cap' ? 125000 : DEFAULT_PURCHASE.amountMinor,
          currency: CURRENCY
        };
    }
    const createdClock = this.clock();
    const latestCreatedAt = Object.values(this.store.data.tasks)
      .map((existing) => Date.parse(existing.createdAt))
      .filter(Number.isFinite)
      .reduce((latest, value) => Math.max(latest, value), 0);
    const createdAt = new Date(Math.max(createdClock.getTime(), latestCreatedAt + (latestCreatedAt ? 1 : 0))).toISOString();
    const task = {
      id: newId('task'),
      createdAt,
      updatedAt: createdAt,
      origin,
      replayOf: replayOf || null,
      scenario,
      mode: 'demo / mock',
      currency: CURRENCY,
      spendingCeilingMinor: TASK_CEILING_MINOR,
      request: purchaseRequest,
      purchase,
      state: 'created',
      entryOpened: false,
      funding: null,
      quote: null,
      policy: null,
      instrument: null,
      checkout: null,
      outcome: null,
      receipt: null,
      failure: null,
      automation: {
        status: 'not_started',
        automatic: false,
        startedAt: null,
        completedAt: null,
        nextAction: 'Start the bounded purchase run.'
      }
    };
    this.store.transaction((data) => {
      data.tasks[task.id] = task;
      const taskDetails = {
        mode: task.mode,
        spendingCeiling: money(task.spendingCeilingMinor)
      };
      if (task.request) {
        taskDetails.request = task.request.raw;
        taskDetails.intent = task.request.intent;
      } else {
        taskDetails.merchant = task.purchase.merchant;
        taskDetails.item = task.purchase.item;
        taskDetails.amount = money(task.purchase.amountMinor, task.purchase.currency);
      }
      appendAudit(data, task.id, this.clock, 'task.created', 'info', 'Assigned purchase task created.', taskDetails);
    });
    return publicTask(task);
  }

  ensureSeedTask() {
    const tasks = this.listTasks();
    if (tasks.length === 0) return this.createTask({ origin: 'seed' });
    return tasks[0];
  }

  reset() {
    this.store.reset();
    return this.ensureSeedTask();
  }

  listTasks() {
    return Object.values(this.store.data.tasks)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicTask);
  }

  getTask(taskId) {
    const task = this.store.data.tasks[taskId];
    if (!task) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
    return publicTask(task);
  }

  getAudit(taskId) {
    if (!this.store.data.tasks[taskId]) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
    return clone(this.store.data.auditEvents.filter((event) => event.taskId === taskId));
  }

  getReceipt(taskId) {
    const task = this.store.data.tasks[taskId];
    if (!task) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
    if (!task.receipt) throw new DomainError(404, 'RECEIPT_NOT_READY', 'A confirmed receipt is not available for this task yet.');
    return clone(task.receipt);
  }

  _setAutomation(taskId, patch) {
    return this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
      task.automation = {
        status: 'not_started',
        automatic: false,
        startedAt: null,
        completedAt: null,
        nextAction: null,
        ...task.automation,
        ...patch
      };
      task.updatedAt = this.clock().toISOString();
      return task.automation;
    });
  }

  _finishOrchestration(taskId, result, automatic = true) {
    const current = this.store.data.tasks[taskId];
    if (!current) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
    let status = 'running';
    let nextAction = null;
    if (current.state === 'completed') {
      status = 'completed';
      nextAction = 'none';
    } else if (current.state === 'reconciliation_required') {
      status = 'awaiting_reconciliation';
      nextAction = 'Reconcile the provider result. Checkout will not be retried automatically.';
    } else if (current.state === 'quoted' && !current.quote?.locked) {
      status = 'awaiting_selection';
      nextAction = 'Select a candidate to lock the exact quote and resume the bounded run.';
    } else if (current.state === 'failed') {
      status = 'stopped';
      nextAction = 'Review the exception. No further payment action was attempted.';
    }
    this._setAutomation(taskId, {
      status,
      automatic,
      completedAt: ['completed', 'stopped', 'awaiting_reconciliation'].includes(status) ? this.clock().toISOString() : null,
      nextAction
    });
    const task = this.getTask(taskId);
    return {
      statusCode: result.statusCode,
      body: {
        ...(result.body || {}),
        task,
        run: {
          status: task.automation.status,
          automatic: task.automation.automatic,
          nextAction: task.automation.nextAction
        }
      }
    };
  }

  _advanceTask(taskId, { candidateId = null } = {}) {
    let task = this.getTask(taskId);
    if (['completed', 'failed', 'reconciliation_required'].includes(task.state)) {
      return this._finishOrchestration(taskId, { statusCode: 200, body: taskResponse(task) }, true);
    }
    const automatic = !candidateId;
    this._setAutomation(taskId, {
      status: 'running',
      automatic,
      startedAt: task.automation?.startedAt || this.clock().toISOString(),
      completedAt: null,
      nextAction: 'NaviPay is running the bounded purchase.'
    });

    const call = (name, args) => {
      const result = this[name](taskId, `orchestrator-${taskId}-${name}`, ...args);
      if (result.statusCode < 200 || result.statusCode >= 300) return this._finishOrchestration(taskId, result, automatic);
      task = this.getTask(taskId);
      return null;
    };

    if (task.state === 'created') {
      const stopped = call('openTask', []);
      if (stopped) return stopped;
    }
    task = this.getTask(taskId);
    if (task.state === 'created') {
      const stopped = call('verifyFunding', []);
      if (stopped) return stopped;
    } else if (task.state === 'funded') {
      // Funding may already be complete after a reload; continue to discovery.
    }
    task = this.getTask(taskId);
    if (task.state === 'funded') {
      const stopped = call('discover', []);
      if (stopped) return stopped;
    }
    task = this.getTask(taskId);
    if (task.state === 'quoted' && !task.quote.locked) {
      const recommendation = task.quote.recommendation || quoteRecommendation(task, task.quote.candidates, this.clock());
      const selected = candidateId || (recommendation.autoSelectable ? recommendation.candidateId : null);
      if (!selected) return this._finishOrchestration(taskId, { statusCode: 200, body: taskResponse(task) }, false);
      const stopped = call('lockQuote', [selected]);
      if (stopped) return stopped;
    }
    task = this.getTask(taskId);
    if (task.state === 'quoted' && task.quote?.locked) {
      const stopped = call('approvePolicy', []);
      if (stopped) return stopped;
    }
    task = this.getTask(taskId);
    if (task.state === 'policy_approved') {
      const stopped = call('issueInstrument', []);
      if (stopped) return stopped;
    }
    task = this.getTask(taskId);
    if (task.state === 'instrument_issued') {
      const stopped = call('executeCheckout', []);
      if (stopped) return stopped;
    }
    return this._finishOrchestration(taskId, { statusCode: 200, body: taskResponse(this.getTask(taskId)) }, automatic);
  }

  _readRunIdempotency(key, fingerprint) {
    const previous = this.store.data.idempotency[key];
    if (!previous) return null;
    if (previous.requestFingerprint !== fingerprint) {
      return {
        statusCode: 409,
        body: {
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Use a new Idempotency-Key when the run input changes.'
          }
        },
        replayed: false
      };
    }
    if (previous.response) return { ...clone(previous.response), replayed: true };
    return { taskId: previous.taskId };
  }

  orchestrateTask(taskId, idempotencyKey, { candidateId = null } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new DomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a short Idempotency-Key for this purchase run.');
    }
    const fingerprint = candidateId || '';
    const key = `orchestrate:${taskId}:${idempotencyKey}`;
    const previous = this._readRunIdempotency(key, fingerprint);
    if (previous && (previous.body || previous.taskId === undefined)) return previous;
    const result = this._advanceTask(taskId, { candidateId });
    const response = { ...result, replayed: false };
    this.store.transaction((data) => {
      data.idempotency[key] = {
        createdAt: this.clock().toISOString(),
        requestFingerprint: fingerprint,
        taskId,
        response: clone(response)
      };
    });
    return response;
  }

  startPurchase({ idempotencyKey, scenario = 'happy', origin = 'operator', request, merchant, item, amount, amountMinor, candidateId = null } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new DomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a short Idempotency-Key for this purchase run.');
    }
    const fingerprint = JSON.stringify({ scenario, origin, request, merchant, item, amount, amountMinor, candidateId });
    const key = `orchestrate:new:${idempotencyKey}`;
    const previous = this._readRunIdempotency(key, fingerprint);
    if (previous && (previous.body || previous.taskId === undefined)) return previous;
    const task = previous?.taskId
      ? this.getTask(previous.taskId)
      : this.createTask({ scenario, origin, request, merchant, item, amount, amountMinor });
    if (!previous) {
      this.store.transaction((data) => {
        data.idempotency[key] = {
          createdAt: this.clock().toISOString(),
          requestFingerprint: fingerprint,
          taskId: task.id,
          response: null
        };
      });
    }
    const result = this._advanceTask(task.id, { candidateId });
    const response = {
      statusCode: previous ? result.statusCode : 201,
      body: result.body,
      replayed: false
    };
    this.store.transaction((data) => {
      data.idempotency[key] = {
        ...data.idempotency[key],
        response: clone(response)
      };
    });
    return response;
  }

  runPurchase(input = {}) {
    const fingerprint = JSON.stringify(input);
    return this.startPurchase({
      ...input,
      idempotencyKey: input.idempotencyKey || `service-run-${crypto.createHash('sha256').update(fingerprint).digest('hex')}`
    });
  }

  replayTask(taskId, idempotencyKey) {
    return this._action(taskId, 'replay-task', idempotencyKey, (task) => {
      if (task.state === 'reconciliation_required' || task.outcome?.status === 'unknown') {
        throw new DomainError(409, 'UNKNOWN_CHECKOUT_REPLAY_BLOCKED', 'Resolve the unknown checkout before creating a replay. NaviPay will not blindly repeat it.');
      }
      if (!['completed', 'failed'].includes(task.state)) {
        throw new DomainError(409, 'TASK_NOT_REPLAYABLE', 'Only a completed or safely stopped task can be replayed.');
      }
      const replayInput = {
        scenario: task.scenario,
        origin: 'replay',
        replayOf: task.id
      };
      if (task.request) {
        replayInput.request = task.request.raw;
      } else {
        const purchase = task.purchase || {
          merchant: task.quote?.lockedSnapshot?.merchant,
          item: task.quote?.lockedSnapshot?.item,
          amountMinor: task.quote?.lockedSnapshot?.totalMinor
        };
        if (purchase.amountMinor <= TASK_CEILING_MINOR) {
          Object.assign(replayInput, {
            merchant: purchase.merchant,
            item: purchase.item,
            amountMinor: purchase.amountMinor
          });
        }
      }
      const replay = this.createTask(replayInput);
      return { statusCode: 201, body: { task: replay, replayOf: task.id } };
    });
  }

  _action(taskId, action, idempotencyKey, handler, requestFingerprint = '') {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new DomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a short Idempotency-Key for this action.');
    }
    return this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) throw new DomainError(404, 'TASK_NOT_FOUND', 'That assigned task does not exist.');
      const storedKey = actionKey(taskId, action, idempotencyKey);
      const previous = data.idempotency[storedKey];
      if (previous) {
        if (previous.requestFingerprint && previous.requestFingerprint !== requestFingerprint) {
          return {
            statusCode: 409,
            body: {
              error: {
                code: 'IDEMPOTENCY_KEY_REUSED',
                message: 'Use a new Idempotency-Key when the action input changes.'
              },
              task: publicTask(task)
            },
            replayed: false
          };
        }
        return { ...clone(previous.response), replayed: true };
      }

      let response;
      try {
        response = handler(task, data);
      } catch (error) {
        const normalized = error instanceof DomainError
          ? error
          : new DomainError(502, 'ADAPTER_ERROR', error?.message || 'The adapter did not complete.');
        response = {
          statusCode: normalized.statusCode,
          body: {
            error: {
              code: normalized.code,
              message: normalized.message,
              details: normalized.details
            },
            task: publicTask(task)
          }
        };
      }
      data.idempotency[storedKey] = {
        createdAt: this.clock().toISOString(),
        requestFingerprint,
        response: clone(response)
      };
      return { ...response, replayed: false };
    });
  }

  openTask(taskId, idempotencyKey) {
    return this._action(taskId, 'open-task', idempotencyKey, (task, data) => {
      if (task.entryOpened) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'created') throw new DomainError(409, 'TASK_NOT_OPENABLE', `Task is already ${task.state}.`);
      task.entryOpened = true;
      task.updatedAt = this.clock().toISOString();
      appendAudit(data, task.id, this.clock, 'task.opened', 'info', 'Operator opened the assigned purchase brief.');
      return { statusCode: 200, body: taskResponse(task) };
    });
  }

  verifyFunding(taskId, idempotencyKey) {
    return this._action(taskId, 'verify-funding', idempotencyKey, (task, data) => {
      if (task.funding) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'created' || !task.entryOpened) {
        throw new DomainError(409, 'INVALID_TRANSITION', 'Open the assigned task before verifying funding.');
      }
      try {
        const evidence = this.fundingAdapter.verify({ taskId, scenario: task.scenario, currency: task.currency });
        validateFundingEvidence(evidence, task.currency);
        task.funding = {
          verifiedAt: this.clock().toISOString(),
          mode: evidence.mode,
          source: evidence.source,
          onChain: evidence.onChain,
          settlement: evidence.settlement
        };
        task.state = 'funded';
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'funding.verified', 'success', 'On-chain funding evidence verified.', {
          mode: evidence.mode,
          network: evidence.onChain.network,
          asset: evidence.onChain.asset,
          transactionReference: evidence.onChain.transactionReference,
          settlementStatus: evidence.settlement.status
        });
        return { statusCode: 200, body: taskResponse(task) };
      } catch (error) {
        task.state = 'failed';
        task.failure = { stage: 'funding', code: error?.code || 'FUNDING_FAILED', message: error?.message || 'The funding adapter did not complete.' };
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'funding.failed', 'error', 'Funding evidence could not be verified.', {
          code: task.failure.code,
          mode: task.mode
        });
        return {
          statusCode: 502,
          body: {
            error: { code: task.failure.code, message: task.failure.message },
            task: publicTask(task)
          }
        };
      }
    });
  }

  discover(taskId, idempotencyKey) {
    return this._action(taskId, 'discover', idempotencyKey, (task, data) => {
      if (task.quote) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'funded') throw new DomainError(409, 'INVALID_TRANSITION', 'Funding evidence must be verified first.');
      task.state = 'discovering';
      task.updatedAt = this.clock().toISOString();
      appendAudit(data, task.id, this.clock, 'discovery.started', 'info', 'Discovery started for the assigned item.', { mode: task.mode });
      try {
        const result = this.discoveryAdapter.discover({ taskId, scenario: task.scenario, currency: task.currency, purchase: task.purchase, request: task.request });
        validateDiscoveryResult(result, task.currency);
        task.quote = {
          mode: result.mode,
          source: result.source,
          discoveredAt: result.discoveredAt,
          candidates: result.candidates,
          recommendedCandidateId: result.recommendedCandidateId,
          recommendation: null,
          selectedCandidateId: null,
          locked: false,
          lockedAt: null,
          lockedSnapshot: null
        };
        task.quote.recommendation = quoteRecommendation(task, result.candidates, this.clock());
        task.state = 'quoted';
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'discovery.quoted', 'success', 'One deterministic quote set is ready to review.', {
          mode: result.mode,
          candidateCount: result.candidates.length,
          expiresAt: result.candidates[0].expiresAt
        });
        return { statusCode: 200, body: taskResponse(task) };
      } catch (error) {
        task.state = 'failed';
        task.failure = { stage: 'discovery', code: error?.code || 'DISCOVERY_FAILED', message: error?.message || 'The discovery adapter did not complete.' };
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'discovery.failed', 'error', 'Discovery did not return a quote.', { code: task.failure.code });
        return { statusCode: 502, body: { error: { code: task.failure.code, message: task.failure.message }, task: publicTask(task) } };
      }
    });
  }

  lockQuote(taskId, idempotencyKey, candidateId) {
    return this._action(taskId, 'lock-quote', idempotencyKey, (task, data) => {
      if (!task.quote) throw new DomainError(409, 'INVALID_TRANSITION', 'Discover a quote before locking it.');
      if (task.quote.locked) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'quoted') throw new DomainError(409, 'INVALID_TRANSITION', 'This quote is no longer available to lock.');
      const candidate = candidateId
        ? task.quote.candidates.find((item) => item.id === candidateId)
        : task.quote.candidates.find((item) => item.id === task.quote.recommendedCandidateId);
      if (!candidate) throw new DomainError(422, 'QUOTE_CANDIDATE_NOT_FOUND', 'Select one of the returned quote candidates.');
      if (candidate.currency !== task.currency) throw new DomainError(422, 'QUOTE_CURRENCY_MISMATCH', 'The quote currency does not match the task currency.');
      if (candidate.availability === 'out_of_stock') throw new DomainError(422, 'QUOTE_UNAVAILABLE', 'The selected local catalog item is not available.');
      if (new Date(candidate.expiresAt).getTime() <= this.clock().getTime()) {
        throw new DomainError(422, 'QUOTE_EXPIRED', 'The selected quote expired before it could be locked.');
      }
      task.quote.selectedCandidateId = candidate.id;
      task.quote.locked = true;
      task.quote.lockedAt = this.clock().toISOString();
      task.quote.lockedSnapshot = {
        quoteId: candidate.id,
        brand: candidate.brand,
        productCategory: candidate.productCategory,
        merchant: candidate.merchant,
        merchantDomain: candidate.merchantDomain,
        item: candidate.item,
        variant: candidate.variant,
        totalMinor: candidate.totalMinor,
        currency: candidate.currency,
        availability: candidate.availability,
        evidence: candidate.evidence,
        expiresAt: candidate.expiresAt
      };
      task.updatedAt = this.clock().toISOString();
      appendAudit(data, task.id, this.clock, 'quote.locked', 'success', 'Merchant, item, amount, currency, and expiry are now immutable.', {
        merchant: candidate.merchant,
        item: candidate.item,
        total: money(candidate.totalMinor, candidate.currency),
        expiresAt: candidate.expiresAt
      });
      return { statusCode: 200, body: taskResponse(task) };
    }, candidateId || '');
  }

  approvePolicy(taskId, idempotencyKey) {
    return this._action(taskId, 'approve-policy', idempotencyKey, (task, data) => {
      if (task.policy) return { statusCode: task.state === 'failed' ? 422 : 200, body: taskResponse(task, task.state === 'failed' ? { error: task.failure } : {}) };
      if (!task.quote || !task.quote.locked) throw new DomainError(409, 'INVALID_TRANSITION', 'Lock an exact quote before policy approval.');
      if (task.state !== 'quoted') throw new DomainError(409, 'INVALID_TRANSITION', 'This task is not awaiting policy approval.');
      const locked = task.quote.lockedSnapshot;
      const checks = [
        { key: 'funding-evidence', label: 'Funding evidence verified', status: task.funding?.onChain?.status === 'verified' ? 'passed' : 'failed', detail: 'Chain observation and settlement status remain separate.' },
        { key: 'quote-lock', label: 'Exact quote locked', status: 'passed', detail: `${locked.merchant} / ${locked.item}` },
        { key: 'task-ceiling', label: 'Immutable task ceiling', status: locked.totalMinor <= task.spendingCeilingMinor ? 'passed' : 'failed', detail: `${money(locked.totalMinor, locked.currency)} against ${money(task.spendingCeilingMinor, task.currency)}` },
        { key: 'quote-expiry', label: 'Quote is within expiry', status: new Date(locked.expiresAt).getTime() > this.clock().getTime() ? 'passed' : 'failed', detail: `Expires ${locked.expiresAt}` },
        { key: 'single-merchant', label: 'Single merchant scope', status: 'passed', detail: locked.merchantDomain },
        { key: 'currency', label: 'Currency matches task', status: locked.currency === task.currency ? 'passed' : 'failed', detail: locked.currency }
      ];
      const failed = checks.filter((check) => check.status === 'failed');
      task.policy = {
        status: failed.length ? 'declined' : 'approved',
        checkedAt: this.clock().toISOString(),
        checks,
        authority: 'server policy engine'
      };
      task.updatedAt = this.clock().toISOString();
      if (failed.length) {
        const capFailed = failed.some((check) => check.key === 'task-ceiling');
        const expiryFailed = failed.some((check) => check.key === 'quote-expiry');
        task.state = 'failed';
        task.failure = {
          stage: 'policy',
          code: capFailed ? 'SPENDING_CEILING_EXCEEDED' : (expiryFailed ? 'QUOTE_EXPIRED' : 'POLICY_DECLINED'),
          message: capFailed
            ? `The locked quote ${money(locked.totalMinor, locked.currency)} exceeds the immutable task ceiling of ${money(task.spendingCeilingMinor, task.currency)}.`
            : (expiryFailed ? 'The locked quote expired before policy approval.' : 'The locked quote did not satisfy the task policy.')
        };
        appendAudit(data, task.id, this.clock, 'policy.declined', 'error', 'Policy stopped the task before issuance.', {
          code: task.failure.code,
          failedChecks: failed.map((check) => check.key)
        });
        return { statusCode: 422, body: { error: task.failure, task: publicTask(task) } };
      }
      task.state = 'policy_approved';
      appendAudit(data, task.id, this.clock, 'policy.approved', 'success', 'Server policy approved the exact locked purchase.', {
        ceiling: money(task.spendingCeilingMinor, task.currency),
        total: money(locked.totalMinor, locked.currency),
        authority: 'server policy engine'
      });
      return { statusCode: 200, body: taskResponse(task) };
    });
  }

  issueInstrument(taskId, idempotencyKey) {
    return this._action(taskId, 'issue-instrument', idempotencyKey, (task, data) => {
      if (task.instrument) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'policy_approved' || !task.quote?.locked || task.policy?.status !== 'approved') {
        throw new DomainError(409, 'INVALID_TRANSITION', 'Policy must approve a locked quote before issuance.');
      }
      task.state = 'issuing';
      task.updatedAt = this.clock().toISOString();
      appendAudit(data, task.id, this.clock, 'instrument.issuing', 'info', 'Issuing a task-scoped mock instrument.', { mode: task.mode });
      try {
        const locked = task.quote.lockedSnapshot;
        const issued = this.issuerAdapter.issue({ taskId, scenario: task.scenario, scope: { ...locked, amountMinor: locked.totalMinor } });
        validateIssuedInstrument(issued, locked);
        task.instrument = {
          mode: issued.mode,
          reference: issued.reference,
          status: issued.status,
          issuedAt: issued.issuedAt,
          scope: issued.scope,
          retiredAt: null
        };
        task.state = 'instrument_issued';
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'instrument.issued', 'success', 'One-use authority issued for this exact purchase.', {
          mode: issued.mode,
          reference: issued.reference,
          merchant: issued.scope.merchant,
          total: money(issued.scope.amountMinor, issued.scope.currency),
          expiresAt: issued.scope.expiresAt
        });
        return { statusCode: 200, body: taskResponse(task) };
      } catch (error) {
        task.state = 'failed';
        task.failure = { stage: 'issuance', code: error?.code || 'ISSUANCE_FAILED', message: error?.message || 'The issuer adapter did not complete.' };
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'instrument.failed', 'error', 'The scoped instrument was not issued.', { code: task.failure.code });
        return { statusCode: 502, body: { error: { code: task.failure.code, message: task.failure.message }, task: publicTask(task) } };
      }
    });
  }

  executeCheckout(taskId, idempotencyKey) {
    return this._action(taskId, 'execute-checkout', idempotencyKey, (task, data) => {
      if (task.checkout) return { statusCode: 200, body: taskResponse(task) };
      if (task.state !== 'instrument_issued' || !task.instrument?.scope) {
        throw new DomainError(409, 'INVALID_TRANSITION', 'Issue the scoped instrument before checkout.');
      }
      task.state = 'executing';
      task.updatedAt = this.clock().toISOString();
      appendAudit(data, task.id, this.clock, 'checkout.started', 'info', 'Mock merchant checkout started once.', {
        merchantDomain: task.instrument.scope.merchantDomain,
        amount: money(task.instrument.scope.amountMinor, task.instrument.scope.currency)
      });
      const scope = task.instrument.scope;
      let result;
      try {
        result = this.checkoutAdapter.execute({ taskId, scenario: task.scenario, scope });
        validateCheckoutResult(result, scope);
      } catch (error) {
        task.state = 'failed';
        task.failure = { stage: 'checkout', code: error?.code || 'CHECKOUT_ADAPTER_FAILED', message: error?.message || 'The checkout adapter failed before returning a result.' };
        task.outcome = { status: 'declined', label: 'Checkout adapter failed', mode: 'mock', reason: task.failure.message };
        task.instrument.status = 'retired';
        task.instrument.retiredAt = this.clock().toISOString();
        task.updatedAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'checkout.failed', 'error', 'Checkout did not produce a definitive result within the locked contract; no retry was attempted.', {
          code: task.failure.code,
          retry: 'not attempted'
        });
        return { statusCode: 502, body: { error: task.failure, task: publicTask(task) } };
      }
      task.checkout = {
        mode: result.mode,
        status: result.status,
        merchantDomain: result.merchantDomain,
        amountMinor: result.amountMinor,
        currency: result.currency,
        attemptedAt: result.attemptedAt,
        checkoutReference: result.checkoutReference,
        authorizationReference: result.authorizationReference || null,
        captureReference: result.captureReference || null,
        reason: result.reason || result.message || null
      };
      task.updatedAt = this.clock().toISOString();

      if (result.status === 'authorized') {
        task.state = 'authorized';
        task.outcome = {
          status: 'confirmed',
          label: 'Authorized and captured',
          mode: result.mode,
          authorizationReference: result.authorizationReference,
          captureReference: result.captureReference,
          settledAmountMinor: result.amountMinor,
          currency: result.currency,
          completedAt: result.capturedAt
        };
        task.receipt = createReceipt(task, result.capturedAt);
        task.instrument.status = 'retired';
        task.instrument.retiredAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'checkout.authorized', 'success', 'Merchant authorization received and captured.', {
          mode: result.mode,
          checkoutReference: result.checkoutReference,
          authorizationReference: result.authorizationReference,
          captureReference: result.captureReference
        });
        task.state = 'completed';
        appendAudit(data, task.id, this.clock, 'task.completed', 'success', 'Purchase completed; one-use authority retired.', {
          outcome: 'confirmed',
          instrumentStatus: 'retired'
        });
      } else if (result.status === 'unknown') {
        task.state = 'reconciliation_required';
        task.instrument.status = 'pending_reconciliation';
        task.outcome = {
          status: 'unknown',
          label: 'Unknown - reconcile before any retry',
          mode: result.mode,
          message: result.message,
          checkoutReference: result.checkoutReference,
          nextAction: 'Reconcile the provider result. NaviPay will not replay this checkout automatically.'
        };
        appendAudit(data, task.id, this.clock, 'checkout.unknown', 'warning', 'Checkout returned no definitive result. Automatic retry is blocked.', {
          checkoutReference: result.checkoutReference,
          nextAction: 'reconciliation_required'
        });
      } else {
        task.state = 'failed';
        task.failure = { stage: 'checkout', code: 'CHECKOUT_DECLINED', message: result.reason };
        task.outcome = { status: 'declined', label: 'Declined', mode: result.mode, checkoutReference: result.checkoutReference, reason: result.reason };
        task.instrument.status = 'retired';
        task.instrument.retiredAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'checkout.declined', 'error', 'Merchant declined the checkout; no retry was attempted.', {
          checkoutReference: result.checkoutReference,
          reason: result.reason
        });
      }
      return { statusCode: 200, body: taskResponse(task) };
    });
  }

  reconcileCheckout(taskId, idempotencyKey, resolution) {
    return this._action(taskId, 'reconcile-checkout', idempotencyKey, (task, data) => {
      if (task.state !== 'reconciliation_required' || task.outcome?.status !== 'unknown') {
        throw new DomainError(409, 'RECONCILIATION_NOT_REQUIRED', 'This task has no unknown checkout awaiting reconciliation.');
      }
      if (!['authorized', 'declined'].includes(resolution)) {
        throw new DomainError(422, 'INVALID_RECONCILIATION', 'Resolution must be authorized or declined.');
      }
      if (resolution === 'authorized') {
        task.state = 'completed';
        task.outcome = {
          ...task.outcome,
          status: 'confirmed',
          label: 'Reconciled as authorized',
          nextAction: 'none',
          reconciledAt: this.clock().toISOString()
        };
        task.receipt = createReceipt(task, task.outcome.reconciledAt);
        task.instrument.status = 'retired';
        task.instrument.retiredAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'checkout.reconciled', 'success', 'Operator reconciled the unknown result as authorized.', {
          checkoutReference: task.checkout.checkoutReference,
          retry: 'not attempted',
          instrumentStatus: 'retired'
        });
      } else {
        task.state = 'failed';
        task.failure = { stage: 'checkout', code: 'RECONCILED_DECLINED', message: 'Operator reconciled the unknown result as declined.' };
        task.outcome = { ...task.outcome, status: 'declined', label: 'Reconciled as declined', nextAction: 'none', reconciledAt: this.clock().toISOString() };
        task.instrument.status = 'retired';
        task.instrument.retiredAt = this.clock().toISOString();
        appendAudit(data, task.id, this.clock, 'checkout.reconciled', 'error', 'Operator reconciled the unknown result as declined.', {
          checkoutReference: task.checkout.checkoutReference,
          retry: 'not attempted'
        });
      }
      task.automation = {
        ...task.automation,
        status: task.state === 'completed' ? 'completed' : 'stopped',
        automatic: task.automation?.automatic || false,
        completedAt: this.clock().toISOString(),
        nextAction: 'none'
      };
      task.updatedAt = this.clock().toISOString();
      return { statusCode: 200, body: taskResponse(task) };
    }, resolution || '');
  }
}

module.exports = {
  CURRENCY,
  TASK_CEILING_MINOR,
  SCENARIOS,
  DomainError,
  NaviPayService,
  money,
  publicTask
};
