(function initMobileBridge(root) {
  const DB_FILE = "bgm_blog_database.json";

  function isAvailable() {
    const capacitor = root.Capacitor;
    if (!capacitor) return false;
    const platform = typeof capacitor.getPlatform === "function"
      ? capacitor.getPlatform()
      : "";
    return platform === "android" ||
      (typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
  }

  function nativeBridge() {
    return root.PlatformMobileNative || null;
  }

  function databasePathLabel() {
    return `应用私有目录/${DB_FILE}`;
  }

  function isNotFound(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return ["NOT_FOUND", "ENOENT"].includes(code) ||
      /(?:file|directory).*(?:not|does not).*exist|找不到/i.test(message);
  }

  async function loadDatabase() {
    const native = nativeBridge();
    if (!native?.Filesystem) {
      return {
        ok: false,
        unsupported: true,
        error: "当前平台暂不支持 loadDatabase。"
      };
    }
    try {
      const result = await native.Filesystem.readFile({
        path: DB_FILE,
        directory: native.Directory.Data,
        encoding: native.Encoding.UTF8
      });
      return {
        ok: true,
        path: databasePathLabel(),
        data: JSON.parse(String(result.data || "null"))
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { ok: true, path: databasePathLabel(), data: null };
      }
      return { ok: false, path: databasePathLabel(), error: error.message };
    }
  }

  async function saveDatabase(data) {
    const native = nativeBridge();
    if (!native?.Filesystem) {
      return {
        ok: false,
        unsupported: true,
        error: "当前平台暂不支持 saveDatabase。"
      };
    }
    try {
      const result = await native.Filesystem.writeFile({
        path: DB_FILE,
        data: JSON.stringify(data),
        directory: native.Directory.Data,
        encoding: native.Encoding.UTF8,
        recursive: true
      });
      return {
        ok: true,
        path: databasePathLabel(),
        uri: result.uri || ""
      };
    } catch (error) {
      return { ok: false, path: databasePathLabel(), error: error.message };
    }
  }

  function create() {
    const hasFilesystem = Boolean(nativeBridge()?.Filesystem);
    return root.PlatformContract.createAdapter({
      platform: "android",
      label: "Android",
      capabilities: {
        database: hasFilesystem
      },
      methods: {
        loadDatabase,
        saveDatabase,
        getDatabasePath: async () => databasePathLabel()
      }
    });
  }

  root.PlatformMobileBridge = { isAvailable, create };
})(globalThis);
