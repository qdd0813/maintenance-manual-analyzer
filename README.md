# 维修手册材料工具分析网页

这是一个面向航空维修手册 PDF 的网页工具：用户上传 PDF 后，前端先在浏览器本地提取文字；如果 PDF 是扫描件，会自动使用免费浏览器 OCR；随后把文本交给 Vercel 后端调用 DeepSeek，最终生成可下载 PDF 报告。

## 当前功能

- 上传航空维修手册 PDF
- 自动读取 PDF 文字层
- 扫描版 PDF 自动走浏览器 OCR
- 大型手册按页分块分析并自动去重合并，避免只分析文件开头
- 调用 DeepSeek `deepseek-v4-flash` 分析
- 按 `逻辑(1).docx` 的结构输出三张表
- 标注“必须/视情”、判断依据、适用性、选择组
- 后台密码保护提示词设置
- 下载 PDF 报告，另保留 Markdown 下载

## 输出格式

1. `Fixtures, Tools, Test and Support Equipment 和 Consumable Materials`
   - 名称、件号、数量、必须/视情、判断依据、适用性、选择组
2. `Expendable Parts`
   - 名称、ITEM号、IPC参考章节、必须/视情、判断依据、适用性、选择组
3. `Referenced Information`
   - Reference号、描述、必须/视情、判断依据、适用性、选择组

判断依据要求包含原文关键句和页码/位置；如果出现 A/B/C 或备选关系，会用选择组标出并在报告末尾说明。

## 本地开发

```bash
pnpm install
pnpm dev
```

浏览器打开终端里显示的本地地址即可。前端默认 API 地址是 `/api/analyze`，正式部署到 GitHub Pages 后，请在网页“后台设置”里改成 Vercel 的完整接口地址，例如：

```text
https://你的-vercel-项目.vercel.app/api/analyze
```

不要直接双击根目录的 `index.html`，浏览器不能直接运行里面引用的 TSX 源码；本地必须用 `pnpm dev`，线上必须发布 `dist` 构建产物。

## 白屏排查

如果打开后是白色空白页，优先检查：

1. 本地是否运行了 `pnpm dev`，而不是双击 `index.html`。
2. GitHub Pages 是否选择了 GitHub Actions，而不是 `Deploy from branch` 的根目录发布。
3. 打开的是否是构建产物地址，页面源码里应引用 `assets/index-*.js`，而不是 `/frontend/src/main.tsx`。

可以运行：

```bash
pnpm self-check
```

看到 `SELF_CHECK_OK` 表示构建后的静态页面入口正常。

## DeepSeek Key

不要把 Key 放进前端或 GitHub。后端只读取环境变量：

```bash
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
```

本地测试如果系统不允许创建点开头文件，可以在项目根目录创建 `env.local`；如果编辑器自动保存成 `env.local.md`，旧版本地测试脚本也兼容，但正式 Vercel 部署只需要在 Vercel 后台设置 `DEEPSEEK_API_KEY`。

## Vercel 后端部署

1. 把本项目推送到 GitHub。
2. 在 Vercel 导入同一个仓库。
3. 在 Vercel 项目的 Environment Variables 添加 `DEEPSEEK_API_KEY`。
4. 部署后复制接口地址：`https://你的-vercel-项目.vercel.app/api/analyze`。
5. 回到 GitHub Pages 前端，在“后台设置”里填入该接口地址。

## GitHub Pages 前端部署

仓库已包含 `.github/workflows/pages.yml`。推送到 GitHub 后：

1. 在 GitHub 仓库 Settings → Pages 中选择 GitHub Actions。
2. 触发 `Deploy site to GitHub Pages` 工作流。
3. 打开生成的网站链接。

## 已验证样例

样例 `222222222222222.pdf` 是扫描版 PDF：

```text
pages=32
characters=0
status=no-text-layer
```

已通过本地 OCR + DeepSeek 生成过测试报告：

```text
output/pdf/222222222222222_DeepSeek逻辑分析报告.pdf
```

## 安全说明

- DeepSeek API Key 只放 Vercel 环境变量，不放 GitHub Pages 前端。
- 后台密码用于保护浏览器本地保存的提示词设置，不是云端用户系统。
- 浏览器 OCR 不上传原始 PDF 到服务器；后端只接收 OCR/提取后的文本用于分析。
- 大文件会拆成多个小文本请求，避免单次请求和模型上下文截断；耗时与调用费用会随分块数量增加。
