(function initBrowserBridge(root) {
  const STORAGE_DB_KEY = "bgm-local-blog-browser-db";
  const BGM_USER_AGENT = "BangumiPersonalBlogDesktop/1.0 ([https://github.com/bgm-local-blog](https://github.com/bgm-local-blog))";

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveBrowserDatabase(data) {
    try {
      localStorage.setItem(STORAGE_DB_KEY, JSON.stringify(data));
      return { ok: true, path: "浏览器 localStorage 演示模式" };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function downloadBrowserJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    downloadBlob(blob, `bgm-blog-backup-${new Date().toISOString().slice(0, 10)}.json`);
    return { ok: true, path: "浏览器下载" };
  }

  function downloadBrowserMarkdown(posts) {
    const articles = (Array.isArray(posts) ? posts : [])
      .filter((post) => post.kind === "article");
    for (const post of articles) {
      const date = String(post.createdAt || "").slice(0, 10) || "undated";
      const title = String(post.title || "blog")
        .replace(/[<>:"/\\|?*]/g, "-")
        .slice(0, 80);
      downloadBlob(
        new Blob(
          [`# ${post.title || "无题日志"}\n\n${post.content || ""}\n`],
          { type: "text/markdown;charset=utf-8" }
        ),
        `${date}-${title}.md`
      );
    }
    return { ok: true, count: articles.length, path: "浏览器下载" };
  }

  async function browserBangumiRequest(payload) {
    const { url, method = "GET", body, token = "" } = payload || {};
    if (
      typeof url !== "string" ||
      (url !== "https://api.bgm.tv/calendar" && !url.startsWith("https://api.bgm.tv/v0/"))
    ) {
      return { ok: false, status: 0, error: "仅允许请求 Bangumi 官方公开 API。" };
    }
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "User-Agent": BGM_USER_AGENT,
          Accept: "application/json",
          ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
        url
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: "NETWORK_ERROR",
        error: error.message,
        url
      };
    }
  }

  async function browserAiChat(payload) {
    const { baseUrl, apiKey = "", model, messages = [] } = payload || {};
    try {
      if (!String(model || "").trim()) throw new Error("请先配置 AI 模型名称。");
      const endpoint = root.AiClient.buildAiEndpoint(baseUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(String(apiKey || "").trim()
            ? { Authorization: `Bearer ${String(apiKey).trim()}` }
            : {})
        },
        body: JSON.stringify({
          model: String(model).trim(),
          messages,
          temperature: 0.7,
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: data?.error?.message || data?.message || response.statusText
        };
      }
      const content = root.AiClient.extractAiContent(data);
      return content
        ? { ok: true, status: response.status, content, usage: data?.usage || null }
        : { ok: false, status: response.status, error: "AI 服务返回了空内容。" };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: root.AiClient.formatAiTransportError(error)
      };
    }
  }

  function create() {
    return root.PlatformContract.createAdapter({
      platform: "browser",
      label: "Browser preview",
      capabilities: {
        database: true,
        bangumi: true,
        ai: true,
        backupExport: true,
        markdownExport: true
      },
      methods: {
        loadDatabase: async () => ({
          ok: true,
          path: "浏览器 localStorage 演示模式",
          data: safeJsonParse(localStorage.getItem(STORAGE_DB_KEY), null)
        }),
        saveDatabase: async (data) => saveBrowserDatabase(data),
        requestBangumi: browserBangumiRequest,
        aiChat: browserAiChat,
        exportBackup: async (data) => downloadBrowserJson(data),
        exportAllMarkdown: async (posts) => downloadBrowserMarkdown(posts),
        exportOneMarkdown: async (post) => downloadBrowserMarkdown([post]),
        getDatabasePath: async () => "浏览器 localStorage 演示模式"
      },
      secureStorage: {
        get: async (key) => localStorage.getItem(key),
        set: async (key, value) => localStorage.setItem(key, value),
        remove: async (key) => localStorage.removeItem(key)
      }
    });
  }

  root.PlatformBrowserBridge = { create };
})(globalThis);
