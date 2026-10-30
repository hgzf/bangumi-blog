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

test("android adapter reads and writes the database through Filesystem", async () => {
  global.PlatformContract = contract;
  global.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true };
  const writes = [];
  global.PlatformMobileNative = {
    Capacitor: global.Capacitor,
    Directory: { Data: "DATA" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      readFile: async () => {
        const error = new Error("File does not exist");
        error.code = "NOT_FOUND";
        throw error;
      },
      writeFile: async (options) => {
        writes.push(options);
        return { uri: "file:///data/bgm_blog_database.json" };
      }
    }
  };
  loadFresh("../platform/mobile-bridge");

  const adapter = global.PlatformMobileBridge.create();
  const loaded = await adapter.loadDatabase();
  const saved = await adapter.saveDatabase({ posts: [] });

  assert.equal(adapter.capabilities.database, true);
  assert.deepEqual(loaded, {
    ok: true,
    path: "应用私有目录/bgm_blog_database.json",
    data: null
  });
  assert.equal(saved.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].directory, "DATA");
  assert.equal(writes[0].encoding, "utf8");
  assert.equal(writes[0].path, "bgm_blog_database.json");
});

test("android adapter requests the official Bangumi API through CapacitorHttp", async () => {
  global.PlatformContract = contract;
  global.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true };
  const requests = [];
  global.PlatformMobileNative = {
    Capacitor: global.Capacitor,
    CapacitorHttp: {
      request: async (options) => {
        requests.push(options);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          url: options.url,
          data: { id: 1, name: "测试条目" }
        };
      }
    }
  };
  loadFresh("../platform/mobile-bridge");

  const adapter = global.PlatformMobileBridge.create();
  const response = await adapter.requestBangumi({
    url: "https://api.bgm.tv/v0/subjects/1",
    token: " token-value "
  });
  const rejected = await adapter.requestBangumi({
    url: "https://example.com/private"
  });

  assert.equal(adapter.capabilities.bangumi, true);
  assert.deepEqual(response, {
    ok: true,
    status: 200,
    statusText: "OK",
    data: { id: 1, name: "测试条目" },
    url: "https://api.bgm.tv/v0/subjects/1"
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.Authorization, "Bearer token-value");
  assert.equal(requests[0].connectTimeout, 15000);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /仅允许请求 Bangumi 官方公开 API/);
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
