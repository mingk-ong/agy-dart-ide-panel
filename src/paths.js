"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REQUIRED_PLUGIN_FILES = [
  "plugin.json",
  path.join("sidecars", "dashboard", "server.mjs"),
  path.join("sidecars", "dashboard", "index.html"),
  path.join("scripts", "install.mjs")
];

const MIN_NODE_MAJOR = 22;

/**
 * 获取当前用户主目录（兼容 Windows 与 POSIX）。
 * @returns {string}
 */
function getHomeDir() {
  if (process.platform === "win32") {
    return process.env.USERPROFILE || process.env.HOME || os.homedir();
  }
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * 获取 agy-dart 统一配置文件路径。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function getAgyDartConfigPath(env = process.env) {
  const custom = typeof env.AGY_DART_CONFIG_PATH === "string" ? env.AGY_DART_CONFIG_PATH.trim() : "";
  if (custom) {
    return path.resolve(custom);
  }
  return path.join(getHomeDir(), ".agy-dart", "config.json");
}

/**
 * 校验目录是否为完整有效的 agy-dart 插件根目录。
 * @param {string} dirPath
 * @returns {boolean}
 */
function isValidPluginDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string") {
    return false;
  }
  const resolved = path.resolve(dirPath);
  for (const rel of REQUIRED_PLUGIN_FILES) {
    if (!fs.existsSync(path.join(resolved, rel))) {
      return false;
    }
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "plugin.json"), "utf8").replace(/^\uFEFF/, ""));
    return Boolean(manifest && manifest.name === "agy-dart");
  } catch {
    return false;
  }
}

/**
 * 按优先级探测已安装的 agy-dart 插件根目录。
 * @param {{ configuredPath?: string, workspacePaths?: string[] }} [options]
 * @returns {{ ok: boolean, pluginRoot: string, source: string, checkedPaths: string[] }}
 */
function resolvePluginRoot(options = {}) {
  const candidates = [];
  const configured = typeof options.configuredPath === "string" ? options.configuredPath.trim() : "";
  if (configured) {
    candidates.push({ path: path.resolve(configured), source: "config" });
  }

  candidates.push({
    path: path.join(getHomeDir(), ".gemini", "config", "plugins", "agy-dart"),
    source: "global"
  });

  if (Array.isArray(options.workspacePaths)) {
    for (const ws of options.workspacePaths) {
      if (typeof ws === "string" && ws.trim()) {
        candidates.push({
          path: path.join(path.resolve(ws.trim()), ".agents", "plugins", "agy-dart"),
          source: "workspace"
        });
      }
    }
  }

  const checkedPaths = [];
  for (const item of candidates) {
    checkedPaths.push(item.path);
    if (isValidPluginDir(item.path)) {
      return {
        ok: true,
        pluginRoot: item.path,
        source: item.source,
        checkedPaths
      };
    }
  }

  return {
    ok: false,
    pluginRoot: "",
    source: "",
    checkedPaths
  };
}

/**
 * 解析版本号中的主版本号。
 * @param {string} versionText
 * @returns {number}
 */
function parseNodeMajor(versionText) {
  const m = String(versionText || "").trim().match(/^v?(\d+)\./);
  return m ? Number.parseInt(m[1], 10) : 0;
}

/**
 * 校验指定 Node 可执行文件是否存在且版本 >= 22。
 * @param {string} binPath
 * @returns {{ ok: boolean, version: string, major: number, error?: string }}
 */
function verifyNodeBinary(binPath) {
  if (!binPath || typeof binPath !== "string") {
    return { ok: false, version: "", major: 0, error: "路径为空" };
  }
  const resolved = path.resolve(binPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, version: "", major: 0, error: `文件不存在: ${resolved}` };
  }
  const res = spawnSync(resolved, ["-v"], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true
  });
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      version: "",
      major: 0,
      error: res.error ? res.error.message : (res.stderr || `退出码 ${res.status}`).trim()
    };
  }
  const version = String(res.stdout || "").trim();
  const major = parseNodeMajor(version);
  if (major < MIN_NODE_MAJOR) {
    return {
      ok: false,
      version,
      major,
      error: `Node.js 版本过低 (${version})，需要 >= v${MIN_NODE_MAJOR}`
    };
  }
  return { ok: true, version, major };
}

