import * as readline from "node:readline";
import chalk from "chalk";
import type { Agent } from "./agent";
import { listPrompts } from "./prompts";
import { listSessions, loadSession, deleteSession } from "./session";
import { setAgentPrompt } from "./display";

export interface CmdResult {
  handled: boolean;
  shouldExit: boolean;
  toggleThink?: boolean;
  togglePager?: boolean;
}

export interface CmdContext {
  agent: Agent;
  rl: readline.Interface;
  rootDir: string;
  showThinking: boolean;
  pagerOn: boolean;
}

export function handleCommand(input: string, c: CmdContext): CmdResult {
  if (input === "/exit" || input === "/quit") {
    c.rl.close();
    return { handled: true, shouldExit: true };
  }

  if (input === "/clear") {
    c.agent.reset();
    console.log(chalk.gray("  上下文已重置"));
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  const promptNames = listPrompts().map((p) => p.name);
  if (input.startsWith("/") && promptNames.includes(input.slice(1))) {
    const label = c.agent.setPrompt(input.slice(1));
    console.log(chalk.gray(`  已切换: ${label}`));
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  if (input === "?" || input === "/help") {
    const prompts = listPrompts()
      .map((p) => chalk.cyan(`/${p.name}`) + " " + p.label)
      .join("  ");
    console.log(
      chalk.gray(`  /exit /clear /history /think /pager  ${prompts}`),
    );
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  if (input === "/think") {
    console.log(
      chalk.gray(
        `  思考内容: ${!c.showThinking ? "显示" : "隐藏 (Thinking...)"}`,
      ),
    );
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false, toggleThink: true };
  }

  if (input === "/pager") {
    console.log(chalk.gray(`  长输出分页: ${!c.pagerOn ? "开启" : "关闭"}`));
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false, togglePager: true };
  }

  if (input === "/history") {
    const sessions = listSessions(c.rootDir);
    if (sessions.length === 0) {
      console.log(chalk.gray("  暂无历史会话"));
    } else {
      console.log(chalk.bold(`\n  历史会话 (${sessions.length}):\n`));
      sessions.forEach((ses, i) => {
        const date = ses.createdAt.slice(0, 19).replace("T", " ");
        const idx = chalk.cyan(String(i + 1));
        const info = chalk.gray(
          `${date}  ${ses.messageCount}条  ${ses.promptMode}`,
        );
        console.log(`  ${idx}  ${ses.preview}`);
        console.log(`     ${info}`);
      });
      console.log(
        chalk.gray(
          `\n  /history load <序号>  恢复会话  |  /history del <序号>  删除会话`,
        ),
      );
    }
    console.log("");
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  const histLoad = input.match(/^\/history\s+load\s+(\d+)$/);
  if (histLoad) {
    const idx = parseInt(histLoad[1]!, 10) - 1;
    const sessions = listSessions(c.rootDir);
    if (idx < 0 || idx >= sessions.length) {
      console.log(chalk.red("  无效的会话序号"));
    } else {
      const loaded = loadSession(sessions[idx]!.file);
      if (loaded) {
        c.agent.setMessages(loaded.messages, loaded.promptMode);
        console.log(
          chalk.green(
            `  ✔ 已恢复会话 (${loaded.messages.length} 条消息, 模式: ${loaded.promptMode})`,
          ),
        );
      } else {
        console.log(chalk.red("  会话加载失败"));
      }
    }
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  const histDel = input.match(/^\/history\s+del\s+(\d+)$/);
  if (histDel) {
    const idx = parseInt(histDel[1]!, 10) - 1;
    const sessions = listSessions(c.rootDir);
    if (idx < 0 || idx >= sessions.length) {
      console.log(chalk.red("  无效的会话序号"));
    } else {
      const ok = deleteSession(sessions[idx]!.file);
      console.log(ok ? chalk.green("  ✔ 已删除") : chalk.red("  删除失败"));
    }
    setAgentPrompt(c.rl, c.agent);
    c.rl.prompt();
    return { handled: true, shouldExit: false };
  }

  return { handled: false, shouldExit: false };
}
