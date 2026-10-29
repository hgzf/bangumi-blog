const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAiEndpoint,
  extractAiContent,
  formatAiTransportError
} = require("../ai-client");

test("builds a chat completions endpoint from a provider base URL", () => {
  assert.equal(
    buildAiEndpoint("https://api.deepseek.com/v1").toString(),
    "https://api.deepseek.com/v1/chat/completions"
  );
});

test("keeps an explicit chat completions endpoint unchanged", () => {
  assert.equal(
    buildAiEndpoint("https://example.com/v1/chat/completions").toString(),
    "https://example.com/v1/chat/completions"
  );
});

test("extracts text from common OpenAI-compatible responses", () => {
  assert.equal(
    extractAiContent({ choices: [{ message: { content: "春菜回复" } }] }),
    "春菜回复"
  );
  assert.equal(
    extractAiContent({ choices: [{ message: { content: [{ text: "分" }, { text: "段" }] } }] }),
    "分段"
  );
  assert.equal(extractAiContent({ output_text: "兼容输出" }), "兼容输出");
});

test("turns generic fetch failures into actionable network diagnostics", () => {
  const error = new TypeError("fetch failed");
  error.cause = { code: "ECONNREFUSED", message: "connect refused" };

  const message = formatAiTransportError(error);

  assert.match(message, /ECONNREFUSED/);
  assert.match(message, /代理|VPN/);
  assert.doesNotMatch(message, /^fetch failed$/);
});
