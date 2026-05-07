import OpenAI from "openai";
import chalk from "chalk";
import { chatStream, type Message, type ToolDef, type ToolCall } from "./llm";
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
import { MAX_TOOL_LOOP, DEFAULT_TOKEN_BUDGET } from "./constants";

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
        basePrompt = basePrompt.replace(/\$\{PYSCF_DOCS}/g, getQcDocsPath());
      }
      this.messages.push({
        role: "system",
        content:
          basePrompt +
          `\n\nWorking directory: ${this.rootDir}\nAll file read/write and command execution is relative to this directory.`,
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
        const rawQuery = input
          .replace(/```[\s\S]*?```/g, "")
          .replace(
            /\b(atom|basis|spin|charge|verbose|symmetry)\s*[=:]\s*[^,\n)]+/gi,
            "",
          )
          .replace(/,/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const query = rawQuery || input;

        // LLM 翻译 + 分解复合查询，每条子查询独立检索
        let subQueries: string[] = [];
        try {
          const d = await this.translateAndDecompose(query);
          if (d.translated !== query) {
            console.log(chalk.gray(`  [QC] 英译: ${d.translated}`));
          }
          subQueries = d.queries;
        } catch {
          console.log(chalk.gray("  [QC] LLM 翻译失败，回退到内置翻译"));
        }

        // 每条子查询独立 RAG，合并去重（按文件保留最高分）
        const topK = Math.ceil(10 / Math.max(1, subQueries.length));
        const all = (
          await Promise.all(
            (subQueries.length ? subQueries : [undefined]).map((qen) =>
              queryDocs(getQcDocsPath(), query, dk, topK, qen),
            ),
          )
        ).flat();
        const dedup = new Map<string, (typeof all)[number]>();
        for (const r of all) {
          const prev = dedup.get(r.file);
          if (!prev || r.score > prev.score) dedup.set(r.file, r);
        }
        const results = [...dedup.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        if (results.length > 0) {
          const ragBlock = results
            .map(
              (r) =>
                `### ${r.file} (score: ${r.score.toFixed(3)})\n\`\`\`\n${r.content}\n\`\`\``,
            )
            .join("\n\n");
          userContent = `## Retrieved documentation\n\n${ragBlock}\n\n---\n\nUser question: ${input}`;
        }
      }
    }

    // 保存快照用于错误回滚
    const snapshotLength = this.messages.length;
    this.messages.push({ role: "user", content: userContent });
    this.hadWrites = false;

    try {
      this.applyTokenBudget();
      await this.toolLoop(onText, onConfirm, onThinking);
      if (this.hadWrites && this.activePrompt !== "qc") {
        this.messages.push({ role: "user", content: "Verify the changes work. If they pass, stop." });
        this.applyTokenBudget();
        await this.toolLoop(onText, onConfirm, onThinking);
      }
    } catch (e) {
      // 回滚到 user 消息之前，包括去掉可能已添加的 assistant/tool 消息
      this.messages = this.messages.slice(0, snapshotLength);
      throw e;
    }
  }

  private applyTokenBudget(): void {
    const { messages: trimmed, trimmed: count } = trimMessages(this.messages, DEFAULT_TOKEN_BUDGET);
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
    for (let i = 0; i < MAX_TOOL_LOOP; i++) {
      let text = "";
      let reasoning = "";
      let tcs: ToolCall[] = [];

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
        this.messages.push({ role: "assistant", content: text || "" });
        return;
      }

      const am: Message = { role: "assistant", content: text || "", tool_calls: tcs };
      if (reasoning) am.reasoning_content = reasoning;
      this.messages.push(am);

      for (const tc of tcs) {
        const tool = this.tools.find(
          (t) => t.def.function.name === tc.function.name,
        );
        if (!tool) {
          this.messages.push({
            role: "tool",
            content: "Unknown tool",
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
            content: "Failed to parse arguments",
            tool_call_id: tc.id,
          });
          continue;
        }

        if (tool.needConfirm) {
          const cf = tool.needConfirm(params);
          if (cf.needed && !(await onConfirm(cf.message || ""))) {
            this.messages.push({
              role: "tool",
              content: "Denied by user",
              tool_call_id: tc.id,
            });
            continue;
          }
        }

        const result = await tool
          .run("", params)
          .catch((e: Error) => `Failed: ${e.message}`);
        this.messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
    }

    // 循环耗尽：请求最终响应（不带工具）
    const finalStream = chatStream(this.client, this.model, this.messages, []);
    let finalText = "";
    for await (const c of finalStream) {
      if (c.reasoning && onThinking) onThinking(c.reasoning);
      if (c.text) {
        finalText += c.text;
        onText(c.text);
      }
    }
    if (finalText) {
      this.messages.push({ role: "assistant", content: finalText });
    }
  }

  /**
   * 两步 LLM 调用：先翻译（中文 prompt，DeepSeek Flash 对此更可靠），
   * 再对英文译文做查询分解。翻译失败或含中文则回退到 rag.ts 内置 translateQuery。
   */
  private async translateAndDecompose(query: string): Promise<{
    translated: string;
    queries: string[];
  }> {
    // Step 1 — 翻译（中文指令，模型响应更稳定）
    let translated = query;
    try {
      const t = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: "你是翻译器，只输出英文译文。" },
          { role: "user", content: `翻译为英文:\n${query}` },
        ],
        temperature: 0,
        max_tokens: 256,
      });
      const text = t.choices[0]?.message?.content?.trim() || "";
      if (text && !/[一-鿿]/.test(text)) translated = text;
    } catch {
      // 网络错误等，沿用原始 query
    }

    if (translated === query) return { translated, queries: [] };

    // Step 2 — 分解复合查询（英文 prompt，尝试拆分多个独立话题）
    let queries = [translated];
    try {
      const d = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "If the query covers multiple distinct chemistry topics (method, basis set, geometry optimization, frequency analysis, solvent, excited state, active space, etc.), split into 2-3 focused English search queries. Output one query per line, no extra text.",
          },
          { role: "user", content: translated },
        ],
        temperature: 0,
        max_tokens: 256,
      });
      const lines = (d.choices[0]?.message?.content?.trim() || "")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/[一-鿿]/.test(s));
      if (lines.length > 1) {
        queries = lines;
        console.log(chalk.gray(`  [QC] 拆分为 ${queries.length} 个子查询`));
      }
    } catch {
      // 分解失败无所谓，用单条译文检索
    }

    return { translated, queries };
  }
}
