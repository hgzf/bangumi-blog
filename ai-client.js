(function initAiClient(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AiClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAiClient() {
  function buildAiEndpoint(baseUrl) {
    const parsed = new URL(String(baseUrl || "").trim());
    if (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))) {
      throw new Error("AI 地址必须使用 HTTPS；本地模型可使用 localhost HTTP。");
    }
    if (/\/chat\/completions\/?$/.test(parsed.pathname)) return parsed;
    return new URL(`${parsed.toString().replace(/\/+$/, "")}/chat/completions`);
  }

  function extractAiContent(data) {
    const message = data?.choices?.[0]?.message?.content;
    const content = Array.isArray(message)
      ? message.map((part) => part?.text || "").join("")
      : message || data?.output_text || data?.response || data?.result || "";
    return String(content || "").trim();
  }

  function findErrorCode(error, depth = 0) {
    if (!error || depth > 4) return "";
    if (typeof error === "string") return error;
    return error.code || error.errno || findErrorCode(error.cause, depth + 1) || "";
  }

  function formatAiTransportError(error) {
    const code = String(findErrorCode(error) || "").trim();
    if (error?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return "AI 请求超时，请检查网络、代理或服务状态后重试。";
    }
    const causeMessage = String(error?.cause?.message || "").trim();
    const detail = [code, causeMessage].filter(Boolean).join("：");
    const hint = "请检查系统代理、VPN、防火墙或 AI 地址后重试。";
    if (detail) return `网络连接失败（${detail}）。${hint}`;
    return `网络连接失败。${hint}`;
  }

  return {
    buildAiEndpoint,
    extractAiContent,
    formatAiTransportError
  };
});
