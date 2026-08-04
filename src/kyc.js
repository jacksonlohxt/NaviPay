const crypto = require('node:crypto');

const KYC_PROVIDER_ID = 'local-mock-kyc';
const KYC_STATES = Object.freeze(['approved', 'pending', 'rejected']);
const KYC_ACTIONS = Object.freeze(['approve', 'pending', 'reject']);
const KYC_REASON_CODES = Object.freeze(['simulated_approval', 'simulated_pending', 'simulated_rejection']);

class KycProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KycProviderError';
    this.code = code;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function normalizeReason(value, status) {
  const fallback = status === 'approved' ? 'simulated_approval' : status === 'rejected' ? 'simulated_rejection' : 'simulated_pending';
  const reasonCode = value === undefined || value === null ? fallback : String(value).trim();
  if (!KYC_REASON_CODES.includes(reasonCode)) throw new KycProviderError('INVALID_KYC_REASON', 'KYC decisions accept safe reason codes only.');
  return reasonCode;
}

function normalizeDecision(value) {
  const decision = String(value || '').trim().toLowerCase();
  const aliases = { approved: 'approve', rejected: 'reject' };
  return aliases[decision] || decision;
}

/**
 * Provider-neutral KYC boundary. Only normalized status and references cross
 * this seam. Identity documents, biometric data, and provider payloads never
 * belong in NaviPay state or browser projections.
 */
class KycProviderContract {
  getStatus() {
    throw new Error('KYC providers must implement getStatus().');
  }

  receiveDecision() {
    throw new Error('KYC providers must implement receiveDecision().');
  }

  reconcileReference() {
    throw new Error('KYC providers must implement reconcileReference().');
  }
}

/**
 * Credential-free local KYC gate for development and judging.
 * It is a deterministic decision simulator, not identity verification and not
 * a live KYC provider. It stores no identity documents.
 */
class LocalMockKycProvider extends KycProviderContract {
  constructor({ clock = () => new Date() } = {}) {
    super();
    this.clock = clock;
    this.providerId = KYC_PROVIDER_ID;
    this.providerMode = 'local_mock';
    this.calls = { status: 0, decision: 0, reconcile: 0 };
  }

  getStatus({ profile } = {}) {
    this.calls.status += 1;
    if (!profile) throw new KycProviderError('KYC_PROFILE_NOT_FOUND', 'The local KYC profile does not exist.');
    return {
      providerId: this.providerId,
      providerMode: this.providerMode,
      providerReference: profile.providerReference,
      status: profile.status,
      decisionReference: profile.decisionReference || null,
      decidedAt: profile.decidedAt || null,
      reasonCode: profile.reasonCode || null,
      updatedAt: profile.updatedAt || null
    };
  }

  receiveDecision({ profile, decisionId, action, status, reason = null, reasonCode = null } = {}) {
    this.calls.decision += 1;
    if (!profile) throw new KycProviderError('KYC_PROFILE_NOT_FOUND', 'The local KYC profile does not exist.');
    if (typeof decisionId !== 'string' || !decisionId.trim() || decisionId.length > 200) throw new KycProviderError('INVALID_KYC_DECISION', 'A KYC decision must include a bounded decision ID.');
    const normalizedAction = normalizeDecision(action || status);
    if (!KYC_ACTIONS.includes(normalizedAction)) throw new KycProviderError('INVALID_KYC_DECISION', 'KYC simulation decision must be approve, pending, or reject.');
    const nextStatus = { approve: 'approved', pending: 'pending', reject: 'rejected' }[normalizedAction];
    return {
      decisionId,
      providerId: this.providerId,
      providerMode: this.providerMode,
      providerReference: profile.providerReference,
      decisionReference: stableReference('MOCK-KYC-DECISION', `${profile.providerReference}:${decisionId}`),
      status: nextStatus,
      reasonCode: normalizeReason(reasonCode || reason, nextStatus),
      decidedAt: this.clock().toISOString(),
      disclosure: 'Local simulated KYC decision only - no identity documents were collected or verified.'
    };
  }

  reconcileReference({ profile, providerReference } = {}) {
    this.calls.reconcile += 1;
    if (!profile || profile.providerReference !== providerReference) throw new KycProviderError('KYC_REFERENCE_NOT_FOUND', 'The KYC provider reference could not be reconciled.');
    return this.getStatus({ profile });
  }
}

module.exports = {
  KYC_ACTIONS,
  KYC_REASON_CODES,
  KYC_PROVIDER_ID,
  KYC_STATES,
  KycProviderContract,
  KycProviderError,
  LocalMockKycProvider,
  normalizeDecision,
  stableReference
};
