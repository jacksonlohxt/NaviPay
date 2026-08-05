const crypto = require('node:crypto');

const AGENT_CONTRACT_VERSION = 1;
const CURRENCY = 'XSGD';
const MODES = Object.freeze(['recorded_replay', 'deterministic_fallback']);
const STAGES = Object.freeze(['funding', 'discovery', 'issuance', 'execution']);
const STAGE_STATUSES = Object.freeze(['not_started', 'running', 'completed', 'blocked', 'skipped', 'awaiting_input']);
const TOOL_KINDS = Object.freeze(['observation', 'decision', 'side_effect']);
const TOOL_NAMES = Object.freeze([
  'catalog.search',
  'quote.lock',
  'inventory.reserve',
  'funding.observe_local_mock',
  'issuance.issue_scoped_instrument',
  'execution.run_local_checkout',
  'payment.reconcile',
  'order.create',
  'receipt.issue'
]);
const EVENT_TYPES = Object.freeze([
  'run.created',
  'context.assembled',
  'model.proposed',
  'observation.recorded',
  'policy.decided',
  'stage.transitioned',
  'tool.proposed',
  'tool.resulted',
  'checkpoint.saved',
  'outcome.recorded'
]);
const UNSAFE_KEY = /(?:raw|payload|secret|password|passwd|credential|pan|cvv|private.?key|auth.?token|cookie|dom|html|page.?text|provider.?body|provider.?response|executable|script)/i;
const UNSAFE_STRING = /(?:javascript\s*:|<\/?script|\beval\s*\(|\b(?:require|import)\s*\(|\bprocess\.(?:env|exit)|child_process|(?:https?|ftp|data|file):\/\/)/i;

class AgentContractError extends Error {
  constructor(code, message, path = null) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
    this.statusCode = 422;
    this.path = path;
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function fail(code, message, path = null) {
  throw new AgentContractError(code, message, path);
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AGENT_SCHEMA_INVALID', `${name} must be an object.`, name);
  return value;
}

function only(value, keys, name) {
  object(value, name);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('AGENT_UNKNOWN_FIELD', `${name} contains unsupported field ${key}.`, `${name}.${key}`);
  }
}

function safeString(value, name, { max = 240, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || UNSAFE_STRING.test(value)) {
    fail('AGENT_UNSAFE_STRING', `${name} must be bounded plain text.`, name);
  }
  return value;
}

function safeEnum(value, values, name) {
  if (!values.includes(value)) fail('AGENT_INVALID_ENUM', `${name} must be one of ${values.join(', ')}.`, name);
  return value;
}

function minor(value, name, { allowNull = true, max = 10000000 } = {}) {
  if (value === null && allowNull) return value;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('AGENT_UNSAFE_AMOUNT', `${name} must be a bounded non-negative minor-unit integer.`, name);
  return value;
}

function quantity(value, name = 'quantity') {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) fail('AGENT_UNSAFE_QUANTITY', `${name} must be an integer between 1 and 20.`, name);
  return value;
}

function timestamp(value, name) {
  safeString(value, name, { max: 64 });
  if (!Number.isFinite(Date.parse(value))) fail('AGENT_INVALID_TIMESTAMP', `${name} must be an ISO timestamp.`, name);
  return value;
}

function hash(value, name) {
  safeString(value, name, { max: 128 });
  if (!/^[a-f0-9]{16,128}$/i.test(value)) fail('AGENT_INVALID_HASH', `${name} must be a hexadecimal content hash.`, name);
  return value;
}

function safeReference(value, name, { allowNull = true } = {}) {
  if (value === null && allowNull) return value;
  safeString(value, name, { max: 200 });
  if (/[:/?#]/.test(value)) fail('AGENT_UNSAFE_REFERENCE', `${name} must be an opaque local reference.`, name);
  return value;
}

function rejectUnsafeKeys(value, path = 'value', seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('AGENT_SCHEMA_INVALID', 'Cyclic values are not allowed.', path);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key) && !(key === 'credentials' && nested === false) && !['payload', 'payloadHash'].includes(key)) fail('AGENT_UNSAFE_FIELD', `${path}.${key} is not permitted.`, `${path}.${key}`);
    rejectUnsafeKeys(nested, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function parseStructuredIntent(value) {
  only(value, ['version', 'purpose', 'product', 'productCategory', 'brand', 'quantity', 'currency', 'budgetMinor', 'keywords'], 'structuredIntent');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'structuredIntent has an unsupported version.', 'structuredIntent.version');
  safeString(value.purpose, 'structuredIntent.purpose', { max: 40 });
  for (const field of ['product', 'productCategory', 'brand']) if (value[field] !== null) safeString(value[field], `structuredIntent.${field}`, { max: 100 });
  if (value.productCategory !== null && !['keyboards', 'mice', 'earphones', 'power banks'].includes(value.productCategory)) fail('AGENT_INVALID_ENUM', 'structuredIntent.productCategory is not supported.', 'structuredIntent.productCategory');
  quantity(value.quantity);
  if (value.currency !== CURRENCY) fail('AGENT_INVALID_ENUM', 'Only XSGD is supported.', 'structuredIntent.currency');
  minor(value.budgetMinor, 'structuredIntent.budgetMinor');
  if (!Array.isArray(value.keywords) || value.keywords.length > 12) fail('AGENT_SCHEMA_INVALID', 'structuredIntent.keywords must contain at most 12 entries.', 'structuredIntent.keywords');
  value.keywords.forEach((item, index) => safeString(item, `structuredIntent.keywords[${index}]`, { max: 40 }));
  rejectUnsafeKeys(value, 'structuredIntent');
  return clone(value);
}

function parseSafePersonalContext(value) {
  only(value, ['version', 'purpose', 'preferences', 'hardConstraints', 'spendCeilingMinor', 'currency', 'addressRef', 'profileRef'], 'safePersonalContext');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'safePersonalContext has an unsupported version.', 'safePersonalContext.version');
  safeString(value.purpose, 'safePersonalContext.purpose', { max: 40 });
  only(value.preferences, ['brands', 'categories', 'delivery'], 'safePersonalContext.preferences');
  if (!Array.isArray(value.preferences.brands) || value.preferences.brands.length > 8) fail('AGENT_SCHEMA_INVALID', 'preferences.brands must be a bounded list.', 'safePersonalContext.preferences.brands');
  if (!Array.isArray(value.preferences.categories) || value.preferences.categories.length > 8) fail('AGENT_SCHEMA_INVALID', 'preferences.categories must be a bounded list.', 'safePersonalContext.preferences.categories');
  value.preferences.brands.forEach((item, index) => safeString(item, `safePersonalContext.preferences.brands[${index}]`, { max: 40 }));
  value.preferences.categories.forEach((item, index) => safeString(item, `safePersonalContext.preferences.categories[${index}]`, { max: 40 }));
  safeString(value.preferences.delivery, 'safePersonalContext.preferences.delivery', { max: 40 });
  only(value.hardConstraints, ['brand', 'productCategory', 'merchantScope', 'quantity'], 'safePersonalContext.hardConstraints');
  if (value.hardConstraints.brand !== null) safeString(value.hardConstraints.brand, 'safePersonalContext.hardConstraints.brand', { max: 40 });
  if (value.hardConstraints.productCategory !== null) safeString(value.hardConstraints.productCategory, 'safePersonalContext.hardConstraints.productCategory', { max: 40 });
  if (!Array.isArray(value.hardConstraints.merchantScope) || value.hardConstraints.merchantScope.length > 12) fail('AGENT_SCHEMA_INVALID', 'hardConstraints.merchantScope must be bounded.', 'safePersonalContext.hardConstraints.merchantScope');
  value.hardConstraints.merchantScope.forEach((merchant, index) => {
    only(merchant, ['id', 'label'], `safePersonalContext.hardConstraints.merchantScope[${index}]`);
    safeReference(merchant.id, `safePersonalContext.hardConstraints.merchantScope[${index}].id`, { allowNull: false });
    safeString(merchant.label, `safePersonalContext.hardConstraints.merchantScope[${index}].label`, { max: 80 });
  });
  quantity(value.hardConstraints.quantity, 'safePersonalContext.hardConstraints.quantity');
  minor(value.spendCeilingMinor, 'safePersonalContext.spendCeilingMinor', { allowNull: false, max: 100000 });
  if (value.currency !== CURRENCY) fail('AGENT_INVALID_ENUM', 'Only XSGD is supported.', 'safePersonalContext.currency');
  safeReference(value.addressRef, 'safePersonalContext.addressRef', { allowNull: false });
  safeReference(value.profileRef, 'safePersonalContext.profileRef', { allowNull: false });
  rejectUnsafeKeys(value, 'safePersonalContext');
  return clone(value);
}

function parseToolProposal(value) {
  only(value, ['version', 'id', 'name', 'kind', 'stage', 'input', 'reason'], 'toolProposal');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'toolProposal has an unsupported version.', 'toolProposal.version');
  safeReference(value.id, 'toolProposal.id', { allowNull: false });
  safeEnum(value.name, TOOL_NAMES, 'toolProposal.name');
  safeEnum(value.kind, TOOL_KINDS, 'toolProposal.kind');
  safeEnum(value.stage, STAGES, 'toolProposal.stage');
  object(value.input, 'toolProposal.input');
  for (const [key, item] of Object.entries(value.input)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(key)) fail('AGENT_UNKNOWN_FIELD', 'toolProposal.input keys must be bounded names.', `toolProposal.input.${key}`);
    if (typeof item === 'string') safeString(item, `toolProposal.input.${key}`, { max: 120, allowEmpty: true });
    else if (typeof item !== 'number' && typeof item !== 'boolean' && item !== null) fail('AGENT_UNSAFE_FIELD', 'toolProposal.input accepts only scalar safe values.', `toolProposal.input.${key}`);
  }
  safeString(value.reason, 'toolProposal.reason', { max: 240 });
  if (value.kind !== 'observation' && ['inventory.reserve', 'issuance.issue_scoped_instrument', 'execution.run_local_checkout', 'order.create', 'receipt.issue'].includes(value.name)) {
    if (!['issuance', 'execution'].includes(value.stage) && value.name !== 'inventory.reserve') fail('AGENT_TOOL_STAGE_MISMATCH', 'A tool proposal is assigned to an invalid stage.', 'toolProposal.stage');
  }
  rejectUnsafeKeys(value, 'toolProposal');
  return clone(value);
}