/**
 * 探测系统 Node.js (>= 22) 路径，绝不使用 Electron Extension Host 自身的 process.execPath。
 * @param {string} [configuredPath]
 * @returns {{ ok: boolean, nodePath: string, version: string, error: string }}
 */
function resolveSystemNodePath(configuredPath = "") {
  const custom = typeof configuredPath === "string" ? configuredPath.trim() : "";
  if (custom) {
    const check = verifyNodeBinary(custom);
    if (check.ok) {
      return { ok: true, nodePath: path.resolve(custom), version: check.version, error: "" };
    }
    return {
      ok: false,
      nodePath: "",
      version: check.version,
      error: `自定义 Node.js 路径不可用: ${check.error}`
    };
  }

  const candidates = [];
  const locateCmd = process.platform === "win32" ? "where.exe" : "which";
  const locateArgs = process.platform === "win32" ? ["node"] : ["-a", "node"];
  const loc = spawnSync(locateCmd, locateArgs, {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true
  });
  if (!loc.error && loc.status === 0 && loc.stdout) {
    for (const rawLine of loc.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line) {
        candidates.push(line);
      }
    }
  }

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA || "";
    const nvmSymlink = process.env.NVM_SYMLINK || "";
    candidates.push(path.join(programFiles, "nodejs", "node.exe"));
    if (localAppData) {
      candidates.push(path.join(localAppData, "Programs", "nodejs", "node.exe"));
    }
    if (nvmSymlink) {
      candidates.push(path.join(nvmSymlink, "node.exe"));
    }
  } else {
    candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node");
  }

  const seen = new Set();
  const errors = [];
  for (const cand of candidates) {
    const resolved = path.resolve(cand);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const check = verifyNodeBinary(resolved);
    if (check.ok) {
      return { ok: true, nodePath: resolved, version: check.version, error: "" };
    }
    if (fs.existsSync(resolved) && check.error) {
      errors.push(check.error);
    }
  }

  return {
    ok: false,
    nodePath: "",
    version: "",
    error: errors[0] || `未在 PATH 或默认安装目录找到 Node.js (>= v${MIN_NODE_MAJOR})`
  };
}

/**
 * 获取 Antigravity 状态目录列表（用于监听 antigravity_state.pbtxt 中的模型选择器变化）。
 * @returns {string[]}
 */
function getAntigravityStateDirs() {
  const home = getHomeDir();
  const dirs = [];
  for (const product of ["antigravity", "antigravity-ide", "antigravity-cli"]) {
    const dir = path.join(home, ".gemini", product);
    try {
      if (fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        dirs.push(dir);
      }
    } catch {}
  }
  return dirs;
}

/**
 * 从 antigravity_state.pbtxt 读取用户在模型选择器中最新选中的模型枚举 ID（如 MODEL_PLACEHOLDER_M418）。
 * @param {string[]} [customPbtxtPaths]
 * @returns {{ modelId: string, filePath: string, mtimeMs: number }}
 */
function readSelectedAgentModelId(customPbtxtPaths) {
  const candidates = Array.isArray(customPbtxtPaths) && customPbtxtPaths.length > 0
    ? customPbtxtPaths
    : getAntigravityStateDirs().map((dir) => path.join(dir, "antigravity_state.pbtxt"));

  let latestFile = "";
  let latestMtime = -Infinity;
  for (const file of candidates) {
    try {
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st?.isFile() && st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latestFile = file;
      }
    } catch {}
  }

  if (!latestFile) {
    return { modelId: "", filePath: "", mtimeMs: 0 };
  }

  try {
    const text = fs.readFileSync(latestFile, "utf8");
    const match = text.match(/^\s*last_selected_agent_model:\s*["']?([A-Za-z0-9_.:/-]+)["']?/m);
    return {
      modelId: match && match[1] ? match[1].trim() : "",
      filePath: latestFile,
      mtimeMs: latestMtime
    };
  } catch {
    return { modelId: "", filePath: latestFile, mtimeMs: latestMtime };
  }
}

module.exports = {
  MIN_NODE_MAJOR,
  REQUIRED_PLUGIN_FILES,
  getHomeDir,
  getAgyDartConfigPath,
  isValidPluginDir,
  resolvePluginRoot,
  parseNodeMajor,
  verifyNodeBinary,
  resolveSystemNodePath,
  getAntigravityStateDirs,
  readSelectedAgentModelId
};
