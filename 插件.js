// ==UserScript==
// @name         智云课堂语音识别 AI 学习助手
// @namespace    https://chatgpt.local/zhiyun-ai-study-assistant
// @version      1.0.0
// @description  导出智云课堂语音识别文本，并发送到本地 AI 服务生成课堂总结、重点、知识点和学习大纲
// @author       Xminstrel + ChatGPT
// @match        *://classroom.zju.edu.cn/*
// @match        *://livingroom.cmc.zju.edu.cn/*
// @match        *://onlineroom.cmc.zju.edu.cn/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict"

  const CONFIG = {
    serviceUrl: "http://127.0.0.1:8787",
    defaultProvider: "deepseek",
    selectors: [".item-origin", ".video-trans-item", ".transcript-item", "[class*='subtitle']"],
    panelId: "zhiyun-ai-study-assistant-panel",
    miniId: "zhiyun-ai-study-assistant-mini",
    statusId: "zhiyun-ai-study-assistant-status",
    resultId: "zhiyun-ai-study-assistant-result",
    providerSelectId: "zhiyun-ai-study-assistant-provider",
    requestTimeoutMs: 1200000,
    pollIntervalMs: 2000,
    maxPollMs: 60 * 60 * 1000,
    minCleanLength: 4
  }

  const state = {
    lastSummary: "",
    lastTitle: "",
    activeJobId: ""
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[　]/g, " ")
      .trim()
  }

  function getNodeText(node) {
    if (!node) return ""

    if (node.matches?.(".video-trans-item")) {
      return normalizeText((node.firstElementChild || node).textContent)
    }

    return normalizeText(node.textContent)
  }

  function collectRawLines() {
    const nodes = new Set()

    for (const selector of CONFIG.selectors) {
      document.querySelectorAll(selector).forEach(node => nodes.add(node))
    }

    return [...nodes]
      .map(getNodeText)
      .filter(Boolean)
  }

  function removeAdjacentDuplicates(lines) {
    const result = []
    let last = ""

    for (const line of lines) {
      if (line !== last) {
        result.push(line)
      }
      last = line
    }

    return result
  }

  function isNoiseLine(line) {
    const text = line.replace(/[，。！？,.!?、\s]/g, "")
    const noiseWords = new Set([
      "嗯",
      "啊",
      "呃",
      "哦",
      "是",
      "好",
      "行",
      "对",
      "清楚",
      "可以",
      "是不是",
      "对吧",
      "好吧",
      "嗯嗯",
      "是嗯",
      "行不"
    ])

    if (noiseWords.has(text)) return true

    return text.length < CONFIG.minCleanLength && /^(嗯|啊|呃|哦|是|好|行|对)+$/.test(text)
  }

  function cleanLines(lines) {
    return removeAdjacentDuplicates(lines)
      .map(line => {
        return line
          .replace(/^(嗯|啊|呃|哦)[，,。.\s]*/g, "")
          .replace(/[，,。\s]*(嗯|啊|呃|哦)$/g, "")
          .trim()
      })
      .filter(Boolean)
      .filter(line => !isNoiseLine(line))
  }

  function getPageTitle() {
    return normalizeText(document.title) || "智云课堂语音识别"
  }

  function safeFilename(name) {
    return normalizeText(name)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 120)
  }

  function buildMarkdown(lines, modeName) {
    const title = getPageTitle()
    const now = new Date().toLocaleString()

    return [
      `# ${title}`,
      "",
      `- 来源页面：${location.href}`,
      `- 导出时间：${now}`,
      `- 导出模式：${modeName}`,
      `- 文本条数：${lines.length}`,
      "",
      "---",
      "",
      ...lines.map((line, index) => `${index + 1}. ${line}`)
    ].join("\n")
  }

  function downloadFile(filename, content, mimeType = "text/markdown;charset=utf-8") {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")

    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function saveMarkdownFile(filename, content) {
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "Markdown 文件",
              accept: {
                "text/markdown": [".md"],
                "text/plain": [".txt"]
              }
            }
          ]
        })
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        return "picker"
      } catch (error) {
        if (error.name === "AbortError") return "cancelled"
        console.warn("[智云 AI 学习助手] 文件选择器不可用，回退到浏览器下载", error)
      }
    }

    downloadFile(filename, content)
    return "download"
  }

  function setClipboard(content) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(content)
      return Promise.resolve()
    }

    return navigator.clipboard.writeText(content)
  }

  function requestJson(path, payload) {
    return requestApi("POST", path, payload)
  }

  function requestGet(path) {
    return requestApi("GET", path)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function requestApi(method, path, payload) {
    const url = `${CONFIG.serviceUrl}${path}`

    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers: {
            "Content-Type": "application/json"
          },
          data: payload ? JSON.stringify(payload) : undefined,
          timeout: CONFIG.requestTimeoutMs,
          onload(response) {
            try {
              const data = JSON.parse(response.responseText || "{}")
              if (response.status >= 200 && response.status < 300) {
                resolve(data)
              } else {
                reject(new Error(data.error || `服务返回 ${response.status}`))
              }
            } catch (error) {
              reject(error)
            }
          },
          ontimeout() {
            reject(new Error("AI 总结超时。长课程可能需要更久，请缩短转写文本、换用更快模型，或调大脚本 requestTimeoutMs 和服务端 AI_TIMEOUT_MS"))
          },
          onerror() {
            reject(new Error("无法连接本地 AI 服务，请确认 npm start 已运行"))
          }
        })
      })
    }

    return fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: payload ? JSON.stringify(payload) : undefined
    }).then(async response => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || `服务返回 ${response.status}`)
      }
      return data
    })
  }

  function getTranscriptPayload(modeName) {
    const rawLines = collectRawLines()
    const cleaned = cleanLines(rawLines)

    if (rawLines.length === 0) {
      alert("没有找到语音识别文本。请确认已打开语音识别/字幕面板，并滚动加载完整内容。")
      return null
    }

    return {
      title: getPageTitle(),
      url: location.href,
      exportedAt: new Date().toISOString(),
      modeName,
      rawCount: rawLines.length,
      cleanCount: cleaned.length,
      transcript: buildMarkdown(cleaned, modeName)
    }
  }

  function getSelectedProvider() {
    return document.querySelector(`#${CONFIG.providerSelectId}`)?.value || CONFIG.defaultProvider
  }

  async function loadProviders() {
    const select = document.querySelector(`#${CONFIG.providerSelectId}`)
    if (!select) return

    try {
      const data = await requestGet("/api/providers")
      const providers = data.providers || []

      select.textContent = ""

      for (const provider of providers) {
        const option = document.createElement("option")
        option.value = provider.id
        option.textContent = `${provider.label} · ${provider.model}${provider.ready ? "" : "（未配置 Key）"}`
        option.disabled = !provider.ready
        option.selected = provider.id === data.defaultProvider
        select.appendChild(option)
      }

      if (!select.value) {
        const firstReady = providers.find(provider => provider.ready)
        if (firstReady) select.value = firstReady.id
      }

      showStatus(`AI 服务已连接：${select.options[select.selectedIndex]?.textContent || "未配置模型"}`)
    } catch (error) {
      select.textContent = ""
      const option = document.createElement("option")
      option.value = CONFIG.defaultProvider
      option.textContent = "本地服务未连接"
      select.appendChild(option)
      showStatus(error.message)
    }
  }

  function exportRawMarkdown() {
    const rawLines = collectRawLines()

    if (rawLines.length === 0) {
      alert("没有找到语音识别文本。请确认已打开语音识别/字幕面板。")
      return
    }

    const title = safeFilename(getPageTitle())
    const content = buildMarkdown(rawLines, "原始语音识别文本")
    downloadFile(`${title}_语音识别原文.md`, content)
    showStatus(`已导出原文：${rawLines.length} 条`)
  }

  function exportCleanMarkdown() {
    const payload = getTranscriptPayload("简单清洗版语音识别文本")
    if (!payload) return

    downloadFile(`${safeFilename(payload.title)}_语音识别清洗版.md`, payload.transcript)
    showStatus(`已导出清洗版：${payload.cleanCount} / ${payload.rawCount} 条`)
  }

  async function copyCleanText() {
    const payload = getTranscriptPayload("复制给 AI 的清洗版文本")
    if (!payload) return

    await setClipboard(payload.transcript)
    showStatus(`已复制清洗版：${payload.cleanCount} 条`)
  }

  async function summarizeWithAi() {
    const payload = getTranscriptPayload("AI 总结输入文本")
    if (!payload) return

    showStatus(`正在提交 AI 总结任务：${payload.cleanCount} 条文本`)
    setResult("正在提交后台总结任务...")

    try {
      const data = await requestJson("/api/jobs", {
        title: payload.title,
        sourceUrl: payload.url,
        transcript: payload.transcript,
        mode: "comprehensive",
        provider: getSelectedProvider()
      })

      const jobId = data.job?.id
      if (!jobId) {
        throw new Error("本地服务没有返回任务 ID")
      }

      state.activeJobId = jobId
      showStatus(`任务已提交：${jobId.slice(0, 8)}，正在等待 AI 处理`)

      const job = await pollJob(jobId)
      const result = job.result || {}

      state.lastSummary = result.markdown || ""
      state.lastTitle = payload.title
      setResult(state.lastSummary)
      showStatus(`AI 总结完成：${result.chunkCount || job.totalChunks || 1} 段处理`)
    } catch (error) {
      setResult("")
      showStatus(error.message)
      alert(error.message)
    }
  }

  async function pollJob(jobId) {
    const startedAt = Date.now()

    while (Date.now() - startedAt < CONFIG.maxPollMs) {
      const data = await requestGet(`/api/jobs/${encodeURIComponent(jobId)}`)
      const job = data.job

      if (!job) {
        throw new Error("本地服务没有返回任务状态")
      }

      const chunkInfo = job.totalChunks
        ? `（${job.completedChunks || 0}/${job.totalChunks} 段，${job.progress || 0}%）`
        : `（${job.progress || 0}%）`
      const message = `${job.message || "AI 正在处理"}${chunkInfo}`

      showStatus(message)
      setResult([
        "AI 正在后台整理课堂内容。",
        "",
        `任务状态：${job.status}`,
        `当前进度：${message}`,
        "",
        "你可以保持页面打开等待结果；这个流程不会再因为单个长请求而中途断开。"
      ].join("\n"))

      if (job.status === "completed") return job

      if (job.status === "failed") {
        throw new Error(job.error || job.message || "AI 总结失败")
      }

      await sleep(CONFIG.pollIntervalMs)
    }

    throw new Error("AI 总结仍在后台运行，但前端等待时间已到。请稍后在本地控制台查看结果，或调大 maxPollMs。")
  }

  async function copySummary() {
    if (!state.lastSummary) {
      showStatus("还没有 AI 总结，请先点击自动 AI 总结")
      return
    }

    await setClipboard(state.lastSummary)
    showStatus("已复制 AI 总结")
  }

  async function downloadSummary() {
    if (!state.lastSummary) {
      showStatus("还没有 AI 总结，请先点击自动 AI 总结")
      return
    }

    const filename = `${safeFilename(state.lastTitle || getPageTitle())}_AI学习总结.md`
    const result = await saveMarkdownFile(filename, state.lastSummary)

    if (result === "picker") {
      showStatus("已保存 AI 总结到指定位置")
    } else if (result === "download") {
      showStatus("浏览器不支持选择文件夹，已保存到默认下载目录")
    } else {
      showStatus("已取消导出 AI 总结")
    }
  }

  function showStats() {
    const rawLines = collectRawLines()
    const cleaned = cleanLines(rawLines)

    alert(
      [
        "智云课堂语音识别统计",
        "",
        `页面标题：${getPageTitle()}`,
        `原始条数：${rawLines.length}`,
        `清洗后条数：${cleaned.length}`,
        `当前网址：${location.href}`,
        "",
        "如果原始条数明显偏少，请先滚动语音识别面板，让更多内容加载出来。"
      ].join("\n")
    )

    showStatus(`统计完成：原始 ${rawLines.length} 条，清洗后 ${cleaned.length} 条`)
  }

  function makeButton(text, onClick, variant = "primary") {
    const btn = document.createElement("button")
    btn.textContent = text
    btn.style.display = "block"
    btn.style.width = "100%"
    btn.style.margin = "6px 0"
    btn.style.padding = "8px 10px"
    btn.style.border = variant === "ghost" ? "1px solid #d9d9d9" : "none"
    btn.style.borderRadius = "8px"
    btn.style.background = variant === "ghost" ? "#fff" : "#1677ff"
    btn.style.color = variant === "ghost" ? "#222" : "#fff"
    btn.style.cursor = "pointer"
    btn.style.fontSize = "14px"
    btn.style.lineHeight = "1.2"
    btn.addEventListener("click", onClick)
    return btn
  }

  function makeProviderSelect() {
    const wrap = document.createElement("label")
    wrap.style.display = "block"
    wrap.style.margin = "8px 0"
    wrap.style.fontSize = "12px"
    wrap.style.color = "#666"

    const label = document.createElement("span")
    label.textContent = "AI 模型"
    label.style.display = "block"
    label.style.marginBottom = "4px"

    const select = document.createElement("select")
    select.id = CONFIG.providerSelectId
    select.style.width = "100%"
    select.style.padding = "7px 8px"
    select.style.border = "1px solid #d9d9d9"
    select.style.borderRadius = "8px"
    select.style.background = "#fff"
    select.style.color = "#111"
    select.style.fontSize = "13px"

    const option = document.createElement("option")
    option.value = CONFIG.defaultProvider
    option.textContent = "读取模型配置中"
    select.appendChild(option)

    wrap.appendChild(label)
    wrap.appendChild(select)
    return wrap
  }

  function showStatus(message) {
    const status = document.querySelector(`#${CONFIG.statusId}`)
    if (status) {
      status.textContent = message
    }
    console.log(`[智云 AI 学习助手] ${message}`)
  }

  function setResult(markdown) {
    const result = document.querySelector(`#${CONFIG.resultId}`)
    if (!result) return

    result.textContent = markdown
    result.style.display = markdown ? "block" : "none"
  }

  function createPanel() {
    if (document.querySelector(`#${CONFIG.panelId}`)) return

    const panel = document.createElement("div")
    panel.id = CONFIG.panelId
    panel.style.position = "fixed"
    panel.style.right = "20px"
    panel.style.bottom = "80px"
    panel.style.zIndex = "999999"
    panel.style.width = "260px"
    panel.style.maxHeight = "78vh"
    panel.style.overflow = "auto"
    panel.style.padding = "12px"
    panel.style.borderRadius = "12px"
    panel.style.background = "rgba(255, 255, 255, 0.97)"
    panel.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.22)"
    panel.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    panel.style.color = "#111"

    const title = document.createElement("div")
    title.textContent = "智云 AI 学习助手"
    title.style.fontWeight = "700"
    title.style.fontSize = "15px"
    title.style.marginBottom = "8px"

    const closeBtn = document.createElement("button")
    closeBtn.textContent = "×"
    closeBtn.title = "隐藏面板"
    closeBtn.style.position = "absolute"
    closeBtn.style.right = "8px"
    closeBtn.style.top = "6px"
    closeBtn.style.border = "none"
    closeBtn.style.background = "transparent"
    closeBtn.style.fontSize = "18px"
    closeBtn.style.cursor = "pointer"
    closeBtn.style.color = "#666"
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none"
      createMiniButton()
    })

    const result = document.createElement("pre")
    result.id = CONFIG.resultId
    result.style.display = "none"
    result.style.whiteSpace = "pre-wrap"
    result.style.maxHeight = "240px"
    result.style.overflow = "auto"
    result.style.margin = "10px 0 0"
    result.style.padding = "9px"
    result.style.border = "1px solid #e6e6e6"
    result.style.borderRadius = "8px"
    result.style.background = "#fafafa"
    result.style.color = "#222"
    result.style.fontSize = "12px"
    result.style.lineHeight = "1.5"

    const status = document.createElement("div")
    status.id = CONFIG.statusId
    status.textContent = "准备就绪"
    status.style.fontSize = "12px"
    status.style.color = "#666"
    status.style.marginTop = "8px"
    status.style.wordBreak = "break-all"

    panel.appendChild(closeBtn)
    panel.appendChild(title)
    panel.appendChild(makeProviderSelect())
    panel.appendChild(makeButton("自动 AI 总结", summarizeWithAi))
    panel.appendChild(makeButton("复制 AI 总结", copySummary, "ghost"))
    panel.appendChild(makeButton("导出 AI 总结", downloadSummary, "ghost"))
    panel.appendChild(makeButton("统计文本条数", showStats, "ghost"))
    panel.appendChild(makeButton("导出原文 Markdown", exportRawMarkdown, "ghost"))
    panel.appendChild(makeButton("导出清洗版 Markdown", exportCleanMarkdown, "ghost"))
    panel.appendChild(makeButton("复制清洗版给 AI", copyCleanText, "ghost"))
    panel.appendChild(result)
    panel.appendChild(status)

    document.body.appendChild(panel)
    loadProviders()
    showStatus(`检测到 ${collectRawLines().length} 条文本`)
  }

  function createMiniButton() {
    if (document.querySelector(`#${CONFIG.miniId}`)) return

    const mini = document.createElement("button")
    mini.id = CONFIG.miniId
    mini.textContent = "AI 学习助手"
    mini.style.position = "fixed"
    mini.style.right = "20px"
    mini.style.bottom = "80px"
    mini.style.zIndex = "999999"
    mini.style.padding = "9px 12px"
    mini.style.border = "none"
    mini.style.borderRadius = "999px"
    mini.style.background = "#1677ff"
    mini.style.color = "#fff"
    mini.style.cursor = "pointer"
    mini.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.22)"

    mini.addEventListener("click", () => {
      mini.remove()
      const panel = document.querySelector(`#${CONFIG.panelId}`)
      if (panel) {
        panel.style.display = "block"
      } else {
        createPanel()
      }
    })

    document.body.appendChild(mini)
  }

  function init() {
    createPanel()

    const observer = new MutationObserver(() => {
      if (!document.querySelector(`#${CONFIG.panelId}`) && !document.querySelector(`#${CONFIG.miniId}`)) {
        createPanel()
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    setTimeout(init, 1000)
  }
})()
