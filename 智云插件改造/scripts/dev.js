process.env.AI_MOCK = "true"

const { startServer } = await import("../src/server.js")

startServer()
