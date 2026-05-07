import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message } from "./llm";
import {
  SESSION_TRUNCATE_CHARS,
  DEFAULT_TOKEN_BUDGET,
  CHARS_PER_TOKEN,
} from "./constants";

const SESSIONS_DIR = path.join(os.homedir(), ".kylin", "sessions");

function sessionDir(rootDir: string): string {
  const hash = Buffer.from(rootDir).toString("base64url").slice(0, 16);
  return path.join(SESSIONS_DIR, hash);
}

export interface SessionMeta {
  file: string;
  createdAt: string;
  messageCount: number;
  promptMode: string;
  model: string;
  preview: string;
}

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
  const cleaned = messages.map((m) => {
    if (m.role === "tool" && m.content && m.content.length > SESSION_TRUNCATE_CHARS) {
      return { ...m, content: m.content.slice(0, SESSION_TRUNCATE_CHARS) + "\n...(已截断)" };
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

export function loadSession(
  filePath: string,
): { messages: Message[]; model: string; promptMode: string } | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      messages?: Message[];
      model?: string;
      promptMode?: string;
    };
    return {
      messages: data.messages || [],
      model: data.model || "",
      promptMode: data.promptMode || "general",
    };
  } catch {
    return null;
  }
}

export function listSessions(rootDir: string): SessionMeta[] {
  const dir = sessionDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.map((f) => {
    const fp = path.join(dir, f);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
        messages?: Message[];
        createdAt?: string;
        promptMode?: string;
        model?: string;
      };
      const messages: Message[] = raw.messages || [];
      const firstUser = messages.find((m) => m.role === "user");
      return {
        file: fp,
        createdAt: raw.createdAt || f,
        messageCount: messages.length,
        promptMode: raw.promptMode || "general",
        model: raw.model || "",
        preview: firstUser?.content?.slice(0, 80) || "(空会话)",
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

export function deleteSession(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** 删除本目录下所有历史会话，返回删除数量 */
export function deleteAllSessions(rootDir: string): number {
  const dir = sessionDir(rootDir);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) fs.unlinkSync(path.join(dir, f));
  return files.length;
}

// ============================================================
// Token 预算管理
// ============================================================

function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    let chars = 0;
    if (typeof m.content === "string") chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    if (m.reasoning_content) chars += m.reasoning_content.length;
    if (m.tool_call_id) chars += m.tool_call_id.length;
    total += chars / CHARS_PER_TOKEN + 4;
  }
  return Math.ceil(total);
}

export function trimMessages(
  messages: Message[],
  budget: number = DEFAULT_TOKEN_BUDGET,
): { messages: Message[]; trimmed: number } {
  const current = estimateTokens(messages);
  if (current <= budget) return { messages, trimmed: 0 };
  const systemMsgs = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const sysTokens = estimateTokens(systemMsgs);
  const avail = budget - sysTokens;
  const kept: Message[] = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimateTokens([rest[i]!]);
    if (used + t > avail) break;
    kept.unshift(rest[i]!);
    used += t;
  }
  return {
    messages: [...systemMsgs, ...kept],
    trimmed: messages.length - (systemMsgs.length + kept.length),
  };
}

export function getTokenUsage(messages: Message[]): {
  estimated: number;
  budget: number;
  percent: number;
} {
  const estimated = estimateTokens(messages);
  return {
    estimated,
    budget: DEFAULT_TOKEN_BUDGET,
    percent: Math.round((estimated / DEFAULT_TOKEN_BUDGET) * 100),
  };
}
