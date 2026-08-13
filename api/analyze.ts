import type { VercelRequest, VercelResponse } from "@vercel/node";

const { jsonrepair } = require("jsonrepair") as typeof import("jsonrepair");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const DEFAULT_SYSTEM_PROMPT = `你是一名严谨的航空维修资料分析员。你必须只依据用户提供的维修手册文本进行判断，不得编造。

任务目标：提取维修工作中需要准备的 Fixtures, Tools, Test and Support Equipment、Consumable Materials、Expendable Parts、Referenced Information，并判断“必须/视情”。

输出必须是严格 JSON，不能包含 Markdown、解释性前后缀或代码块。`;

const DEFAULT_USER_PROMPT_TEMPLATE = `请根据以下维修手册 OCR/文本内容输出分析结果。

必须输出 manualInfo、toolMaterials、expendableParts、referencedInformation、choiceNotes、notes。每条必须标注 requirement、basis、applicability、choiceGroup；判断依据必须包含原文和页码。条件性、选择性或按需表达标为“视情”，明确要求使用或参考标为“必须”。只返回严格 JSON。

文件名：{{sourceName}}
页数：{{pageCount}}

维修手册文本：
{{manualText}}`;

const emptyAnalysis = {
  manualInfo: { sourceName: "", taskNumber: "", taskTitle: "", applicability: "", revision: "", pageCount: 0 },
  toolMaterials: [],
  expendableParts: [],
  referencedInformation: [],
  choiceNotes: [],
  notes: [],
};

type AnalyzeBody = {
  sourceName?: string;
  pageCount?: number;
  extractedText?: string;
  model?: string;
  systemPrompt?: string;
  promptTemplate?: string;
};

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequirement(value: unknown) {
  const text = normalizeString(value);
  if (text.includes("视情")) return "视情";
  if (text.includes("必须")) return "必须";
  return text || "视情";
}

function normalizeAnalysis(value: unknown, fallback: AnalyzeBody) {
  const input = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const manualInfo = typeof input.manualInfo === "object" && input.manualInfo ? (input.manualInfo as Record<string, unknown>) : {};
  const mapArray = <T>(items: unknown, mapper: (row: Record<string, unknown>) => T) =>
    Array.isArray(items) ? items.map((item) => mapper(typeof item === "object" && item ? (item as Record<string, unknown>) : {})) : [];

  return {
    manualInfo: {
      sourceName: normalizeString(manualInfo.sourceName) || fallback.sourceName || "",
      taskNumber: normalizeString(manualInfo.taskNumber),
      taskTitle: normalizeString(manualInfo.taskTitle),
      applicability: normalizeString(manualInfo.applicability),
      revision: normalizeString(manualInfo.revision),
      pageCount: Number(manualInfo.pageCount) || fallback.pageCount || 0,
    },
    toolMaterials: mapArray(input.toolMaterials, (row) => ({
      name: normalizeString(row.name),
      partNumber: normalizeString(row.partNumber),
      quantity: normalizeString(row.quantity),
      requirement: normalizeRequirement(row.requirement),
      basis: normalizeString(row.basis),
      applicability: normalizeString(row.applicability) || "ALL/未限定",
      choiceGroup: normalizeString(row.choiceGroup),
    })),
    expendableParts: mapArray(input.expendableParts, (row) => ({
      name: normalizeString(row.name),
      itemNumber: normalizeString(row.itemNumber),
      ipcReference: normalizeString(row.ipcReference),
      requirement: normalizeRequirement(row.requirement),
      basis: normalizeString(row.basis),
      applicability: normalizeString(row.applicability) || "ALL/未限定",
      choiceGroup: normalizeString(row.choiceGroup),
    })),
    referencedInformation: mapArray(input.referencedInformation, (row) => ({
      referenceNumber: normalizeString(row.referenceNumber),
      description: normalizeString(row.description),
      requirement: normalizeRequirement(row.requirement),
      basis: normalizeString(row.basis),
      applicability: normalizeString(row.applicability) || "ALL/未限定",
      choiceGroup: normalizeString(row.choiceGroup),
    })),
    choiceNotes: Array.isArray(input.choiceNotes) ? input.choiceNotes.map(normalizeString).filter(Boolean) : [],
    notes: Array.isArray(input.notes) ? input.notes.map(normalizeString).filter(Boolean) : [],
  };
}

function fillPromptTemplate(template: string, values: { sourceName: string; pageCount: number; manualText: string }) {
  return template
    .replaceAll("{{sourceName}}", values.sourceName)
    .replaceAll("{{pageCount}}", String(values.pageCount))
    .replaceAll("{{manualText}}", values.manualText);
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || trimmed;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const objectText = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(objectText);
    } catch {
      return JSON.parse(jsonrepair(objectText));
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(jsonrepair(raw));
  }
}

async function getBody(request: VercelRequest): Promise<AnalyzeBody> {
  if (request.body && typeof request.body === "object") return request.body as AnalyzeBody;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "只支持 POST 请求" });
    return;
  }

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      response.status(500).json({ error: "后端缺少 DEEPSEEK_API_KEY 环境变量" });
      return;
    }

    const body = await getBody(request);
    const sourceName = normalizeString(body.sourceName) || "未命名PDF";
    const pageCount = Number(body.pageCount) || 0;
    const extractedText = normalizeString(body.extractedText);

    if (!extractedText || extractedText.length < 30) {
      response.status(400).json({ error: "PDF 文本过短，请先完成 OCR 或检查文件" });
      return;
    }

    const prompt = fillPromptTemplate(body.promptTemplate || DEFAULT_USER_PROMPT_TEMPLATE, {
      sourceName,
      pageCount,
      manualText: extractedText.slice(0, 180_000),
    });

    const deepseekResponse = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: normalizeString(body.model) || "deepseek-v4-flash",
        messages: [
          { role: "system", content: body.systemPrompt || DEFAULT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        thinking: { type: "disabled" },
      }),
    });

    const payload = await deepseekResponse.json();
    if (!deepseekResponse.ok) {
      response.status(deepseekResponse.status).json({
        error: payload?.error?.message || "DeepSeek API 调用失败",
      });
      return;
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      response.status(502).json({ error: "DeepSeek 未返回可解析内容" });
      return;
    }

    const analysis = normalizeAnalysis(parseJsonContent(content), { ...body, sourceName, pageCount });
    response.status(200).json({ analysis });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "分析失败",
      analysis: emptyAnalysis,
    });
  }
}

module.exports = handler;
