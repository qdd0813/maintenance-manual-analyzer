import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: pnpm check:pdf-text /path/to/manual.pdf");
  process.exit(1);
}

const loadingTask = getDocument({
  data: new Uint8Array(await readFile(pdfPath)),
  useWorkerFetch: false,
  disableFontFace: true,
});
const pdf = await loadingTask.promise;

let text = "";

for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

await loadingTask.destroy();

console.log(`pages=${pdf.numPages || 0}`);
console.log(`characters=${text.trim().length}`);
console.log(text.trim() ? "status=text-layer-detected" : "status=no-text-layer");
