import OpenAI from "openai";

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
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

export interface StreamEvent {
  text: string;
  toolCalls: any[];
  reasoning: string;
}

export async function* chatStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools?: ToolDef[],
): AsyncGenerator<StreamEvent> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as any,
    tools: tools as any,
    stream: true,
    temperature: 0,
    max_tokens: 8192,
  });

  const toolCalls: Record<number, any> = {};
  let reasoning = "",
    lastSent = 0;

  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta as any;

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
        if (!toolCalls[i])
          toolCalls[i] = {
            id: tc.id || `c${i}`,
            type: "function",
            function: { name: tc.function?.name || "", arguments: "" },
          };
        if (tc.function?.arguments)
          toolCalls[i].function.arguments += tc.function.arguments;
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      yield { text: "", toolCalls: Object.values(toolCalls), reasoning: "" };
      reasoning = "";
      lastSent = 0;
    }
  }
}
