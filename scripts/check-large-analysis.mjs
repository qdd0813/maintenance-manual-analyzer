import assert from "node:assert/strict";
import { createAnalysisChunks } from "../frontend/src/chunking.ts";
import { emptyAnalysis, mergeAnalyses } from "../frontend/src/report.ts";

const pages = Array.from({ length: 25 }, (_, index) => {
  const pageNumber = index + 1;
  const tail = pageNumber === 25 ? " FINAL-EXPENDABLE FINAL-REFERENCE" : "";
  return `===== PAGE ${pageNumber} =====\n${`PAGE-${pageNumber}-CONTENT `.repeat(1200)}${tail}`;
});
const text = pages.join("\n\n");
const chunks = createAnalysisChunks(text);

assert.ok(text.length > 400_000, "fixture must represent a large extracted manual");
assert.ok(chunks.length > 1, "large manual must be split into multiple requests");
assert.equal(chunks[0].pageStart, 1);
assert.equal(chunks.at(-1)?.pageEnd, 25);
assert.ok(chunks.at(-1)?.text.includes("FINAL-REFERENCE"), "last-page reference must remain in a chunk");

const analyses = chunks.map((chunk, index) => ({
  ...emptyAnalysis,
  manualInfo: { ...emptyAnalysis.manualInfo, pageCount: 25 },
  toolMaterials: [],
  expendableParts: [
    {
      name: index === chunks.length - 1 ? "FINAL-EXPENDABLE" : `PART-${index + 1}`,
      itemNumber: String(index + 1),
      ipcReference: `IPC-${index + 1}`,
      requirement: "必须",
      basis: `PAGE ${chunk.pageEnd}`,
      applicability: "ALL/未限定",
      choiceGroup: "",
    },
  ],
  referencedInformation: [
    {
      referenceNumber: index === chunks.length - 1 ? "FINAL-REFERENCE" : `REF-${index + 1}`,
      description: `Reference from PAGE ${chunk.pageEnd}`,
      requirement: "必须",
      basis: `PAGE ${chunk.pageEnd}`,
      applicability: "ALL/未限定",
      choiceGroup: "",
    },
  ],
  choiceNotes: [],
  notes: [],
}));

const merged = mergeAnalyses(analyses, "large-manual.pdf", 25);
assert.equal(merged.expendableParts.length, chunks.length);
assert.equal(merged.referencedInformation.length, chunks.length);
assert.equal(merged.expendableParts.at(-1)?.name, "FINAL-EXPENDABLE");
assert.equal(merged.referencedInformation.at(-1)?.referenceNumber, "FINAL-REFERENCE");

console.log(`LARGE_ANALYSIS_CHECK_OK: ${text.length} characters -> ${chunks.length} chunks; final-page items preserved.`);
