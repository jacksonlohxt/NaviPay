const crypto = require('node:crypto');
const { AdapterError } = require('./adapters');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function timestamp(clock) {
  return clock().toISOString();
}

function safeScope(scope) {
  return {
    merchantId: scope.merchantId,
    merchant: scope.merchant,
    merchantDomain: scope.merchantDomain,
    amountMinor: scope.amountMinor,
    currency: scope.currency,
    mcc: scope.mcc || '5732',
    expiresAt: scope.expiresAt || scope.quoteExpiresAt,
    maxCaptures: 1,
    reusable: false
  };
}

/**
 * A persisted issuer lifecycle for the local competition proof.
 *
 * The issuerCards records contain capability metadata only. The disposable
 * PAN-like and CVV-like values live in this process' capability map and are
 * available only through withCredential(). They are intentionally never
 * returned, persisted, logged, or passed to the task projection.
 */
class LocalFakeIssuerAdapter {
  constructor({ store, clock = () => new Date(), walletAdapter = null, timeoutMs = 5000 } = {}) {
    if (!store) throw new Error('A store is required for the local issuer.');
    this.store = store;
    this.clock = clock;
    this.walletAdapter = walletAdapter;
    this.timeoutMs = timeoutMs;
    this.calls = { issue: 0, status: 0, authorize: 0, capture: 0, reconcile: 0, retire: 0, revoke: 0, refund: 0 };
    this.capabilities = new Map();
  }

  _record(cardId) {
    return this.store.data.issuerCards[cardId] || null;
  }

  _freshStatus(card) {
    if (!card) return null;
    if (card.status === 'active' && Date.parse(card.scope.expiresAt) <= this.clock().getTime()) {
      this.store.transaction((data) => {
        const current = data.issuerCards[card.cardId];
        if (current && current.status === 'active') {
          current.status = 'expired';
          current.expiredAt = timestamp(this.clock);
        }
      });
      return this._record(card.cardId);
    }
    return card;
  }

  _requireCard(cardId) {
    const card = this._freshStatus(this._record(cardId));
    if (!card) throw new AdapterError('CARD_NOT_FOUND', 'The disposable card does not exist.');
    return card;
  }

  issue({ operationId = null, taskId, scope, scenario = 'happy' } = {}) {
    this.calls.issue += 1;
    if (scenario === 'issuer-failure') throw new AdapterError('ISSUER_UNAVAILABLE', 'The simulated issuer rejected the issuance request.');
    const opId = operationId || `issuer:${taskId}:issue`;
    return this.store.transaction((data) => {
      const previous = Object.values(data.issuerCards).find((card) => card.issueOperationId === opId);
      if (previous) {
        if (!this.capabilities.has(previous.cardId) && previous.status === 'active') {
          this.capabilities.set(previous.cardId, { cardId: previous.cardId, pan: `411111${crypto.randomBytes(7).toString('hex').slice(0, 10)}`, cvv: crypto.randomInt(100, 1000).toString().padStart(3, '0') });
        }
        return clone(previous);
      }
      const cardId = stableReference('CARD', opId);
      const reference = stableReference('CARD-REF', taskId);
      const issuedAt = timestamp(this.clock);
      const card = {
        cardId,
        taskId,
        issueOperationId: opId,
        status: 'active',
        reference,
        lastFour: reference.slice(-4),
        issuedAt,
        retiredAt: null,
        revokedAt: null,
        expiredAt: null,
        captureCount: 0,
        scope: safeScope(scope)
      };
      data.issuerCards[cardId] = card;
      this.capabilities.set(cardId, {
        cardId,
        pan: `411111${crypto.randomBytes(7).toString('hex').slice(0, 10)}`,
        cvv: crypto.randomInt(100, 1000).toString().padStart(3, '0')
      });
      data.operations[opId] = {
        ...(data.operations[opId] || {}),
        id: opId,
        taskId,
        stage: 'card_issuing',
        status: 'completed',
        reference,
        completedAt: issuedAt,
        result: { status: 'active', reference, cardId, scope: card.scope }
      };
      return clone(card);
    });
  }

  status(cardIdOrReference) {
    this.calls.status += 1;
    const card = Object.values(this.store.data.issuerCards).find((item) => item.cardId === cardIdOrReference || item.reference === cardIdOrReference);
    return clone(this._freshStatus(card));
  }

  withCredential(cardId, callback) {
    const card = this._requireCard(cardId);
    const capability = this.capabilities.get(card.cardId);
    if (!capability) throw new AdapterError('CARD_CAPABILITY_UNAVAILABLE', 'The isolated disposable card capability is no longer available.');
    return callback({ ...capability, scope: clone(card.scope) });
  }

