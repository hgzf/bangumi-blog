(function loadPlatformBridge(root) {
  if (!root.PlatformContract) {
    throw new Error("Platform contract failed to load.");
  }
  let adapter;
  if (root.PlatformElectronBridge?.isAvailable()) {
    adapter = root.PlatformElectronBridge.create();
  } else if (root.PlatformMobileBridge?.isAvailable()) {
    adapter = root.PlatformMobileBridge.create();
  } else if (root.PlatformBrowserBridge) {
    adapter = root.PlatformBrowserBridge.create();
  } else {
    throw new Error("No platform bridge is available.");
  }
  root.PlatformContract.validateAdapter(adapter);
  root.bgmApi = adapter;
  root.bgmPlatform = {
    name: adapter.platform,
    label: adapter.label,
    capabilities: adapter.capabilities
  };
})(globalThis);
