import { existsSync, readFileSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { resolve } from "node:path"

const pidPath = resolve(".runtime", "server.pid")

if (!existsSync(pidPath)) {
  console.log("没有找到后台服务 PID。若服务仍在运行，请关闭对应 Node 进程。")
  process.exit(0)
}

const pid = Number(readFileSync(pidPath, "utf8").trim())

if (!Number.isInteger(pid) || pid <= 0) {
  await unlink(pidPath).catch(() => {})
  console.log("PID 文件无效，已清理。")
  process.exit(0)
}

try {
  process.kill(pid)
  await unlink(pidPath).catch(() => {})
  console.log(`已停止智云 AI 学习助手：PID ${pid}`)
} catch (error) {
  await unlink(pidPath).catch(() => {})
  console.log(`停止失败或进程已退出：${error.message}`)
}
