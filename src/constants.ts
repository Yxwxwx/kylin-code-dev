// ============================================================
// 集中常量定义
// ============================================================

// --- Agent ---
export const MAX_TOOL_LOOP = 10;
export const DEFAULT_TOKEN_BUDGET = 120_000;
export const CHARS_PER_TOKEN = 2.5;

// --- LLM ---
export const DEEPSEEK_MAX_TOKENS = 8_192;
export const TEMPERATURE = 0;

// --- 命令执行 ---
export const COMMAND_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_CHARS = 20_000;
export const MAX_STDERR_CHARS = 5_000;

// --- 会话 ---
export const SESSION_TRUNCATE_CHARS = 8_000;

// --- RAG ---
export const RAG_TOP_K = 8;
export const RAG_CHUNK_SIZE = 800;
export const RAG_CHUNK_OVERLAP = 100;
export const EMBED_DIMENSIONS = 1024;
export const EMBED_BATCH_SIZE = 10;
export const EMBED_CONCURRENCY = 10;
export const EMBED_RETRY_MAX = 3;

// --- 搜索 ---
export const SEARCH_MAX_RESULTS = 15;