function parseModelProposal(value) {
  only(value, ['version', 'proposalId', 'proposalType', 'intent', 'toolProposals', 'rationale', 'confidence'], 'modelProposal');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'modelProposal has an unsupported version.', 'modelProposal.version');
  safeReference(value.proposalId, 'modelProposal.proposalId', { allowNull: false });
  safeEnum(value.proposalType, ['agent_plan', 'structured_intent'], 'modelProposal.proposalType');
  parseStructuredIntent(value.intent);
  if (!Array.isArray(value.toolProposals) || value.toolProposals.length > TOOL_NAMES.length) fail('AGENT_SCHEMA_INVALID', 'modelProposal.toolProposals is not bounded.', 'modelProposal.toolProposals');
  value.toolProposals.forEach(parseToolProposal);
  safeString(value.rationale, 'modelProposal.rationale', { max: 240 });
  safeEnum(value.confidence, ['recorded', 'deterministic'], 'modelProposal.confidence');
  rejectUnsafeKeys(value, 'modelProposal');
  return clone(value);
}

function parseSafeObservation(value) {
  only(value, ['version', 'id', 'source', 'kind', 'trust', 'summary', 'contentHash', 'observedAt', 'promptInjectionDetected', 'ignored', 'facts'], 'safeObservation');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'safeObservation has an unsupported version.', 'safeObservation.version');
  safeReference(value.id, 'safeObservation.id', { allowNull: false });
  safeEnum(value.source, ['user_instruction', 'local_mock_provider', 'seeded_catalog', 'local_checkout_simulation', 'policy_engine'], 'safeObservation.source');
  safeEnum(value.kind, ['instruction', 'funding_evidence', 'candidate_summary', 'tool_result', 'safety_signal'], 'safeObservation.kind');
  safeEnum(value.trust, ['trusted', 'untrusted'], 'safeObservation.trust');
  safeString(value.summary, 'safeObservation.summary', { max: 240 });
  hash(value.contentHash, 'safeObservation.contentHash');
  timestamp(value.observedAt, 'safeObservation.observedAt');
  if (typeof value.promptInjectionDetected !== 'boolean' || typeof value.ignored !== 'boolean') fail('AGENT_SCHEMA_INVALID', 'safeObservation trust flags must be booleans.', 'safeObservation');
  if (value.trust === 'untrusted' && !value.ignored) fail('AGENT_UNTRUSTED_OBSERVATION', 'Untrusted observations must be ignored by policy.', 'safeObservation.ignored');
  object(value.facts, 'safeObservation.facts');
  for (const [key, fact] of Object.entries(value.facts)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(key)) fail('AGENT_UNKNOWN_FIELD', 'Observation fact keys must be bounded names.', `safeObservation.facts.${key}`);
    if (!(typeof fact === 'string' || typeof fact === 'number' || typeof fact === 'boolean' || fact === null)) fail('AGENT_UNSAFE_FIELD', 'Observation facts may only contain scalar safe values.', `safeObservation.facts.${key}`);
    if (typeof fact === 'string') safeString(fact, `safeObservation.facts.${key}`, { max: 120, allowEmpty: true });
  }
  rejectUnsafeKeys(value, 'safeObservation');
  return clone(value);
}

