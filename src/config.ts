import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface KylinConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const GLOBAL_DIR = path.join(os.homedir(), ".kylin");
const GLOBAL_PATH = path.join(GLOBAL_DIR, "config.json");

export function loadGlobal(): Record<string, any> {
  if (fs.existsSync(GLOBAL_PATH)) {
    return JSON.parse(fs.readFileSync(GLOBAL_PATH, "utf-8"));
  }
  return {};
}

export function saveGlobal(data: Record<string, any>): void {
  if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function loadProject(dir: string): KylinConfig | null {
  const p = path.join(dir, ".kylinrc.json");
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  const models = c.models?.deepseek || {};
  return {
    provider: c.provider || "deepseek",
    model: models.model || c.model || "deepseek-v4-flash",
    apiKey: models.apiKey || c.apiKey,
    baseURL: models.baseURL || c.baseURL || "https://api.deepseek.com",
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
            model,
            maxTokens: 8192,
            temperature: 0,
          },
          dashscope: dashscopeKey ? { apiKey: dashscopeKey } : undefined,
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
  return g?.providers?.deepseek?.apiKey || "";
}

export function resolveModel(project: KylinConfig | null): string {
  return project?.model || "deepseek-v4-flash";
}

/** DashScope API Key（用于 embedding）*/
export function resolveDashscopeKey(dir: string): string {
  const proj = loadProject(dir);
  const pk = (proj as any)?.models?.dashscope?.apiKey;
  if (pk) return pk;
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  const g = loadGlobal();
  return (g as any)?.providers?.dashscope?.apiKey || "";
}
