import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";
import { createAnalysisChunks, type AnalysisChunk } from "./chunking";
import { analysisToMarkdown, emptyAnalysis, mergeAnalyses, type ManualAnalysis } from "./report";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE } from "../../shared/prompt";
import "./app.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Status = {
  stage: "idle" | "extracting" | "ocr" | "analyzing" | "done" | "error";
  message: string;
  progress: number;
};

type AdminConfig = {
  apiUrl: string;
  model: string;
  systemPrompt: string;
  promptTemplate: string;
};

const CONFIG_KEY = "mma-admin-config-v1";
const PASSWORD_KEY = "mma-admin-password-sha256";
const SAME_ORIGIN_API =
  window.location.hostname === "qdddd.cc" ||
  window.location.hostname.endsWith(".qdddd.cc") ||
  window.location.hostname.endsWith(".vercel.app");
const PRODUCTION_API_URL = SAME_ORIGIN_API
  ? new URL("/api/analyze", window.location.origin).href
  : "https://api.qdddd.cc/api/analyze";
const OCR_ASSET_ROOT = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href);
const ANALYSIS_CONCURRENCY = 2;

const defaultConfig: AdminConfig = {
  apiUrl: PRODUCTION_API_URL,
  model: "deepseek-v4-flash",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  promptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
};

function loadConfig(): AdminConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") as Partial<AdminConfig>;
    const config = { ...defaultConfig, ...saved };
    const apiUrl = config.apiUrl?.trim() || "";
    let usesLegacyApi = false;
    let usesUnsafeProductionApi = false;
    try {
      const parsedApiUrl = new URL(apiUrl);
      usesLegacyApi =
        parsedApiUrl.hostname === "maintenance-manual-analyzer.vercel.app" ||
        (SAME_ORIGIN_API && parsedApiUrl.hostname === "api.qdddd.cc");
      const productionPage = !["localhost", "127.0.0.1"].includes(window.location.hostname);
      usesUnsafeProductionApi =
        productionPage &&
        (parsedApiUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsedApiUrl.hostname));
    } catch {
      usesLegacyApi = true;
    }
    if (!apiUrl || apiUrl.startsWith("/") || usesLegacyApi || usesUnsafeProductionApi) {
      config.apiUrl = defaultConfig.apiUrl;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } else if (apiUrl !== config.apiUrl) {
      config.apiUrl = apiUrl;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
    return config;
  } catch {
    return defaultConfig;
  }
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function choiceClass(choiceGroup: string) {
  const normalized = choiceGroup.trim().toUpperCase();
  if (normalized.includes("A")) return "choiceA";
  if (normalized.includes("B")) return "choiceB";
  if (normalized.includes("C")) return "choiceC";
  if (normalized.includes("D")) return "choiceD";
  return "";
}

