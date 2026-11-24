"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * 探测 Antigravity IDE 主程序可执行文件路径。
 * @param {{
 *   appRoot?: string,
 *   execPath?: string,
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   fsImpl?: typeof fs
 * }} [options]
 * @returns {string}
 */
function resolveIdeExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const appRoot = String(options.appRoot || "").trim();
  const execPath = String(options.execPath ?? process.execPath ?? "").trim();

  const existsFile = (p) => {
    if (!p) return false;
    try {
      return fsImpl.existsSync(p) && fsImpl.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  if (platform === "win32") {
    const candidates = [];
    if (appRoot) {
      const baseDir = path.resolve(appRoot, "..", "..");
      candidates.push(path.join(baseDir, "Antigravity IDE.exe"));
      candidates.push(path.join(baseDir, "Antigravity.exe"));
      try {
        if (fsImpl.existsSync(baseDir)) {
          const exes = fsImpl
            .readdirSync(baseDir)
            .filter((name) => /\.exe$/i.test(name) && !/^unins/i.test(name))
            .sort();
          for (const exe of exes) {
            candidates.push(path.join(baseDir, exe));
          }
        }
      } catch {}
    }
    if (execPath && /\.exe$/i.test(execPath) && !/[/\\]node\.exe$/i.test(execPath)) {
      candidates.push(execPath);
    }
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Antigravity IDE", "Antigravity IDE.exe"));
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Antigravity", "Antigravity.exe"));
    }
    if (env.ProgramFiles) {
      candidates.push(path.join(env.ProgramFiles, "Antigravity IDE", "Antigravity IDE.exe"));
      candidates.push(path.join(env.ProgramFiles, "Antigravity", "Antigravity.exe"));
    }

    for (const c of candidates) {
      if (existsFile(c)) return c;
    }
    return "";
  }

  if (platform === "darwin") {
    const candidates = [];
    if (appRoot) {
      const macOsDir = path.resolve(appRoot, "..", "..", "MacOS");
      candidates.push(path.join(macOsDir, "Antigravity IDE"));
      candidates.push(path.join(macOsDir, "Antigravity"));
      candidates.push(path.join(macOsDir, "Electron"));
      try {
        if (fsImpl.existsSync(macOsDir)) {
          for (const item of fsImpl.readdirSync(macOsDir)) {
            candidates.push(path.join(macOsDir, item));
          }
        }
      } catch {}
    }
    if (execPath && !/[/\\]node$/i.test(execPath)) {
      candidates.push(execPath);
    }
    for (const c of candidates) {
      if (existsFile(c)) return c;
    }
    return "";
  }

  const candidates = [];
  if (appRoot) {
    const baseDir = path.resolve(appRoot, "..", "..");
    candidates.push(path.join(baseDir, "antigravity-ide"));
    candidates.push(path.join(baseDir, "antigravity"));
  }
  if (execPath && !/[/\\]node$/i.test(execPath)) {
    candidates.push(execPath);
  }
  candidates.push("/usr/bin/antigravity-ide", "/usr/bin/antigravity", "/opt/Antigravity IDE/antigravity-ide");
  for (const c of candidates) {
    if (existsFile(c)) return c;
  }
  return "";
}

/**
 * 构建冷重启参数：开启窗口会话恢复时传空数组以便原生还原全部标签页；否则回退传入当前工作区。
 * @param {object} [vscodeApi]
 * @returns {string[]}
 */
function buildRestartLaunchArgs(vscodeApi) {
  try {
    const restoreMode = String(
      vscodeApi?.workspace?.getConfiguration?.("window")?.get?.("restoreWindows", "all") || "all"
    ).trim();
    if (restoreMode !== "none") {
      return [];
    }
    const wsFile = vscodeApi?.workspace?.workspaceFile;
    if (wsFile && wsFile.scheme === "file" && wsFile.fsPath) {
      return [wsFile.fsPath];
    }
    const folders = vscodeApi?.workspace?.workspaceFolders;
    if (Array.isArray(folders) && folders.length > 0) {
      return folders
        .map((f) => (f?.uri?.scheme === "file" ? f.uri.fsPath : ""))
        .filter(Boolean);
    }
  } catch {}
  return [];
}

