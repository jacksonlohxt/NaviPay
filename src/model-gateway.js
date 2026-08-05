const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  AGENT_CONTRACT_VERSION,
  MODES,
  TOOL_NAMES,
  clone,
  contentHash,
  parseModelProposal,
  parseProvenance,
  parseSafePersonalContext,
  parseStructuredIntent,
  safeReference
} = require('./agent-contract');

class ModelGatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelGatewayError';
    this.code = code;
    this.statusCode = 422;
  }
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function readBundle(bundlePath = path.join(__dirname, '..', 'fixtures', 'agent-replay-v1.json')) {
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  } catch (error) {
    throw new ModelGatewayError('REPLAY_BUNDLE_UNAVAILABLE', `The recorded replay bundle could not be read: ${error.message}`);
  }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new ModelGatewayError('REPLAY_BUNDLE_INVALID', 'The recorded replay bundle must be an object.');
  const allowed = ['bundleVersion', 'schemaVersion', 'bundleId', 'model', 'promptTemplateVersion', 'responses', 'signature'];
  for (const key of Object.keys(bundle)) if (!allowed.includes(key)) throw new ModelGatewayError('REPLAY_BUNDLE_UNKNOWN_FIELD', `The recorded replay bundle contains unsupported field ${key}.`);
  if (bundle.schemaVersion !== AGENT_CONTRACT_VERSION || bundle.bundleVersion !== 'agent-replay-v1' || bundle.promptTemplateVersion !== 'prompt-v1') throw new ModelGatewayError('REPLAY_BUNDLE_VERSION_UNSUPPORTED', 'The recorded replay bundle version is not supported.');
  if (typeof bundle.signature !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(bundle.signature)) throw new ModelGatewayError('REPLAY_BUNDLE_UNSIGNED', 'The recorded replay bundle must carry a SHA-256 signature.');
  const unsigned = { ...bundle };
  delete unsigned.signature;
  const expected = `sha256:${crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')}`;
  if (bundle.signature !== expected) throw new ModelGatewayError('REPLAY_BUNDLE_SIGNATURE_INVALID', 'The recorded replay bundle signature does not match its contents.');
  if (!Array.isArray(bundle.responses) || bundle.responses.length < 1 || bundle.responses.length > 10) throw new ModelGatewayError('REPLAY_BUNDLE_INVALID', 'The recorded replay bundle must contain a bounded response list.');
  return bundle;
}

function providerProvenance(mode, bundle) {
  if (mode === 'recorded_replay') {
    return parseProvenance({
      mode,
      label: 'recorded replay',
      provider: { kind: 'checked_in_fixture', id: 'navipay-recorded-model-replay' },
      model: bundle.model,
      bundleVersion: bundle.bundleVersion,
      responseVersion: 'response-v1',
      promptTemplateVersion: bundle.promptTemplateVersion,
      schemaVersion: bundle.schemaVersion,
      signature: bundle.signature,
      source: 'checked-in signed response bundle',
      network: false
    });
  }
  return parseProvenance({
    mode,
    label: 'deterministic fallback',
    provider: { kind: 'local_policy', id: 'navipay-deterministic-policy' },
    model: 'none',
    bundleVersion: 'none',
    responseVersion: 'deterministic-v1',
    promptTemplateVersion: 'none',
    schemaVersion: AGENT_CONTRACT_VERSION,
    signature: `sha256:${contentHash('navipay-deterministic-policy-v1')}`,
    source: 'server deterministic fallback',
    network: false
  });
}

function typedTools(intent) {
  const requested = intent?.productCategory || 'catalog';
  return [
    { version: 1, id: 'proposal-discovery', name: 'catalog.search', kind: 'observation', stage: 'discovery', input: { category: requested }, reason: 'Find bounded candidates in the seeded local catalog.' },
    { version: 1, id: 'proposal-quote', name: 'quote.lock', kind: 'decision', stage: 'discovery', input: { currency: 'XSGD', quantity: 1 }, reason: 'Lock the authoritative quote only after server matching.' },
    { version: 1, id: 'proposal-inventory', name: 'inventory.reserve', kind: 'side_effect', stage: 'discovery', input: { quantity: 1 }, reason: 'Request a bounded inventory lease only after quote lock and policy checks.' },
    { version: 1, id: 'proposal-funding', name: 'funding.observe_local_mock', kind: 'observation', stage: 'funding', input: { providerMode: 'local_mock' }, reason: 'Show local mock funding evidence without claiming a live deposit.' },
    { version: 1, id: 'proposal-issuance', name: 'issuance.issue_scoped_instrument', kind: 'side_effect', stage: 'issuance', input: { maxCaptures: 1, currency: 'XSGD' }, reason: 'Request issuance only after server policy approval.' },
    { version: 1, id: 'proposal-execution', name: 'execution.run_local_checkout', kind: 'side_effect', stage: 'execution', input: { mode: 'local_simulation' }, reason: 'Use the local checkout simulation and disclose that it is not browser checkout.' }
  ];
}