function parsePolicyDecision(value) {
  only(value, ['version', 'decisionId', 'status', 'authority', 'reasonCodes', 'reasons', 'checks', 'decidedAt'], 'policyDecision');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'policyDecision has an unsupported version.', 'policyDecision.version');
  safeReference(value.decisionId, 'policyDecision.decisionId', { allowNull: false });
  safeEnum(value.status, ['approved', 'denied', 'paused'], 'policyDecision.status');
  if (value.authority !== 'server_policy_engine') fail('AGENT_POLICY_AUTHORITY_REQUIRED', 'Only the server policy engine may authorise side effects.', 'policyDecision.authority');
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length > 20) fail('AGENT_SCHEMA_INVALID', 'policyDecision.reasonCodes must be bounded.', 'policyDecision.reasonCodes');
  value.reasonCodes.forEach((item, index) => safeString(item, `policyDecision.reasonCodes[${index}]`, { max: 60 }));
  if (!Array.isArray(value.reasons) || value.reasons.length > 20) fail('AGENT_SCHEMA_INVALID', 'policyDecision.reasons must be bounded.', 'policyDecision.reasons');
  value.reasons.forEach((item, index) => safeString(item, `policyDecision.reasons[${index}]`, { max: 240 }));
  object(value.checks, 'policyDecision.checks');
  for (const [key, check] of Object.entries(value.checks)) {
    only(check, ['status', 'reason'], `policyDecision.checks.${key}`);
    safeEnum(check.status, ['passed', 'failed', 'not_run'], `policyDecision.checks.${key}.status`);
    safeString(check.reason, `policyDecision.checks.${key}.reason`, { max: 240 });
  }
  timestamp(value.decidedAt, 'policyDecision.decidedAt');
  rejectUnsafeKeys(value, 'policyDecision');
  return clone(value);
}

