import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { getConfig } from "../src/config.js"
import { startServer } from "../src/server.js"

const config = getConfig()
const url = `http://${config.host}:${config.port}`

await mkdir(resolve(".runtime"), { recursive: true })

if (await isServerOnline(url)) {
  openBrowser(url)
  console.log(`服务已在运行：${url}`)
} else {
  const server = startServer(config)
  await writeFile(resolve(".runtime", "server.pid"), String(process.pid), "utf8")

  server.on("listening", () => {
    openBrowser(url)
  })

  server.on("close", () => {
    console.log("智云 AI 学习助手已停止")
  })
}

async function isServerOnline(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1200)
    })
    return response.ok
  } catch {
    return false
  }
}

function openBrowser(targetUrl) {
  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", targetUrl], {
      windowsHide: true
    })
    return
  }

  if (process.platform === "darwin") {
    execFile("open", [targetUrl])
    return
  }

  execFile("xdg-open", [targetUrl])
}
