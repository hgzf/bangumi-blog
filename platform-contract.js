(function initPlatformContract(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlatformContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlatformContract() {
  const VERSION = 1;
  const PLATFORMS = new Set(["electron", "android", "browser"]);
  const REQUIRED_METHODS = Object.freeze([
    "loadDatabase",
    "saveDatabase",
    "requestBangumi",
    "aiChat",
    "onSystemResume",
    "exportBackup",
    "importBackup",
    "exportAllMarkdown",
    "exportOneMarkdown",
    "chooseYearbookImage",
    "captureYearbookViewport",
    "saveYearbookImage",
    "revealDatabase",
    "getDatabasePath"
  ]);
  const CAPABILITIES = Object.freeze([
    "database",
    "bangumi",
    "ai",
    "backupExport",
    "backupImport",
    "markdownExport",
    "yearbookImage",
    "embeddedAiWeb",
    "systemResume",
    "revealDatabase",
    "secureStorage"
  ]);
  const METHOD_CAPABILITIES = Object.freeze({
    loadDatabase: "database",
    saveDatabase: "database",
    getDatabasePath: "database",
    requestBangumi: "bangumi",
    aiChat: "ai",
    exportBackup: "backupExport",
    importBackup: "backupImport",
    exportAllMarkdown: "markdownExport",
    exportOneMarkdown: "markdownExport",
    chooseYearbookImage: "yearbookImage",
    captureYearbookViewport: "yearbookImage",
    saveYearbookImage: "yearbookImage",
    onSystemResume: "systemResume",
    revealDatabase: "revealDatabase"
  });
  const SECURE_METHODS = Object.freeze(["get", "set", "remove"]);

  function markUnsupported(fn, method) {
    Object.defineProperty(fn, "unsupported", {
      value: true,
      enumerable: false
    });
    Object.defineProperty(fn, "operation", {
      value: method,
      enumerable: false
    });
    return fn;
  }

  function unsupportedMethod(method) {
    const fn = method === "onSystemResume"
      ? () => () => {}
      : async () => ({
          ok: false,
          unsupported: true,
          error: `当前平台暂不支持 ${method}。`
        });
    return markUnsupported(fn, method);
  }

  function unsupportedSecureMethod(method) {
    return markUnsupported(async () => {
      throw new Error(`当前平台暂不支持 secureStorage.${method}()。`);
    }, `secureStorage.${method}`);
  }

  function isUnsupported(fn) {
    return typeof fn === "function" && fn.unsupported === true;
  }

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      throw new Error("Platform adapter must be an object.");
    }
    if (!PLATFORMS.has(adapter.platform)) {
      throw new Error(`Unsupported platform: ${adapter.platform || "(missing)"}`);
    }
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== "function") {
        throw new Error(`Platform adapter is missing method "${method}".`);
      }
      const capability = METHOD_CAPABILITIES[method];
      if (capability && adapter.capabilities?.[capability] && isUnsupported(adapter[method])) {
        throw new Error(`Capability "${capability}" requires implemented method "${method}".`);
      }
    }
    if (adapter.capabilities?.secureStorage) {
      for (const method of SECURE_METHODS) {
        if (typeof adapter.secureStorage?.[method] !== "function" ||
            isUnsupported(adapter.secureStorage[method])) {
          throw new Error(`Capability "secureStorage" requires secureStorage.${method}().`);
        }
      }
    }
    return true;
  }

  function createAdapter({
    platform,
    label = "",
    capabilities = {},
    methods = {},
    secureStorage = {}
  }) {
    if (!PLATFORMS.has(platform)) {
      throw new Error(`Unsupported platform: ${platform || "(missing)"}`);
    }
    const adapter = {
      version: VERSION,
      platform,
      label: String(label || platform),
      capabilities: Object.fromEntries(
        CAPABILITIES.map((key) => [key, Boolean(capabilities[key])])
      )
    };
    for (const method of REQUIRED_METHODS) {
      adapter[method] = typeof methods[method] === "function"
        ? methods[method]
        : unsupportedMethod(method);
    }
    adapter.secureStorage = Object.fromEntries(
      SECURE_METHODS.map((method) => [
        method,
        typeof secureStorage[method] === "function"
          ? secureStorage[method]
          : unsupportedSecureMethod(method)
      ])
    );
    validateAdapter(adapter);
    return adapter;
  }

  return {
    VERSION,
    REQUIRED_METHODS,
    CAPABILITIES,
    PLATFORMS: [...PLATFORMS],
    createAdapter,
    validateAdapter,
    isUnsupported
  };
});
