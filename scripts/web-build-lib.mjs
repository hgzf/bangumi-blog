import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { build as esbuildBuild } from "esbuild";

export const VENDOR_FILES = Object.freeze([
  {
    source: "node_modules/vue/dist/vue.global.prod.js",
    target: "vendor/vue.global.prod.js"
  },
  {
    source: "node_modules/marked/marked.min.js",
    target: "vendor/marked.min.js"
  },
  {
    source: "node_modules/dompurify/dist/purify.min.js",
    target: "vendor/purify.min.js"
  },
  {
    source: "node_modules/@highlightjs/cdn-assets/highlight.min.js",
    target: "vendor/highlight.min.js"
  },
  {
    source: "node_modules/@highlightjs/cdn-assets/styles/github.min.css",
    target: "vendor/github.min.css"
  }
]);

export const RUNTIME_FILES = Object.freeze([
  "index.html",
  "styles.css",
  "renderer.js",
  "ai-client.js",
  "recommendation-engine.js",
  "period-report.js",
  "watch-session.js",
  "quarter-report.js",
  "folder-sync.js",
  "platform-contract.js",
  "platform/electron-bridge.js",
  "platform/mobile-bridge.js",
  "platform/browser-bridge.js",
  "platform/platform-loader.js",
  "assets/app-icon.png",
  "assets/app-icon-64.png",
  "assets/app-icon.ico",
  "assets/app-icon-20261028.ico",
  "assets/haruna-reference.png",
  "assets/haruna-reference-clean.png"
]);

export const REQUIRED_DIST_FILES = Object.freeze([
  ...RUNTIME_FILES,
  ...VENDOR_FILES.map((entry) => entry.target),
  "vendor/mobile-native.bundle.js"
]);

const VENDOR_REPLACEMENTS = new Map([
  [
    "./node_modules/vue/dist/vue.global.prod.js",
    "./vendor/vue.global.prod.js"
  ],
  [
    "./node_modules/marked/marked.min.js",
    "./vendor/marked.min.js"
  ],
  [
    "./node_modules/dompurify/dist/purify.min.js",
    "./vendor/purify.min.js"
  ],
  [
    "./node_modules/@highlightjs/cdn-assets/highlight.min.js",
    "./vendor/highlight.min.js"
  ],
  [
    "./node_modules/@highlightjs/cdn-assets/styles/github.min.css",
    "./vendor/github.min.css"
  ]
]);

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".md", ".txt"]);
const FORBIDDEN_EXTENSIONS = new Set([
  ".lnk", ".jks", ".keystore", ".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3"
]);
const MAX_BUILD_SIZE = 2 * 1024 * 1024;

