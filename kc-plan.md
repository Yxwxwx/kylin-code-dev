
# Kylin Code 开发计划

## 当前状态

### 已完成 ✅

| 模块 | 文件 | 功能 |
|------|------|------|
| CLI 入口 | `src/index.ts` | REPL 交互、代码渲染、分页、路径补全 |
| Agent 核心 | `src/agent.ts` | tool calling 循环、token 预算、错误恢复 |
| LLM 通信 | `src/llm.ts` | DeepSeek 流式对话、reasoning 增量输出 |
| 工具系统 | `src/tools.ts` | 9 个工具：读写删文件、搜索、命令、Git |
| Prompt 路由 | `src/prompts.ts` | 智能匹配 + 8 种模式 |
| 配置管理 | `src/config.ts` | 项目/全局配置、API Key 三级优先级 |
| 初始化 | `src/setup.ts` | inquirer 向导 |
| 会话管理 | `src/session.ts` | 持久化、历史、token 预算裁剪 |
| 依赖 | 6 runtime + 3 dev | chalk, dotenv, inquirer, openai, simple-git, cli-highlight |

### 架构

```
kylin-code .
  → index.ts (CLI: REPL + 渲染器 + 分页 + 补全)
    → agent.ts (tool calling 循环 + token 预算)
      → llm.ts (DeepSeek 流式)
      → tools.ts (9 工具)
      → prompts.ts (智能路由 / system-prompts/)
    → session.ts (会话持久化 + token 预算)
    → config.ts (配置解析)
```

- **8 文件**，包体积 4.2 MB
- **确认机制**：写入/删除/命令执行弹窗确认，只读命令自动放行
- **代码高亮**：cli-highlight（highlight.js），190+ 语言
- **智能路由**：根据用户输入关键词自动匹配 prompt

---

## 里程碑 1：体验完善 ✅

### 1.1 上下文管理 ✅
- [x] 会话历史持久化（保存/恢复对话）
- [x] Token 预算管理（接近上限时自动截断早期消息）
- [x] `/history` 命令查看历史会话

### 1.2 输入体验 ✅
- [x] 多行输入支持（`\` 续行）
- [x] 上下箭头历史命令
- [x] Tab 补全文件路径

### 1.3 输出优化 ✅
- [x] 长输出分页（`/pager` 切换）
- [x] 代码块语法高亮（cli-highlight）
- [ ] Diff 着色显示（待定）

---

## 里程碑 2：工具增强 (2-3 天)

### 2.1 代码编辑
- [ ] 行级替换工具（replace_lines）
- [ ] Diff 预览 + 确认 后再写入
- [ ] 多文件批量修改

### 2.2 项目感知
- [ ] 自动检测项目类型（Node/Python/Rust/Go）
- [ ] 读取 package.json / Cargo.toml 理解依赖
- [ ] 读取 .gitignore 自动忽略

### 2.3 命令执行
- [ ] 长时间命令后台运行 + 流式输出
- [ ] 命令执行状态栏（spinner）
- [ ] 危险命令检测（rm -rf /, git push --force）

---

## 里程碑 3：多模型 & 高级功能 (3-4 天)

### 3.1 多 Provider
- [ ] OpenAI 兼容接口（通义千问、豆包等）
- [ ] `/model` 命令切换模型
- [ ] 模型参数可配置（temperature, max_tokens）

### 3.2 多 Agent
- [ ] Agent 间通信（Plan → Feature → Verify 流水线）
- [ ] 自动选择 Agent 类型（复杂任务用 Plan，简单任务用 General）
- [ ] Agent 输出作为下一个 Agent 输入

### 3.3 上下文增强
- [ ] `@filename` 引用文件内容
- [ ] 自动注入相关文件（根据用户问题智能选择）
- [ ] 项目结构摘要注入

---

## 里程碑 4：质量保证 (2-3 天)

### 4.1 测试
- [ ] 单元测试（vitest）
- [ ] 工具函数测试
- [ ] Agent 循环集成测试

### 4.2 发布
- [x] README + 使用文档
- [ ] npm 发布
- [ ] CHANGELOG

---

## 未来方向

- **IDE 集成**：VSCode 插件、JetBrains 插件
- **MCP 支持**：Model Context Protocol 接入外部工具
- **多模态**：图片理解（截图报错 → 自动修复）
- **Web UI**：浏览器端聊天界面
- **团队协作**：共享 session、代码审查自动化
