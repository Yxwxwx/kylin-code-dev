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
import { resolveDashscopeKey, resolveRagLLMSplit } from "./config";
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

        // 查询拆分：.kylinrc.json 中 rag.llmSplit=true 时启用 LLM 拆分，
        // 否则使用纯规则 domainRewrite（默认，零延迟）
        let subQueries: string[] = [];
        const useLLM = resolveRagLLMSplit(this.rootDir);
        if (useLLM) {
          try {
            const d = await this.translateAndDecompose(query);
            if (d.translated !== query) {
              console.log(
                chalk.gray(`  [QC] LLM 拆分 (${d.queries.length} 条):`),
              );
              d.queries.forEach((q, i) =>
                console.log(
                  chalk.gray(
                    `       ${i + 1}. ${q.slice(0, 80)}${q.length > 80 ? "..." : ""}`,
                  ),
                ),
              );
            } else {
              console.log(
                chalk.gray(`  [QC] LLM 失败，回退规则拆分 (${d.queries.length} 条)`),
              );
            }
            subQueries = d.queries;
          } catch {
            console.log(chalk.gray("  [QC] LLM 异常，回退规则拆分"));
            subQueries = domainRewrite(query, query);
          }
        } else {
          subQueries = domainRewrite(query, query);
        }

        // 每条子查询独立 RAG（每条最多 4 个结果），轮询合并保证多领域覆盖
        const PER_QUERY = 4;
        const byQuery = await Promise.all(
          (subQueries.length ? subQueries : [undefined]).map((qen) =>
            queryDocs(getQcDocsPath(), query, dk, PER_QUERY, qen),
          ),
        );
        // 轮询交织：每轮从每条子查询取 1 个结果，去重
        const merged: (typeof byQuery)[number] = [];
        const seen = new Set<string>();
        let round = 0;
        while (merged.length < 8) {
          let added = false;
          for (const rq of byQuery) {
            if (round < rq.length) {
              const r = rq[round]!;
              if (!seen.has(r.file)) {
                seen.add(r.file);
                merged.push(r);
                added = true;
                if (merged.length >= 8) break;
              }
            }
          }
          if (!added) break; // 所有子查询耗尽
          round++;
        }
        const results = merged;
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
        this.messages.push({
          role: "user",
          content: "Verify the changes work. If they pass, stop.",
        });
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
    const { messages: trimmed, trimmed: count } = trimMessages(
      this.messages,
      DEFAULT_TOKEN_BUDGET,
    );
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

      const am: Message = {
        role: "assistant",
        content: text || "",
        tool_calls: tcs,
      };
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
   * 单次 LLM 调用：翻译 + 按规定领域拆分。
   * 失败则回退到纯规则 domainRewrite。
   */
  private async translateAndDecompose(query: string): Promise<{
    translated: string;
    queries: string[];
  }> {
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "Split into exactly 3 English search queries, one per line.\n" +
              "1st: full accurate translation preserving ALL details (charge, spin, electron count).\n" +
              "2nd+3rd: pick 2 DIFFERENT aspects from the list below. Generate a query in the EXACT style shown — concise, keyword-dense, no sentence structure:\n" +
              "\n" +
              "  excited_states: \"PySCF TDDFT TDA excited state calculation nstates\"\n" +
              "  geomopt: \"PySCF geometry optimization of molecular equilibrium ground state structure\"\n" +
              "  stability: \"PySCF wavefunction stability analysis internal stability test for SCF DFT\"\n" +
              "  frequency: \"PySCF vibrational frequency calculation hessian IR Raman thermochemistry\"\n" +
              "  solvent: \"PySCF implicit solvent model PCM COSMO SMD solvation\"\n" +
              "  active_space: \"PySCF CASSCF active space selection AVAS multi-configurational\"\n" +
              "  relativistic: \"PySCF relativistic effects X2C DKH spin-orbit coupling\"\n" +
              "\n" +
              "Output only the 3 queries, nothing else.",
          },
          { role: "user", content: query },
        ],
        temperature: 0,
        max_tokens: 512,
      });
      const text = resp.choices[0]?.message?.content?.trim() || "";
      if (!text) {
        console.log(chalk.gray("  [QC] LLM 返回空内容"));
      } else if (/[一-鿿]/.test(text)) {
        console.log(
          chalk.gray(
            `  [QC] LLM 返回中文: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`,
          ),
        );
      } else {
        const lines = text
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length >= 1) {
          const translated = lines[0]!;
          const queries = [...new Set(lines)].slice(0, 3);
          return { translated, queries };
        }
      }
    } catch (e) {
      console.log(
        chalk.gray(`  [QC] LLM 调用异常: ${String(e).slice(0, 120)}`),
      );
    }

    // LLM 不可用时：纯规则 domainRewrite（无 base，只出领域查询）
    const queries = domainRewrite(query, query);
    return { translated: query, queries };
  }
}

// ============================================================
// 规则领域改写：LLM 不可用时的 fallback。
// 从原始 query 提取领域关键词，生成英文领域专属查询。
// base 含中文时跳过 base 自身，只返回领域查询。
// ============================================================

function domainRewrite(base: string, originalQuery: string): string[] {
  const q = originalQuery.toLowerCase();
  const hasChinese = /[一-鿿]/.test(base);
  // const hasChinese = false;
  const queries: string[] = hasChinese ? [] : [base];

  const domains: Array<{ re: RegExp; query: string }> = [
    {
      re: /tddft|tda|激发态|excited.*state/i,
      query: "PySCF TDDFT TDA excited state calculation nstates",
    },
    {
      re: /几何优化|结构优化|构型优化|geom.*opt|optimize.*(geometry|structure|geom)|优化.*(结构|构型|几何)/i,
      query:
        "PySCF geometry optimization of molecular equilibrium ground state structure",
    },
    {
      re: /稳定.*[性检波]|[波检].*稳定|stability|internal.*stable|stable.*wavefunction/i,
      query:
        "PySCF wavefunction stability analysis internal stability test for SCF DFT",
    },
    {
      re: /频率|振动|frequenc|vibration|hessian|freq.*calc|ir.*spec|raman|热化学/i,
      query:
        "PySCF vibrational frequency calculation hessian IR Raman thermochemistry",
    },
    {
      re: /溶剂|solvent|pcm|smd|cosmo|溶剂化|水溶液/i,
      query: "PySCF implicit solvent model PCM COSMO SMD solvation",
    },
    {
      re: /活性空间|active.*space|casscf|mcscf|avas|多组态|多参考/i,
      query: "PySCF CASSCF active space selection AVAS multi-configurational",
    },
    {
      re: /相对论|relativistic|x2c|dkh|spin.*orbit/i,
      query: "PySCF relativistic effects X2C DKH spin-orbit coupling",
    },
    {
      re: /nacs?|nonadiabatic|非绝热/i,
      query: "PySCF nonadiabatic coupling NAC matrix electronic states",
    },
  ];

  for (const { re, query } of domains) {
    if (re.test(q) && !queries.includes(query)) {
      queries.push(query);
    }
  }

  return queries.length > 3 ? queries.slice(0, 3) : queries;
}
