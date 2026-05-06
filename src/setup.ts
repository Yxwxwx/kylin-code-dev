import { saveGlobal, initProject } from "./config";

export async function runSetup(
  targetDir: string,
): Promise<{ apiKey: string; model: string; dashscopeKey: string }> {
  const inquirer = await import("inquirer");
  const a = await inquirer.default.prompt([
    {
      type: "password",
      name: "apiKey",
      message: "DeepSeek API Key:",
      mask: "*",
      validate: (v: string) => (v.trim() ? true : "必填"),
    },
    {
      type: "list",
      name: "model",
      message: "模型:",
      default: "deepseek-v4-flash",
      choices: [
        { name: "V4 Flash (推荐)", value: "deepseek-v4-flash" },
        { name: "V4 Pro", value: "deepseek-v4-pro" },
      ],
    },
    {
      type: "password",
      name: "dashscopeKey",
      message: "DashScope API Key (embedding, 可跳过):",
      mask: "*",
    },
    { type: "confirm", name: "save", message: "保存到全局?", default: true },
  ]);
  if (a.save) {
    saveGlobal({
      providers: {
        deepseek: { apiKey: a.apiKey, model: a.model },
        dashscope: a.dashscopeKey ? { apiKey: a.dashscopeKey } : undefined,
      },
      activeProvider: "deepseek",
      defaultModel: a.model,
    });
  }
  initProject(targetDir, a.apiKey, a.model, a.dashscopeKey || undefined);
  return {
    apiKey: a.apiKey,
    model: a.model,
    dashscopeKey: a.dashscopeKey || "",
  };
}
