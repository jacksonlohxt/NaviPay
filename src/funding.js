const crypto = require('node:crypto');

const FUNDING_ASSET = 'XSGD';
const FUNDING_NETWORK = 'Avalanche Fuji';
const FUNDING_PROVIDER_ID = 'local-mock-xsgd-avalanche';
const FUNDING_STATES = Object.freeze(['pending', 'confirmed', 'failed', 'expired', 'reversed']);
const FUNDING_ACTIONS = Object.freeze(['confirm', 'fail', 'expire', 'reverse']);
const FUNDING_MAX_MINOR = 100000000;

class FundingProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FundingProviderError';
    this.code = code;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function normalizeAmountMinor({ amount, amountMinor } = {}) {
  if (amount !== undefined && amountMinor !== undefined) {
    const parsedAmount = normalizeAmountMinor({ amount });
    const parsedMinor = normalizeAmountMinor({ amountMinor });
    if (parsedAmount !== parsedMinor) throw new FundingProviderError('MALFORMED_AMOUNT', 'Provide either amount or amountMinor, not conflicting values.');
    return parsedAmount;
  }
  if (amountMinor !== undefined) {
    const value = typeof amountMinor === 'number' ? amountMinor : typeof amountMinor === 'string' && /^\d+$/.test(amountMinor) ? Number(amountMinor) : NaN;
    if (!Number.isSafeInteger(value) || value < 1 || value > FUNDING_MAX_MINOR) {
      throw new FundingProviderError('MALFORMED_AMOUNT', 'Funding amountMinor must be a positive integer within the local funding limit.');
    }
    return value;
  }
  if (typeof amount !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount.trim())) {
    throw new FundingProviderError('MALFORMED_AMOUNT', 'Funding amount must be a positive XSGD decimal with at most two decimal places.');
  }
  const [whole, fraction = ''] = amount.trim().split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value) || value < 1 || value > FUNDING_MAX_MINOR) {
    throw new FundingProviderError('MALFORMED_AMOUNT', 'Funding amount must be positive and within the local funding limit.');
  }
  return value;
}

function formatAmount(amountMinor) {
  return `${FUNDING_ASSET} ${(amountMinor / 100).toFixed(2)}`;
}

function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase();
  const aliases = { confirmed: 'confirm', failed: 'fail', expired: 'expire', reversed: 'reverse' };
  return aliases[action] || action;
}

/**
 * Provider-neutral XSGD funding contract.
 *
 * Implementations must normalize provider-specific payloads at this boundary.
 * They must never return credentials, raw webhook payloads, custody material,
 * or unredacted provider secrets to the service or browser projection.
 */
class FundingProviderContract {
  createFundingIntent() {
    throw new Error('Funding providers must implement createFundingIntent().');
  }

  getFundingStatus() {
    throw new Error('Funding providers must implement getFundingStatus().');
  }

  receiveProviderEvent() {
    throw new Error('Funding providers must implement receiveProviderEvent().');
  }

  reconcileReference() {
    throw new Error('Funding providers must implement reconcileReference().');
  }
}

/**
 * Credential-free local provider for judging and development.
 *
 * This provider creates mock:// instructions and only simulates provider
 * outcomes. It does not create blockchain transactions, call a network, or
 * represent a live Avalanche or XSGD integration.
 */
class LocalMockXsgdFundingProvider extends FundingProviderContract {
  constructor({ clock = () => new Date() } = {}) {
    super();
    this.clock = clock;
    this.calls = { create: 0, status: 0, event: 0, reconcile: 0 };
    this.providerId = FUNDING_PROVIDER_ID;
  }

  _validateAssetNetwork({ asset, network }) {
    if (asset !== FUNDING_ASSET) throw new FundingProviderError('WRONG_FUNDING_ASSET', `The local funding provider accepts ${FUNDING_ASSET} only.`);
    if (network !== FUNDING_NETWORK) throw new FundingProviderError('WRONG_FUNDING_NETWORK', `The local funding provider accepts ${FUNDING_NETWORK} only.`);
  }

  createFundingIntent({ intentId, amountMinor, asset = FUNDING_ASSET, network = FUNDING_NETWORK, expiresAt } = {}) {
    this.calls.create += 1;
    this._validateAssetNetwork({ asset, network });
    if (!intentId || !Number.isSafeInteger(amountMinor) || amountMinor < 1 || !expiresAt) {
      throw new FundingProviderError('INVALID_FUNDING_INTENT', 'The local provider could not create a valid funding intent.');
    }
    const providerReference = stableReference('MOCK-XSGD', `${intentId}:${amountMinor}:${asset}:${network}`);
    const instructionId = stableReference('MOCK-DEPOSIT', providerReference);
    return {
      providerId: this.providerId,
      providerMode: 'local_mock',
      providerReference,
      status: 'pending',
      asset,
      network,
      amountMinor,
      expiresAt,
      depositInstructions: {
        mode: 'local_mock',
        destination: `mock://avalanche-fuji/xsgd/${instructionId}`,
        memo: `NAVIPAY-${instructionId.slice(-12)}`,
        amountMinor,
        asset,
        network,
        expiresAt,
        disclosure: 'Local mock deposit instructions only. This destination is not a wallet or blockchain address.'
      }
    };
  }

