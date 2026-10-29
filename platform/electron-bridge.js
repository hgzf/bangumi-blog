(function initElectronBridge(root) {
  function getIpcRenderer() {
    try {
      return require("electron").ipcRenderer;
    } catch {
      return null;
    }
  }

  function isAvailable() {
    return Boolean(getIpcRenderer());
  }

  function create() {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) throw new Error("Electron IPC bridge is unavailable.");

    return root.PlatformContract.createAdapter({
      platform: "electron",
      label: "Electron",
      capabilities: {
        database: true,
        bangumi: true,
        ai: true,
        backupExport: true,
        backupImport: true,
        markdownExport: true,
        yearbookImage: true,
        embeddedAiWeb: true,
        systemResume: true,
        revealDatabase: true,
        secureStorage: false
      },
      methods: {
        loadDatabase: () => ipcRenderer.invoke("database:load"),
        saveDatabase: (data) => ipcRenderer.invoke("database:save", data),
        requestBangumi: (payload) => ipcRenderer.invoke("bangumi:request", payload),
        aiChat: (payload) => ipcRenderer.invoke("ai:chat", payload),
        onSystemResume: (callback) => {
          if (typeof callback !== "function") return () => {};
          const listener = () => callback();
          ipcRenderer.on("app:system-resume", listener);
          return () => ipcRenderer.removeListener("app:system-resume", listener);
        },
        exportBackup: (data) => ipcRenderer.invoke("backup:export", data),
        importBackup: () => ipcRenderer.invoke("backup:import"),
        exportAllMarkdown: (posts) => ipcRenderer.invoke("markdown:export-all", posts),
        exportOneMarkdown: (post) => ipcRenderer.invoke("markdown:export-one", post),
        chooseYearbookImage: (payload) => ipcRenderer.invoke("yearbook:choose-image", payload),
        captureYearbookViewport: (payload) => ipcRenderer.invoke("yearbook:capture-viewport", payload),
        saveYearbookImage: (payload) => ipcRenderer.invoke("yearbook:save-image", payload),
        revealDatabase: () => ipcRenderer.invoke("path:reveal-database"),
        getDatabasePath: () => ipcRenderer.invoke("app:database-path")
      },
      secureStorage: {
        get: async (key) => localStorage.getItem(key),
        set: async (key, value) => localStorage.setItem(key, value),
        remove: async (key) => localStorage.removeItem(key)
      }
    });
  }

  root.PlatformElectronBridge = { isAvailable, create };
})(globalThis);
