(function initImageUrl(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ImageUrl = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createImageUrlApi() {
  function secure(value) {
    const url = String(value || "").trim();
    if (/^http:\/\//i.test(url)) return `https://${url.slice("http://".length)}`;
    return url;
  }

  function secureSet(images) {
    if (!images || typeof images !== "object" || Array.isArray(images)) return {};
    return Object.fromEntries(
      Object.entries(images).map(([key, value]) => [
        key,
        typeof value === "string" ? secure(value) : value
      ])
    );
  }

  return { secure, secureSet };
});
