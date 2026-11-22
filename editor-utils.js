(function initEditorUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EditorUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEditorUtilsApi() {
  function latestContent(modelValue, domValue) {
    return typeof domValue === "string" ? domValue : String(modelValue || "");
  }

  return { latestContent };
});
