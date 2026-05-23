import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const BUILT_IN_PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    endpointMode: "chat-completions",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    outputTokenParam: "max_tokens"
  },
  openai: {
    label: "OpenAI",
    endpointMode: "responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    outputTokenParam: "max_completion_tokens"
  },
  qwen: {
    label: "通义千问",
    endpointMode: "chat-completions",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    outputTokenParam: "max_tokens"
  },
  doubao: {
    label: "豆包/火山方舟",
    endpointMode: "chat-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6",
    outputTokenParam: "max_tokens"
  },
  kimi: {
    label: "Kimi/Moonshot",
    endpointMode: "chat-completions",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    outputTokenParam: "max_tokens"
  },
  custom: {
    label: "自定义兼容接口",
    endpointMode: "chat-completions",
    baseUrl: "https://example.com/v1",
    model: "custom-model",
    outputTokenParam: "max_tokens"
  }
}

export function loadEnv(file = ".env") {
  const envPath = resolve(process.cwd(), file)
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eq = trimmed.indexOf("=")
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

export function getConfig() {
  loadEnv()

  const providerIds = readProviderIds()
  const providers = Object.fromEntries(providerIds.map(id => [id, buildProviderConfig(id)]))
  const defaultProvider = normalizeProviderId(process.env.AI_PROVIDER || process.env.DEFAULT_AI_PROVIDER || providerIds[0])

  return {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 8787),
    defaultProvider: providers[defaultProvider] ? defaultProvider : providerIds[0],
    providers,
    mock: readBoolean("AI_MOCK", false),
    timeoutMs: readNumber("AI_TIMEOUT_MS", 300000),
    maxChunkChars: readNumber("MAX_CHUNK_CHARS", 12000),
    maxOutputTokens: readNumber("MAX_OUTPUT_TOKENS", 5000),
    saveOutputs: readBoolean("SAVE_OUTPUTS", true)
  }
}

export function resolveProvider(config, requestedProvider) {
  const id = normalizeProviderId(requestedProvider || config.defaultProvider)
  const provider = config.providers[id]

  if (!provider) {
    const available = Object.keys(config.providers).join(", ")
    throw new Error(`未知 AI 供应商：${requestedProvider || id}。可用供应商：${available}`)
  }

  return provider
}

export function getPublicProviders(config) {
  return Object.values(config.providers).map(provider => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    endpointMode: provider.endpointMode,
    baseUrl: provider.baseUrl,
    ready: config.mock || Boolean(provider.apiKey),
    isDefault: provider.id === config.defaultProvider
  }))
}

function readProviderIds() {
  const raw = process.env.AI_PROVIDERS || process.env.AI_PROVIDER || "deepseek,openai,qwen,doubao,kimi,custom"
  const ids = raw
    .split(",")
    .map(normalizeProviderId)
    .filter(Boolean)

  return ids.length ? [...new Set(ids)] : ["deepseek"]
}

function buildProviderConfig(id) {
  const defaults = BUILT_IN_PROVIDERS[id] || BUILT_IN_PROVIDERS.custom
  const prefix = envPrefix(id)

  return {
    id,
    label: env(`${prefix}_LABEL`, defaults.label || id),
    endpointMode: env(`${prefix}_ENDPOINT_MODE`, legacyValue(id, "AI_ENDPOINT_MODE", defaults.endpointMode)),
    baseUrl: stripTrailingSlash(env(`${prefix}_BASE_URL`, legacyValue(id, "AI_BASE_URL", defaults.baseUrl))),
    apiKey: env(`${prefix}_API_KEY`, legacyApiKey(id)),
    model: env(`${prefix}_MODEL`, legacyValue(id, "AI_MODEL", defaults.model)),
    outputTokenParam: env(`${prefix}_OUTPUT_TOKEN_PARAM`, legacyValue(id, "OUTPUT_TOKEN_PARAM", defaults.outputTokenParam))
  }
}

function legacyApiKey(id) {
  if (id === "openai") return process.env.OPENAI_API_KEY || process.env.AI_API_KEY || ""
  if (id === "custom") return process.env.AI_API_KEY || ""
  return ""
}

function legacyValue(id, name, fallback) {
  if (id === "custom" || id === "openai") {
    return env(name, fallback)
  }

  return fallback
}

function env(name, fallback = "") {
  const value = process.env[name]
  return value === undefined || value === "" ? fallback : value
}

function readBoolean(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

function readNumber(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "")
}

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
}

function envPrefix(id) {
  return normalizeProviderId(id).replace(/-/g, "_").toUpperCase()
}
