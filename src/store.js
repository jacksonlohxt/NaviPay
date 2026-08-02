const fs = require('node:fs');
const path = require('node:path');

function emptyState() {
  return {
    version: 1,
    tasks: {},
    auditEvents: [],
    idempotency: {}
  };
}

function validateState(value, filePath = 'store') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`NaviPay data at ${filePath} must be a JSON object.`);
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported NaviPay data version at ${filePath}.`);
  }
  if (!value.tasks || typeof value.tasks !== 'object' || Array.isArray(value.tasks)) {
    throw new Error(`NaviPay data at ${filePath} has an invalid task index.`);
  }
  if (!Array.isArray(value.auditEvents)) {
    throw new Error(`NaviPay data at ${filePath} has an invalid audit timeline.`);
  }
  if (!value.idempotency || typeof value.idempotency !== 'object' || Array.isArray(value.idempotency)) {
    throw new Error(`NaviPay data at ${filePath} has an invalid idempotency index.`);
  }
  return value;
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

module.exports = { JsonStore, MemoryStore, emptyState, validateState };
