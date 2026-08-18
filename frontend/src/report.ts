export type ToolMaterialRow = {
  name: string;
  partNumber: string;
  quantity: string;
  requirement: string;
  basis: string;
  applicability: string;
  choiceGroup: string;
};

export type ExpendablePartRow = {
  name: string;
  itemNumber: string;
  ipcReference: string;
  requirement: string;
  basis: string;
  applicability: string;
  choiceGroup: string;
};

export type ReferenceInfoRow = {
  referenceNumber: string;
  description: string;
  requirement: string;
  basis: string;
  applicability: string;
  choiceGroup: string;
};

export type ManualAnalysis = {
  manualInfo: {
    sourceName: string;
    taskNumber: string;
    taskTitle: string;
    applicability: string;
    revision: string;
    pageCount: number;
  };
  toolMaterials: ToolMaterialRow[];
  expendableParts: ExpendablePartRow[];
  referencedInformation: ReferenceInfoRow[];
  choiceNotes: string[];
  notes: string[];
};

export const emptyAnalysis: ManualAnalysis = {
  manualInfo: {
    sourceName: "",
    taskNumber: "",
    taskTitle: "",
    applicability: "",
    revision: "",
    pageCount: 0,
  },
  toolMaterials: [],
  expendableParts: [],
  referencedInformation: [],
  choiceNotes: [],
  notes: [],
};

const normalizedKey = (...values: string[]) =>
  values
    .map((value) => value.trim().toLocaleLowerCase().replace(/\s+/g, " "))
    .join("|");

const mergeText = (current: string, incoming: string) => {
  const left = current.trim();
  const right = incoming.trim();
  if (!left) return right;
  if (!right || left.includes(right)) return left;
  if (right.includes(left)) return right;
  return `${left}；${right}`;
};

const mergeRequirement = (current: string, incoming: string) =>
  current === "必须" || incoming === "必须" ? "必须" : current || incoming || "视情";

export function mergeAnalyses(analyses: ManualAnalysis[], sourceName: string, pageCount: number): ManualAnalysis {
  const merged: ManualAnalysis = {
    ...emptyAnalysis,
    manualInfo: { ...emptyAnalysis.manualInfo, sourceName, pageCount },
    toolMaterials: [],
    expendableParts: [],
    referencedInformation: [],
    choiceNotes: [],
    notes: [],
  };

  const toolIndex = new Map<string, number>();
  const expendableIndex = new Map<string, number>();
  const referenceIndex = new Map<string, number>();

  for (const analysis of analyses) {
    for (const field of ["taskNumber", "taskTitle", "applicability", "revision"] as const) {
      if (!merged.manualInfo[field] && analysis.manualInfo[field]) merged.manualInfo[field] = analysis.manualInfo[field];
    }

    for (const row of analysis.toolMaterials) {
      const key = normalizedKey(row.name, row.partNumber, row.quantity, row.applicability);
      const existingIndex = toolIndex.get(key);
      if (existingIndex === undefined) {
        toolIndex.set(key, merged.toolMaterials.length);
        merged.toolMaterials.push({ ...row });
      } else {
        const existing = merged.toolMaterials[existingIndex];
        existing.requirement = mergeRequirement(existing.requirement, row.requirement);
        existing.basis = mergeText(existing.basis, row.basis);
        existing.choiceGroup = mergeText(existing.choiceGroup, row.choiceGroup);
      }
    }

    for (const row of analysis.expendableParts) {
      const key = normalizedKey(row.name, row.itemNumber, row.ipcReference, row.applicability);
      const existingIndex = expendableIndex.get(key);
      if (existingIndex === undefined) {
        expendableIndex.set(key, merged.expendableParts.length);
        merged.expendableParts.push({ ...row });
      } else {
        const existing = merged.expendableParts[existingIndex];
        existing.requirement = mergeRequirement(existing.requirement, row.requirement);
        existing.basis = mergeText(existing.basis, row.basis);
        existing.choiceGroup = mergeText(existing.choiceGroup, row.choiceGroup);
      }
    }

    for (const row of analysis.referencedInformation) {
      const key = normalizedKey(row.referenceNumber, row.description, row.applicability);
      const existingIndex = referenceIndex.get(key);
      if (existingIndex === undefined) {
        referenceIndex.set(key, merged.referencedInformation.length);
        merged.referencedInformation.push({ ...row });
      } else {
        const existing = merged.referencedInformation[existingIndex];
        existing.requirement = mergeRequirement(existing.requirement, row.requirement);
        existing.basis = mergeText(existing.basis, row.basis);
        existing.choiceGroup = mergeText(existing.choiceGroup, row.choiceGroup);
      }
    }

    merged.choiceNotes.push(...analysis.choiceNotes);
    merged.notes.push(...analysis.notes);
  }

  merged.choiceNotes = [...new Set(merged.choiceNotes.map((item) => item.trim()).filter(Boolean))];
  merged.notes = [...new Set(merged.notes.map((item) => item.trim()).filter(Boolean))];
  return merged;
}

