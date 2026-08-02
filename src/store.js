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

class MemoryStore {
  constructor(initial = emptyState()) {
    this.data = initial;
  }

  transaction(mutator) {
    const result = mutator(this.data);
    return result;
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
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = emptyState();
    }
  }

  transaction(mutator) {
    const result = super.transaction(mutator);
    this.save();
    return result;
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = { JsonStore, MemoryStore, emptyState };