/**
 * 调度独立后台冷重启作业（所有前置校验通过且 detached 助手启动成功后才返回 ok: true）。
 * @param {{
 *   nodePath: string,
 *   email: string,
 *   isGcpTos?: boolean,
 *   syncOnboarding?: boolean,
 *   vscodeApi?: object,
 *   exePath?: string,
 *   helperPath?: string,
 *   dbPaths?: string[],
 *   waitPids?: number[],
 *   waitTimeoutMs?: number,
 *   postExitDelayMs?: number,
 *   spawnFn?: typeof spawn,
 *   fsImpl?: typeof fs,
 *   env?: Record<string, string | undefined>,
 *   logger?: { log: (msg: string) => void }
 * }} [options]
 */
function scheduleColdRestart(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const spawnFn = options.spawnFn || spawn;
  const logger = options.logger || { log() {} };
  const nodePath = String(options.nodePath || "").trim();
  const helperPath = String(options.helperPath || path.join(__dirname, "coldRestartHelper.mjs")).trim();

  if (!nodePath || !fsImpl.existsSync(nodePath)) {
    return {
      ok: false,
      fallbackToReload: true,
      error: "未找到可用的 Node.js 可执行文件，自动回退为快速重载"
    };
  }
  if (!helperPath || !fsImpl.existsSync(helperPath)) {
    return {
      ok: false,
      fallbackToReload: true,
      error: "缺少冷重启助手脚本，自动回退为快速重载"
    };
  }

  const exePath =
    String(options.exePath || "").trim() ||
    resolveIdeExecutable({
      appRoot: options.vscodeApi?.env?.appRoot,
      execPath: process.execPath,
      env: options.env || process.env,
      fsImpl
    });

  if (!exePath || !fsImpl.existsSync(exePath)) {
    return {
      ok: false,
      fallbackToReload: true,
      error: "未能定位 Antigravity IDE 主程序路径，自动回退为快速重载"
    };
  }

  const processName = path.basename(exePath);
  const launchArgs = buildRestartLaunchArgs(options.vscodeApi);
  const waitPids = Array.isArray(options.waitPids)
    ? options.waitPids
    : [process.ppid, process.pid].filter((p) => Number(p) > 0);

  const jobPayload = {
    exePath,
    processName,
    launchArgs,
    email: String(options.email || "").trim(),
    isGcpTos: Boolean(options.isGcpTos),
    syncOnboarding: options.syncOnboarding !== false,
    dbPaths: Array.isArray(options.dbPaths) ? options.dbPaths : undefined,
    waitPids,
    waitTimeoutMs: Number(options.waitTimeoutMs) || 15000,
    postExitDelayMs: Number(options.postExitDelayMs ?? 450)
  };

  const rand = crypto.randomBytes(6).toString("hex");
  const jobPath = path.join(os.tmpdir(), `agy-fusion-restart-${Date.now()}-${rand}.json`);
  try {
    fsImpl.writeFileSync(jobPath, JSON.stringify(jobPayload), { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    return {
      ok: false,
      fallbackToReload: true,
      error: `写入冷重启作业文件失败: ${err?.message || String(err)}`
    };
  }

  try {
    const cleanNodeEnv = { ...(options.env || process.env) };
    delete cleanNodeEnv.ELECTRON_RUN_AS_NODE;

    const child = spawnFn(nodePath, [helperPath, jobPath], {
      cwd: os.tmpdir(),
      env: cleanNodeEnv,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    if (typeof child?.unref === "function") {
      child.unref();
    }
    logger.log(`[冷重启] 已调度后台冷重启助手 (${processName})，即将优雅退出主进程`);
    return {
      ok: true,
      exePath,
      processName,
      jobPath
    };
  } catch (err) {
    try {
      fsImpl.unlinkSync(jobPath);
    } catch {}
    return {
      ok: false,
      fallbackToReload: true,
      error: `拉起冷重启助手失败: ${err?.message || String(err)}`
    };
  }
}

module.exports = {
  resolveIdeExecutable,
  buildRestartLaunchArgs,
  scheduleColdRestart
};
