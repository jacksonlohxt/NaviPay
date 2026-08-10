const fs = require('node:fs');
const path = require('node:path');

const CURRENT_VERSION = 2;

function emptyState() {
  return {
    version: CURRENT_VERSION,
    tasks: {},
    auditEvents: [],
    idempotency: {},
    operations: {},
    wallets: {},
    walletLedger: [],
    walletTransfers: {},
    walletTopups: {},
    merchantBalances: {},
    merchantCredits: {},
    inventory: {},
    reservations: {},
    orders: {},
    deliveries: {},
    issuerCards: {},
    issuerAuthorizations: {},
    issuerCaptures: {},
    checkoutSessions: {},
    checkoutWebhooks: [],
    refunds: {},
    workerRuns: {},
    fundingIntents: {},
    fundingEvents: {},
    fundingCredits: {},
    kycProfiles: {},
    kycEvents: {},
    agentRuns: {},
    agentEvents: [],
    agentCheckpoints: {}
  };
}

function ensureCollection(state, key, kind) {
  if (state[key] === undefined) state[key] = kind === 'array' ? [] : {};
  if (kind === 'array' && !Array.isArray(state[key])) throw new Error(`NaviPay data has an invalid ${key}.`);
  if (kind === 'object' && (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key]))) throw new Error(`NaviPay data has an invalid ${key} index.`);
}

function migrateState(value, filePath = 'store') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`NaviPay data at ${filePath} must be a JSON object.`);
  }
  if (value.version === 1) {
    return {
      ...emptyState(),
      ...value,
      version: CURRENT_VERSION
    };
  }
  if (value.version !== CURRENT_VERSION) {
    throw new Error(`Unsupported NaviPay data version at ${filePath}.`);
  }
  return value;
}

function validateState(value, filePath = 'store') {
  const state = migrateState(value, filePath);
  ensureCollection(state, 'tasks', 'object');
  ensureCollection(state, 'auditEvents', 'array');
  ensureCollection(state, 'idempotency', 'object');
  ensureCollection(state, 'operations', 'object');
  ensureCollection(state, 'wallets', 'object');
  ensureCollection(state, 'walletLedger', 'array');
  ensureCollection(state, 'walletTransfers', 'object');
  ensureCollection(state, 'walletTopups', 'object');
  ensureCollection(state, 'merchantBalances', 'object');
  ensureCollection(state, 'merchantCredits', 'object');
  ensureCollection(state, 'inventory', 'object');
  ensureCollection(state, 'reservations', 'object');
  ensureCollection(state, 'orders', 'object');
  ensureCollection(state, 'deliveries', 'object');
  ensureCollection(state, 'issuerCards', 'object');
  ensureCollection(state, 'issuerAuthorizations', 'object');
  ensureCollection(state, 'issuerCaptures', 'object');
  ensureCollection(state, 'checkoutSessions', 'object');
  ensureCollection(state, 'checkoutWebhooks', 'array');
  ensureCollection(state, 'refunds', 'object');
  ensureCollection(state, 'workerRuns', 'object');
  ensureCollection(state, 'fundingIntents', 'object');
  ensureCollection(state, 'fundingEvents', 'object');
  ensureCollection(state, 'fundingCredits', 'object');
  ensureCollection(state, 'kycProfiles', 'object');
  ensureCollection(state, 'kycEvents', 'object');
  ensureCollection(state, 'agentRuns', 'object');
  ensureCollection(state, 'agentEvents', 'array');
  ensureCollection(state, 'agentCheckpoints', 'object');
  return state;
}

class MemoryStore {
  constructor(initial = emptyState()) {
    this.data = validateState(initial);
  }

  transaction(mutator) {
    const result = mutator(this.data);
    return result;
  }

  reset() {
    this.data = emptyState();
  }
}

class JsonStore extends MemoryStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = validateState(parsed, this.filePath);
      if (parsed.version !== this.data.version) this.save();
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.data = emptyState();
        return;
      }
      if (error instanceof SyntaxError) {
        throw new Error(`NaviPay data at ${this.filePath} is not valid JSON. Remove or restore the file to continue.`);
      }
      throw error;
    }
  }

  transaction(mutator) {
    const result = super.transaction(mutator);
    this.save();
    return result;
  }

  reset() {
    super.reset();
    this.save();
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temporaryPath, 'w', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(this.data, null, 2)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = { CURRENT_VERSION, JsonStore, MemoryStore, emptyState, migrateState, validateState };
