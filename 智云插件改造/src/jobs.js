import { randomUUID } from "node:crypto"
import { summarizeCourse } from "./summarizer.js"

const jobs = new Map()
const MAX_JOBS = 50
const JOB_TTL_MS = 2 * 60 * 60 * 1000

export function createSummaryJob(payload, config) {
  cleanupJobs()

  const id = randomUUID()
  const now = new Date().toISOString()
  const job = {
    id,
    status: "queued",
    progress: 0,
    stage: "queued",
    message: "任务已提交，等待开始",
    totalChunks: 0,
    completedChunks: 0,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  }

  jobs.set(id, job)

  queueMicrotask(async () => {
    updateJob(id, {
      status: "running",
      stage: "starting",
      message: "正在准备课堂文本"
    })

    try {
      const result = await summarizeCourse(payload, config, {
        onProgress(progress) {
          updateJob(id, {
            ...progress,
            progress: calculateProgress(progress)
          })
        }
      })

      updateJob(id, {
        status: "completed",
        progress: 100,
        stage: "completed",
        message: "AI 总结完成",
        result
      })
    } catch (error) {
      updateJob(id, {
        status: "failed",
        stage: "failed",
        message: error.name === "AbortError" ? "AI 服务请求超时" : error.message,
        error: error.name === "AbortError" ? "AI 服务请求超时" : error.message
      })
    }
  })

  return sanitizeJob(job)
}

export function getSummaryJob(id) {
  cleanupJobs()
  const job = jobs.get(id)
  return job ? sanitizeJob(job) : null
}

function updateJob(id, patch) {
  const job = jobs.get(id)
  if (!job) return

  Object.assign(job, patch, {
    updatedAt: new Date().toISOString()
  })
}

function calculateProgress({ stage, totalChunks = 0, completedChunks = 0 }) {
  if (stage === "completed") return 100
  if (stage === "final") return 85
  if (!totalChunks || totalChunks <= 1) return stage === "chunking" ? 10 : 30

  return Math.min(85, Math.round(10 + (completedChunks / totalChunks) * 70))
}

function sanitizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    message: job.message,
    totalChunks: job.totalChunks,
    completedChunks: job.completedChunks,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
}

function cleanupJobs() {
  const now = Date.now()

  for (const [id, job] of jobs) {
    if (now - Date.parse(job.updatedAt) > JOB_TTL_MS) {
      jobs.delete(id)
    }
  }

  if (jobs.size <= MAX_JOBS) return

  const removable = [...jobs.values()]
    .filter(job => job.status !== "running")
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))

  for (const job of removable) {
    if (jobs.size <= MAX_JOBS) break
    jobs.delete(job.id)
  }
}
