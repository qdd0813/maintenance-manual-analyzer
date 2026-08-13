export const DEFAULT_SYSTEM_PROMPT = `你是一名严谨的航空维修资料分析员。你必须只依据用户提供的维修手册文本进行判断，不得编造。

任务目标：提取维修工作中需要准备的 Fixtures, Tools, Test and Support Equipment、Consumable Materials、Expendable Parts、Referenced Information，并判断“必须/视情”。

输出必须是严格 JSON，不能包含 Markdown、解释性前后缀或代码块。`;

export const DEFAULT_USER_PROMPT_TEMPLATE = `请根据以下维修手册 OCR/文本内容，按“逻辑(1).docx”的格式输出分析结果。

【必须遵守的提取规则】
1. 输出三类表：
   - Fixtures, Tools, Test and Support Equipment 和 Consumable Materials
   - Expendable Parts
   - Referenced Information
2. 每条都必须给出“必须/视情”和“判断依据”。
3. 判断依据必须包含原文关键句和页码/位置，例如“PAGE 3: 原文……”。如果页码无法确定，写“位置不明”。
4. 判断“必须”：原文明确要求使用、安装、移除、检查、参考，或出现在必须步骤/准备清单中。
5. 判断“视情”：原文出现 IF、as necessary、if installed、if damaged、optional、or、one of、alternative、depending on、选择 A/B/C 等条件性、选择性或按需表达。
6. 适用性必须识别 ** ON A/C FSN 或类似适用范围；没有明确适用范围则写“ALL/未限定”。
7. 如果存在 A/B/C/备选件/二选一/多选一，请在 choiceGroup 中标为 A、B、C 或同一组名，并在 choiceNotes 中说明选择关系。
8. 不确定时不要省略，标为“视情”，并说明不确定原因。
9. 若某类没有提取到内容，返回空数组。

【JSON 格式】
{
  "manualInfo": {
    "sourceName": "文件名",
    "taskNumber": "任务号",
    "taskTitle": "任务名称",
    "applicability": "适用性",
    "revision": "修订信息",
    "pageCount": 0
  },
  "toolMaterials": [
    {
      "name": "名称",
      "partNumber": "件号",
      "quantity": "数量",
      "requirement": "必须 或 视情",
      "basis": "判断依据，包含原文和页码",
      "applicability": "适用性",
      "choiceGroup": "选择组；没有则空字符串"
    }
  ],
  "expendableParts": [
    {
      "name": "名称",
      "itemNumber": "ITEM号",
      "ipcReference": "IPC参考章节",
      "requirement": "必须 或 视情",
      "basis": "判断依据，包含原文和页码",
      "applicability": "适用性",
      "choiceGroup": "选择组；没有则空字符串"
    }
  ],
  "referencedInformation": [
    {
      "referenceNumber": "Reference号",
      "description": "描述",
      "requirement": "必须 或 视情",
      "basis": "判断依据，包含原文和页码",
      "applicability": "适用性",
      "choiceGroup": "选择组；没有则空字符串"
    }
  ],
  "choiceNotes": ["选择组说明"],
  "notes": ["其他分析备注"]
}

【文件信息】
文件名：{{sourceName}}
页数：{{pageCount}}

【维修手册文本】
{{manualText}}`;

export function fillPromptTemplate(
  template: string,
  values: {
    sourceName: string;
    pageCount: number;
    manualText: string;
  },
) {
  return template
    .replaceAll("{{sourceName}}", values.sourceName)
    .replaceAll("{{pageCount}}", String(values.pageCount))
    .replaceAll("{{manualText}}", values.manualText);
}
