import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jsonrepair } from "jsonrepair";
import { emptyAnalysis, type ManualAnalysis } from "../shared/report.js";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE, fillPromptTemplate } from "../shared/prompt.js";


const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";


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


function normalizeAnalysis(value: unknown, fallback: AnalyzeBody): ManualAnalysis {
  const input = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const manualInfo = typeof input.manualInfo === "object" && input.manualInfo ? (input.manualInfo as Record<string, unknown>) : {};