function parseStageTransition(value) {
  only(value, ['version', 'transitionId', 'runId', 'stage', 'status', 'at', 'reason', 'evidenceRefs', 'internalSteps'], 'stageTransition');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'stageTransition has an unsupported version.', 'stageTransition.version');
  safeReference(value.transitionId, 'stageTransition.transitionId', { allowNull: false });
  safeReference(value.runId, 'stageTransition.runId', { allowNull: false });
  safeEnum(value.stage, STAGES, 'stageTransition.stage');
  safeEnum(value.status, STAGE_STATUSES, 'stageTransition.status');
  timestamp(value.at, 'stageTransition.at');
  safeString(value.reason, 'stageTransition.reason', { max: 240 });
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 12) fail('AGENT_SCHEMA_INVALID', 'stageTransition.evidenceRefs must be bounded.', 'stageTransition.evidenceRefs');
  value.evidenceRefs.forEach((item, index) => safeReference(item, `stageTransition.evidenceRefs[${index}]`, { allowNull: false }));
  if (!Array.isArray(value.internalSteps) || value.internalSteps.length > 24) fail('AGENT_SCHEMA_INVALID', 'stageTransition.internalSteps must be bounded.', 'stageTransition.internalSteps');
  value.internalSteps.forEach((step, index) => {
    only(step, ['name', 'status', 'reference'], `stageTransition.internalSteps[${index}]`);
    safeString(step.name, `stageTransition.internalSteps[${index}].name`, { max: 80 });
    safeEnum(step.status, STAGE_STATUSES, `stageTransition.internalSteps[${index}].status`);
    safeReference(step.reference, `stageTransition.internalSteps[${index}].reference`);
  });
  rejectUnsafeKeys(value, 'stageTransition');
  return clone(value);
}

