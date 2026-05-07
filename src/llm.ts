import OpenAI from "openai";
import { DEEPSEEK_MAX_TOKENS, TEMPERATURE } from "./constants";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: StreamToolCallDelta[];
}

interface OpenAIStreamChunk {
  choices: Array<{
    delta?: OpenAIDelta;
    finish_reason?: string | null;
  }>;
}

export interface StreamEvent {
  text: string;
  toolCalls: ToolCall[];
  reasoning: string;
}

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
};

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export async function* chatStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools?: ToolDef[],
): AsyncGenerator<StreamEvent> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
    stream: true,
    temperature: TEMPERATURE,
    max_tokens: DEEPSEEK_MAX_TOKENS,
  });

  const rawToolCalls: Record<number, ToolCall> = {};
  let reasoning = "";
  let lastSent = 0;

  for await (const chunk of stream) {
    const choice = chunk.choices[0] as OpenAIStreamChunk["choices"][0] | undefined;
    const d = choice?.delta;

    if (d?.reasoning_content) reasoning += d.reasoning_content;
    const delta = reasoning.slice(lastSent);
    if (delta) {
      yield { text: "", toolCalls: [], reasoning: delta };
      lastSent = reasoning.length;
    }

    if (d?.content) yield { text: d.content, toolCalls: [], reasoning: "" };

    if (d?.tool_calls) {
      for (const tc of d.tool_calls) {
        const i = tc.index;
        if (!rawToolCalls[i]) {
          rawToolCalls[i] = {
            id: tc.id || `c${i}`,
            type: "function",
            function: { name: tc.function?.name || "", arguments: "" },
          };
        }
        if (tc.function?.arguments) {
          rawToolCalls[i]!.function.arguments += tc.function.arguments;
        }
      }
    }

    if (choice?.finish_reason) {
      yield { text: "", toolCalls: Object.values(rawToolCalls), reasoning: "" };
      reasoning = "";
      lastSent = 0;
    }
  }
}
