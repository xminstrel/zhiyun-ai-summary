const titleInput = document.querySelector("#titleInput")
const transcriptInput = document.querySelector("#transcriptInput")
const providerInput = document.querySelector("#providerInput")
const modeInput = document.querySelector("#modeInput")
const summarizeButton = document.querySelector("#summarizeButton")
const sampleButton = document.querySelector("#sampleButton")
const copyButton = document.querySelector("#copyButton")
const downloadButton = document.querySelector("#downloadButton")
const summaryOutput = document.querySelector("#summaryOutput")
const serviceState = document.querySelector("#serviceState")

let latestSummary = ""
const POLL_INTERVAL_MS = 2000
const MAX_POLL_MS = 60 * 60 * 1000

async function checkHealth() {
  try {
    const response = await fetch("/health")
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "服务异常")
    }

    renderProviders(data.providers || [], data.defaultProvider)
    serviceState.textContent = data.mock ? "模拟模式" : "服务在线"
    serviceState.className = "service-state ok"
  } catch {
    serviceState.textContent = "服务离线"
    serviceState.className = "service-state error"
    providerInput.innerHTML = '<option value="">服务未连接</option>'
  }
}

function renderProviders(providers, defaultProvider) {
  const visibleProviders = providers.length
    ? providers
    : [{ id: "deepseek", label: "DeepSeek", model: "deepseek-v4-flash", ready: false }]

  providerInput.innerHTML = ""

  for (const provider of visibleProviders) {
    const option = document.createElement("option")
    option.value = provider.id
    option.textContent = `${provider.label} · ${provider.model}${provider.ready ? "" : "（未配置 Key）"}`
    option.disabled = !provider.ready
    option.selected = provider.id === defaultProvider
    providerInput.appendChild(option)
  }

  if (!providerInput.value) {
    const firstReady = visibleProviders.find(provider => provider.ready)
    if (firstReady) providerInput.value = firstReady.id
  }
}

async function summarize() {
  const transcript = transcriptInput.value.trim()
  if (!transcript) {
    summaryOutput.textContent = "请先粘贴课堂转写文本。"
    return
  }

  if (!providerInput.value) {
    summaryOutput.textContent = "请先在 .env 中配置至少一个可用 AI 供应商。"
    return
  }

  summarizeButton.disabled = true
  summarizeButton.textContent = "生成中"
  summaryOutput.textContent = "AI 正在整理课堂内容，请稍等..."

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: titleInput.value.trim() || "课堂学习总结",
        transcript,
        mode: modeInput.value,
        provider: providerInput.value
      })
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "总结失败")
    }

    const jobId = data.job?.id
    if (!jobId) {
      throw new Error("本地服务没有返回任务 ID")
    }

    const job = await pollJob(jobId)
    latestSummary = job.result?.markdown || ""
    summaryOutput.textContent = latestSummary || "AI 没有返回内容。"
  } catch (error) {
    latestSummary = ""
    summaryOutput.textContent = error.message
  } finally {
    summarizeButton.disabled = false
    summarizeButton.textContent = "生成总结"
  }
}

async function pollJob(jobId) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < MAX_POLL_MS) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "读取任务状态失败")
    }

    const job = data.job
    const chunkInfo = job.totalChunks
      ? `${job.completedChunks || 0}/${job.totalChunks} 段，${job.progress || 0}%`
      : `${job.progress || 0}%`

    summaryOutput.textContent = [
      "AI 正在后台整理课堂内容。",
      "",
      `任务 ID：${jobId}`,
      `任务状态：${job.status}`,
      `当前进度：${job.message || "处理中"}（${chunkInfo}）`
    ].join("\n")

    if (job.status === "completed") return job

    if (job.status === "failed") {
      throw new Error(job.error || job.message || "AI 总结失败")
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error("AI 总结仍在后台运行，但前端等待时间已到。请稍后刷新或重新查询。")
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function copySummary() {
  if (!latestSummary) return
  await navigator.clipboard.writeText(latestSummary)
  copyButton.textContent = "已复制"
  setTimeout(() => {
    copyButton.textContent = "复制"
  }, 1200)
}

async function downloadSummary() {
  if (!latestSummary) return

  const title = (titleInput.value.trim() || "课堂学习总结")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80)
  const filename = `${title}_AI学习总结.md`

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
      await writable.write(latestSummary)
      await writable.close()
      return
    } catch (error) {
      if (error.name === "AbortError") return
      console.warn("文件选择器不可用，回退到浏览器下载", error)
    }
  }

  const blob = new Blob([latestSummary], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function fillSample() {
  titleInput.value = "示例课程：算法复杂度"
  transcriptInput.value = [
    "# 示例课程：算法复杂度",
    "",
    "1. 今天我们先回顾一下算法复杂度，主要看时间复杂度和空间复杂度。",
    "2. 时间复杂度不是程序真实运行时间，而是输入规模变大时操作次数增长的趋势。",
    "3. 常见的复杂度有 O(1)、O(log n)、O(n)、O(n log n)、O(n^2)。",
    "4. 二分查找为什么是 O(log n)，因为每次都会把搜索区间缩小一半。",
    "5. 老师强调，考试里要会从循环嵌套、递归式、数据结构操作三个角度判断复杂度。",
    "6. 空间复杂度要注意额外开辟的数组、递归调用栈，以及是否原地修改。"
  ].join("\n")
}

summarizeButton.addEventListener("click", summarize)
copyButton.addEventListener("click", copySummary)
downloadButton.addEventListener("click", downloadSummary)
sampleButton.addEventListener("click", fillSample)

checkHealth()
