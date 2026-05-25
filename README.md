# 智云 AI 学习助手

这是一个面向学校课程回放平台的完整小项目：油猴脚本从智云课堂页面采集老师上课语音识别文本，本地 Node 服务负责调用 AI 生成课堂总结、要点、重点、知识点、学习大纲和复习建议。

## 项目思路

整体链路分为三层：

1. `插件.js`：运行在课程回放页面，采集字幕/语音识别文本，支持导出原文、导出清洗版、复制文本、自动 AI 总结。
2. `src/server.js`：本地 AI 服务，保存 API Key、接收油猴脚本请求、处理长文本分块、调用模型、保存总结。
3. `public/`：本地网页控制台，可手动粘贴转写文本后生成总结，适合调试和备用。

这样做的好处是 API Key 不会写进油猴脚本，网页只能访问本机 `127.0.0.1:8787`。服务端支持多模型供应商配置，可以在 DeepSeek、OpenAI、通义千问、豆包/火山方舟、Kimi 或自定义 OpenAI 兼容接口之间切换。

## 文件结构

```text
.
├─ 插件.js                 # 油猴脚本
├─ src/
│  ├─ server.js            # 本地 HTTP 服务
│  ├─ summarizer.js        # 分块、汇总、调用 AI
│  ├─ prompts.js           # 总结提示词
│  └─ config.js            # 多供应商 .env 配置读取
├─ public/
│  ├─ index.html           # 本地控制台页面
│  ├─ styles.css
│  └─ app.js
├─ prompts/course-summary.md
├─ samples/transcript.md
├─ 启动智云AI助手.bat
├─ 后台启动智云AI助手.vbs
├─ 停止智云AI助手.bat
├─ 创建桌面快捷方式.bat
├─ tests/smoke.js
├─ .env.example
└─ package.json
```

## 快速开始

1. 安装 Node.js 18 或更高版本。
2. 复制配置文件：

```powershell
Copy-Item .env.example .env
```