export function rewriteVendorPaths(html) {
  let result = String(html || "");
  for (const [source, target] of VENDOR_REPLACEMENTS) {
    result = result.replaceAll(source, target);
  }
  if (result.includes("node_modules")) {
    const reference = result.match(/[^"'\s]*node_modules[^"'\s]*/)?.[0] || "node_modules";
    throw new Error(`Unresolved node_modules reference: ${reference}`);
  }
  const mobileBundleTag = '<script src="./vendor/mobile-native.bundle.js"></script>';
  if (!result.includes(mobileBundleTag)) {
    const mobileBridgeTag = '<script src="./platform/mobile-bridge.js"></script>';
    if (result.includes(mobileBridgeTag)) {
      result = result.replace(
        mobileBridgeTag,
        `${mobileBridgeTag}\n  ${mobileBundleTag}`
      );
    } else if (result.includes("</body>")) {
      result = result.replace("</body>", `  ${mobileBundleTag}\n</body>`);
    } else {
      result += `\n${mobileBundleTag}`;
    }
  }
  return result;
}

async function copyRuntimeFile(rootDir, outDir, relativePath) {
  const source = join(rootDir, relativePath);
  const target = join(outDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

export async function buildWeb({
  rootDir = process.cwd(),
  outDir = join(rootDir, "dist")
} = {}) {
  const resolvedRoot = resolve(rootDir);
  const resolvedOut = resolve(outDir);
  if (resolvedRoot === resolvedOut) {
    throw new Error("Refusing to build into the project root.");
  }
  await rm(resolvedOut, { recursive: true, force: true });
  await mkdir(resolvedOut, { recursive: true });

  for (const relativePath of RUNTIME_FILES) {
    if (relativePath === "index.html") continue;
    await copyRuntimeFile(resolvedRoot, resolvedOut, relativePath);
  }
  for (const vendor of VENDOR_FILES) {
    const target = join(resolvedOut, vendor.target);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(resolvedRoot, vendor.source), target);
  }

  await esbuildBuild({
    entryPoints: [join(resolvedRoot, "platform", "mobile-native-entry.js")],
    outfile: join(resolvedOut, "vendor", "mobile-native.bundle.js"),
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    logLevel: "silent"
  });

  const index = await readFile(join(resolvedRoot, "index.html"), "utf8");
  await writeFile(join(resolvedOut, "index.html"), rewriteVendorPaths(index), "utf8");
  return {
    outDir: resolvedOut,
    files: (await walkFiles(resolvedOut)).length
  };
}

function isForbiddenPath(filePath, relativePath) {
  const name = relativePath.toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(extname(name))) return true;
  return name === "bgm_blog_database.json" ||
    name.endsWith("/bgm_blog_database.json") ||
    name.includes(".taste-skill/") ||
    name.includes("node_modules/");
}

async function validateHtmlReferences(outDir, html) {
  for (const match of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (
      !reference ||
      reference.startsWith("#") ||
      /^(?:https?:|data:|blob:|mailto:)/i.test(reference)
    ) {
      continue;
    }
    if (reference.startsWith("file://") || /^[A-Za-z]:[\\/]/.test(reference)) {
      throw new Error(`Absolute path in web build: ${reference}`);
    }
    const clean = reference.split(/[?#]/)[0].replace(/^\.\//, "");
    if (!clean) continue;
    const target = resolve(outDir, clean);
    const targetRelative = relative(resolve(outDir), target);
    if (targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
      throw new Error(`Reference escapes web build: ${reference}`);
    }
    try {
      await stat(target);
    } catch {
      throw new Error(`Missing web asset referenced by index.html: ${reference}`);
    }
  }
}

export async function validateWebBuild(outDir = join(process.cwd(), "dist")) {
  const root = resolve(outDir);
  let files;
  try {
    files = await walkFiles(root);
  } catch (error) {
    throw new Error(`Web build directory is unreadable: ${error.message}`);
  }

  const relativeFiles = files.map((file) => relative(root, file).replaceAll("\\", "/"));
  for (const relativePath of relativeFiles) {
    if (isForbiddenPath(resolve(root, relativePath), relativePath)) {
      throw new Error(`Forbidden web build file: ${relativePath}`);
    }
  }
  for (const required of REQUIRED_DIST_FILES) {
    if (!relativeFiles.includes(required.replaceAll("\\", "/"))) {
      throw new Error(`Missing required web build file: ${required}`);
    }
  }

  const index = await readFile(join(root, "index.html"), "utf8");
  if (index.includes("node_modules")) {
    throw new Error("Web build still references node_modules.");
  }
  await validateHtmlReferences(root, index);

  let totalSize = 0;
  for (const file of files) {
    const fileStat = await stat(file);
    totalSize += fileStat.size;
    if (fileStat.size === 0 && TEXT_EXTENSIONS.has(extname(file).toLowerCase())) {
      throw new Error(`Empty web build text file: ${relative(root, file)}`);
    }
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const text = await readFile(file, "utf8");
    if (text.includes("node_modules") || /\b[A-Za-z]:[\\/]/.test(text)) {
      throw new Error(`Unsafe path in web build text file: ${relative(root, file)}`);
    }
  }
  if (totalSize > MAX_BUILD_SIZE) {
    throw new Error(`Web build exceeds 2 MB: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }
  return true;
}
