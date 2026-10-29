const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUIRED_METHODS,
  createAdapter,
  validateAdapter,
  isUnsupported
} = require("../platform-contract");

function stubMethods() {
  return Object.fromEntries(REQUIRED_METHODS.map((method) => [
    method,
    async () => ({ ok: true, method })
  ]));
}

test("adapter fills unavailable methods with an explicit unsupported result", async () => {
  const adapter = createAdapter({
    platform: "android",
    capabilities: { database: false },
    methods: {}
  });

  const result = await adapter.loadDatabase();

  assert.equal(isUnsupported(adapter.loadDatabase), true);
  assert.deepEqual(result, {
    ok: false,
    unsupported: true,
    error: "当前平台暂不支持 loadDatabase。"
  });
});

test("adapter rejects a capability that is declared but not implemented", () => {
  assert.throws(() => createAdapter({
    platform: "electron",
    capabilities: { database: true },
    methods: {}
  }), /database.*loadDatabase/i);
});

test("complete adapter satisfies the platform contract", () => {
  const adapter = createAdapter({
    platform: "electron",
    capabilities: Object.fromEntries(
      [
        "database",
        "bangumi",
        "ai",
        "backupExport",
        "backupImport",
        "markdownExport",
        "yearbookImage",
        "embeddedAiWeb",
        "systemResume",
        "revealDatabase"
      ].map((key) => [key, true])
    ),
    methods: stubMethods()
  });

  assert.equal(validateAdapter(adapter), true);
  assert.equal(adapter.platform, "electron");
});

test("secure storage capability requires all secure storage methods", () => {
  assert.throws(() => createAdapter({
    platform: "android",
    capabilities: { secureStorage: true },
    methods: stubMethods(),
    secureStorage: {}
  }), /secureStorage.*get/i);
});

test("unknown platforms are rejected", () => {
  assert.throws(() => createAdapter({
    platform: "windows-phone",
    methods: {}
  }), /unsupported platform/i);
});
