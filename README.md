
# 🦄 Kylin Code

> AI 编程助手 + 量子化学计算平台。基于 DeepSeek 模型，通过 Tool Calling 直接操作文件、执行命令、管理 Git。内置 PySCF `/qc` 模式，RAG 检索官方文档自动编写并运行量子化学计算。

## 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **DeepSeek API Key**（[获取地址](https://platform.deepseek.com/api_keys)）
- **DashScope API Key**（[获取地址](https://dashscope.console.aliyun.com/apiKey)，用于 `/qc` 模式 RAG 检索）

### 安装

```bash
git clone https://github.com/Yxwxwx/kylin-code-dev.git
cd kylin-code-dev
npm install        # 自动解压 pyscf-docs.tar.gz
npm run build
npm link
```

### 初始化

```bash
kylin-code .
```

首次运行自动进入初始化向导，依次输入 DeepSeek API Key、模型、DashScope API Key（可跳过），配置写入 `.kylinrc.json`。

### 使用

```bash
kylin-code .
# 或指定目录
kylin-code /path/to/project
```

```
○ > 帮我写一个 Express 服务器
○ > /qc + 用 B3LYP/cc-pVDZ 算 O2 三重态基态能量
```

## 命令参考

输入 `?` 或 `/help` 查看所有命令。

| 命令 | 说明 |
|------|------|
| `?` `/help` | 显示帮助 |
| `/exit` `/quit` | 退出 |
| `/clear` | 重置上下文 |
| `/less` | 切换思考内容显示/隐藏（/less） |
| `/pager` | 切换长输出分页 |
| `/history` | 历史会话列表 |
| `/history load <n>` | 恢复第 n 个会话 |
| `/history del <n>` | 删除第 n 个会话 |
| `/general` ... `/feature` | 8 种编程模式 |
| `/qc` | **量子化学模式**（PySCF + RAG） |

## 功能特性

### 🧪 `/qc` 量子化学模式

基于 PySCF 的量子化学计算。流程：

```
用户描述计算任务 → RAG 检索 PySCF 文档 → Agent 写脚本 → 确认执行 → 展示结果
```

- **RAG 检索**：text-embedding-v4 向量化 pyscf-docs（1721 chunks），混合检索（余弦 + 中英文关键词加权 + 领域门控）
- **文档内置**：PySCF 官方示例 + 用户手册压缩打包（496K），首次 npm install 自动解压
- **支持**：HF、DFT、CCSD(T)、MP2、CASSCF、TDDFT、几何优化、频率分析、溶剂模型、PBC 等 35 个模块

### 🤖 Agent 智能循环

基于 DeepSeek Tool Calling 实现自主循环：**读取代码 → 理解需求 → 调用工具 → 验证结果**。

### 🔧 内置工具

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件内容（支持行号范围） |
| `write_file` | 创建/覆盖文件（需确认） |
| `delete_file` | 删除文件（需确认） |
| `list_directory` | 树形展示目录结构 |
| `search_code` | 正则搜索代码内容 |
| `run_command` | 执行 Shell 命令（60s 超时） |
| `git_status` / `git_diff` / `git_log` | Git 操作 |

### 🧭 智能 Prompt 路由

| 模式 | 触发词 | 用途 |
|------|--------|------|
| `general` | 默认 | 通用编程 |
| `plan` | 计划、架构 | 技术方案设计 |
| `explore` | 搜索、查找 | 代码探索 |
| `commit` | commit、提交 | Git 提交信息 |
| `verify` | 验证、测试 | 代码审查 |
| `fix` | 修复、bug | Bug 诊断 |
| `refactor` | 重构、优化 | 代码重构 |
| `feature` | 添加、创建 | 新功能开发 |
| `qc` | pyscf、DFT、CCSD | 量子化学计算 |

### 🎨 交互体验

- **Token 圆环** `○ ◔ ◑ ◕ ●` 实时反映用量
- **输入框线** 横线框起用户输入，与输出分离
- **思考动画** `* 思考内容...` / `Thinking...`
- **代码高亮** cli-highlight（highlight.js），190+ 语言
- **多行输入** `\` 续行，命令历史，Tab 路径补全

### 🛡️ 安全 & 会话

- 写入/删除/非安全命令需确认 `[y/n]`
- 命令 60s 超时，输出 20000 字符上限
- 自动保存至 `~/.kylin/sessions/`，Token 预算管理

## 配置

### API Key 优先级

1. `.kylinrc.json` → 2. 环境变量 → 3. `~/.kylin/config.json`

### `.kylinrc.json`

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "models": {
    "deepseek": { "apiKey": "sk-xxx", "baseURL": "https://api.deepseek.com", "model": "deepseek-v4-flash" },
    "dashscope": { "apiKey": "sk-yyy" }
  }
}
```

## 架构

```
src/
├── index.ts      # REPL 主循环 + 组件装配
├── agent.ts      # Agent 核心：tool calling + token 预算
├── commands.ts   # 命令分发（/less /pager /history /qc ...）
├── renderer.ts   # 流式代码块渲染 + cli-highlight
├── display.ts    # 圆环/框线/prompt/动画/分页
├── llm.ts        # DeepSeek 流式对话
├── tools.ts      # 9 个工具（文件/命令/Git）
├── prompts.ts    # Prompt 路由 + 9 种模式
├── rag.ts        # RAG 检索（text-embedding-v4 + 混合检索）
├── session.ts    # 会话持久化 + Token 预算
├── config.ts     # 三级优先级配置
└── setup.ts      # 初始化向导

pyscf-docs.tar.gz # PySCF 文档（npm install 解压）
system-prompts/   # Prompt 模板
```

## License

MIT © 2026 Yxwxwx
