import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveProvider } from "./config.js"
import { buildChunkPrompt, buildFinalPrompt, buildSystemPrompt } from "./prompts.js"

export function normalizeTranscript(input) {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

export function chunkText(text, maxChars = 12000) {
  const normalized = normalizeTranscript(text)
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const paragraphs = normalized.split(/\n{2,}/)
  const chunks = []
  let current = ""

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph

    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    if (current) chunks.push(current)

    if (paragraph.length <= maxChars) {
      current = paragraph
      continue
    }

    for (let start = 0; start < paragraph.length; start += maxChars) {
      chunks.push(paragraph.slice(start, start + maxChars))
    }
    current = ""
  }

  if (current) chunks.push(current)
  return chunks
}

export async function summarizeCourse(
  { title, sourceUrl, transcript, mode = "comprehensive", provider: requestedProvider },
  config,
  options = {}
) {
  const provider = resolveProvider(config, requestedProvider)
  const cleanedTranscript = normalizeTranscript(transcript)

  if (!cleanedTranscript) {
    throw new Error("transcript 不能为空")
  }

  const chunks = chunkText(cleanedTranscript, config.maxChunkChars)
  const partialSummaries = []
  options.onProgress?.({
    stage: "chunking",
    message: `已切分为 ${chunks.length} 段`,
    totalChunks: chunks.length,
    completedChunks: 0
  })

  if (chunks.length > 1) {
    for (let index = 0; index < chunks.length; index += 1) {
      options.onProgress?.({
        stage: "chunk",
        message: `正在整理第 ${index + 1} / ${chunks.length} 段`,
        totalChunks: chunks.length,
        completedChunks: index
      })

      const prompt = buildChunkPrompt({
        title,
        sourceUrl,
        chunkIndex: index,
        chunkCount: chunks.length,
        transcript: chunks[index]
      })

      partialSummaries.push(await callAi(prompt, provider, config))
      options.onProgress?.({
        stage: "chunk",
        message: `已完成第 ${index + 1} / ${chunks.length} 段`,
        totalChunks: chunks.length,
        completedChunks: index + 1
      })
    }
  }

  options.onProgress?.({
    stage: "final",
    message: chunks.length > 1 ? "正在汇总所有分段" : "正在生成课堂总结",
    totalChunks: chunks.length,
    completedChunks: partialSummaries.length
  })

  const finalPrompt = buildFinalPrompt({
    title,
    sourceUrl,
    mode,
    transcript: cleanedTranscript,
    partialSummaries
  })

  const markdown = await callAi(finalPrompt, provider, config)
  const result = {
    title: title || "课堂学习总结",
    provider: provider.id,
    providerLabel: provider.label,
    model: provider.model,
    markdown,
    chunkCount: chunks.length,
    generatedAt: new Date().toISOString()
  }

  if (config.saveOutputs) {
    await saveSummary(result)
  }

  options.onProgress?.({
    stage: "completed",
    message: "AI 总结完成",
    totalChunks: chunks.length,
    completedChunks: chunks.length
  })

  return result
}

export async function callAi(userPrompt, provider, config) {
  if (config.mock) {
    return buildMockSummary(userPrompt, provider)
  }

  if (!provider.apiKey) {
    throw new Error(`缺少 ${provider.id.toUpperCase()}_API_KEY。请在 .env 中填写该供应商的 API Key，或设置 AI_MOCK=true 测试流程。`)
  }

  if (provider.endpointMode === "responses") {
    return callResponsesApi(userPrompt, provider, config)
  }

  return callChatCompletionsApi(userPrompt, provider, config)
}

async function callChatCompletionsApi(userPrompt, provider, config) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const body = {
    model: provider.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt()
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  }

  body[provider.outputTokenParam || "max_tokens"] = config.maxOutputTokens

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `${provider.label} 返回 ${response.status}`)
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error(`${provider.label} 没有返回可用文本`)
    }

    return content.trim()
  } finally {
    clearTimeout(timer)
  }
}

async function callResponsesApi(userPrompt, provider, config) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(`${provider.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        instructions: buildSystemPrompt(),
        input: userPrompt,
        store: false,
        max_output_tokens: config.maxOutputTokens
      }),
      signal: controller.signal
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `${provider.label} 返回 ${response.status}`)
    }

    const content = data.output_text || extractResponsesText(data)
    if (!content) {
      throw new Error(`${provider.label} 没有返回可用文本`)
    }

    return content.trim()
  } finally {
    clearTimeout(timer)
  }
}

function extractResponsesText(data) {
  return (data.output || [])
    .flatMap(item => item.content || [])
    .filter(part => part.type === "output_text" || part.type === "text")
    .map(part => part.text)
    .filter(Boolean)
    .join("\n")
}

function buildMockSummary(prompt, provider) {
  const sample = prompt.slice(0, 500).replace(/\n{3,}/g, "\n\n")

  return [
    "# 模拟课堂学习总结",
    "",
    `- 当前供应商：${provider.label}`,
    `- 当前模型：${provider.model}`,
    "",
    "## 1. 课堂一句话概览",
    "这是 AI_MOCK=true 生成的本地模拟结果，用于验证油猴脚本、服务端和页面流程是否打通。",
    "",
    "## 2. 课程主线",
    "- 已接收到课堂转写文本。",
    "- 服务端会按请求选择供应商，并在正式配置 API Key 后调用对应模型生成完整总结。",
    "",
    "## 3. 核心知识点",
    "- 文本采集",
    "- 清洗去重",
    "- 多模型配置",
    "- 长文本分块",
    "- AI 汇总",
    "",
    "## 4. 重点与难点",
    "- 重点：API Key 只保存在本地服务，不写入油猴脚本。",
    "- 难点：不同供应商的模型名、输出 token 参数和 endpoint 模式可能不同。",
    "",
    "## 5. 学习大纲",
    "- 配置 `.env`",
    "- 选择默认供应商",
    "- 启动本地服务",
    "- 在控制台或课程回放页生成总结",
    "",
    "## 6. 复习与作业建议",
    "- 使用真实 API Key 再跑一次完整总结。",
    "",
    "## 7. 待确认问题",
    "- 以下是本次收到的材料片段：",
    "",
    "```text",
    sample,
    "```"
  ].join("\n")
}

async function saveSummary(result) {
  await mkdir("outputs", { recursive: true })
  const safeTitle = String(result.title || "summary")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80)
  const stamp = result.generatedAt.replace(/[:.]/g, "-")
  await writeFile(join("outputs", `${stamp}_${result.provider}_${safeTitle}.md`), result.markdown, "utf8")
}