  getFundingStatus({ intent } = {}) {
    this.calls.status += 1;
    if (!intent) throw new FundingProviderError('FUNDING_INTENT_NOT_FOUND', 'The local provider could not find that funding intent.');
    this._validateAssetNetwork(intent);
    return {
      providerId: this.providerId,
      providerMode: 'local_mock',
      providerReference: intent.providerReference,
      status: intent.status,
      asset: intent.asset,
      network: intent.network,
      amountMinor: intent.amountMinor,
      confirmationEvidence: clone(intent.confirmationEvidence || null),
      failureReason: intent.failureReason || null,
      updatedAt: intent.updatedAt || null
    };
  }

  receiveProviderEvent({ intent, eventId, providerReference, action, status, asset = FUNDING_ASSET, network = FUNDING_NETWORK, amountMinor, reason = null, confirmationEvidence = null } = {}) {
    this.calls.event += 1;
    if (!intent) throw new FundingProviderError('FUNDING_INTENT_NOT_FOUND', 'The local provider could not find that funding intent.');
    this._validateAssetNetwork({ asset, network });
    if (providerReference !== intent.providerReference) throw new FundingProviderError('PROVIDER_REFERENCE_MISMATCH', 'The provider reference does not match this funding intent.');
    if (amountMinor !== undefined && amountMinor !== intent.amountMinor) throw new FundingProviderError('FUNDING_AMOUNT_MISMATCH', 'The provider event amount does not match the funding intent.');
    if (!eventId || typeof eventId !== 'string' || eventId.length > 200) throw new FundingProviderError('INVALID_PROVIDER_EVENT', 'A provider event must include a bounded event ID.');
    const normalizedAction = normalizeAction(action || status);
    if (!FUNDING_ACTIONS.includes(normalizedAction)) throw new FundingProviderError('INVALID_PROVIDER_EVENT', 'Provider event action must be confirm, fail, expire, or reverse.');
    const nextStatus = { confirm: 'confirmed', fail: 'failed', expire: 'expired', reverse: 'reversed' }[normalizedAction];
    const evidence = confirmationEvidence ? {
      type: confirmationEvidence.type || 'provider_confirmation',
      providerReference: intent.providerReference,
      network,
      asset,
      amountMinor: intent.amountMinor,
      transactionReference: confirmationEvidence.transactionReference || null,
      confirmationCount: confirmationEvidence.confirmationCount ?? null,
      observedAt: confirmationEvidence.observedAt || this.clock().toISOString(),
      note: confirmationEvidence.note || 'Provider evidence normalized by NaviPay.'
    } : normalizedAction === 'confirm' ? {
      type: 'provider_confirmation',
      providerReference: intent.providerReference,
      network,
      asset,
      amountMinor: intent.amountMinor,
      transactionReference: null,
      confirmationCount: null,
      observedAt: this.clock().toISOString(),
      note: 'Provider confirmation evidence was not supplied.'
    } : null;
    return {
      eventId,
      providerId: this.providerId,
      providerReference: intent.providerReference,
      action: normalizedAction,
      status: nextStatus,
      asset,
      network,
      amountMinor: intent.amountMinor,
      reason: typeof reason === 'string' ? reason.slice(0, 240) : null,
      confirmationEvidence: evidence,
      receivedAt: this.clock().toISOString()
    };
  }

  reconcileReference({ intent, providerReference } = {}) {
    this.calls.reconcile += 1;
    if (!intent || intent.providerReference !== providerReference) throw new FundingProviderError('PROVIDER_REFERENCE_NOT_FOUND', 'The provider reference could not be reconciled by the local provider.');
    return this.getFundingStatus({ intent });
  }

  simulate({ intent, action } = {}) {
    const normalizedAction = normalizeAction(action);
    if (!FUNDING_ACTIONS.includes(normalizedAction)) throw new FundingProviderError('INVALID_SIMULATION_ACTION', 'Local simulation action must be confirm, fail, expire, or reverse.');
    const eventId = stableReference('MOCK-EVENT', `${intent.id}:${normalizedAction}`);
    const evidence = normalizedAction === 'confirm' ? {
      type: 'mock_confirmation',
      transactionReference: stableReference('MOCK-TX', intent.providerReference),
      confirmationCount: 3,
      observedAt: this.clock().toISOString(),
      note: 'Deterministic local simulation only - not an on-chain transaction or live provider confirmation.'
    } : normalizedAction === 'reverse' ? {
      type: 'mock_reversal',
      transactionReference: stableReference('MOCK-REVERSAL', intent.providerReference),
      confirmationCount: 0,
      observedAt: this.clock().toISOString(),
      note: 'Deterministic local reversal simulation only - no blockchain transaction was created.'
    } : null;
    return this.receiveProviderEvent({
      intent,
      eventId,
      providerReference: intent.providerReference,
      action: normalizedAction,
      asset: intent.asset,
      network: intent.network,
      amountMinor: intent.amountMinor,
      reason: normalizedAction === 'fail' ? 'Local mock provider simulated a funding failure.' : normalizedAction === 'expire' ? 'Local mock deposit intent expired before confirmation.' : null,
      confirmationEvidence: evidence
    });
  }
}

module.exports = {
  FUNDING_ACTIONS,
  FUNDING_ASSET,
  FUNDING_MAX_MINOR,
  FUNDING_NETWORK,
  FUNDING_PROVIDER_ID,
  FUNDING_STATES,
  FundingProviderContract,
  FundingProviderError,
  LocalMockXsgdFundingProvider,
  formatAmount,
  normalizeAction,
  normalizeAmountMinor,
  stableReference
};
