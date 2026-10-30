const { app, BrowserWindow, ipcMain, dialog, shell, powerMonitor, net } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  buildAiEndpoint,
  extractAiContent,
  formatAiTransportError
} = require("./ai-client");

const DB_FILE = "bgm_blog_database.json";
const FOLDER_SYNC_CONFIG_FILE = "folder-sync.json";
const FOLDER_SYNC_FILE_PATTERN = /^bgm-blog-sync-[a-z0-9-]{6,80}\.json$/i;
const FOLDER_SYNC_MAX_FILE_BYTES = 64 * 1024 * 1024;
const APP_ICON = path.join(__dirname, "assets", "app-icon.ico");
const smokeTest = process.env.BGM_BLOG_SMOKE_TEST === "1";
app.setAppUserModelId("com.bgmlog.personal-blog");
if (smokeTest && process.env.BGM_BLOG_TEST_DATA) {
  app.setPath("userData", path.resolve(process.env.BGM_BLOG_TEST_DATA));
}
const singleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function databasePath() {
  return path.join(app.getPath("userData"), DB_FILE);
}

function folderSyncConfigPath() {
  return path.join(app.getPath("userData"), FOLDER_SYNC_CONFIG_FILE);
}

function defaultFolderSyncPath() {
  return path.join(app.getPath("documents"), "BGM Blog Sync");
}

async function readFolderSyncConfig() {
  try {
    const raw = await fs.readFile(folderSyncConfigPath(), "utf8");
    const data = JSON.parse(raw);
    return {
      configured: Boolean(data?.folderPath),
      folderPath: data?.folderPath ? path.resolve(data.folderPath) : defaultFolderSyncPath()
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { configured: false, folderPath: defaultFolderSyncPath() };
  }
}

async function saveFolderSyncConfig(folderPath) {
  await atomicWriteJson(folderSyncConfigPath(), { folderPath });
}

async function getFolderSyncInfo() {
  try {
    const config = await readFolderSyncConfig();
    return { ok: true, ...config };
  } catch (error) {
    return { ok: false, supported: true, error: error.message };
  }
}

async function chooseFolderSyncFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Syncthing 同步文件夹",
    defaultPath: (await readFolderSyncConfig()).folderPath,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const folderPath = path.resolve(result.filePaths[0]);
  try {
    await fs.mkdir(folderPath, { recursive: true });
    await saveFolderSyncConfig(folderPath);
    return { ok: true, configured: true, folderPath };
  } catch (error) {
    return { ok: false, supported: true, error: error.message };
  }
}

async function readFolderSyncSnapshots() {
  try {
    const config = await readFolderSyncConfig();
    if (!config.configured) {
      return { ok: false, configured: false, folderPath: config.folderPath, error: "尚未选择同步文件夹。" };
    }
    await fs.mkdir(config.folderPath, { recursive: true });
    const entries = await fs.readdir(config.folderPath, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isFile() || !FOLDER_SYNC_FILE_PATTERN.test(entry.name)) continue;
      const filePath = path.join(config.folderPath, entry.name);
      const info = await fs.stat(filePath);
      if (!info.size || info.size > FOLDER_SYNC_MAX_FILE_BYTES) continue;
      try {
        const raw = await fs.readFile(filePath, "utf8");
        snapshots.push({ name: entry.name, data: JSON.parse(raw) });
      } catch {
        // Ignore an incomplete file while Syncthing is still transferring it.
      }
      if (snapshots.length >= 24) break;
    }
    return { ok: true, configured: true, folderPath: config.folderPath, snapshots };
  } catch (error) {
    return { ok: false, supported: true, error: error.message };
  }
}

async function writeFolderSyncSnapshot(payload) {
  const { filename, data } = payload || {};
  if (!FOLDER_SYNC_FILE_PATTERN.test(String(filename || ""))) {
    return { ok: false, supported: true, error: "同步快照文件名无效。" };
  }
  try {
    const config = await readFolderSyncConfig();
    if (!config.configured) {
      return { ok: false, configured: false, folderPath: config.folderPath, error: "尚未选择同步文件夹。" };
    }
    await fs.mkdir(config.folderPath, { recursive: true });
    const target = path.join(config.folderPath, filename);
    await atomicWriteJson(target, data);
    return { ok: true, configured: true, folderPath: config.folderPath, path: target };
  } catch (error) {
    return { ok: false, supported: true, error: error.message };
  }
}

