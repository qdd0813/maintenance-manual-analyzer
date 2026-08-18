export const ANALYSIS_CHUNK_CHARACTERS = 60_000;

export type AnalysisChunk = {
  text: string;
  pageStart: number;
  pageEnd: number;
};

function splitTextPart(text: string, maxCharacters: number) {
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxCharacters) {
    parts.push(text.slice(offset, offset + maxCharacters));
  }
  return parts;
}

export function createAnalysisChunks(text: string, maxCharacters = ANALYSIS_CHUNK_CHARACTERS): AnalysisChunk[] {
  const matches = [...text.matchAll(/^===== PAGE (\d+) =====$/gm)];
  if (!matches.length) {
    return splitTextPart(text, maxCharacters).map((part) => ({ text: part, pageStart: 1, pageEnd: 1 }));
  }

  const pages = matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? text.length;
    return { pageNumber: Number(match[1]), text: text.slice(start, end).trim() };
  });
  const chunks: AnalysisChunk[] = [];
  let currentPages: typeof pages = [];
  let currentLength = 0;

  const flush = () => {
    if (!currentPages.length) return;
    chunks.push({
      text: currentPages.map((page) => page.text).join("\n\n"),
      pageStart: currentPages[0].pageNumber,
      pageEnd: currentPages[currentPages.length - 1].pageNumber,
    });
    currentPages = [];
    currentLength = 0;
  };

  for (const page of pages) {
    if (page.text.length > maxCharacters) {
      flush();
      const marker = `===== PAGE ${page.pageNumber} =====\n`;
      for (const part of splitTextPart(page.text.slice(marker.length), maxCharacters - marker.length)) {
        chunks.push({ text: `${marker}${part}`, pageStart: page.pageNumber, pageEnd: page.pageNumber });
      }
      continue;
    }
    if (currentPages.length && currentLength + page.text.length + 2 > maxCharacters) flush();
    currentPages.push(page);
    currentLength += page.text.length + 2;
  }
  flush();
  return chunks;
}
