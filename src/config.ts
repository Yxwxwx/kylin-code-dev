import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface KylinConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  models?: {
    deepseek?: { apiKey: string; baseURL?: string };
    dashscope?: { apiKey: string };
  };
  rag?: {
    llmSplit?: boolean;
  };
}

const GLOBAL_DIR = path.join(os.homedir(), ".kylin");
const GLOBAL_PATH = path.join(GLOBAL_DIR, "config.json");

export function loadGlobal(): Record<string, unknown> {
  if (fs.existsSync(GLOBAL_PATH)) {
    return JSON.parse(fs.readFileSync(GLOBAL_PATH, "utf-8")) as Record<string, unknown>;
  }
  return {};
}

export function saveGlobal(data: Record<string, unknown>): void {
  if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function loadProject(dir: string): KylinConfig | null {
  const p = path.join(dir, ".kylinrc.json");
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
  const models = (c.models as Record<string, unknown> | undefined)?.deepseek as Record<string, unknown> | undefined;
  const ragCfg = c.rag as Record<string, unknown> | undefined;
  return {
    provider: (c.provider as string) || "deepseek",
    // 向后兼容：model 优先取顶层，其次取 models.deepseek.model
    model: (c.model as string) || (models?.model as string) || "deepseek-v4-flash",
    apiKey: (models?.apiKey as string) || (c.apiKey as string) || undefined,
    baseURL: (models?.baseURL as string) || (c.baseURL as string) || "https://api.deepseek.com",
    rag: {
      llmSplit: ragCfg?.llmSplit === true,
    },
  };
}

export function initProject(
  dir: string,
  apiKey: string,
  model: string,
  dashscopeKey?: string,
): void {
  const p = path.join(dir, ".kylinrc.json");
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        provider: "deepseek",
        model,
        models: {
          deepseek: {
            apiKey,
            baseURL: "https://api.deepseek.com",
          },
          dashscope: dashscopeKey ? { apiKey: dashscopeKey } : undefined,
        },
        rag: {
          llmSplit: false,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

export function resolveApiKey(project: KylinConfig | null): string {
  if (project?.apiKey) return project.apiKey;
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const g = loadGlobal();
  return ((g.providers as Record<string, unknown> | undefined)?.deepseek as Record<string, unknown> | undefined)?.apiKey as string || "";
}

export function resolveModel(project: KylinConfig | null): string {
  return project?.model || "deepseek-v4-flash";
}

/** DashScope API Key（用于 embedding）*/
export function resolveDashscopeKey(dir: string): string {
  const proj = loadProject(dir);
  const pk = proj?.models?.dashscope?.apiKey;
  if (pk) return pk;
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  const g = loadGlobal();
  return ((g.providers as Record<string, unknown> | undefined)?.dashscope as Record<string, unknown> | undefined)?.apiKey as string || "";
}

/** RAG LLM 拆分开关，默认关闭 */
export function resolveRagLLMSplit(dir: string): boolean {
  const proj = loadProject(dir);
  return proj?.rag?.llmSplit === true;
}