  authorize({ operationId, taskId, cardId, merchantId, merchantDomain, amountMinor, currency, mcc, scenario = 'happy' } = {}) {
    this.calls.authorize += 1;
    const card = this._requireCard(cardId);
    const opId = operationId || `issuer:${taskId}:authorize`;
    const existing = this.store.data.issuerAuthorizations[opId];
    if (existing) return clone(existing);
    const scope = card.scope;
    let status = 'authorized';
    let code = null;
    if (scenario === 'expired-card' || card.status === 'expired') {
      status = 'declined';
      code = 'CARD_EXPIRED';
    } else if (['retired', 'revoked'].includes(card.status)) {
      status = 'declined';
      code = `CARD_${card.status.toUpperCase()}`;
    } else if (merchantId !== scope.merchantId || merchantDomain !== scope.merchantDomain) {
      status = 'declined';
      code = 'WRONG_MERCHANT';
    } else if (currency !== scope.currency) {
      status = 'declined';
      code = 'CURRENCY_MISMATCH';
    } else if (amountMinor !== scope.amountMinor || amountMinor > scope.amountMinor || scenario === 'amount-overage' || scenario === 'overage') {
      status = 'declined';
      code = 'AMOUNT_EXCEEDS_SCOPE';
    } else if (mcc !== scope.mcc) {
      status = 'declined';
      code = 'MCC_MISMATCH';
    } else if (card.captureCount >= scope.maxCaptures) {
      status = 'declined';
      code = 'CAPTURE_LIMIT_REACHED';
    }
    const authorization = {
      operationId: opId,
      taskId,
      cardId: card.cardId,
      status,
      code,
      authorizationReference: stableReference('AUTH', opId),
      merchantId,
      merchantDomain,
      amountMinor,
      currency,
      mcc: mcc || scope.mcc,
      authorizedAt: timestamp(this.clock),
      expiresAt: scope.expiresAt
    };
    return this.store.transaction((data) => {
      data.issuerAuthorizations[opId] = authorization;
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId, stage: 'card_authorize', status, code, reference: authorization.authorizationReference, completedAt: authorization.authorizedAt, result: clone(authorization) };
      return clone(authorization);
    });
  }

  capture({ operationId, taskId, authorizationReference, cardId, walletId, merchantId, amountMinor, currency, scenario = 'happy' } = {}) {
    this.calls.capture += 1;
    const opId = operationId || `issuer:${taskId}:capture`;
    const existing = this.store.data.issuerCaptures[opId];
    if (existing) return clone(existing);
    const card = this._requireCard(cardId);
    if (card.captureCount >= card.scope.maxCaptures || card.status !== 'active') throw new AdapterError('CAPTURE_LIMIT_REACHED', 'The disposable card allows one capture only.');
    const authorization = Object.values(this.store.data.issuerAuthorizations).find((item) => item.authorizationReference === authorizationReference);
    if (!authorization || authorization.cardId !== card.cardId || authorization.status !== 'authorized') throw new AdapterError('AUTHORIZATION_NOT_FOUND', 'The issuer authorization is not available for capture.');
    if (merchantId !== card.scope.merchantId || amountMinor !== card.scope.amountMinor || currency !== card.scope.currency) throw new AdapterError('CAPTURE_SCOPE_MISMATCH', 'The issuer capture did not match the one-use card scope.');
    if (!this.walletAdapter) throw new AdapterError('ISSUER_FUNDING_UNAVAILABLE', 'The fake issuer has no fake-wallet funding boundary.');
    const payment = this.walletAdapter.captureForIssuer({ operationId: `op_${taskId}_payment`, taskId, walletId, merchantId, amountMinor, currency, scenario });
    const status = payment.status === 'authorized' ? 'captured' : payment.status;
    const capture = {
      operationId: opId,
      taskId,
      cardId: card.cardId,
      status,
      code: payment.code || null,
      authorizationReference,
      captureReference: stableReference('CAPTURE', opId),
      paymentReference: payment.reference,
      transactionReference: payment.transactionReference || null,
      amountMinor,
      currency,
      capturedAt: status === 'captured' ? timestamp(this.clock) : null,
      attemptedAt: timestamp(this.clock),
      message: payment.message || null,
      payment
    };
    return this.store.transaction((data) => {
      data.issuerCaptures[opId] = capture;
      const current = data.issuerCards[card.cardId];
      if (current) {
        if (status === 'captured') {
          current.captureCount += 1;
          current.status = 'captured';
        } else if (status === 'unknown') current.status = 'pending_reconciliation';
        else if (status === 'declined') current.status = 'retired';
      }
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId, stage: 'card_capture', status, code: capture.code, reference: capture.captureReference, completedAt: capture.capturedAt, updatedAt: timestamp(this.clock), result: clone({ ...capture, payment: undefined }) };
      return clone(capture);
    });
  }

  reconcile({ operationId, taskId, cardId, walletId, merchantId, amountMinor, currency, resolution } = {}) {
    this.calls.reconcile += 1;
    const opId = operationId || `issuer:${taskId}:capture`;
    const capture = this.store.data.issuerCaptures[opId];
    if (!capture) throw new AdapterError('CAPTURE_NOT_RECONCILABLE', 'No issuer capture is awaiting reconciliation.');
    if (capture.status !== 'unknown') return clone(capture);
    if (!['authorized', 'declined'].includes(resolution)) throw new AdapterError('INVALID_CAPTURE_RESOLUTION', 'Capture resolution must be authorized or declined.');
    const payment = this.walletAdapter.resolveUnknown({ operationId: `op_${taskId}_payment`, taskId, walletId, merchantId, amountMinor, currency, resolution });
    return this.store.transaction((data) => {
      const current = data.issuerCaptures[opId];
      current.status = payment.status === 'authorized' ? 'captured' : 'declined';
      current.code = payment.code || null;
      current.payment = payment;
      current.transactionReference = payment.transactionReference || null;
      current.reconciledAt = timestamp(this.clock);
      const card = data.issuerCards[current.cardId];
      if (card) {
        if (current.status === 'captured') { card.captureCount += 1; card.status = 'captured'; }
        else card.status = 'retired';
      }
      return clone(current);
    });
  }

  retire({ operationId, taskId, cardId, reason = 'completed' } = {}) {
    this.calls.retire += 1;
    const card = this._requireCard(cardId);
    const opId = operationId || `issuer:${taskId}:retire`;
    return this.store.transaction((data) => {
      const current = data.issuerCards[card.cardId];
      if (current.status === 'retired') return clone(current);
      current.status = 'retired';
      current.retiredAt = current.retiredAt || timestamp(this.clock);
      current.retireReason = reason;
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId: taskId || current.taskId, stage: 'card_retired', status: 'completed', reference: current.reference, completedAt: current.retiredAt, result: { status: 'retired', reference: current.reference } };
      this.capabilities.delete(current.cardId);
      return clone(current);
    });
  }

  revoke({ operationId, taskId, cardId, reason = 'operator' } = {}) {
    this.calls.revoke += 1;
    const card = this._requireCard(cardId);
    const opId = operationId || `issuer:${taskId}:revoke`;
    return this.store.transaction((data) => {
      const current = data.issuerCards[card.cardId];
      if (current.status === 'revoked') return clone(current);
      current.status = 'revoked';
      current.revokedAt = current.revokedAt || timestamp(this.clock);
      current.revokeReason = reason;
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId: taskId || current.taskId, stage: 'card_revoked', status: 'completed', reference: current.reference, completedAt: current.revokedAt, result: { status: 'revoked', reference: current.reference } };
      this.capabilities.delete(current.cardId);
      return clone(current);
    });
  }

  refund({ operationId, taskId, cardId, walletId, merchantId, amountMinor, currency, kind = 'refund' } = {}) {
    this.calls.refund += 1;
    const opId = operationId || `issuer:${taskId}:${kind}`;
    const existing = this.store.data.refunds[opId];
    if (existing) return clone(existing);
    const payment = this.walletAdapter.compensate({ operationId: `op_${taskId}_payment`, taskId, walletId, merchantId, amountMinor, currency });
    const result = { operationId: opId, taskId, cardId, kind, status: payment.status === 'compensated' ? kind === 'reversal' ? 'reversed' : 'refunded' : 'failed', reference: stableReference(kind === 'reversal' ? 'REVERSAL' : 'REFUND', opId), transactionReference: payment.transactionReference || null, amountMinor, currency, occurredAt: timestamp(this.clock) };
    return this.store.transaction((data) => {
      data.refunds[opId] = result;
      const card = data.issuerCards[cardId];
      if (card && ['active', 'captured', 'pending_reconciliation'].includes(card.status)) {
        card.status = 'retired';
        card.retiredAt = card.retiredAt || timestamp(this.clock);
      }
      return clone(result);
    });
  }
}

module.exports = { LocalFakeIssuerAdapter, LocalIssuerAdapter: LocalFakeIssuerAdapter };
