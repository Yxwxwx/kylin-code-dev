
# Kylin Code 开发计划

## 当前状态

### 已完成 ✅

| 模块 | 文件 | 功能 |
|------|------|------|
| CLI 入口 | `src/index.ts` | REPL 交互、组件装配 |
| 命令分发 | `src/commands.ts` | 所有 `/` 命令 + `?` |
| 显示组件 | `src/display.ts` | 圆环/框线/prompt/动画/分页 |
| 流式渲染 | `src/renderer.ts` | 跨 chunk 代码块缓冲 + cli-highlight |
| Agent 核心 | `src/agent.ts` | tool calling 循环、token 预算 |
| LLM 通信 | `src/llm.ts` | DeepSeek 流式对话、reasoning 输出 |
| 工具系统 | `src/tools.ts` | 9 个工具：读写删文件、搜索、命令、Git |
| Prompt 路由 | `src/prompts.ts` | 9 种模式（含 qc）+ 关键词匹配 |
| 配置管理 | `src/config.ts` | DeepSeek + DashScope 三级优先级 |
| 初始化 | `src/setup.ts` | inquirer 向导（含 DashScope Key） |
| 会话管理 | `src/session.ts` | 持久化、历史、token 预算裁剪 |
| **RAG 检索** | `src/rag.ts` | text-embedding-v4 + 混合检索（余弦 + 中英文关键词 + 领域门控） |
| QC 文档 | `pyscf-docs.tar.gz` | PySCF 示例 + 手册（496K） |
| 依赖 | 6 runtime + 3 dev | chalk, cli-highlight, dotenv, inquirer, openai, simple-git |

### 架构

```
kylin-code .
  → index.ts (REPL + 装配)
    → commands.ts (命令分发)
    → display.ts (圆环/框线/动画/分页)
    → agent.ts (tool calling + token 预算)
      → llm.ts (DeepSeek 流式)
      → tools.ts (9 工具)
      → prompts.ts (9 种模式)
      → rag.ts (RAG 检索)
    → renderer.ts (代码块渲染)
    → session.ts (会话持久化)
    → config.ts (配置)
```

- **12 文件**，包体积 4.2 MB
- **9 种 prompt 模式**，含量子化学 `/qc`
- **RAG 检索**：1721 chunks，混合检索 + 中→英翻译
- **代码高亮**：cli-highlight（highlight.js）

---

## 里程碑 1：体验完善 ✅

### 1.1 上下文管理 ✅
- [x] 会话历史持久化
- [x] Token 预算管理
- [x] `/history` 命令

### 1.2 输入体验 ✅
- [x] 多行输入（`\` 续行）
- [x] 上下箭头历史
- [x] Tab 路径补全

### 1.3 输出优化 ✅
- [x] 长输出分页（`/pager`）
- [x] 代码高亮（cli-highlight）
- [x] 思考动画 + 输入框线

---

## 里程碑 2：QC 量子化学模式 ✅

### 2.1 PySCF 集成 ✅
- [x] `/qc` prompt 模式
- [x] PySCF 快速参考
- [x] 跳过双重验证

### 2.2 RAG 文档检索 ✅
- [x] 文档分块 + text-embedding-v4 向量化
- [x] 混合检索（余弦 + 中英文关键词加权）
- [x] 领域门控（PBC/溶剂等未提及时自动降权）
- [x] 中→英查询翻译
- [x] 索引缓存 + 并发 embedding
- [x] pyscf-docs.tar.gz 压缩打包

### 2.3 文档语料 ✅
- [x] PySCF 官方示例（35 模块）
- [x] PySCF 用户手册（.rst/.md）
- [x] 文件标签 + 目录名提取

---

## 里程碑 3：工具增强 (待定)

### 3.1 代码编辑
- [ ] 行级替换工具（replace_lines）
- [ ] Diff 预览 + 确认

### 3.2 项目感知
- [ ] 自动检测项目类型
- [ ] 读取依赖文件

### 3.3 命令执行
- [ ] 长时间命令后台运行
- [ ] 危险命令检测

---

## 里程碑 4：多模型 & 高级功能 (待定)

### 4.1 多 Provider
- [ ] OpenAI 兼容接口
- [ ] `/model` 切换

### 4.2 多 Agent
- [ ] Agent 间通信

---

## 里程碑 5：质量保证 (待定)

### 5.1 测试
- [ ] 单元测试（vitest）

### 5.2 发布
- [x] README + 使用文档
- [ ] npm 发布

---

## 未来方向

- **更多 QC 软件**：ORCA、Gaussian 输入文件生成
- **MCP 支持**：Model Context Protocol
- **Web UI**：浏览器端界面
