import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message } from "./llm";

// --- 会话存储路径 ---

const SESSIONS_DIR = path.join(os.homedir(), ".kylin", "sessions");

function sessionDir(rootDir: string): string {
  // 用项目路径的 hash 避免特殊字符
  const hash = Buffer.from(rootDir).toString("base64url").slice(0, 16);
  return path.join(SESSIONS_DIR, hash);
}

// --- 会话元数据 ---

export interface SessionMeta {
  file: string;
  createdAt: string;
  messageCount: number;
  promptMode: string;
  model: string;
  preview: string; // 第一条用户消息的前 80 字符
}

// --- 保存 ---

export function saveSession(
  rootDir: string,
  messages: Message[],
  model: string,
  promptMode: string,
): string {
  const dir = sessionDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${ts}.json`);

  // 过滤掉工具结果中过大的内容，避免文件膨胀
  const cleaned = messages.map((m) => {
    if (m.role === "tool" && m.content && m.content.length > 8000) {
      return { ...m, content: m.content.slice(0, 8000) + "\n...(已截断)" };
    }
    return m;
  });

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        rootDir,
        model,
        promptMode,
        messages: cleaned,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return file;
}

// --- 加载 ---

export function loadSession(
  filePath: string,
): { messages: Message[]; model: string; promptMode: string } | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      messages: data.messages || [],
      model: data.model || "",
      promptMode: data.promptMode || "general",
    };
  } catch {
    return null;
  }
}

// --- 列出历史会话 ---

export function listSessions(rootDir: string): SessionMeta[] {
  const dir = sessionDir(rootDir);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse(); // 最新的在前

  return files.map((f) => {
    const fp = path.join(dir, f);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const messages: Message[] = raw.messages || [];
      const firstUser = messages.find((m) => m.role === "user");
      const preview = firstUser?.content?.slice(0, 80) || "(空会话)";
      return {
        file: fp,
        createdAt: raw.createdAt || f,
        messageCount: messages.length,
        promptMode: raw.promptMode || "general",
        model: raw.model || "",
        preview,
      };
    } catch {
      return {
        file: fp,
        createdAt: f,
        messageCount: 0,
        promptMode: "general",
        model: "",
        preview: "(损坏)",
      };
    }
  });
}

// --- 删除会话 ---

export function deleteSession(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ============================================================
// Token 预算管理
// ============================================================

// 粗略估算：中英文混合约 2.5 字符/token
const CHARS_PER_TOKEN = 2.5;

// DeepSeek V4 上下文窗口 128K，但预留 8K 给输出，实际可用 120K
const DEFAULT_BUDGET = 120_000;

function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    let chars = 0;
    if (typeof m.content === "string") chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    if (m.reasoning_content) chars += m.reasoning_content.length;
    if (m.tool_call_id) chars += m.tool_call_id.length;
    // 消息结构开销约 4 token
    total += chars / CHARS_PER_TOKEN + 4;
  }
  return Math.ceil(total);
}

/**
 * 按 token 预算裁剪消息。
 * 保留 system prompt + 尽可能多的尾部消息，早期的 user/assistant/tool 对被成对裁剪。
 * 返回裁剪后的消息和是否发生了裁剪。
 */
export function trimMessages(
  messages: Message[],
  budget: number = DEFAULT_BUDGET,
): { messages: Message[]; trimmed: number } {
  const current = estimateTokens(messages);
  if (current <= budget) return { messages, trimmed: 0 };

  // system 消息必须保留
  const systemMsgs = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const sysTokens = estimateTokens(systemMsgs);
  const avail = budget - sysTokens;

  // 从后往前取，保证最新消息不被截断
  const kept: Message[] = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimateTokens([rest[i]!]);
    if (used + t > avail) break;
    kept.unshift(rest[i]!);
    used += t;
  }

  const trimmed = messages.length - (systemMsgs.length + kept.length);
  return { messages: [...systemMsgs, ...kept], trimmed };
}

/** 获取当前 token 估算，供外部展示 */
export function getTokenUsage(messages: Message[]): {
  estimated: number;
  budget: number;
  percent: number;
} {
  const estimated = estimateTokens(messages);
  return {
    estimated,
    budget: DEFAULT_BUDGET,
    percent: Math.round((estimated / DEFAULT_BUDGET) * 100),
  };
}
