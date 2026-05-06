
# 🦄 Kylin Code

> AI 编程助手，基于 DeepSeek 模型的命令行工具，通过 Tool Calling 机制直接操作你的项目文件、执行命令、管理 Git。

## 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **DeepSeek API Key**（[获取地址](https://platform.deepseek.com/api_keys)）

### 安装

```bash
git clone https://github.com/Yxwxwx/kylin-code-dev.git
cd kylin-code-dev
npm install
npm run build
npm link
```

### 初始化

```bash
kylin-code .
```

首次运行自动进入初始化向导，输入 API Key 和模型，配置写入 `.kylinrc.json`。

### 开始使用

```bash
kylin-code .
# 或指定目录
kylin-code /path/to/project
```

进入交互式 REPL，输入任务即可：

```
○ > 帮我写一个 Express 服务器
○ > 搜索项目中所有 TODO 注释
○ > 解释 src/agent.ts 的流程
```

## 命令参考

输入 `?` 或 `/help` 查看所有可用命令。

| 命令 | 说明 |
|------|------|
| `?` `/help` | 显示帮助 |
| `/exit` `/quit` | 退出程序 |
| `/clear` | 重置会话上下文 |
| `/think` | 切换思考内容显示/隐藏 |
| `/pager` | 切换长输出分页 |
| `/history` | 列出历史会话 |
| `/history load <n>` | 恢复第 n 个历史会话 |
| `/history del <n>` | 删除第 n 个历史会话 |
| `/general` | 通用编程模式 |
| `/plan` | 架构规划模式 |
| `/explore` | 代码探索模式 |
| `/commit` | Git 提交模式 |
| `/verify` | 验证测试模式 |
| `/fix` | Bug 修复模式 |
| `/refactor` | 代码重构模式 |
| `/feature` | 功能开发模式 |

## 功能特性

### 🤖 Agent 智能循环

基于 DeepSeek Tool Calling 实现自主循环：**读取代码 → 理解需求 → 调用工具 → 验证结果 → 继续迭代**。

### 🔧 内置工具

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件内容（支持行号范围） |
| `write_file` | 创建/覆盖文件（需确认） |
| `delete_file` | 删除文件（需确认） |
| `list_directory` | 树形展示目录结构 |
| `search_code` | 正则搜索代码内容 |
| `run_command` | 执行 Shell 命令（60s 超时） |
| `git_status` | 查看 Git 仓库状态 |
| `git_diff` | 查看未暂存的变更 |
| `git_log` | 查看提交历史 |

### 🧭 智能 Prompt 路由

根据用户输入关键词自动匹配最佳 prompt 模式：

| 模式 | 触发词 | 用途 |
|------|--------|------|
| `general` | 默认 | 通用编程任务 |
| `plan` | 计划、架构、设计、plan | 架构设计与技术方案 |
| `explore` | 搜索、查找、在哪、find | 代码探索与搜索 |
| `commit` | commit、提交、stage | Git 提交信息生成 |
| `verify` | 验证、测试、检查、test | 代码审查与验证 |
| `fix` | 修复、bug、debug、报错 | Bug 诊断与修复 |
| `refactor` | 重构、整理、优化、refactor | 代码重构 |
| `feature` | 添加、创建、实现、开发 | 新功能开发 |

### 🎨 交互体验

- **上下文圆环**：prompt 中的 `○ ◔ ◑ ◕ ●` 实时反映 token 用量
- **输入框线**：用户输入被横线框起，与输出清晰分离
- **思考动画**：`* 思考内容...` 或 `Thinking...` 动态指示
- **代码高亮**：基于 `cli-highlight`（highlight.js），支持 190+ 语言
- **多行输入**：行尾 `\` 续行，`» ` 提示符
- **命令历史**：上下箭头浏览历史输入
- **Tab 补全**：输入 `.` `/` `~` 开头的路径时自动补全文件名

### 🛡️ 安全机制

- 写入/删除文件需用户确认 `[y/n]`
- 非安全命令执行前弹窗确认，只读命令（`ls`、`cat`、`grep` 等）自动放行
- 命令 60 秒超时终止，输出上限 20000 字符
- 写入文件后自动验证，有错误自动修复

### 💾 会话管理

- 每轮对话自动保存到 `~/.kylin/sessions/`
- `/history` 查看、恢复、删除历史会话
- Token 预算管理：接近上下文上限时自动截断早期消息

## 配置说明

### API Key 优先级

1. 项目级 `.kylinrc.json` 中的 `apiKey`
2. 环境变量 `DEEPSEEK_API_KEY`
3. 全局配置 `~/.kylin/config.json`

### 配置文件

`.kylinrc.json`：

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "models": {
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.deepseek.com",
      "model": "deepseek-v4-flash",
      "maxTokens": 8192,
      "temperature": 0
    }
  }
}
```

## 架构

```
src/
├── index.ts    # CLI 入口：REPL、渲染器、分页、路径补全
├── agent.ts    # Agent 核心：tool calling 循环、token 预算
├── llm.ts      # LLM 通信：DeepSeek 流式对话、reasoning 支持
├── tools.ts    # 工具系统：9 个工具（文件/命令/Git）
├── prompts.ts  # Prompt 路由：8 种模式 + 关键词匹配
├── config.ts   # 配置管理：三级优先级 API Key
├── setup.ts    # 初始化向导（inquirer）
└── session.ts  # 会话持久化 + Token 预算管理
```

## License

MIT © 2026 Yxwxwx
