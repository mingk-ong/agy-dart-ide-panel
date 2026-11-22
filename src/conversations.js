"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getHomeDir } = require("./paths");

const SAFE_CONV_ID_RE = /^[A-Za-z0-9._-]+$/;
const EXCLUDED_DIRS = new Set(["tempmediastorage", ".", ".."]);
const HEAD_READ_BYTES = 24 * 1024;
const TITLE_CACHE = new Map();

/**
 * 校验对话 ID 是否合法且无路径穿越风险。
 * @param {string} id
 * @returns {boolean}
 */
function isSafeConversationId(id) {
  if (typeof id !== "string") {
    return false;
  }
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 128 || trimmed.includes("..")) {
    return false;
  }
  if (EXCLUDED_DIRS.has(trimmed.toLowerCase())) {
    return false;
  }
  return SAFE_CONV_ID_RE.test(trimmed);
}

/**
 * 获取 Antigravity brain 会话根目录列表。
 * @param {string} [homeDir]
 * @returns {string[]}
 */
function getBrainRoots(homeDir = getHomeDir()) {
  return [
    path.join(homeDir, ".gemini", "antigravity", "brain"),
    path.join(homeDir, ".gemini", "antigravity-ide", "brain")
  ];
}

/**
 * 格式化时间标签，便于在下拉列表展示。
 * @param {number} mtimeMs
 * @returns {string}
 */
function formatShortTime(mtimeMs) {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) {
    return "";
  }
  const d = new Date(mtimeMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

/**
 * 从 transcript.jsonl 头部安全提取首个用户请求作为友好标题。
 * @param {string} filePath
 * @param {number} mtimeMs
 * @param {number} size
 * @returns {string}
 */
function extractConversationTitle(filePath, mtimeMs, size) {
  const cached = TITLE_CACHE.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.title;
  }

  let title = "";
  let fd = null;
  try {
    const readSize = Math.min(HEAD_READ_BYTES, Math.max(0, size));
    if (readSize > 0) {
      fd = fs.openSync(filePath, "r");
      const buf = Buffer.allocUnsafe(readSize);
      const bytesRead = fs.readSync(fd, buf, 0, readSize, 0);
      const text = buf.subarray(0, bytesRead).toString("utf8");
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line || !line.trim()) {
          continue;
        }
        try {
          const obj = JSON.parse(line);
          const isUser = obj.type === "USER_INPUT" || obj.source === "USER";
          if (!isUser) {
            continue;
          }
          const rawContent =
            typeof obj.content === "string"
              ? obj.content
              : (obj.user_input && typeof obj.user_input.user_response === "string" ? obj.user_input.user_response : "");
          const reqMatch = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
          const candidate = (reqMatch ? reqMatch[1] : rawContent).replace(/\s+/g, " ").trim();
          if (candidate) {
            title = candidate.length > 26 ? `${candidate.slice(0, 26)}...` : candidate;
            break;
          }
        } catch {
          // 忽略末行截断或非 JSON 行
        }
      }
    }
  } catch {
    // 忽略读取异常
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }

  if (TITLE_CACHE.size > 200) {
    TITLE_CACHE.clear();
  }
  TITLE_CACHE.set(filePath, { mtimeMs, size, title });
  return title;
}

/**
 * 扫描近期活跃 Antigravity 对话列表（按最后更新时间降序）。
 * @param {{ brainRoots?: string[], limit?: number }} [options]
 * @returns {Array<{ id: string, title: string, updatedAtMs: number, updatedLabel: string, transcriptPath: string }>}
 */
function listRecentConversations(options = {}) {
  const roots = Array.isArray(options.brainRoots) && options.brainRoots.length > 0
    ? options.brainRoots
    : getBrainRoots();
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 20;
  const byId = new Map();

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeConversationId(entry.name)) {
        continue;
      }
      const convDir = path.join(root, entry.name);
      const candidates = [
        path.join(convDir, ".system_generated", "logs", "transcript.jsonl"),
        path.join(convDir, ".system_generated", "logs", "transcript_full.jsonl")
      ];
      for (const transcriptPath of candidates) {
        if (!fs.existsSync(transcriptPath)) {
          continue;
        }
        try {
          const st = fs.statSync(transcriptPath);
          if (!st.isFile()) {
            continue;
          }
          const existing = byId.get(entry.name);
          if (!existing || st.mtimeMs > existing.updatedAtMs) {
            const title = extractConversationTitle(transcriptPath, st.mtimeMs, st.size) || `会话 ${entry.name.slice(0, 8)}`;
            byId.set(entry.name, {
              id: entry.name,
              title,
              updatedAtMs: st.mtimeMs,
              updatedLabel: formatShortTime(st.mtimeMs),
              transcriptPath
            });
          }
          break;
        } catch {
          // 忽略无权访问或并发写入文件
        }
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, limit);
}

/**
 * 获取最近一条活跃对话 ID。
 * @param {{ brainRoots?: string[] }} [options]
 * @returns {string}
 */
function getLatestConversationId(options = {}) {
  const list = listRecentConversations({ ...options, limit: 1 });
  return list.length > 0 ? list[0].id : "";
}

module.exports = {
  isSafeConversationId,
  getBrainRoots,
  listRecentConversations,
  getLatestConversationId
};
