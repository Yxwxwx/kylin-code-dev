import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs";
import { config as loadDotenv } from "dotenv";
import chalk from "chalk";
import { loadProject, resolveApiKey, resolveModel } from "./config";
import { runSetup } from "./setup";
import { Agent } from "./agent";
import { saveSession, getTokenUsage } from "./session";
import { createRenderer } from "./renderer";
import {
  printInputFrame,
  setAgentPrompt,
  createDotAnim,
  pagerIfNeeded,
} from "./display";
import { handleCommand } from "./commands";

loadDotenv({ quiet: true });

const dirArg = process.argv.slice(2).find((a) => !a.startsWith("-")) || ".";
const rootDir = path.resolve(dirArg);
if (rootDir !== process.cwd()) process.chdir(rootDir);

// ============================================================
// Tab 路径补全
// ============================================================

function pathCompleter(line: string): [string[], string] {
  const lastSpace = line.lastIndexOf(" ");
  const partial = line.slice(lastSpace + 1);
  if (
    !partial ||
    (!partial.startsWith(".") &&
      !partial.startsWith("/") &&
      !partial.startsWith("~"))
  ) {
    return [[], partial];
  }
  const dir = partial.includes("/")
    ? path.resolve(rootDir, path.dirname(partial))
    : rootDir;
  const prefix = partial.includes("/") ? path.basename(partial) : partial;
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .filter((e) => e.name.startsWith(prefix))
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
  } catch {
    return [[], partial];
  }
  const hits = entries.map(
    (e) =>
      line.slice(0, lastSpace + 1) +
      partial.slice(0, partial.lastIndexOf("/") + 1) +
      e,
  );
  return [hits, partial];
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  let cfg = loadProject(rootDir);
  if (!cfg) {
    if (!process.stdin.isTTY) {
      console.error("请运行 kylin-code init");
      process.exit(1);
    }
    console.log(chalk.bold.cyan("\n  🦄 Kylin Code 初始化\n"));
    await runSetup(rootDir);
    cfg = loadProject(rootDir)!;
    console.log(chalk.green("✔ 初始化完成\n"));
  }

  const apiKey = resolveApiKey(cfg);
  if (!apiKey) {
    console.error("未设置 API Key");
    process.exit(1);
  }
  const model = resolveModel(cfg);
  const agent = new Agent(rootDir, apiKey, model);

  agent.setOnTrimmed((count) => {
    console.log(
      chalk.yellow(`  ⚡ 上下文已裁剪 ${count} 条早期消息 (token 预算)`),
    );
  });

  const cmdHistory: string[] = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    history: cmdHistory,
    completer: pathCompleter,
    tabSize: 2,
    terminal: true,
  });

  let showThinking = true;
  let pagerOn = false;
  let multiLineBuffer: string[] = [];

  console.log(chalk.gray(`  Agent 就绪 — ${model}\n`));
  setAgentPrompt(rl, agent);
  rl.prompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trimEnd();
    if (trimmed.endsWith("\\")) {
      multiLineBuffer.push(trimmed.slice(0, -1));
      rl.setPrompt(chalk.gray("» "));
      rl.prompt();
      return;
    }

    let input: string;
    if (multiLineBuffer.length > 0) {
      multiLineBuffer.push(line);
      input = multiLineBuffer.join("\n").trim();
      multiLineBuffer = [];
    } else {
      input = line.trim();
    }

    if (!input) {
      setAgentPrompt(rl, agent);
      rl.prompt();
      return;
    }

    const cmd = handleCommand(input, {
      agent,
      rl,
      rootDir,
      showThinking,
      pagerOn,
    });
    if (cmd.handled) {
      if (cmd.toggleThink) showThinking = !showThinking;
      if (cmd.togglePager) pagerOn = !pagerOn;
      return;
    }

    // --- 普通对话 ---
    printInputFrame(input, agent);
    rl.pause();

    let thinkingActive = false;
    const dotAnim = createDotAnim();
    const render = createRenderer();
    let outLines = 0;

    try {
      await agent.process(
        input,
        (text) => {
          if (thinkingActive) {
            thinkingActive = false;
            if (!showThinking) dotAnim.stop();
            process.stdout.write("\n\n" + chalk.cyan("⏺") + " ");
            outLines += 2;
          }
          const rendered = render(text);
          outLines += (rendered.match(/\n/g) || []).length;
          if (rendered) process.stdout.write(rendered);
        },
        (msg) =>
          new Promise((resolve) => {
            if (!showThinking) dotAnim.pause();
            rl.resume();
            console.log(chalk.yellow(`  \n ⚠ ${msg}`));
            rl.question(chalk.gray("  [y] 允许  [n] 拒绝 > "), (a) => {
              if (!showThinking) dotAnim.resume();
              rl.pause();
              resolve(a.trim().toLowerCase() === "y" || a.trim() === "yes");
            });
          }),
        (t) => {
          if (!thinkingActive) {
            thinkingActive = true;
            if (showThinking) {
              process.stdout.write("\n" + chalk.gray.dim("* "));
              outLines += 1;
            } else {
              dotAnim.start();
              return;
            }
          }
          if (showThinking) {
            outLines += (t.match(/\n/g) || []).length;
            process.stdout.write(chalk.gray.dim(t.replace(/\n/g, "\n  ")));
          }
        },
      );

      const leftover = render.flush();
      if (leftover) {
        outLines += (leftover.match(/\n/g) || []).length;
        process.stdout.write(leftover);
      }

      if (pagerOn) await pagerIfNeeded(outLines, rl);

      const usage = getTokenUsage(agent.getMessages());
      if (usage.percent > 85) {
        console.log(
          chalk.red(
            `  ⚠ Token: ${usage.estimated}/${usage.budget} (${usage.percent}%)`,
          ),
        );
      }

      const msgs = agent.getMessages();
      if (msgs.length > 1) saveSession(rootDir, msgs, model, agent.getPrompt());
      console.log("");
    } catch (e) {
      console.log(chalk.red(`\n  错误: ${(e as Error).message}\n`));
    }

    rl.resume();
    setAgentPrompt(rl, agent);
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
