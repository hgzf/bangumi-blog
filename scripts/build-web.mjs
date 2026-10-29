import { buildWeb } from "./web-build-lib.mjs";

const result = await buildWeb();
console.log(`Web build complete: ${result.outDir} (${result.files} files)`);