const normalizeCell = (value: string) => value.replaceAll("\n", " ").replaceAll("|", "｜");

const list = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";

export function analysisToMarkdown(analysis: ManualAnalysis) {
  const info = analysis.manualInfo;
  const toolRows = analysis.toolMaterials.length
    ? analysis.toolMaterials.map((row) =>
        [
          row.name || "-",
          row.partNumber || "-",
          row.quantity || "-",
          row.requirement || "-",
          row.basis || "-",
          row.applicability || "-",
          row.choiceGroup || "-",
        ]
          .map(normalizeCell)
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      )
    : ["| - | - | - | - | - | - | - |"];

  const expendableRows = analysis.expendableParts.length
    ? analysis.expendableParts.map((row) =>
        [
          row.name || "-",
          row.itemNumber || "-",
          row.ipcReference || "-",
          row.requirement || "-",
          row.basis || "-",
          row.applicability || "-",
          row.choiceGroup || "-",
        ]
          .map(normalizeCell)
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      )
    : ["| - | - | - | - | - | - |"];

  const referenceRows = analysis.referencedInformation.length
    ? analysis.referencedInformation.map((row) =>
        [
          row.referenceNumber || "-",
          row.description || "-",
          row.requirement || "-",
          row.basis || "-",
          row.applicability || "-",
          row.choiceGroup || "-",
        ]
          .map(normalizeCell)
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      )
    : ["| - | - | - | - | - |"];

  return [
    "# 维修手册工具材料分析表",
    "",
    "## 手册信息",
    "",
    `- 文件名：${info.sourceName || "-"}`,
    `- 任务号：${info.taskNumber || "-"}`,
    `- 任务名称：${info.taskTitle || "-"}`,
    `- 适用性：${info.applicability || "-"}`,
    `- 修订信息：${info.revision || "-"}`,
    `- 页数：${info.pageCount || "-"}`,
    "",
    "## Fixtures, Tools, Test and Support Equipment 和 Consumable Materials",
    "",
    "| 名称 | 件号 | 数量 | 必须/视情 | 判断依据 | 适用性 | 选择组 |",
    "|---|---|---:|---|---|---|---|",
    ...toolRows,
    "",
    "## Expendable Parts",
    "",
    "| 名称 | ITEM号 | IPC参考章节 | 必须/视情 | 判断依据 | 适用性 | 选择组 |",
    "|---|---|---|---|---|---|---|",
    ...expendableRows,
    "",
    "## Referenced Information",
    "",
    "| Reference号 | 描述 | 必须/视情 | 判断依据 | 适用性 | 选择组 |",
    "|---|---|---|---|---|---|",
    ...referenceRows,
    "",
    "## 选择组注释",
    "",
    list(analysis.choiceNotes),
    "",
    "## 备注",
    "",
    list(analysis.notes),
  ].join("\n");
}
