import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, "public", "ocr");
const workerSource = path.join(path.dirname(require.resolve("tesseract.js/package.json")), "dist", "worker.min.js");
const coreSource = path.dirname(require.resolve("tesseract.js-core/package.json"));
const languageSource = path.dirname(require.resolve("@tesseract.js-data/eng/package.json"));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "core"), { recursive: true });
await mkdir(path.join(outputRoot, "lang"), { recursive: true });
await cp(workerSource, path.join(outputRoot, "worker.min.js"));

const coreFiles = (await readdir(coreSource)).filter(
  (file) => file.startsWith("tesseract-core-") && file.includes("lstm.wasm"),
);
for (const file of coreFiles) {
  await cp(path.join(coreSource, file), path.join(outputRoot, "core", file));
}

const languageFile = (await readdir(languageSource, { recursive: true })).find(
  (file) => file.endsWith("eng.traineddata.gz") && file.includes("4.0.0_best_int"),
);
if (!languageFile) throw new Error("未找到 Tesseract 英文语言包");
await cp(path.join(languageSource, languageFile), path.join(outputRoot, "lang", "eng.traineddata.gz"));

console.log(`OCR assets prepared: ${coreFiles.length + 2} files`);