function parseEventEnvelope(value) {
  only(value, ['version', 'eventId', 'runId', 'taskId', 'sequence', 'type', 'stage', 'occurredAt', 'actor', 'idempotencyKey', 'payloadHash', 'payload', 'previousHash'], 'eventEnvelope');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'eventEnvelope has an unsupported version.', 'eventEnvelope.version');
  safeReference(value.eventId, 'eventEnvelope.eventId', { allowNull: false });
  safeReference(value.runId, 'eventEnvelope.runId', { allowNull: false });
  safeReference(value.taskId, 'eventEnvelope.taskId', { allowNull: false });
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) fail('AGENT_INVALID_SEQUENCE', 'eventEnvelope.sequence must be a positive integer.', 'eventEnvelope.sequence');
  safeEnum(value.type, EVENT_TYPES, 'eventEnvelope.type');
  if (value.stage !== null) safeEnum(value.stage, STAGES, 'eventEnvelope.stage');
  timestamp(value.occurredAt, 'eventEnvelope.occurredAt');
  only(value.actor, ['type', 'id'], 'eventEnvelope.actor');
  safeEnum(value.actor.type, ['system', 'model', 'policy', 'tool', 'worker'], 'eventEnvelope.actor.type');
  safeReference(value.actor.id, 'eventEnvelope.actor.id', { allowNull: false });
  safeReference(value.idempotencyKey, 'eventEnvelope.idempotencyKey', { allowNull: false });
  hash(value.payloadHash, 'eventEnvelope.payloadHash');
  object(value.payload, 'eventEnvelope.payload');
  hash(value.previousHash, 'eventEnvelope.previousHash');
  rejectUnsafeKeys(value, 'eventEnvelope');
  return clone(value);
}

function parseCheckpoint(value) {
  only(value, ['version', 'checkpointId', 'runId', 'name', 'stage', 'sequence', 'status', 'at', 'resumable'], 'checkpoint');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'checkpoint has an unsupported version.', 'checkpoint.version');
  safeReference(value.checkpointId, 'checkpoint.checkpointId', { allowNull: false });
  safeReference(value.runId, 'checkpoint.runId', { allowNull: false });
  safeString(value.name, 'checkpoint.name', { max: 80 });
  safeEnum(value.stage, STAGES, 'checkpoint.stage');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) fail('AGENT_INVALID_SEQUENCE', 'checkpoint.sequence must be a non-negative integer.', 'checkpoint.sequence');
  safeEnum(value.status, STAGE_STATUSES, 'checkpoint.status');
  timestamp(value.at, 'checkpoint.at');
  if (typeof value.resumable !== 'boolean') fail('AGENT_SCHEMA_INVALID', 'checkpoint.resumable must be a boolean.', 'checkpoint.resumable');
  rejectUnsafeKeys(value, 'checkpoint');
  return clone(value);
}

function parseProvenance(value) {
  only(value, ['mode', 'label', 'provider', 'model', 'bundleVersion', 'responseVersion', 'promptTemplateVersion', 'promptInputHash', 'schemaVersion', 'signature', 'source', 'network', 'credentials'], 'provenance');
  safeEnum(value.mode, MODES, 'provenance.mode');
  safeString(value.label, 'provenance.label', { max: 40 });
  only(value.provider, ['kind', 'id'], 'provenance.provider');
  safeString(value.provider.kind, 'provenance.provider.kind', { max: 40 });
  safeReference(value.provider.id, 'provenance.provider.id', { allowNull: false });
  safeString(value.model, 'provenance.model', { max: 100 });
  safeString(value.bundleVersion, 'provenance.bundleVersion', { max: 40 });
  safeString(value.responseVersion, 'provenance.responseVersion', { max: 40 });
  safeString(value.promptTemplateVersion, 'provenance.promptTemplateVersion', { max: 40 });
  if (value.promptInputHash !== undefined) hash(value.promptInputHash, 'provenance.promptInputHash');
  if (value.schemaVersion !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'provenance.schemaVersion is unsupported.', 'provenance.schemaVersion');
  safeString(value.signature, 'provenance.signature', { max: 160 });
  safeString(value.source, 'provenance.source', { max: 120 });
  if (value.network !== false || (value.credentials !== undefined && value.credentials !== false)) fail('AGENT_PROVIDER_BOUNDARY', 'P0 model provenance must be offline and credential-free.', 'provenance');
  return clone(value);
}

