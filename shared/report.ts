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
