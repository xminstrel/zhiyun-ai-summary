import { readFile } from "node:fs/promises"
import { createApp } from "../src/server.js"

const server = createApp({
  host: "127.0.0.1",
  port: 0,
  defaultProvider: "deepseek",
  providers: {
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      endpointMode: "chat-completions",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-v4-flash",
      outputTokenParam: "max_tokens"
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      endpointMode: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-5",
      outputTokenParam: "max_completion_tokens"
    }
  },
  mock: true,
  timeoutMs: 30000,
  maxChunkChars: 12000,
  maxOutputTokens: 1000,
  saveOutputs: false
})

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))

const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

try {
  const health = await fetch(`${baseUrl}/health`).then(res => res.json())
  if (!health.ok || !health.mock || health.defaultProvider !== "deepseek") {
    throw new Error("health check failed")
  }

  const providers = await fetch(`${baseUrl}/api/providers`).then(res => res.json())
  if (!providers.providers?.some(provider => provider.id === "openai")) {
    throw new Error("providers endpoint failed")
  }

  const transcript = await readFile("samples/transcript.md", "utf8")
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: "冒烟测试课程",
      transcript,
      mode: "comprehensive",
      provider: "openai"
    })
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || "job create request failed")
  }

  const jobId = data.job?.id
  if (!jobId || data.job.status !== "queued") {
    throw new Error("unexpected job creation output")
  }

  const job = await waitForJob(`${baseUrl}/api/jobs/${jobId}`)

  if (job.result?.provider !== "openai" || !job.result?.markdown?.includes("模拟课堂学习总结")) {
    throw new Error("unexpected summary output")
  }

  console.log("smoke ok")
} finally {
  await new Promise(resolve => server.close(resolve))
}

async function waitForJob(url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const data = await fetch(url).then(res => res.json())
    const job = data.job

    if (job?.status === "completed") return job
    if (job?.status === "failed") throw new Error(job.error || "job failed")

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error("job did not complete")
}
