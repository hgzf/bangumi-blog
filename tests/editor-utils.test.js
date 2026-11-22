const test = require("node:test");
const assert = require("node:assert/strict");

const EditorUtils = require("../editor-utils");

test("publish uses the latest Chinese text from the editor DOM", () => {
  assert.equal(
    EditorUtils.latestContent("", "今天写了一条测试"),
    "今天写了一条测试"
  );
});

test("publish respects an intentionally cleared editor", () => {
  assert.equal(EditorUtils.latestContent("旧内容", ""), "");
});
