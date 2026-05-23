import { createReadStream, existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getConfig, getPublicProviders, resolveProvider } from "./config.js"
import { createSummaryJob, getSummaryJob } from "./jobs.js"
import { summarizeCourse } from "./summarizer.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const projectRoot = resolve(__dirname, "..")
const publicRoot = resolve(projectRoot, "public")

const MIME_TYPES = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".md": "text/markdown;charset=utf-8",
  ".txt": "text/plain;charset=utf-8"
}

export function createApp(config = getConfig()) {
  return createServer(async (req, res) => {
    setCorsHeaders(req, res)

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, buildHealthPayload(config))
        return
      }

      if (req.method === "GET" && url.pathname === "/api/providers") {
        sendJson(res, {
          ok: true,
          defaultProvider: config.defaultProvider,
          providers: getPublicProviders(config)
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/summarize") {
        const payload = await readJson(req)
        const result = await summarizeCourse(payload, config)
        sendJson(res, {
          ok: true,
          ...result
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/jobs") {
        const payload = await readJson(req)
        const job = createSummaryJob(payload, config)
        sendJson(res, {
          ok: true,
          job
        }, 202)
        return
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/jobs/".length))
        const job = getSummaryJob(id)
        if (!job) {
          sendJson(res, { error: "任务不存在或已过期" }, 404)
          return
        }

        sendJson(res, {
          ok: true,
          job
        })
        return
      }

      if (req.method === "GET") {
        await serveStatic(url.pathname, res)
        return
      }

      sendJson(res, { error: "Method Not Allowed" }, 405)
    } catch (error) {
      const message = error.name === "AbortError" ? "AI 服务请求超时" : error.message
      sendJson(res, { error: message || "服务器内部错误" }, 500)
    }
  })
}

export function startServer(config = getConfig()) {
  const server = createApp(config)

  server.listen(config.port, config.host, () => {
    const provider = resolveProvider(config, config.defaultProvider)
    console.log(`智云 AI 学习助手已启动：http://${config.host}:${config.port}`)
    console.log(`默认供应商：${provider.label}，模型：${provider.model}${config.mock ? "，AI_MOCK=true" : ""}`)
  })

  return server
}

function buildHealthPayload(config) {
  const provider = resolveProvider(config, config.defaultProvider)

  return {
    ok: true,
    defaultProvider: config.defaultProvider,
    provider: provider.id,
    providerLabel: provider.label,
    model: provider.model,
    endpointMode: provider.endpointMode,
    mock: config.mock,
    providers: getPublicProviders(config)
  }
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

function isAllowedOrigin(origin) {
  if (!origin) return false

  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()

    if (host === "127.0.0.1" || host === "localhost") return true

    return [
      "classroom.zju.edu.cn",
      "livingroom.cmc.zju.edu.cn",
      "onlineroom.cmc.zju.edu.cn"
    ].includes(host)
  } catch {
    return false
  }
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json;charset=utf-8"
  })
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  let body = ""

  for await (const chunk of req) {
    body += chunk
    if (body.length > 8 * 1024 * 1024) {
      throw new Error("请求体过大，请缩短文本或调低分块长度")
    }
  }

  if (!body) return {}
  return JSON.parse(body)
}

async function serveStatic(pathname, res) {
  const targetPath = pathname === "/" ? "/index.html" : pathname
  const resolved = normalize(resolve(publicRoot, `.${targetPath}`))

  if (!resolved.startsWith(publicRoot)) {
    sendJson(res, { error: "Forbidden" }, 403)
    return
  }

  if (!existsSync(resolved)) {
    const fallback = join(publicRoot, "index.html")
    if (existsSync(fallback)) {
      await streamFile(fallback, res)
      return
    }
    sendJson(res, { error: "Not Found" }, 404)
    return
  }

  await streamFile(resolved, res)
}

async function streamFile(filePath, res) {
  const ext = extname(filePath)
  await readFile(filePath)
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
  })
  createReadStream(filePath).pipe(res)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer()
}