function normalizeProposal({ runId, intent, template, confidence }) {
  const safeIntent = parseStructuredIntent({
    version: AGENT_CONTRACT_VERSION,
    purpose: 'one_purchase',
    product: intent?.product || null,
    productCategory: intent?.productCategory || null,
    brand: intent?.brand || null,
    quantity: Number.isSafeInteger(intent?.quantity) && intent.quantity >= 1 && intent.quantity <= 20 ? intent.quantity : 1,
    currency: intent?.currency || 'XSGD',
    budgetMinor: intent?.budgetMinor ?? null,
    keywords: Array.isArray(intent?.keywords) ? intent.keywords.slice(0, 12) : []
  });
  const tools = template?.toolProposals || typedTools(safeIntent);
  const proposal = {
    version: AGENT_CONTRACT_VERSION,
    proposalId: stableId('proposal', runId),
    proposalType: 'agent_plan',
    intent: safeIntent,
    toolProposals: tools,
    rationale: template?.rationale || 'The proposal is advisory. The server policy engine remains the only authority for side effects.',
    confidence
  };
  return parseModelProposal(proposal);
}

class ModelGateway {
  constructor(mode) {
    if (!MODES.includes(mode)) throw new ModelGatewayError('MODEL_MODE_UNSUPPORTED', `Unsupported model mode: ${mode}.`);
    this.mode = mode;
  }

  getProvenance() {
    throw new Error('ModelGateway.getProvenance must be implemented.');
  }

  propose() {
    throw new Error('ModelGateway.propose must be implemented.');
  }
}

class RecordedReplayGateway extends ModelGateway {
  constructor({ bundlePath } = {}) {
    super('recorded_replay');
    this.bundle = readBundle(bundlePath);
    this.calls = 0;
  }

  getProvenance() {
    return providerProvenance(this.mode, this.bundle);
  }

  propose({ runId, intent, context } = {}) {
    this.calls += 1;
    parseSafePersonalContext(context);
    const response = this.bundle.responses.find((item) => item.category === intent?.productCategory && (!item.brand || item.brand === intent?.brand)) || this.bundle.responses.find((item) => item.category === 'default');
    if (!response) throw new ModelGatewayError('REPLAY_RESPONSE_NOT_FOUND', 'The recorded replay bundle has no response for this bounded intent.');
    return {
      proposal: normalizeProposal({ runId, intent, template: response, confidence: 'recorded' }),
      provenance: this.getProvenance(),
      prompt: { schemaVersion: AGENT_CONTRACT_VERSION, templateVersion: this.bundle.promptTemplateVersion, inputHash: contentHash(JSON.stringify({ intent, context })) }
    };
  }
}

class DeterministicFallbackGateway extends ModelGateway {
  constructor() {
    super('deterministic_fallback');
    this.calls = 0;
  }

  getProvenance() {
    return providerProvenance(this.mode);
  }

  propose({ runId, intent, context } = {}) {
    this.calls += 1;
    parseSafePersonalContext(context);
    return {
      proposal: normalizeProposal({ runId, intent, confidence: 'deterministic' }),
      provenance: this.getProvenance(),
      prompt: { schemaVersion: AGENT_CONTRACT_VERSION, templateVersion: 'none', inputHash: contentHash(JSON.stringify({ intent, context })) }
    };
  }
}

function createModelGateway(mode = process.env.NAVIPAY_AGENT_MODE || 'recorded_replay', options = {}) {
  if (mode === 'recorded_replay') return new RecordedReplayGateway(options);
  if (mode === 'deterministic_fallback') return new DeterministicFallbackGateway(options);
  throw new ModelGatewayError('MODEL_MODE_UNSUPPORTED', 'Only recorded_replay and deterministic_fallback are enabled in P0.');
}

module.exports = {
  ModelGateway,
  ModelGatewayError,
  RecordedReplayGateway,
  DeterministicFallbackGateway,
  createModelGateway,
  readBundle,
  providerProvenance,
  typedTools,
  safeReference
};
