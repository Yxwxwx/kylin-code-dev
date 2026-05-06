
import * as readline from "node:readline";
import chalk from "chalk";
import { getTokenUsage } from "./session";
import type { Agent } from "./agent";

// ============================================================
// Token 用量圆环
// ============================================================

const RING_CHARS = ["○", "◔", "◑", "◕", "●"];

export function renderTokenRing(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const idx = Math.min(
    RING_CHARS.length - 1,
    Math.floor((clamped / 100) * RING_CHARS.length),
  );
  if (idx === 0) return chalk.gray(RING_CHARS[0]!);
  return chalk.white(RING_CHARS[idx]!);
}

// ============================================================
// 输入框线
// ============================================================

export function printInputFrame(input: string, agent: Agent): void {
  const termWidth = process.stdout.columns || 80;
  const hr = chalk.gray("─".repeat(termWidth));
  const ring = renderTokenRing(getTokenUsage(agent.getMessages()).percent);
  process.stdout.write("\x1b[1A\x1b[2K");
  console.log(hr);
  for (const inputLine of input.split("\n")) {
    console.log(ring + chalk.gray(" > ") + inputLine);
  }
  console.log(hr);
}

// ============================================================
// Prompt 行
// ============================================================

export function setAgentPrompt(rl: readline.Interface, agent: Agent): void {
  const ring = renderTokenRing(getTokenUsage(agent.getMessages()).percent);
  const mode =
    agent.getPrompt() === "general"
      ? ""
      : chalk.gray(` ${agent.getPrompt()}`);
  rl.setPrompt(ring + chalk.gray(" >") + mode + " ");
}

// ============================================================
// 思考动画（隐藏模式）
// ============================================================

export function createDotAnim() {
  let timer: ReturnType<typeof setInterval> | null = null;
  let dotCount = 0;
  let paused = false;

  const start = () => {
    dotCount = 0;
    paused = false;
    process.stdout.write("\n" + chalk.gray.dim("Thinking."));
    timer = setInterval(() => {
      if (paused) return;
      dotCount = (dotCount + 1) % 6;
      process.stdout.write(
        "\r" + chalk.gray.dim("Thinking" + ".".repeat(dotCount + 1)),
      );
    }, 400);
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      process.stdout.write("\r\x1b[2K");
    }
  };

  const pause = () => {
    paused = true;
  };
  const resume = () => {
    paused = false;
  };

  return { start, stop, pause, resume };
}

// ============================================================
// 长输出分页
// ============================================================

export async function pagerIfNeeded(outLines: number, rl: readline.Interface) {
  const termHeight = process.stdout.rows || 40;
  if (outLines <= termHeight - 3) return;

  rl.resume();
  console.log(
    chalk.gray(`\n  ── 输出 ${outLines} 行，按任意键继续 (q 跳过) ──`),
  );
  await new Promise<void>((resolve) => {
    const onKey = (_str: string, key: readline.Key) => {
      process.stdin.removeListener("keypress", onKey);
      if (process.stdin.isRaw) process.stdin.setRawMode(false);
      if (key.name === "q") {
        resolve();
        return;
      }
      process.stdout.write("\x1b[1A\x1b[2K");
      resolve();
    };
    readline.emitKeypressEvents(process.stdin);
    if (!process.stdin.isRaw) process.stdin.setRawMode(true);
    process.stdin.on("keypress", onKey);
  });
  rl.pause();
}
