const crypto = require('node:crypto');
const {
  AGENT_CONTRACT_VERSION,
  CURRENCY,
  MODES,
  STAGES,
  STAGE_STATUSES,
  TOOL_NAMES,
  AgentContractError,
  clone,
  contentHash,
  parseAgentRun,
  parseCheckpoint,
  parseEventEnvelope,
  parseModelProposal,
  parsePolicyDecision,
  parseSafeObservation,
  parseSafePersonalContext,
  parseStageTransition,
  parseToolProposal,
  safeReference
} = require('./agent-contract');

function id(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function now(clock) {
  return clock().toISOString();
}

function assembleSafePersonalContext(task) {
  const intent = task.request?.intent || {};
  const context = {
    version: AGENT_CONTRACT_VERSION,
    purpose: 'one_purchase',
    preferences: {
      brands: intent.brand ? [intent.brand] : [],
      categories: intent.productCategory ? [intent.productCategory] : [],
      delivery: 'fixture_address'
    },
    hardConstraints: {
      brand: intent.brand || null,
      productCategory: intent.productCategory || null,
      merchantScope: [{ id: 'approved_local_merchants', label: 'Seeded local merchant scope' }],
      quantity: Number.isSafeInteger(intent.quantity) && intent.quantity >= 1 && intent.quantity <= 20 ? intent.quantity : 1
    },
    spendCeilingMinor: task.spendingCeilingMinor,
    currency: CURRENCY,
    addressRef: 'fixture_delivery_address',
    profileRef: 'demo_customer_profile'
  };
  return parseSafePersonalContext(context);
}

function safeObservation({ runId, source, kind, summary, value, trust = 'trusted', promptInjectionDetected = false, ignored = false, facts = {}, clock }) {
  const observation = {
    version: AGENT_CONTRACT_VERSION,
    id: id('observation', `${runId}:${source}:${kind}:${summary}`),
    source,
    kind,
    trust,
    summary,
    contentHash: contentHash(value),
    observedAt: now(clock),
    promptInjectionDetected,
    ignored,
    facts
  };
  return parseSafeObservation(observation);
}

function safeContextObservation(runId, task, clock) {
  const instruction = task.request?.raw || '';
  const injection = /(?:ignore|disregard|bypass)\s+(?:previous|all|policy|safety)|(?:reveal|show)\s+(?:secret|credential|password|pan|cvv)/i.test(instruction);
  return safeObservation({
    runId,
    source: 'user_instruction',
    kind: injection ? 'safety_signal' : 'instruction',
    summary: injection ? 'The bounded instruction contained an untrusted safety signal; policy ignored it.' : 'The bounded instruction was interpreted as one local purchase.',
    value: instruction,
    trust: injection ? 'untrusted' : 'trusted',
    promptInjectionDetected: injection,
    ignored: injection,
    facts: { purpose: 'one_purchase', currency: CURRENCY },
    clock
  });
}

class AllowlistedToolRegistry {
  constructor() {
    this.tools = new Map([
      ['catalog.search', { name: 'catalog.search', stage: 'discovery', kind: 'observation', sideEffect: false }],
      ['quote.lock', { name: 'quote.lock', stage: 'discovery', kind: 'decision', sideEffect: false }],
      ['inventory.reserve', { name: 'inventory.reserve', stage: 'discovery', kind: 'side_effect', sideEffect: true }],
      ['funding.observe_local_mock', { name: 'funding.observe_local_mock', stage: 'funding', kind: 'observation', sideEffect: false }],
      ['issuance.issue_scoped_instrument', { name: 'issuance.issue_scoped_instrument', stage: 'issuance', kind: 'side_effect', sideEffect: true }],
      ['execution.run_local_checkout', { name: 'execution.run_local_checkout', stage: 'execution', kind: 'side_effect', sideEffect: true }],
      ['payment.reconcile', { name: 'payment.reconcile', stage: 'execution', kind: 'decision', sideEffect: true }],
      ['order.create', { name: 'order.create', stage: 'execution', kind: 'side_effect', sideEffect: true }],
      ['receipt.issue', { name: 'receipt.issue', stage: 'execution', kind: 'side_effect', sideEffect: true }]
    ]);
  }

  get(name) {
    return this.tools.get(name) || null;
  }

  validate(proposals) {
    if (!Array.isArray(proposals)) throw new AgentContractError('AGENT_TOOL_PROPOSALS_INVALID', 'Tool proposals must be an array.');
    const results = [];
    for (const value of proposals) {
      let proposal;
      try {
        proposal = parseToolProposal(value);
      } catch (error) {
        results.push({ status: 'denied', code: error.code || 'AGENT_TOOL_INVALID', reason: error.message });
        continue;
      }
      const tool = this.get(proposal.name);
      if (!tool) {
        results.push({ status: 'denied', code: 'TOOL_NOT_ALLOWLISTED', reason: `Tool ${proposal.name} is not allowlisted.` });
        continue;
      }
      if (tool.stage !== proposal.stage || tool.kind !== proposal.kind) {
        results.push({ status: 'denied', code: 'TOOL_SCOPE_MISMATCH', reason: `Tool ${proposal.name} is not valid for ${proposal.stage}.` });
        continue;
      }
      results.push({ status: 'accepted_as_proposal', code: null, reason: 'Typed proposal is allowlisted but remains subject to server policy.', tool: tool.name });
    }
    return results;
  }

  projection() {
    return [...this.tools.values()].map((tool) => ({ ...tool }));
  }
}

class AgentPolicyEngine {
  constructor({ registry = new AllowlistedToolRegistry() } = {}) {
    this.registry = registry;
  }

  evaluate({ proposal, context } = {}) {
    parseSafePersonalContext(context);
    let parsedProposal;
    try {
      parsedProposal = parseModelProposal(proposal);
    } catch (error) {
      const unknownTool = Array.isArray(proposal?.toolProposals) && proposal.toolProposals.some((item) => !TOOL_NAMES.includes(item?.name));
      if (!unknownTool) throw error;
      const reasons = ['The proposed tool is not in the server allowlist.'];
      return {
        version: AGENT_CONTRACT_VERSION,
        decisionId: id('policy', JSON.stringify(proposal)),
        status: 'denied',
        authority: 'server_policy_engine',
        reasonCodes: ['TOOL_NOT_ALLOWLISTED'],
        reasons,
        checks: {
          typedProposal: { status: 'failed', reason: error.message },
          allowlistedTools: { status: 'failed', reason: reasons[0] },
          serverPolicy: { status: 'not_run', reason: 'Business policy did not run for a denied tool proposal.' }
        },
        decidedAt: new Date().toISOString()
      };
    }
    const toolResults = this.registry.validate(parsedProposal.toolProposals);
    const denied = toolResults.filter((result) => result.status === 'denied');
    return {
      version: AGENT_CONTRACT_VERSION,
      decisionId: id('policy', proposal.proposalId),
      status: denied.length ? 'denied' : 'paused',
      authority: 'server_policy_engine',
      reasonCodes: denied.length ? denied.map((result) => result.code) : ['MODEL_PROPOSAL_ADVISORY', 'BUSINESS_POLICY_REQUIRED'],
      reasons: denied.length ? denied.map((result) => result.reason) : ['The model proposal is advisory and cannot authorize a side effect.', 'The deterministic server policy must evaluate quote, budget, inventory, funding, issuance, payment, order, and receipt.'],
      checks: {
        typedProposal: { status: 'passed', reason: 'The proposal matches the versioned typed contract.' },
        allowlistedTools: { status: denied.length ? 'failed' : 'passed', reason: denied.length ? denied.map((result) => result.reason).join(' ') : 'All proposed tools are in the local allowlist.' },
        serverPolicy: { status: 'not_run', reason: 'Business policy is evaluated at the authoritative lifecycle boundary.' }
      },
      decidedAt: new Date().toISOString(),
      toolResults
    };
  }

  fromBusinessDecision(decision, clock) {
    const status = decision?.status === 'approved' ? 'approved' : decision?.status === 'paused' ? 'paused' : 'denied';
    const reason = decision?.reason || 'The server policy engine recorded no additional reason.';
    const checks = {};
    for (const [key, check] of Object.entries(decision?.checks || {})) {
      checks[key] = { status: ['passed', 'failed', 'not_run'].includes(check.status) ? check.status : 'not_run', reason: String(check.reason || reason).slice(0, 240) };
    }
    return parsePolicyDecision({
      version: AGENT_CONTRACT_VERSION,
      decisionId: decision?.decisionId || id('policy', reason),
      status,
      authority: 'server_policy_engine',
      reasonCodes: [decision?.code || (status === 'approved' ? 'AUTHORIZATION_APPROVED' : 'AUTHORIZATION_REJECTED')],
      reasons: [reason],
      checks,
      decidedAt: decision?.decidedAt || now(clock)
    });
  }
}

function initialStages() {
  return STAGES.map((stage) => ({ stage, status: 'not_started', startedAt: null, completedAt: null, reason: 'Stage has not started.', evidenceRefs: [], internalSteps: [] }));
}

function createAgentRun({ task, mode, provenance, clock }) {
  const createdAt = now(clock);
  const run = {
    version: AGENT_CONTRACT_VERSION,
    id: `agent_${crypto.randomUUID()}`,
    taskId: task.id,
    mode,
    status: 'created',
    provenance,
    context: assembleSafePersonalContext(task),
    proposal: null,
    observations: [],
    policyDecision: null,
    stages: initialStages(),
    budgets: { spendCeilingMinor: task.spendingCeilingMinor, currency: CURRENCY, modelCalls: 0, toolCalls: 0, retries: 0 },
    checkpoint: { version: AGENT_CONTRACT_VERSION, checkpointId: id('checkpoint', `${task.id}:created`), runId: '', name: 'created', stage: 'funding', sequence: 0, status: 'not_started', at: createdAt, resumable: true },
    outcome: null
  };
  run.checkpoint.runId = run.id;
  return parseAgentRun(run);
}

function appendAgentEvent(data, { runId, type, stage = null, idempotencyKey, payload, clock }) {
  if (!data.agentEvents) data.agentEvents = [];
  const run = data.agentRuns?.[runId];
  if (!run) throw new AgentContractError('AGENT_RUN_NOT_FOUND', 'An event must belong to a persisted agent run.');
  const previous = data.agentEvents.filter((event) => event.runId === runId).at(-1);
  const actorType = type.startsWith('model.') || type === 'tool.proposed' ? 'model' : type.startsWith('policy.') || type.startsWith('stage.') || type === 'outcome.recorded' ? 'policy' : type.startsWith('tool.') ? 'tool' : type.startsWith('observation.') ? 'worker' : 'system';
  const sequence = previous ? previous.sequence + 1 : 1;
  const safePayload = clone(payload || {});
  const envelope = parseEventEnvelope({
    version: AGENT_CONTRACT_VERSION,
    eventId: id('event', `${runId}:${sequence}:${type}`),
    runId,
    taskId: run.taskId,
    sequence,
    type,
    stage,
    occurredAt: now(clock),
    actor: { type: actorType, id: `navipay-${actorType}` },
    idempotencyKey: id('idem', `${runId}:${sequence}:${idempotencyKey || type}`),
    payloadHash: contentHash(JSON.stringify(safePayload)),
    payload: safePayload,
    previousHash: previous?.payloadHash || '0'.repeat(64)
  });
  data.agentEvents.push(envelope);
  return envelope;
}

function recordObservation(data, run, observation, clock) {
  const parsed = parseSafeObservation(observation);
  if (!run.observations.some((item) => item.id === parsed.id)) run.observations.push(parsed);
  appendAgentEvent(data, { runId: run.id, type: 'observation.recorded', stage: parsed.source === 'local_mock_provider' ? 'funding' : parsed.kind === 'candidate_summary' ? 'discovery' : null, idempotencyKey: parsed.id, payload: { observation: parsed }, clock });
}

function updateStage(data, run, stageName, status, patch, clock) {
  const current = run.stages.find((item) => item.stage === stageName);
  if (!current) throw new AgentContractError('AGENT_STAGE_INVALID', `Unknown agent stage ${stageName}.`);
  const next = {
    ...current,
    ...patch,
    stage: stageName,
    status,
    startedAt: status === 'not_started' ? (patch?.startedAt || current.startedAt || null) : (patch?.startedAt || current.startedAt || now(clock)),
    completedAt: ['completed', 'blocked', 'skipped', 'awaiting_input'].includes(status) ? (patch?.completedAt || current.completedAt || now(clock)) : null,
    evidenceRefs: patch?.evidenceRefs || current.evidenceRefs || [],
    internalSteps: patch?.internalSteps || current.internalSteps || [],
    reason: patch?.reason || current.reason || 'Stage state updated.'
  };
  const transition = parseStageTransition({
    version: AGENT_CONTRACT_VERSION,
    transitionId: id('transition', `${run.id}:${stageName}:${status}:${next.completedAt || next.startedAt}`),
    runId: run.id,
    stage: stageName,
    status,
    at: next.completedAt || next.startedAt || now(clock),
    reason: next.reason,
    evidenceRefs: next.evidenceRefs,
    internalSteps: next.internalSteps
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  Object.assign(current, next);
  if (changed) appendAgentEvent(data, { runId: run.id, type: 'stage.transitioned', stage: stageName, idempotencyKey: transition.transitionId, payload: { transition }, clock });
  return current;
}

function saveCheckpoint(data, run, { name, stage, status, resumable }, clock) {
  const events = data.agentEvents?.filter((event) => event.runId === run.id) || [];
  const checkpoint = parseCheckpoint({
    version: AGENT_CONTRACT_VERSION,
    checkpointId: id('checkpoint', `${run.id}:${name}:${events.length}`),
    runId: run.id,
    name,
    stage,
    sequence: events.length,
    status,
    at: now(clock),
    resumable
  });
  run.checkpoint = checkpoint;
  if (data.agentCheckpoints) data.agentCheckpoints[run.id] = checkpoint;
  appendAgentEvent(data, { runId: run.id, type: 'checkpoint.saved', stage, idempotencyKey: checkpoint.checkpointId, payload: { checkpoint }, clock });
  return checkpoint;
}

function recordBusinessPolicy(data, run, decision, clock) {
  const policyDecision = parsePolicyDecision(decision);
  run.policyDecision = policyDecision;
  appendAgentEvent(data, { runId: run.id, type: 'policy.decided', stage: 'issuance', idempotencyKey: policyDecision.decisionId, payload: { decision: policyDecision }, clock });
}

function projectAgentStage(stage) {
  return {
    stage: stage.stage,
    label: stage.stage.charAt(0).toUpperCase() + stage.stage.slice(1),
    status: stage.status,
    reason: stage.reason,
    evidenceRefs: stage.evidenceRefs,
    internalSteps: stage.internalSteps,
    startedAt: stage.startedAt,
    completedAt: stage.completedAt
  };
}

function rebuildAgentRunFromEvents(run, events) {
  const rebuilt = {
    context: null,
    proposal: null,
    observations: [],
    policyDecision: null,
    stages: initialStages(),
    checkpoint: run.checkpoint,
    outcome: null
  };
  for (const event of events.slice().sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'context.assembled') rebuilt.context = clone(event.payload.context);
    if (event.type === 'model.proposed') rebuilt.proposal = clone(event.payload.proposal);
    if (event.type === 'observation.recorded') {
      const observation = event.payload.observation;
      if (!rebuilt.observations.some((item) => item.id === observation.id)) rebuilt.observations.push(clone(observation));
    }
    if (event.type === 'policy.decided') rebuilt.policyDecision = clone(event.payload.decision);
    if (event.type === 'stage.transitioned') {
      const transition = event.payload.transition;
      const target = rebuilt.stages.find((item) => item.stage === transition.stage);
      if (target) Object.assign(target, { status: transition.status, reason: transition.reason, evidenceRefs: transition.evidenceRefs, internalSteps: transition.internalSteps, startedAt: target.startedAt || transition.at, completedAt: ['completed', 'blocked', 'skipped', 'awaiting_input'].includes(transition.status) ? transition.at : null });
    }
    if (event.type === 'checkpoint.saved') rebuilt.checkpoint = clone(event.payload.checkpoint);
    if (event.type === 'outcome.recorded') rebuilt.outcome = clone(event.payload.outcome);
  }
  return { ...run, ...rebuilt };
}

function projectReviewerRun({ run, events = [], taskProjection = null, toolRegistry = new AllowlistedToolRegistry() }) {
  const rebuilt = rebuildAgentRunFromEvents(run, events);
  const safeToolFacts = {
    funding: { tool: 'funding.observe_local_mock', status: 'observed', providerMode: 'local_mock', providerId: 'local-mock-xsgd-avalanche', reference: rebuilt.stages[0].evidenceRefs[0] || null, disclosure: 'Local mock funding evidence only. No live XSGD, custody, or Avalanche transaction.' },
    discovery: { tool: 'catalog.search', status: rebuilt.stages[1].status, source: taskProjection?.discovery?.label || 'Seeded catalog', candidateCount: taskProjection?.quote?.candidates?.length || 0, reference: taskProjection?.quote?.quoteId || null },
    issuance: { tool: 'issuance.issue_scoped_instrument', status: taskProjection?.card?.status || 'not_issued', reference: taskProjection?.card?.reference || null, scope: taskProjection?.card?.scope || null },
    execution: { tool: 'execution.run_local_checkout', status: taskProjection?.checkout?.status || 'not_started', reference: taskProjection?.checkout?.checkoutReference || null, disclosure: 'Simulated local checkout only. This is not a real browser checkout or external merchant.' }
  };
  return {
    version: AGENT_CONTRACT_VERSION,
    runId: rebuilt.id,
    taskId: rebuilt.taskId,
    readOnly: true,
    mode: rebuilt.provenance.label,
    modeId: rebuilt.mode,
    provenance: clone(rebuilt.provenance),
    contextSummary: clone(rebuilt.context),
    proposal: clone(rebuilt.proposal),
    policyDecision: clone(rebuilt.policyDecision),
    toolRegistry: toolRegistry.projection(),
    safeToolFacts,
    observations: rebuilt.observations.map((observation) => ({ ...observation, summary: observation.summary })),
    stages: rebuilt.stages.map(projectAgentStage),
    budgets: clone(rebuilt.budgets),
    checkpoint: clone(rebuilt.checkpoint),
    outcome: {
      status: taskProjection?.state || rebuilt.outcome?.status || rebuilt.status,
      code: taskProjection?.customerOutcome?.code || rebuilt.outcome?.code || null,
      customerStatus: taskProjection?.customerOutcome?.title || rebuilt.outcome?.customerStatus || 'Purchase not complete',
      receiptReference: taskProjection?.receipt?.id || null
    },
    eventSummary: events.map((event) => ({ eventId: event.eventId, runId: event.runId, taskId: event.taskId, sequence: event.sequence, type: event.type, stage: event.stage, actor: event.actor, occurredAt: event.occurredAt, payloadHash: event.payloadHash }))
  };
}

function projectCustomerAgent(run) {
  if (!run) return null;
  return {
    version: AGENT_CONTRACT_VERSION,
    mode: run.provenance?.label || (run.mode === 'recorded_replay' ? 'recorded replay' : 'deterministic fallback'),
    disclosure: run.mode === 'recorded_replay'
      ? 'Recorded replay proposal; server policy and local purchase safeguards remained authoritative.'
      : 'Deterministic fallback; no model call was used. Server policy and local purchase safeguards remained authoritative.',
    stages: run.stages.map((stage) => ({ stage: stage.stage, status: stage.status }))
  };
}

module.exports = {
  AllowlistedToolRegistry,
  AgentPolicyEngine,
  assembleSafePersonalContext,
  safeObservation,
  safeContextObservation,
  createAgentRun,
  appendAgentEvent,
  recordObservation,
  updateStage,
  saveCheckpoint,
  recordBusinessPolicy,
  rebuildAgentRunFromEvents,
  projectReviewerRun,
  projectCustomerAgent,
  initialStages,
  STAGES,
  MODES,
  TOOL_NAMES
};
