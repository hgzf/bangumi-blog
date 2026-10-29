const test = require("node:test");
const assert = require("node:assert/strict");

const contract = require("../platform-contract");

function loadFresh(path) {
  delete require.cache[require.resolve(path)];
  require(path);
}

test("browser adapter declares only implemented browser capabilities", () => {
  global.PlatformContract = contract;
  global.AiClient = {
    buildAiEndpoint: (url) => new URL(`${url}/chat/completions`),
    extractAiContent: () => "ok",
    formatAiTransportError: (error) => error.message
  };
  loadFresh("../platform/browser-bridge");

  const adapter = global.PlatformBrowserBridge.create();

  assert.equal(adapter.platform, "browser");
  assert.equal(adapter.capabilities.database, true);
  assert.equal(adapter.capabilities.backupImport, false);
  assert.equal(adapter.capabilities.yearbookImage, false);
  assert.equal(contract.validateAdapter(adapter), true);
});

test("android placeholder adapter loads with all native capabilities disabled", () => {
  global.PlatformContract = contract;
  global.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true };
  loadFresh("../platform/mobile-bridge");

  const adapter = global.PlatformMobileBridge.create();

  assert.equal(adapter.platform, "android");
  assert.equal(Object.values(adapter.capabilities).every(Boolean), false);
  assert.equal(contract.validateAdapter(adapter), true);
});

test("platform loader selects the first available real adapter", () => {
  global.PlatformContract = contract;
  const mobile = contract.createAdapter({ platform: "android", methods: {} });
  global.PlatformElectronBridge = { isAvailable: () => false, create: () => null };
  global.PlatformMobileBridge = { isAvailable: () => true, create: () => mobile };
  global.PlatformBrowserBridge = { create: () => null };

  loadFresh("../platform/platform-loader");

  assert.equal(global.bgmApi.platform, "android");
  assert.equal(global.bgmPlatform.name, "android");
});