3. 编辑 `.env`，选择默认供应商并填写对应 Key。比如使用 DeepSeek：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-flash
```

如果只是先测试流程，可以设置：

```env
AI_MOCK=true
```

4. 启动服务。推荐日常直接双击：

```text
后台启动智云AI助手.vbs
```

它会在后台启动本地服务，并自动打开：

```text
http://127.0.0.1:8787
```

如果想看到服务日志，可以双击：

```text
启动智云AI助手.bat
```

如果希望桌面上也有入口，可以双击一次：

```text
创建桌面快捷方式.bat
```

也可以在终端里运行：

```powershell
npm.cmd start
```

5. 如果需要停止后台服务，双击：

```text
停止智云AI助手.bat
```

6. 安装 `插件.js` 到 Tampermonkey/篡改猴，然后进入智云课堂回放页，打开语音识别/字幕面板，选择 AI 模型，点击页面右下角的“自动 AI 总结”。

更新脚本后如果页面还显示旧行为，请在 Tampermonkey 中确认脚本内容已替换为最新 `插件.js`，并刷新课程回放页面。

## 多模型配置

`.env` 里有两类配置：

```env
AI_PROVIDER=deepseek
AI_PROVIDERS=deepseek,openai,qwen,doubao,kimi,custom
```

`AI_PROVIDER` 是默认模型；`AI_PROVIDERS` 控制哪些模型显示在网页和油猴面板下拉框里，顺序就是显示顺序。

每个供应商都有独立配置，格式是：

```env
供应商_API_KEY=
供应商_BASE_URL=
供应商_MODEL=
供应商_ENDPOINT_MODE=
供应商_OUTPUT_TOKEN_PARAM=
```

例如 DeepSeek：

```env
DEEPSEEK_API_KEY=你的 Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_ENDPOINT_MODE=chat-completions
DEEPSEEK_OUTPUT_TOKEN_PARAM=max_tokens
```

例如 OpenAI：

```env
OPENAI_API_KEY=你的 Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5
OPENAI_ENDPOINT_MODE=responses
OPENAI_OUTPUT_TOKEN_PARAM=max_completion_tokens
```

自定义 OpenAI 兼容接口：

```env
AI_PROVIDER=custom
CUSTOM_LABEL=我的模型
CUSTOM_API_KEY=你的 Key
CUSTOM_BASE_URL=https://你的服务地址/v1
CUSTOM_MODEL=你的模型名
CUSTOM_ENDPOINT_MODE=chat-completions
CUSTOM_OUTPUT_TOKEN_PARAM=max_tokens
```

说明：OpenAI 官方文档建议新项目优先考虑 Responses API，但很多国产或第三方模型服务更常兼容 Chat Completions，所以项目同时支持 `responses` 和 `chat-completions` 两种模式。

## 可生成的内容

默认“完整课堂总结”会输出：

- 课堂一句话概览
- 课程主线
- 核心知识点
- 重点与难点
- 学习大纲
- 复习与作业建议
- 待确认问题

本地控制台还支持：

- 完整课堂总结
- 学习大纲
- 重点速记
- 考试复习

油猴脚本默认调用完整课堂总结，并会从本地服务读取可用 AI 模型下拉选择。

## 导出到指定文件夹

点击“导出 AI 总结”时，项目会优先调用浏览器的系统保存对话框。你可以在弹出的窗口里选择目标文件夹，也可以修改文件名。

如果当前浏览器不支持系统保存对话框，项目会自动回退到浏览器默认下载目录。推荐使用新版 Chrome 或 Edge。

## 长文本处理

课程回放经常很长。现在项目默认使用后台任务模式：

1. 前端把文本提交到 `POST /api/jobs`，服务端立即返回任务 ID。
2. 服务端在后台按 `MAX_CHUNK_CHARS` 分块整理。
3. 前端每 2 秒查询 `GET /api/jobs/:id`，显示当前阶段、分块进度和最终结果。

服务端分块策略是：

1. 先让 AI 分别整理每个片段。
2. 再把片段总结汇总成一份完整学习资料。

如果接口上下文较小，可以把 `.env` 中的 `MAX_CHUNK_CHARS` 调低，例如：

```env
MAX_CHUNK_CHARS=8000
```

如果模型响应较慢，可以调大单次模型调用超时：

```env
AI_TIMEOUT_MS=300000
```

单位是毫秒，`300000` 表示 5 分钟。油猴脚本默认会等待整次总结最多 20 分钟。

## 常见问题

### 油猴脚本提示无法连接本地 AI 服务

确认已双击：

```text
后台启动智云AI助手.vbs
```

或者已运行：

```powershell
npm.cmd start
```

并检查服务地址是否为：

```text
http://127.0.0.1:8787/health
```

### AI 接口报 max_completion_tokens 不支持

部分兼容接口只支持 `max_tokens`，把对应供应商的配置改成：

```env
DEEPSEEK_OUTPUT_TOKEN_PARAM=max_tokens
```

### AI 总结超时

新版油猴脚本和本地控制台已经改为后台任务轮询，正常情况下不会再因为一个长 HTTP 请求而超时。若仍然显示超时或失败，可以尝试：

- 把 `DEEPSEEK_MODEL` 从 `deepseek-v4-pro` 改成 `deepseek-v4-flash`。
- 把 `MAX_CHUNK_CHARS` 调低到 `6000` 或 `8000`。
- 把 `AI_TIMEOUT_MS` 调大到 `300000` 或 `600000`。
- 重新启动 `npm.cmd start`，并刷新课程页面。
- 确认 Tampermonkey 中的脚本已经更新到最新版本。

### 下拉框显示“未配置 Key”

对应供应商缺少 API Key。比如选择 DeepSeek，就需要填写：

```env
DEEPSEEK_API_KEY=你的 Key
```

如果是测试流程，可以设置：

```env
AI_MOCK=true
```

### 导出的文本条数偏少

很多课程页面会懒加载字幕，请先滚动语音识别/字幕面板，让更多内容加载出来，再点击导出或 AI 总结。

## 开发检查

```powershell
npm.cmd run check
npm.cmd run smoke
```

`npm.cmd run smoke` 使用 `AI_MOCK=true` 的内部模拟总结，不会请求外部网络。

## 后续可扩展方向

- 自动识别课程名、教师名、章节名。
- 在油猴面板增加“总结模式”选择。
- 按课程建立历史总结库。
- 对多节课生成期末复习总纲。
- 支持把总结导出为 Word、PDF 或 Anki 卡片。