async function extractPdf(file: File, onStatus: (status: Status) => void) {
  const buffer = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
  const textPages: string[] = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    onStatus({
      stage: "extracting",
      message: `正在读取 PDF 文字层：第 ${pageIndex}/${document.numPages} 页`,
      progress: pageIndex / document.numPages,
    });
    const page = await document.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    textPages.push(pageText);
  }

  const text = textPages.map((pageText, index) => `===== PAGE ${index + 1} =====\n${pageText}`).join("\n\n");
  if (text.replace(/===== PAGE \d+ =====/g, "").trim().length > 200) {
    return { text, pageCount: document.numPages, mode: "PDF文字层" };
  }

  const worker = await createWorker("eng", 1, {
    workerPath: new URL("worker.min.js", OCR_ASSET_ROOT).href,
    corePath: new URL("core", OCR_ASSET_ROOT).href,
    langPath: new URL("lang", OCR_ASSET_ROOT).href,
  });
  const ocrPages: string[] = [];
  try {
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      onStatus({
        stage: "ocr",
        message: `未发现有效文字层，正在浏览器 OCR：第 ${pageIndex}/${document.numPages} 页`,
        progress: pageIndex / document.numPages,
      });
      const page = await document.getPage(pageIndex);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建 OCR 画布");

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      ocrPages.push(`===== PAGE ${pageIndex} =====\n${result.data.text.trim()}`);
    }
  } finally {
    await worker.terminate();
  }

  return { text: ocrPages.join("\n\n"), pageCount: document.numPages, mode: "浏览器 OCR" };
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ stage: "idle", message: "等待上传 PDF", progress: 0 });
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<ManualAnalysis>(emptyAnalysis);
  const [markdown, setMarkdown] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [extractMode, setExtractMode] = useState("");
  const [config, setConfig] = useState<AdminConfig>(loadConfig);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [workPasswordOpen, setWorkPasswordOpen] = useState(false);
  const [workPassword, setWorkPassword] = useState("");
  const [workPasswordError, setWorkPasswordError] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  const hasResult = analysis.toolMaterials.length + analysis.expendableParts.length + analysis.referencedInformation.length > 0;
  const textPreview = useMemo(() => extractedText.slice(0, 1500), [extractedText]);

  const saveConfig = (nextConfig: AdminConfig) => {
    setConfig(nextConfig);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig));
  };

  const unlockAdmin = async () => {
    setError("");
    const existingHash = localStorage.getItem(PASSWORD_KEY);
    if (!existingHash) {
      if (newPassword.length < 6) {
        setError("首次设置后台密码至少需要 6 位。");
        return;
      }
      localStorage.setItem(PASSWORD_KEY, await sha256(newPassword));
      setAdminUnlocked(true);
      setPasswordInput("");
      setNewPassword("");
      return;
    }
    if ((await sha256(passwordInput)) === existingHash) {
      setAdminUnlocked(true);
      setPasswordInput("");
      return;
    }
    setError("后台密码不正确。");
  };

  const resetConfig = () => {
    saveConfig(defaultConfig);
  };

  const requestAnalysis = () => {
    if (!file) {
      setError("请先上传 PDF 文件。");
      return;
    }

    setError("");
    setWorkPasswordError("");
    setWorkPasswordOpen(true);
  };

  const runAnalysis = async (submittedPassword: string) => {
    if (!file) return;

    setError("");
    setAnalysis(emptyAnalysis);
    setMarkdown("");

    let failureStage = "PDF 读取";
    try {
      const extracted = await extractPdf(file, setStatus);
      setExtractedText(extracted.text);
      setExtractMode(extracted.mode);

      failureStage = "后端分析";
      setStatus({ stage: "analyzing", message: "正在生成分析报告，请稍等…", progress: 0.95 });
      const chunks = createAnalysisChunks(extracted.text);
      const chunkResults = new Array<ManualAnalysis>(chunks.length);
      let nextChunkIndex = 0;
      let completedChunks = 0;

      const analyzeChunk = async (chunk: AnalysisChunk, chunkIndex: number, retryDepth = 0): Promise<ManualAnalysis[]> => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 285_000);
        let response: Response;
        try {
          response = await fetch(config.apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceName: file.name,
              pageCount: extracted.pageCount,
              extractedText: chunk.text,
              chunkIndex: chunkIndex + 1,
              chunkCount: chunks.length,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              model: config.model,
              systemPrompt: config.systemPrompt,
              promptTemplate: config.promptTemplate,
              workPassword: submittedPassword,
            }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }

        const responseText = await response.text();
        let payload: { analysis?: ManualAnalysis; error?: string; code?: string };
        try {
          payload = JSON.parse(responseText);
        } catch {
          if (response.status === 504) {
            throw new Error(`第 ${chunkIndex + 1}/${chunks.length} 个分块分析超时，请稍后重试。`);
          }
          throw new Error(`分析服务返回异常（HTTP ${response.status || "未知"}），请稍后重试。`);
        }
        if (response.status === 401) {
          setWorkPassword("");
          setWorkPasswordError("工作密码不正确，请重新输入。");
          setWorkPasswordOpen(true);
          throw new Error(payload.error || "工作密码错误");
        }
        if (response.status === 422 && payload.code === "OUTPUT_TRUNCATED" && retryDepth < 5) {
          const smallerChunks = createAnalysisChunks(chunk.text, Math.max(2_500, Math.floor(chunk.text.length / 2)));
          if (smallerChunks.length > 1) {
            const retriedResults: ManualAnalysis[] = [];
            for (const smallerChunk of smallerChunks) {
              retriedResults.push(...(await analyzeChunk(smallerChunk, chunkIndex, retryDepth + 1)));
            }
            return retriedResults;
          }
        }
        if (response.status === 422 && payload.code === "OUTPUT_TRUNCATED") {
          throw new Error("当前页面内容过密，自动细分后模型输出仍达到长度上限，请稍后重试。");
        }
        if (!response.ok) throw new Error(payload.error || `分析接口返回失败（HTTP ${response.status}）`);
        if (!payload.analysis) throw new Error("分析服务未返回报告内容，请重试。");
        return [payload.analysis];
      };

      const workers = Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, chunks.length) }, async () => {
        while (nextChunkIndex < chunks.length) {
          const chunkIndex = nextChunkIndex;
          nextChunkIndex += 1;
          const results = await analyzeChunk(chunks[chunkIndex], chunkIndex);
          chunkResults[chunkIndex] = mergeAnalyses(results, file.name, extracted.pageCount);
          completedChunks += 1;
          setStatus({
            stage: "analyzing",
            message: `正在分析完整手册：已完成 ${completedChunks}/${chunks.length} 个分块`,
            progress: 0.8 + (completedChunks / chunks.length) * 0.18,
          });
        }
      });
      await Promise.all(workers);

      const mergedAnalysis = mergeAnalyses(chunkResults, file.name, extracted.pageCount);
      setAnalysis(mergedAnalysis);
      setMarkdown(analysisToMarkdown(mergedAnalysis));
      setStatus({ stage: "done", message: "分析完成，可以预览或下载 PDF。", progress: 1 });
    } catch (caught) {
      setStatus({ stage: "error", message: "分析失败", progress: 0 });
      const message = caught instanceof Error ? caught.message : "未知错误";
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError(`${failureStage}超时，请检查网络后重试。`);
      } else if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
        setError(`${failureStage}失败：网络资源无法加载。请刷新页面后重试；若仍失败，请记录此提示。`);
      } else {
        setError(`${failureStage}失败：${message}`);
      }
    }
  };

  const submitWorkPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedPassword = workPassword.trim();
    if (!submittedPassword) {
      setWorkPasswordError("请输入工作密码。");
      return;
    }

    setWorkPasswordError("");
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifyPassword: true, workPassword: submittedPassword }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setWorkPasswordError(response.status === 401 ? "工作密码不正确，请重新输入。" : payload.error || "密码验证失败，请重试。");
        return;
      }

      setWorkPasswordOpen(false);
      await runAnalysis(submittedPassword);
      setWorkPassword("");
    } catch {
      setWorkPasswordError("密码验证服务暂时无法连接，请检查网络后重试。");
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown || analysisToMarkdown(analysis)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${analysis.manualInfo.sourceName || "维修手册"}_分析报告.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    if (!reportRef.current) return;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const reportWidth = reportRef.current.scrollWidth;
    const cssPageHeight = Math.max(1, Math.floor((reportWidth * pageHeight) / pageWidth));
    const reportHeight = reportRef.current.scrollHeight;

    for (let offset = 0, pageIndex = 0; offset < reportHeight; offset += cssPageHeight, pageIndex += 1) {
      const sliceHeight = Math.min(cssPageHeight, reportHeight - offset);
      const canvas = await html2canvas(reportRef.current, {
        scale: 1.5,
        backgroundColor: "#ffffff",
        useCORS: true,
        y: offset,
        width: reportWidth,
        height: sliceHeight,
        windowWidth: reportWidth,
        windowHeight: sliceHeight,
        ignoreElements: (element) => element.classList.contains("noCapture"),
      });
      if (pageIndex > 0) pdf.addPage();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidth, imageHeight);
    }

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${analysis.manualInfo.sourceName || "维修手册"}_分析报告.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="shell">
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Aviation Maintenance Intelligence</p>
          <h1>把维修手册，整理成一份清晰可用的准备清单。</h1>
          <p className="lead">
            上传 PDF，自动识别工具、耗材、消耗件与参考资料，逐项标注“必须/视情”和原文判断依据，最后生成可下载的中文报告。
          </p>
          <p className="reviewNotice" role="note">
            所有输出结果仅供参考，仍需人工核对确认。
          </p>
          <div className="heroBadges">
            <span>本地识别扫描件</span>
            <span>依据原文判断</span>
            <span>一键生成 PDF</span>
          </div>
          <div className="processCards" aria-label="工作流程">
            <div>
              <strong>01</strong>
              <span>上传手册</span>
            </div>
            <div>
              <strong>02</strong>
              <span>提取内容</span>
            </div>
            <div>
              <strong>03</strong>
              <span>生成清单</span>
            </div>
          </div>
        </div>

        <aside className="uploadPanel">
          <div className="panelHeader">
            <span>Report Studio</span>
            <strong>PDF → 清单报告</strong>
          </div>
          <label className="fileBox">
            <input
              accept="application/pdf"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <span>{file ? file.name : "拖入或点击选择 PDF"}</span>
            <small>支持文字版与扫描版维修手册</small>
          </label>

          <div className="progressBar" aria-label="进度">
            <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
          </div>
          <p className="hint">{status.message}</p>
          {error ? <div className="error panelError">{error}</div> : null}

          <button className="primaryButton" disabled={!file || status.stage === "extracting" || status.stage === "ocr" || status.stage === "analyzing"} onClick={requestAnalysis}>
            {status.stage === "analyzing" || status.stage === "ocr" || status.stage === "extracting" ? "处理中…" : "开始分析"}
          </button>

          <button className="ghostButton" onClick={() => setAdminOpen((open) => !open)}>
            {adminOpen ? "收起后台设置" : "打开后台设置"}
          </button>
        </aside>
      </section>

      {workPasswordOpen ? (
        <div className="dialogBackdrop" role="presentation">
          <section className="workPasswordDialog" role="dialog" aria-modal="true" aria-labelledby="work-password-title">
            <p className="eyebrow">Secure Analysis</p>
            <h2 id="work-password-title">输入工作密码</h2>
            <p className="dialogDescription">验证通过后才会连接分析服务。</p>
            <form onSubmit={submitWorkPassword}>
              <label className="field">
                <span>工作密码</span>
                <input
                  autoFocus
                  autoComplete="current-password"
                  type="password"
                  value={workPassword}
                  onChange={(event) => setWorkPassword(event.target.value)}
                />
              </label>
              {workPasswordError ? <div className="error">{workPasswordError}</div> : null}
              <div className="dialogActions">
                <button type="button" className="ghostButton" onClick={() => setWorkPasswordOpen(false)}>取消</button>
                <button type="submit" className="primaryButton">确认并分析</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {adminOpen ? (
        <section className="adminPanel">
          <h2>后台设置</h2>
          {!adminUnlocked ? (
            <div className="adminLogin">
              {localStorage.getItem(PASSWORD_KEY) ? (
                <label className="field">
                  <span>输入后台密码</span>
                  <input type="password" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} />
                </label>
              ) : (
                <label className="field">
                  <span>首次设置后台密码</span>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </label>
              )}
              <button className="primaryButton" onClick={unlockAdmin}>进入后台</button>
              <p className="hint">提示：后台密码用于保护本机浏览器里的分析规则设置；接口密钥只放在后端环境变量里。</p>
            </div>
          ) : (
            <div className="adminGrid">
              <label className="field">
                <span>DeepSeek 模型</span>
                <input value={config.model} onChange={(event) => saveConfig({ ...config, model: event.target.value })} />
              </label>
              <label className="field">
                <span>后端 API 地址</span>
                <input value={config.apiUrl} onChange={(event) => saveConfig({ ...config, apiUrl: event.target.value })} />
              </label>
              <label className="field wide">
                <span>系统提示词</span>
                <textarea rows={6} value={config.systemPrompt} onChange={(event) => saveConfig({ ...config, systemPrompt: event.target.value })} />
              </label>
              <label className="field wide">
                <span>分析提示词模板</span>
                <textarea rows={18} value={config.promptTemplate} onChange={(event) => saveConfig({ ...config, promptTemplate: event.target.value })} />
              </label>
              <div className="actions left">
                <button onClick={resetConfig}>恢复默认提示词</button>
                <button onClick={() => setAdminUnlocked(false)}>锁定后台</button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {extractedText ? (
        <section className="section">
          <h2>文本提取预览</h2>
          <p className="hint">提取方式：{extractMode}。这里只展示前 1500 字，完整文本会提交给后端分析。</p>
          <pre className="textPreview">{textPreview}</pre>
        </section>
      ) : null}

      {hasResult ? (
        <div className="report" ref={reportRef}>
          <section className="reportHead">
            <div>
              <h2>维修手册工具材料分析表</h2>
              <p>每条均包含必须/视情、适用性与原文判断依据。</p>
            </div>
            <div className="actions noCapture">
              <button onClick={downloadMarkdown}>下载 Markdown</button>
              <button className="primaryExport" onClick={downloadPdf}>下载 PDF</button>
            </div>
          </section>

          <section className="section">
            <h2>手册信息</h2>
            <dl className="metaGrid">
              <div><dt>文件名</dt><dd>{analysis.manualInfo.sourceName || "-"}</dd></div>
              <div><dt>任务号</dt><dd>{analysis.manualInfo.taskNumber || "-"}</dd></div>
              <div><dt>任务名称</dt><dd>{analysis.manualInfo.taskTitle || "-"}</dd></div>
              <div><dt>适用性</dt><dd>{analysis.manualInfo.applicability || "-"}</dd></div>
              <div><dt>修订信息</dt><dd>{analysis.manualInfo.revision || "-"}</dd></div>
              <div><dt>页数</dt><dd>{analysis.manualInfo.pageCount || "-"}</dd></div>
            </dl>
          </section>

          <ReportTable
            title="Fixtures, Tools, Test and Support Equipment 和 Consumable Materials"
            headers={["名称", "件号", "数量", "必须/视情", "判断依据", "适用性", "选择组"]}
            rows={analysis.toolMaterials.map((row) => ({
              choiceGroup: row.choiceGroup,
              cells: [row.name, row.partNumber, row.quantity, row.requirement, row.basis, row.applicability, row.choiceGroup],
            }))}
          />
          <ReportTable
            title="Expendable Parts"
            headers={["名称", "ITEM号", "IPC参考章节", "必须/视情", "判断依据", "适用性", "选择组"]}
            rows={analysis.expendableParts.map((row) => ({
              choiceGroup: row.choiceGroup,
              cells: [row.name, row.itemNumber, row.ipcReference, row.requirement, row.basis, row.applicability, row.choiceGroup],
            }))}
          />
          <ReportTable
            title="Referenced Information"
            headers={["Reference号", "描述", "必须/视情", "判断依据", "适用性", "选择组"]}
            rows={analysis.referencedInformation.map((row) => ({
              choiceGroup: row.choiceGroup,
              cells: [row.referenceNumber, row.description, row.requirement, row.basis, row.applicability, row.choiceGroup],
            }))}
          />

          <section className="section">
            <h2>选择组注释</h2>
            {analysis.choiceNotes.length ? <ul className="list">{analysis.choiceNotes.map((note) => <li key={note}>{note}</li>)}</ul> : <p className="empty">无</p>}
          </section>

          <section className="section">
            <h2>备注</h2>
            {analysis.notes.length ? <ul className="list">{analysis.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p className="empty">无</p>}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: { choiceGroup: string; cells: string[] }[];
}) {
  return (
    <section className="section">
      <h2>{title}</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, rowIndex) => (
              <tr className={choiceClass(row.choiceGroup)} key={`${title}-${rowIndex}`}>
                {row.cells.map((cell, cellIndex) => (
                  <td key={`${title}-${rowIndex}-${cellIndex}`}>
                    {cellIndex === 3 && (cell === "必须" || cell === "视情") ? <span className={cell === "必须" ? "badge" : "badgeSoft"}>{cell}</span> : cell || "-"}
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={headers.length} className="empty">未提取到相关内容</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