async function openFolderSyncFolder() {
  try {
    const config = await readFolderSyncConfig();
    await fs.mkdir(config.folderPath, { recursive: true });
    const error = await shell.openPath(config.folderPath);
    if (error) throw new Error(error);
    return { ok: true, folderPath: config.folderPath };
  } catch (error) {
    return { ok: false, supported: true, error: error.message };
  }
}

async function readDatabase() {
  try {
    const raw = await fs.readFile(databasePath(), "utf8");
    return { ok: true, data: JSON.parse(raw), path: databasePath() };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: true, data: null, path: databasePath() };
    }
    return { ok: false, error: error.message, path: databasePath() };
  }
}

async function atomicWriteJson(target, data) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  try {
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }
}

function safeFilename(value, fallback = "untitled") {
  return String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 90) || fallback;
}

function getBgmHeaders(token) {
  return {
    "User-Agent": "BangumiPersonalBlogDesktop/1.0 ([https://github.com/bgm-local-blog](https://github.com/bgm-local-blog))",
    Accept: "application/json",
    ...(token && token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {})
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
  const headers = getBgmHeaders(token);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "follow"
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

function isLocalHttpUrl(url) {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

async function requestAiChat(payload) {
  const { baseUrl, apiKey = "", model, messages = [] } = payload || {};
  let endpoint;
  try {
    endpoint = buildAiEndpoint(baseUrl);
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }

  if (!String(model || "").trim()) {
    return { ok: false, status: 0, error: "请先配置 AI 模型名称。" };
  }

  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => ["system", "user", "assistant"].includes(message?.role) && typeof message?.content === "string")
    .slice(-24)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 12000) }));

  try {
    const response = await net.fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(String(apiKey || "").trim() ? { Authorization: `Bearer ${String(apiKey).trim()}` } : {})
      },
      body: JSON.stringify({
        model: String(model).trim(),
        messages: safeMessages,
        temperature: 0.7,
        stream: false
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(60000)
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.error?.message || data?.message || response.statusText || "AI 请求失败。"
      };
    }
    const content = extractAiContent(data);
    if (!String(content).trim()) {
      return { ok: false, status: response.status, error: "AI 服务返回了空内容。" };
    }
    return {
      ok: true,
      status: response.status,
      content: String(content).trim(),
      usage: data?.usage || null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: formatAiTransportError(error)
    };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#f8f8f8",
    icon: APP_ICON,
    show: false,
    title: "番组手帐",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      webviewTag: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    try {
      const url = new URL(params.src);
      if (url.protocol !== "https:" && !isLocalHttpUrl(url)) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!smokeTest || process.env.BGM_BLOG_SMOKE_VISIBLE === "1") {
      mainWindow.show();
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      const aiBase = process.env.BGM_BLOG_SMOKE_AI_BASE || "";
      const aiKey = process.env.BGM_BLOG_SMOKE_AI_KEY || "smoke-key";
      const aiModel = process.env.BGM_BLOG_SMOKE_AI_MODEL || "smoke-model";
      const webUrl = process.env.BGM_BLOG_SMOKE_WEB_URL || "";
      const testRecommendations = process.env.BGM_BLOG_SMOKE_RECOMMENDATIONS === "1";
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const aiBase = ${JSON.stringify(aiBase)};
        const aiKey = ${JSON.stringify(aiKey)};
        const aiModel = ${JSON.stringify(aiModel)};
        const webUrl = ${JSON.stringify(webUrl)};
        const testRecommendations = ${JSON.stringify(testRecommendations)};
        const ai = aiBase ? await window.bgmApi.aiChat({
          baseUrl: aiBase,
          apiKey: aiKey,
          model: aiModel,
          messages: [{ role: "user", content: "smoke" }]
        }) : null;
        let embeddedWeb = null;
        if (webUrl) {
          embeddedWeb = await new Promise((resolve) => {
            const view = document.createElement("webview");
            const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 8000);
            view.addEventListener("dom-ready", () => {
              clearTimeout(timer);
              const loaded = { ok: true, url: view.getURL() };
              view.remove();
              resolve(loaded);
            }, { once: true });
            view.src = webUrl;
            view.style.width = "2px";
            view.style.height = "2px";
            document.body.appendChild(view);
          });
        }
        const yearbookExport = testRecommendations ? { skipped: true } : await (async () => {
          let yearbookButton = null;
          for (let attempt = 0; attempt < 30 && !yearbookButton; attempt += 1) {
            yearbookButton = [...document.querySelectorAll(".nav-button")]
              .find((item) => item.textContent.includes("年鉴"));
            if (!yearbookButton) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (!yearbookButton) return { clicked: false, exported: false, message: "missing yearbook navigation" };
          yearbookButton.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const exportButton = [...document.querySelectorAll(".yearbook-controls .button")]
            .find((item) => item.textContent.includes("导出长图"));
          if (!exportButton) return { clicked: false, exported: false, message: "missing export button" };
          exportButton.click();
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            const message = document.querySelector(".toast")?.textContent?.trim() || "";
            if (message.includes("长图已导出")) return { clicked: true, exported: true, message };
            if (message.includes("长图导出失败")) return { clicked: true, exported: false, message };
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return { clicked: true, exported: false, message: "export timeout" };
        })();
        const recommendations = await (async () => {
          if (!testRecommendations) return null;
          const subjectsButton = [...document.querySelectorAll(".nav-button")]
            .find((item) => item.textContent.includes("番组档案"));
          if (!subjectsButton) return { ok: false, error: "missing subjects navigation" };
          await new Promise((resolve) => setTimeout(resolve, 1200));
          subjectsButton.click();
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            const error = document.querySelector(".queue-recommendation-error")?.textContent?.trim();
            if (error) return { ok: false, error };
            const groups = [...document.querySelectorAll(".queue-recommendation-group")].map((group) => ({
              title: group.querySelector(".queue-recommendation-group-head h3")?.textContent?.trim() || "",
              cards: [...group.querySelectorAll(".queue-recommendation-card")].map((card) => ({
                title: card.querySelector("h3")?.textContent?.trim() || "",
                reason: card.querySelector(".queue-recommendation-reason")?.textContent?.trim() || ""
              }))
            }));
            if (groups.some((group) => group.cards.length)) {
              return {
                ok: groups.every((group) => group.cards.every((card) => card.reason)),
                groups
              };
            }
          }
          return { ok: false, error: "recommendation timeout" };
        })();
        const aiSettingsTest = await (async () => {
          const settingsButton = document.querySelector('[aria-label="打开系统设置"]');
          if (!settingsButton) return { ok: false, error: "missing settings button" };
          settingsButton.click();
          await new Promise((resolve) => setTimeout(resolve, 120));
          const testButton = [...document.querySelectorAll(".setting-actions .button")]
            .find((button) => button.textContent.includes("测试连接"));
          const statusSlot = document.querySelector(".ai-connection-status");
          const result = {
            ok: Boolean(testButton),
            button: testButton?.textContent?.trim() || "",
            statusInitiallyHidden: !statusSlot
          };
          document.querySelector('[aria-label="关闭设置"]')?.click();
          return result;
        })();
        return {
          title: document.querySelector("h1")?.textContent?.trim(),
          rootMounted: document.querySelector("#app")?.hasAttribute("data-v-app"),
          nodeIntegration: typeof require === "function",
          bridgeAvailable: typeof window.bgmApi?.loadDatabase === "function",
          aiBridgeAvailable: typeof window.bgmApi?.aiChat === "function",
          ai,
          embeddedWeb,
          yearbookExport,
          recommendations,
          aiSettingsTest
        };
      })()`).catch((error) => ({ error: error.message }));
      console.log(`BGM_BLOG_SMOKE_RESULT ${JSON.stringify(result)}`);
      setTimeout(() => app.quit(), 350);
    });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function requestRendererDateRefresh() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:system-resume");
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  powerMonitor.on("resume", requestRendererDateRefresh);
  powerMonitor.on("unlock-screen", requestRendererDateRefresh);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

ipcMain.handle("database:load", readDatabase);

ipcMain.handle("database:save", async (_event, data) => {
  try {
    await atomicWriteJson(databasePath(), data);
    return { ok: true, path: databasePath() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("bangumi:request", (_event, payload) => requestBangumi(payload));
ipcMain.handle("ai:chat", (_event, payload) => requestAiChat(payload));

ipcMain.handle("backup:export", async (_event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出番组手帐备份",
    defaultPath: `bgm-blog-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 数据备份", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), "utf8");
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("backup:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入番组手帐备份",
    properties: ["openFile"],
    filters: [{ name: "JSON 数据备份", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const raw = await fs.readFile(result.filePaths[0], "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !Array.isArray(data.posts)) {
      throw new Error("备份文件缺少有效的 posts 数组。");
    }
    return { ok: true, data, path: result.filePaths[0] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("markdown:export-all", async (_event, posts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Markdown 导出文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const folder = result.filePaths[0];
  try {
    let count = 0;
    for (const post of Array.isArray(posts) ? posts : []) {
      if (post.kind !== "article") continue;
      const date = String(post.createdAt || "").slice(0, 10) || "undated";
      const filename = `${date}-${safeFilename(post.title, "blog")}.md`;
      const frontmatter = [
        "---",
        `title: ${JSON.stringify(post.title || "无题日志")}`,
        `date: ${JSON.stringify(post.createdAt || "")}`,
        `updated: ${JSON.stringify(post.updatedAt || post.createdAt || "")}`,
        `tags: [${(post.tags || []).map((tag) => JSON.stringify(tag)).join(", ")}]`,
        "---",
        ""
      ].join("\n");
      await fs.writeFile(path.join(folder, filename), `${frontmatter}${post.content || ""}\n`, "utf8");
      count += 1;
    }
    return { ok: true, count, path: folder };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("markdown:export-one", async (_event, post) => {
  if (!post || post.kind !== "article") return { ok: false, error: "只能导出长文。" };
  const defaultName = `${String(post.createdAt || "").slice(0, 10) || "undated"}-${safeFilename(post.title, "blog")}.md`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 Markdown",
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fs.writeFile(result.filePath, `# ${post.title || "无题日志"}\n\n${post.content || ""}\n`, "utf8");
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("yearbook:choose-image", async (_event, payload) => {
  const { filename } = payload || {};
  const defaultName = `${safeFilename(filename, "personal-yearbook.png").replace(/\.png$/i, "")}.png`;
  if (smokeTest && process.env.BGM_BLOG_YEARBOOK_EXPORT_PATH) {
    return { ok: true, filePath: path.resolve(process.env.BGM_BLOG_YEARBOOK_EXPORT_PATH) };
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出年鉴长图",
    defaultPath: path.join(app.getPath("pictures"), defaultName),
    filters: [{ name: "PNG 长图", extensions: ["png"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const filePath = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`;
  return { ok: true, filePath };
});

ipcMain.handle("yearbook:capture-viewport", async (event, payload) => {
  const { rect } = payload || {};
  const captureRect = {
    x: Math.max(0, Math.round(Number(rect?.x) || 0)),
    y: Math.max(0, Math.round(Number(rect?.y) || 0)),
    width: Math.round(Number(rect?.width) || 0),
    height: Math.round(Number(rect?.height) || 0)
  };
  if (captureRect.width < 320 || captureRect.height < 200) {
    return { ok: false, error: "当前视口尺寸异常，无法截取年鉴区块。" };
  }
  if (captureRect.width > 2400 || captureRect.height > 2400) {
    return { ok: false, error: "当前视口尺寸超出安全截图范围。" };
  }
  try {
    event.sender.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const image = await event.sender.capturePage(captureRect);
    if (image.isEmpty()) throw new Error("页面截图为空。");
    return { ok: true, dataUrl: image.toDataURL(), size: image.getSize() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("yearbook:save-image", async (_event, payload) => {
  const { filePath, dataUrl } = payload || {};
  if (typeof filePath !== "string" || !/\.png$/i.test(filePath)) {
    return { ok: false, error: "长图保存路径无效。" };
  }
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    return { ok: false, error: "长图数据为空或格式不正确。" };
  }
  try {
    const buffer = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    if (!buffer.length || buffer.length > 100 * 1024 * 1024) {
      throw new Error("长图文件为空或超过 100 MB 安全上限。");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return { ok: true, path: filePath, bytes: buffer.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("path:reveal-database", async () => {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const target = databasePath();
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, JSON.stringify({ posts: [] }, null, 2), "utf8");
  }
  shell.showItemInFolder(target);
  return { ok: true, path: target };
});

ipcMain.handle("app:database-path", () => databasePath());
ipcMain.handle("folder-sync:info", getFolderSyncInfo);
ipcMain.handle("folder-sync:choose-folder", chooseFolderSyncFolder);
ipcMain.handle("folder-sync:read-snapshots", readFolderSyncSnapshots);
ipcMain.handle("folder-sync:write-snapshot", (_event, payload) => writeFolderSyncSnapshot(payload));
ipcMain.handle("folder-sync:open-folder", openFolderSyncFolder);
