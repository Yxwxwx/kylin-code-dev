import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// 从 system-prompts/ 文件夹加载 prompt 文件
// ============================================================

export interface PromptDef {
  name: string;
  label: string;
  match: string[];
  load: () => string;
}

function findPromptDir(): string {
  const candidates = [
    path.join(process.cwd(), "system-prompts"),
    path.join(path.dirname(process.argv[1] || ""), "..", "system-prompts"),
    path.join(__dirname, "..", "system-prompts"),
  ];
  for (const d of candidates) if (fs.existsSync(d)) return d;
  return candidates[0]!;
}

let _dir: string | null = null;
function promptDir(): string {
  if (!_dir) {
    _dir = findPromptDir();
  }
  return _dir;
}

/** 解析 pyscf-docs/ 路径 */
export function getQcDocsPath(): string {
  return path.join(promptDir(), "..", "pyscf-docs");
}

function readPromptFile(filename: string): string {
  const fp = path.join(promptDir(), filename);
  if (!fs.existsSync(fp)) {
    return "";
  }
  return fs
    .readFileSync(fp, "utf-8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/!`[^`]*`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================
// Prompt 注册表
// ============================================================

const PROMPTS: PromptDef[] = [
  {
    name: "general",
    label: "通用编程",
    match: [],
    load: () => readPromptFile("agent-prompt-general-purpose.md") || "",
  },
  {
    name: "plan",
    label: "架构规划",
    match: [
      "计划",
      "规划",
      "架构",
      "设计",
      "方案",
      "plan",
      "architect",
      "design",
      "怎么实现",
      "如何做",
    ],
    load: () => readPromptFile("agent-prompt-plan-mode-enhanced.md") || "",
  },
  {
    name: "explore",
    label: "代码探索",
    match: [
      "探索",
      "搜索",
      "查找",
      "找",
      "查",
      "explore",
      "search",
      "find",
      "在哪",
      "定位",
    ],
    load: () => readPromptFile("agent-prompt-explore.md") || "",
  },
  {
    name: "commit",
    label: "Git 提交",
    match: ["commit", "提交", "stage", "暂存"],
    load: () => readPromptFile("agent-prompt-quick-git-commit.md") || "",
  },
  {
    name: "verify",
    label: "验证测试",
    match: ["验证", "测试", "检查", "verify", "test", "check", "审查"],
    load: () => readPromptFile("agent-prompt-verification-specialist.md") || "",
  },
  {
    name: "fix",
    label: "修复 Bug",
    match: ["修复", "fix", "bug", "错误", "报错", "debug", "调试"],
    load: () => readPromptFile("agent-prompt-general-purpose.md") || "",
  },
  {
    name: "refactor",
    label: "代码重构",
    match: ["重构", "refactor", "整理", "优化", "拆分", "提取", "重写"],
    load: () => readPromptFile("agent-prompt-general-purpose.md") || "",
  },
  {
    name: "feature",
    label: "添加功能",
    match: [
      "添加",
      "新增",
      "创建",
      "实现",
      "写",
      "add",
      "create",
      "implement",
      "开发",
      "做个",
      "生成",
      "帮我",
      "写个",
    ],
    load: () => readPromptFile("agent-prompt-general-purpose.md") || "",
  },
  {
    name: "qc",
    label: "量子化学",
    match: [
      "pyscf",
      "量子化学",
      "量化",
      "DFT",
      "HF",
      "CCSD",
      "MP2",
      "CASSCF",
      "基组",
      "basis",
      "opt",
      "freq",
      "单点能",
      "结构优化",
      "频率",
      "激发态",
      "TDDFT",
    ],
    load: () => readPromptFile("agent-prompt-qc.md") || "",
  },
];

// ============================================================
// API
// ============================================================

export function matchPrompt(input: string): PromptDef | null {
  const lower = input.toLowerCase();
  let best: PromptDef | null = null;
  let bestScore = 0;
  for (const p of PROMPTS) {
    let score = 0;
    for (const kw of p.match) {
      if (lower.includes(kw.toLowerCase())) score += kw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore > 0 ? best : null;
}

export function getPrompt(name: string): string {
  return PROMPTS.find((p) => p.name === name)?.load() || PROMPTS[0]!.load();
}

export function getLabel(name: string): string {
  return PROMPTS.find((p) => p.name === name)?.label || name;
}

export function listPrompts(): { name: string; label: string }[] {
  return PROMPTS.map((p) => ({ name: p.name, label: p.label }));
}

export const DEFAULT_PROMPT = PROMPTS[0]!.load();
