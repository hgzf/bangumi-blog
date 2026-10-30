(function initMobileBridge(root) {
  const DB_FILE = "bgm_blog_database.json";
  const BGM_USER_AGENT = "BangumiPersonalBlogDesktop/1.0 ([https://github.com/bgm-local-blog](https://github.com/bgm-local-blog))";

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

  function getBangumiHeaders(token) {
    return {
      "User-Agent": BGM_USER_AGENT,
      Accept: "application/json",
      ...(String(token || "").trim()
        ? { Authorization: `Bearer ${String(token).trim()}` }
        : {})
    };
  }

  async function requestBangumi(payload) {
    const { url, method = "GET", body, token = "" } = payload || {};
    if (
      typeof url !== "string" ||
      (url !== "https://api.bgm.tv/calendar" && !url.startsWith("https://api.bgm.tv/v0/"))
    ) {
      return { ok: false, status: 0, error: "仅允许请求 Bangumi 官方公开 API。" };
    }

    const http = nativeBridge()?.CapacitorHttp;
    if (!http?.request) {
      return {
        ok: false,
        status: 0,
        unsupported: true,
        error: "当前平台暂不支持 requestBangumi。"
      };
    }

    const headers = getBangumiHeaders(token);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await http.request({
        url,
        method,
        headers,
        ...(body === undefined ? {} : { data: body }),
        connectTimeout: 15000,
        readTimeout: 30000
      });
      const status = Number(response.status) || 0;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status >= 200 && status < 300 ? "OK" : "HTTP_ERROR",
        data: response.data ?? null,
        url
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: "NETWORK_ERROR",
        error: error?.message || "Bangumi 请求失败。",
        url
      };
    }
  }

  function create() {
    const hasFilesystem = Boolean(nativeBridge()?.Filesystem);
    const hasBangumiHttp = Boolean(nativeBridge()?.CapacitorHttp?.request);
    return root.PlatformContract.createAdapter({
      platform: "android",
      label: "Android",
      capabilities: {
        database: hasFilesystem,
        bangumi: hasBangumiHttp
      },
      methods: {
        loadDatabase,
        saveDatabase,
        requestBangumi,
        getDatabasePath: async () => databasePathLabel()
      }
    });
  }

  root.PlatformMobileBridge = { isAvailable, create };
})(globalThis);
