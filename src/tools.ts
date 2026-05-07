import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { simpleGit } from "simple-git";
import type { ToolDef } from "./llm";
import {
  COMMAND_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  MAX_STDERR_CHARS,
  SEARCH_MAX_RESULTS,
} from "./constants";

export interface ToolConfirm {
  needed: boolean;
  message?: string;
}

export interface Tool {
  def: ToolDef;
  needConfirm?: (p: Record<string, unknown>) => ToolConfirm;
  run: (root: string, p: Record<string, unknown>) => Promise<string>;
}

export function allTools(rootDir: string): Tool[] {
  return [
    readFile,
    writeFile,
    deleteFile,
    listDir,
    search,
    runCmd,
    gitDiff,
    gitStatus,
    gitLog,
  ].map((fn) => fn(rootDir));
}

function readFile(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read file contents with optional line range",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            startLine: { type: "number" },
            endLine: { type: "number" },
          },
          required: ["filePath"],
        },
      },
    },
    async run(_, p) {
      const r = path.resolve(root, p.filePath as string);
      if (!fs.existsSync(r)) return "File not found";
      const lines = fs.readFileSync(r, "utf-8").split("\n");
      const s = Math.max(1, Number(p.startLine) || 1);
      const e = Math.min(lines.length, Number(p.endLine) || lines.length);
      return lines
        .slice(s - 1, e)
        .map((l, i) => `${s + i}: ${l}`)
        .join("\n");
    },
  };
}

function writeFile(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or overwrite a file",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            content: { type: "string" },
          },
          required: ["filePath", "content"],
        },
      },
    },
    needConfirm(p) {
      return { needed: true, message: `写入 ${p.filePath}` };
    },
    async run(_, p) {
      const r = path.resolve(root, p.filePath as string);
      const d = path.dirname(r);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(r, p.content as string, "utf-8");
      return `Written ${p.filePath}`;
    },
  };
}

function deleteFile(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file",
        parameters: {
          type: "object",
          properties: { filePath: { type: "string" } },
          required: ["filePath"],
        },
      },
    },
    needConfirm(p) {
      return { needed: true, message: `删除 ${p.filePath}` };
    },
    async run(_, p) {
      const r = path.resolve(root, p.filePath as string);
      if (!fs.existsSync(r)) return `File not found: ${p.filePath}`;
      fs.unlinkSync(r);
      return `Deleted ${p.filePath}`;
    },
  };
}

function listDir(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "list_directory",
        description: "List directory tree structure",
        parameters: {
          type: "object",
          properties: {
            dirPath: { type: "string" },
            depth: { type: "number" },
          },
          required: [],
        },
      },
    },
    async run(_, p) {
      const d = path.resolve(root, (p.dirPath as string) || ".");
      if (!fs.existsSync(d)) return "Directory not found";
      return tree(d, "", (p.depth as number) || 3, 0);
    },
  };
}

function tree(dir: string, prefix: string, maxD: number, curD: number): string {
  if (curD >= maxD) return "";
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        !e.name.startsWith(".") &&
        e.name !== "node_modules" &&
        e.name !== "dist",
    );
  entries.sort((a, b) =>
    a.isDirectory() === b.isDirectory()
      ? a.name.localeCompare(b.name)
      : a.isDirectory()
        ? -1
        : 1,
  );
  let out = "";
  for (let i = 0; i < entries.length; i++) {
    const last = i === entries.length - 1;
    out += `${prefix}${last ? "└── " : "├── "}${entries[i].name}${entries[i].isDirectory() ? "/" : ""}\n`;
    if (entries[i].isDirectory())
      out += tree(
        path.join(dir, entries[i].name),
        prefix + (last ? "    " : "│   "),
        maxD,
        curD + 1,
      );
  }
  return out;
}

function search(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "search_code",
        description: "Search code with regex pattern",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            dirPath: { type: "string" },
            filePattern: { type: "string" },
          },
          required: ["pattern"],
        },
      },
    },
    async run(_, p) {
      const d = path.resolve(root, (p.dirPath as string) || ".");
      const regex = new RegExp(p.pattern as string, "gi");
      const extF = p.filePattern
        ? new RegExp(
            (p.filePattern as string)
              .replace(/\./g, "\\.")
              .replace(/\*/g, ".*") + "$",
          )
        : null;
      const results: string[] = [];
      walk(d, d, regex, extF, results, SEARCH_MAX_RESULTS);
      return results.length ? results.join("\n") : `No match for "${p.pattern}"`;
    },
  };
}

