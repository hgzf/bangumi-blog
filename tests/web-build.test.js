const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = resolve(__dirname, "..");
const moduleUrl = pathToFileURL(join(projectRoot, "scripts", "web-build-lib.mjs")).href;

async function loadLib() {
  return import(moduleUrl);
}

test("vendor path rewriting removes node_modules and rejects unknown references", async () => {
  const { rewriteVendorPaths } = await loadLib();
  const rewritten = rewriteVendorPaths(`
    <link rel="stylesheet" href="./node_modules/@highlightjs/cdn-assets/styles/github.min.css">
    <script src="./node_modules/vue/dist/vue.global.prod.js"></script>
    <script src="./node_modules/marked/marked.min.js"></script>
    <script src="./node_modules/dompurify/dist/purify.min.js"></script>
    <script src="./node_modules/@highlightjs/cdn-assets/highlight.min.js"></script>
  `);

  assert.doesNotMatch(rewritten, /node_modules/);
  assert.match(rewritten, /\.\/vendor\/vue\.global\.prod\.js/);
  assert.match(rewritten, /\.\/vendor\/highlight\.min\.js/);
  assert.match(rewritten, /\.\/vendor\/mobile-native\.bundle\.js/);
  assert.throws(
    () => rewriteVendorPaths('<script src="./node_modules/unknown/file.js"></script>'),
    /Unresolved node_modules reference/
  );
});

test("web build contains runtime files and passes security validation", async () => {
  const { buildWeb, validateWebBuild } = await loadLib();
  const outDir = await mkdtemp(join(tmpdir(), "bgm-web-build-"));
  try {
    await buildWeb({ rootDir: projectRoot, outDir });
    const index = await readFile(join(outDir, "index.html"), "utf8");

    assert.match(index, /\.\/vendor\/vue\.global\.prod\.js/);
    assert.doesNotMatch(index, /node_modules/);
    assert.match(await readFile(join(outDir, "renderer.js"), "utf8"), /createApp/);
    assert.match(await readFile(join(outDir, "platform", "platform-loader.js"), "utf8"), /bgmApi/);
    assert.ok((await readFile(join(outDir, "vendor", "mobile-native.bundle.js"))).length > 1000);
    assert.equal(await validateWebBuild(outDir), true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("web validation rejects personal shortcuts and migration seeds in the output", async () => {
  const { buildWeb, validateWebBuild } = await loadLib();
  const outDir = await mkdtemp(join(tmpdir(), "bgm-web-forbidden-"));
  try {
    await buildWeb({ rootDir: projectRoot, outDir });
    await writeFile(join(outDir, "personal.lnk"), "not allowed");
    await assert.rejects(validateWebBuild(outDir), /Forbidden web build file/);
    await rm(join(outDir, "personal.lnk"), { force: true });
    await writeFile(join(outDir, "mobile-seed.json"), "{}");
    await assert.rejects(validateWebBuild(outDir), /Forbidden web build file: mobile-seed\.json/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
