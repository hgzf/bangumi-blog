(function initMobileBridge(root) {
  function isAvailable() {
    const capacitor = root.Capacitor;
    if (!capacitor) return false;
    const platform = typeof capacitor.getPlatform === "function"
      ? capacitor.getPlatform()
      : "";
    return platform === "android" ||
      (typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
  }

  function create() {
    return root.PlatformContract.createAdapter({
      platform: "android",
      label: "Android placeholder",
      capabilities: {},
      methods: {}
    });
  }

  root.PlatformMobileBridge = { isAvailable, create };
})(globalThis);
