import OpenAI from "openai";
import chalk from "chalk";
import { chatStream, type Message, type ToolDef } from "./llm";
import { allTools, type Tool } from "./tools";
import {
  getPrompt,
  matchPrompt,
  getLabel,
  getQcDocsPath,
  DEFAULT_PROMPT,
} from "./prompts";
import { trimMessages } from "./session";
import { resolveDashscopeKey } from "./config";
import { queryDocs } from "./rag";

export class Agent {
  private client: OpenAI;
  private model: string;
  private tools: Tool[];
  private toolDefs: ToolDef[];
  private messages: Message[];
  private hadWrites = false;
  private activePrompt = "general";
  private explicitMode = false;
  private rootDir: string;
  private onTrimmed: ((count: number) => void) | null = null;

  constructor(rootDir: string, apiKey: string, model: string) {
    this.rootDir = rootDir;
    this.client = new OpenAI({ baseURL: "https://api.deepseek.com", apiKey });
    this.model = model;
    this.tools = allTools(rootDir);
    this.toolDefs = this.tools.map((t) => t.def);
    this.messages = [];
  }

  reset(): void {
    this.messages = [];
    this.hadWrites = false;
    this.explicitMode = false;
  }
  getPrompt(): string {
    return this.activePrompt;
  }
  setPrompt(name: string): string {
    this.activePrompt = name;
    this.messages = [];
    this.explicitMode = true;
    return getLabel(name);
  }
  getMessages(): Message[] {
    return this.messages;
  }
  setMessages(msgs: Message[], promptMode?: string): void {
    this.messages = msgs;
    if (promptMode) {
      this.activePrompt = promptMode;
      this.explicitMode = true;
    }
  }
  setOnTrimmed(cb: ((count: number) => void) | null): void {
    this.onTrimmed = cb;
  }

  async process(
    input: string,
    onText: (t: string) => void,
    onConfirm: (msg: string) => Promise<boolean>,
    onThinking?: (t: string) => void,
  ): Promise<void> {
    // 首条消息：构建 system prompt
    if (this.messages.length === 0) {
      if (!this.explicitMode) {
        const m = matchPrompt(input);
        if (m) this.activePrompt = m.name;
      }
      let basePrompt = getPrompt(this.activePrompt) || DEFAULT_PROMPT;
      if (this.activePrompt === "qc") {
        basePrompt = basePrompt.replace(/\${PYSCF_DOCS}/g, getQcDocsPath());
      }
      this.messages.push({
        role: "system",
        content:
          basePrompt +
          `\n\n工作目录: ${this.rootDir}\n所有文件读写和命令执行都基于此目录。`,
      });
    }

    // qc 模式：每条消息都做 RAG 检索
    let userContent = input;
    if (this.activePrompt === "qc") {
      console.log(chalk.gray("  [QC] 启动 RAG 检索..."));
      const dk = resolveDashscopeKey(this.rootDir);
      console.log(
        chalk.gray(`  [QC] DashScope key: ${dk ? "已设置" : "未设置"}`),
      );
      if (dk) {
        const query = input
          .replace(/```[\s\S]*?```/g, "")
          .replace(
            /\b(atom|basis|spin|charge|verbose|symmetry)\s*[=:]\s*[^,\n)]+/gi,
            "",
          )
          .replace(/,/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const results = await queryDocs(getQcDocsPath(), query || input, dk, 8);
        if (results.length > 0) {
          const ragBlock = results
            .map(
              (r) =>
                `### ${r.file} (score: ${r.score.toFixed(3)})\n\`\`\`\n${r.content}\n\`\`\``,
            )
            .join("\n\n");
          userContent = `## 检索到的相关文档\n\n${ragBlock}\n\n---\n\n用户问题: ${input}`;
        }
      }
    }

    this.messages.push({ role: "user", content: userContent });
    this.hadWrites = false;

    try {
      this.applyTokenBudget();
      await this.toolLoop(onText, onConfirm, onThinking);
      if (this.hadWrites && this.activePrompt !== "qc") {
        this.messages.push({ role: "user", content: "运行验证，通过则结束。" });
        this.applyTokenBudget();
        await this.toolLoop(onText, onConfirm, onThinking);
      }
    } catch (e) {
      this.messages.pop();
      throw e;
    }
  }

  private applyTokenBudget(): void {
    const { messages: trimmed, trimmed: count } = trimMessages(this.messages);
    if (count > 0) {
      this.messages = trimmed;
      if (this.onTrimmed) this.onTrimmed(count);
    }
  }

  private async toolLoop(
    onText: (t: string) => void,
    onConfirm: (msg: string) => Promise<boolean>,
    onThinking?: (t: string) => void,
  ): Promise<void> {
    for (let i = 0; i < 10; i++) {
      let text = "",
        reasoning = "",
        tcs: any[] = [];
      const stream = chatStream(
        this.client,
        this.model,
        this.messages,
        this.toolDefs,
      );
      for await (const c of stream) {
        if (c.reasoning) {
          reasoning += c.reasoning;
          if (onThinking) onThinking(c.reasoning);
        }
        if (c.text) {
          text += c.text;
          onText(c.text);
        }
        if (c.toolCalls.length) tcs = c.toolCalls;
      }
      if (tcs.length === 0) {
        this.messages.push({ role: "assistant", content: text || null });
        break;
      }

      const am: any = { role: "assistant", tool_calls: tcs };
      if (text) am.content = text;
      if (reasoning) am.reasoning_content = reasoning;
      this.messages.push(am);

      for (const tc of tcs) {
        const tool = this.tools.find(
          (t) => t.def.function.name === tc.function.name,
        );
        if (!tool) {
          this.messages.push({
            role: "tool",
            content: "未知工具",
            tool_call_id: tc.id,
          });
          continue;
        }
        if (tc.function.name === "write_file") this.hadWrites = true;

        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(tc.function.arguments || "{}");
        } catch {
          this.messages.push({
            role: "tool",
            content: "参数解析失败",
            tool_call_id: tc.id,
          });
          continue;
        }
        if (tool.needConfirm) {
          const msg = tool.needConfirm(params);
          if (msg && !(await onConfirm(msg))) {
            this.messages.push({
              role: "tool",
              content: "用户拒绝",
              tool_call_id: tc.id,
            });
            continue;
          }
        }
        const result = await tool
          .run("", params)
          .catch((e) => `失败: ${(e as Error).message}`);
        this.messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
    }
  }
}
