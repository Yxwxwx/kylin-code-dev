import chalk from "chalk";
import { highlight } from "cli-highlight";

export function renderCodeBlock(code: string, lang: string): string {
  const trimmed = code.trimEnd();
  if (!trimmed.trim()) return "";
  let colored: string;
  try {
    colored = highlight(trimmed, { language: lang || undefined, theme: {} });
  } catch {
    colored = chalk.white(trimmed);
  }
  return `\n${chalk.gray("┌" + (lang || "code"))}\n${colored}\n${chalk.gray("└")}`;
}

export function renderInline(t: string): string {
  return t.replace(/`([^`]+)`/g, (_, c) => chalk.cyan(c));
}

export interface Renderer {
  (chunk: string): string;
  flush(): string;
}

export function createRenderer(): Renderer {
  let buf = "";
  let lang = "";
  let fence = "";

  const flushFence = (chunk: string): string => {
    const combined = fence + chunk;
    const om = combined.match(/```(\w*)\n/);
    if (!om || om.index === undefined) {
      fence = combined;
      return "";
    }
    fence = "";
    const before = combined.slice(0, om.index);
    const lt = om[1] || "";
    const rest = combined.slice(om.index + om[0].length);
    const ci = rest.indexOf("\n```");
    if (ci !== -1) {
      return (
        renderInline(before) +
        renderCodeBlock(rest.slice(0, ci), lt) +
        createRenderer()(rest.slice(ci + 4))
      );
    }
    buf = rest;
    lang = lt;
    return renderInline(before);
  };

  const render: Renderer = (chunk: string): string => {
    if (buf || lang) {
      const ci = chunk.startsWith("```") ? 0 : chunk.indexOf("\n```");
      if (ci === -1) {
        buf += chunk;
        return "";
      }
      const code = buf + (ci === 0 ? "" : chunk.slice(0, ci));
      let after = chunk.slice(ci === 0 ? 3 : ci + 4);
      if (after.startsWith("\n")) after = after.slice(1);
      const lt = lang;
      buf = "";
      lang = "";
      return renderCodeBlock(code, lt) + createRenderer()(after);
    }

    if (fence) return flushFence(chunk);

    const btIdx = chunk.indexOf("```");
    if (btIdx === -1) return renderInline(chunk);

    const before = chunk.slice(0, btIdx);
    const after = chunk.slice(btIdx);
    const om = after.match(/```(\w*)\n/);
    if (!om || om.index === undefined) {
      fence = after;
      return renderInline(before);
    }

    const lt = om[1] || "";
    const rest = after.slice(om.index + om[0].length);
    const ci = rest.indexOf("\n```");
    if (ci !== -1) {
      return (
        renderInline(before) +
        renderCodeBlock(rest.slice(0, ci), lt) +
        createRenderer()(rest.slice(ci + 4))
      );
    }
    buf = rest;
    lang = lt;
    return renderInline(before);
  };

  render.flush = (): string => {
    let out = "";
    if (fence) {
      const clean = fence.replace(/^```/, "");
      if (clean) out += renderInline(clean);
    }
    out += renderCodeBlock(buf, lang || "");
    fence = "";
    buf = "";
    lang = "";
    return out;
  };

  return render;
}