function parseAgentRun(value) {
  only(value, ['version', 'id', 'taskId', 'mode', 'status', 'provenance', 'context', 'proposal', 'observations', 'policyDecision', 'stages', 'budgets', 'checkpoint', 'outcome'], 'agentRun');
  if (value.version !== AGENT_CONTRACT_VERSION) fail('AGENT_SCHEMA_VERSION_UNSUPPORTED', 'agentRun has an unsupported version.', 'agentRun.version');
  safeReference(value.id, 'agentRun.id', { allowNull: false });
  safeReference(value.taskId, 'agentRun.taskId', { allowNull: false });
  safeEnum(value.mode, MODES, 'agentRun.mode');
  safeEnum(value.status, ['created', 'running', 'completed', 'failed', 'awaiting_input'], 'agentRun.status');
  parseProvenance(value.provenance);
  parseSafePersonalContext(value.context);
  if (value.proposal !== null) parseModelProposal(value.proposal);
  if (!Array.isArray(value.observations) || value.observations.length > 40) fail('AGENT_SCHEMA_INVALID', 'agentRun.observations must be bounded.', 'agentRun.observations');
  value.observations.forEach(parseSafeObservation);
  if (value.policyDecision !== null) parsePolicyDecision(value.policyDecision);
  if (!Array.isArray(value.stages) || value.stages.length !== STAGES.length) fail('AGENT_SCHEMA_INVALID', 'agentRun.stages must contain exactly four stages.', 'agentRun.stages');
  value.stages.forEach((stageValue) => {
    only(stageValue, ['stage', 'status', 'startedAt', 'completedAt', 'reason', 'evidenceRefs', 'internalSteps'], 'agentRun.stage');
    safeEnum(stageValue.stage, STAGES, 'agentRun.stage.stage');
    safeEnum(stageValue.status, STAGE_STATUSES, 'agentRun.stage.status');
    if (stageValue.startedAt !== null) timestamp(stageValue.startedAt, 'agentRun.stage.startedAt');
    if (stageValue.completedAt !== null) timestamp(stageValue.completedAt, 'agentRun.stage.completedAt');
    safeString(stageValue.reason, 'agentRun.stage.reason', { max: 240 });
    parseStageTransition({ version: AGENT_CONTRACT_VERSION, transitionId: `${value.id}-${stageValue.stage}`, runId: value.id, stage: stageValue.stage, status: stageValue.status, at: stageValue.completedAt || stageValue.startedAt || new Date(0).toISOString(), reason: stageValue.reason, evidenceRefs: stageValue.evidenceRefs, internalSteps: stageValue.internalSteps });
  });
  only(value.budgets, ['spendCeilingMinor', 'currency', 'modelCalls', 'toolCalls', 'retries'], 'agentRun.budgets');
  minor(value.budgets.spendCeilingMinor, 'agentRun.budgets.spendCeilingMinor', { allowNull: false, max: 100000 });
  if (value.budgets.currency !== CURRENCY) fail('AGENT_INVALID_ENUM', 'agentRun.budgets.currency must be XSGD.', 'agentRun.budgets.currency');
  for (const field of ['modelCalls', 'toolCalls', 'retries']) if (!Number.isSafeInteger(value.budgets[field]) || value.budgets[field] < 0 || value.budgets[field] > 20) fail('AGENT_UNSAFE_QUANTITY', `agentRun.budgets.${field} is invalid.`, `agentRun.budgets.${field}`);
  parseCheckpoint(value.checkpoint);
  if (value.outcome !== null) {
    only(value.outcome, ['status', 'code', 'receiptReference', 'customerStatus'], 'agentRun.outcome');
    safeString(value.outcome.status, 'agentRun.outcome.status', { max: 40 });
    if (value.outcome.code !== null) safeString(value.outcome.code, 'agentRun.outcome.code', { max: 80, allowEmpty: true });
    safeReference(value.outcome.receiptReference, 'agentRun.outcome.receiptReference');
    safeString(value.outcome.customerStatus, 'agentRun.outcome.customerStatus', { max: 80 });
  }
  rejectUnsafeKeys(value, 'agentRun');
  return clone(value);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  AGENT_CONTRACT_VERSION,
  CURRENCY,
  MODES,
  STAGES,
  STAGE_STATUSES,
  TOOL_KINDS,
  TOOL_NAMES,
  EVENT_TYPES,
  AgentContractError,
  contentHash,
  clone,
  parseStructuredIntent,
  parseSafePersonalContext,
  parseToolProposal,
  parseModelProposal,
  parseSafeObservation,
  parsePolicyDecision,
  parseStageTransition,
  parseEventEnvelope,
  parseCheckpoint,
  parseProvenance,
  parseAgentRun,
  rejectUnsafeKeys,
  safeReference
};