function walk(
  base: string,
  dir: string,
  regex: RegExp,
  extF: RegExp | null,
  out: string[],
  max: number,
): void {
  if (out.length >= max) return;
  let es: fs.Dirent[];
  try {
    es = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of es) {
    if (out.length >= max) return;
    if (
      e.name.startsWith(".") ||
      e.name === "node_modules" ||
      e.name === "dist"
    )
      continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      // 跳过符号链接目录，避免无限循环
      if (e.isSymbolicLink()) continue;
      walk(base, fp, regex, extF, out, max);
      continue;
    }
    if (extF && !extF.test(e.name)) continue;
    try {
      const ls = fs.readFileSync(fp, "utf-8").split("\n");
      for (let i = 0; i < ls.length; i++) {
        if (regex.test(ls[i]!)) {
          out.push(`${path.relative(base, fp)}:${i + 1}: ${ls[i]!.trim()}`);
          if (out.length >= max) return;
        }
      }
    } catch {
      // 权限问题等跳过
    }
  }
}

const SAFE_CMDS = [
  "ls",
  "cat",
  "head",
  "tail",
  "echo",
  "pwd",
  "whoami",
  "which",
  "grep",
  "find",
  "wc",
  "sort",
  "uniq",
  "file",
  "stat",
  "env",
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch",
  "npm list",
  "npm view",
  "node -v",
  "ls ",
];

function runCmd(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "run_command",
        description: "Execute a shell command",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
    needConfirm(p) {
      const c = (p.command as string).trim();
      const isSafe = SAFE_CMDS.some((s) => c.startsWith(s));
      return { needed: !isSafe, message: `执行: ${c}` };
    },
    run(_, p) {
      return new Promise((resolve) => {
        const c = p.command as string;
        const ch = spawn(c, { cwd: root, shell: true, env: process.env });
        let out = "";
        let err = "";
        const t = setTimeout(() => {
          ch.kill();
          resolve("Timed out");
        }, COMMAND_TIMEOUT_MS);
        ch.stdout?.on("data", (d: Buffer) => {
          const s = d.toString();
          process.stdout.write(s);
          out += s;
          if (out.length > MAX_OUTPUT_CHARS) {
            out = out.slice(0, MAX_OUTPUT_CHARS) + "...";
            ch.kill();
          }
        });
        ch.stderr?.on("data", (d: Buffer) => {
          const s = d.toString();
          process.stderr.write(s);
          err += s;
          if (err.length > MAX_STDERR_CHARS) err = err.slice(0, MAX_STDERR_CHARS) + "...";
        });
        ch.on("close", (code) => {
          clearTimeout(t);
          resolve(
            [
              out.trim(),
              err.trim() ? `stderr: ${err.trim()}` : "",
              `exit: ${code}`,
            ]
              .filter(Boolean)
              .join("\n") || `exit: ${code}`,
          );
        });
        ch.on("error", (e) => {
          clearTimeout(t);
          resolve(`Failed: ${e.message}`);
        });
      });
    },
  };
}

function gitDiff(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "git_diff",
        description: "Show git diff of changes",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    async run() {
      try {
        const d = await simpleGit(root).diff();
        return d || "No changes";
      } catch {
        return "Git unavailable";
      }
    },
  };
}

function gitStatus(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "git_status",
        description: "Show git working tree status",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    async run() {
      try {
        const s = await simpleGit(root).status();
        const ls: string[] = [];
        if (s.staged.length) ls.push("staged: " + s.staged.join(", "));
        if (s.modified.length) ls.push("modified: " + s.modified.join(", "));
        if (s.created.length) ls.push("new: " + s.created.join(", "));
        if (s.deleted.length) ls.push("deleted: " + s.deleted.join(", "));
        return ls.join("\n") || "Clean";
      } catch {
        return "Git unavailable";
      }
    },
  };
}

function gitLog(root: string): Tool {
  return {
    def: {
      type: "function",
      function: {
        name: "git_log",
        description: "Show git commit history",
        parameters: {
          type: "object",
          properties: { count: { type: "number" } },
          required: [],
        },
      },
    },
    async run(_, p) {
      try {
        const l = await simpleGit(root).log({ n: (p.count as number) || 10 });
        return l.all
          .map(
            (c) => `${c.hash.slice(0, 7)} ${c.date.slice(0, 10)} ${c.message}`,
          )
          .join("\n");
      } catch {
        return "Git unavailable";
      }
    },
  };
}
