import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { syncOnboardingEmail } from "./onboardingSync.mjs";

const STRIPPED_LAUNCH_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "VSCODE_IPC_HOOK",
  "VSCODE_IPC_HOOK_EXTHOST",
  "VSCODE_NLS_CONFIG",
  "VSCODE_PID",
  "VSCODE_CWD",
  "VSCODE_CLI",
  "VSCODE_AMD_ENTRYPOINT",
  "VSCODE_HANDLES_UNCAUGHT_ERRORS",
  "VSCODE_CRASH_REPORTER_PROCESS_TYPE",
  "VSCODE_CODE_CACHE_PATH"
]);

/**
 * 清洗 Electron / VS Code 注入的父进程环境变量，确保冷重启拉起新 IDE 时不误以 Node 模式或旧 IPC 运行。
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string | undefined>}
 */
export function sanitizeLaunchEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (STRIPPED_LAUNCH_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function isPidAliveDefault(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * 检查目标 IDE 进程是否仍在运行。
 * @param {{
 *   processName?: string,
 *   waitPids?: number[],
 *   platform?: string,
 *   spawnSyncFn?: typeof spawnSync,
 *   isPidAliveFn?: (pid: number) => boolean
 * }} [options]
 */
export function isTargetProcessRunning(options = {}) {
  const platform = options.platform || process.platform;
  const spawnSyncFn = options.spawnSyncFn || spawnSync;
  const isPidAliveFn = options.isPidAliveFn || isPidAliveDefault;
  const processName = String(options.processName || "").trim();
  const waitPids = Array.isArray(options.waitPids) ? options.waitPids.filter((p) => Number(p) > 0) : [];

  if (platform === "win32" && processName) {
    try {
      const res = spawnSyncFn("tasklist", ["/FI", `IMAGENAME eq ${processName}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000
      });
      const out = String(res?.stdout || "").trim();
      if (res?.status === 0 && out) {
        const lowerName = processName.toLowerCase();
        const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.toLowerCase().startsWith(`"${lowerName}"`)) {
            return true;
          }
        }
        return false;
      }
    } catch {}
  }

  if (platform !== "win32" && processName) {
    try {
      const res = spawnSyncFn("pgrep", ["-x", processName], {
        encoding: "utf8",
        timeout: 3000
      });
      if (res?.status === 0 && String(res.stdout || "").trim()) {
        return true;
      }
      if (res?.status === 1) {
        return false;
      }
    } catch {}
  }

  for (const pid of waitPids) {
    if (isPidAliveFn(pid)) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 轮询等待目标 IDE 主进程优雅退出（超时绝不强杀）。
 * @param {{
 *   processName?: string,
 *   waitPids?: number[],
 *   waitTimeoutMs?: number,
 *   pollIntervalMs?: number,
 *   platform?: string,
 *   isRunningFn?: () => boolean,
 *   sleepFn?: (ms: number) => Promise<void>
 * }} [options]
 */
export async function waitForProcessExit(options = {}) {
  const waitTimeoutMs = Math.max(200, Number(options.waitTimeoutMs) || 15000);
  const pollIntervalMs = Math.max(25, Number(options.pollIntervalMs) || 250);
  const sleepFn = options.sleepFn || sleep;
  const checkRunning =
    options.isRunningFn ||
    (() =>
      isTargetProcessRunning({
        processName: options.processName,
        waitPids: options.waitPids,
        platform: options.platform
      }));

  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    if (!checkRunning()) {
      return { exited: true, timedOut: false };
    }
    await sleepFn(pollIntervalMs);
  }

  return checkRunning()
    ? { exited: false, timedOut: true }
    : { exited: true, timedOut: false };
}

/**
 * 执行一次完整的冷重启作业：等待旧 IDE 主进程退出 -> 原子写盘同步引导键 -> 清洗环境拉起新 IDE。
 * @param {object} job
 * @param {{
 *   isRunningFn?: () => boolean,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   syncOnboardingFn?: typeof syncOnboardingEmail,
 *   spawnFn?: typeof spawn,
 *   env?: Record<string, string | undefined>
 * }} [deps]
 */
export async function runColdRestartJob(job = {}, deps = {}) {
  const exePath = String(job.exePath || "").trim();
  if (!exePath) {
    return { ok: false, reason: "missing_exe" };
  }

  const processName =
    job.processName !== undefined ? String(job.processName || "").trim() : basename(exePath);
  const sleepFn = deps.sleepFn || sleep;
  const syncFn = deps.syncOnboardingFn || syncOnboardingEmail;
  const spawnFn = deps.spawnFn || spawn;

  const waitRes = await waitForProcessExit({
    processName,
    waitPids: job.waitPids,
    waitTimeoutMs: job.waitTimeoutMs || 15000,
    pollIntervalMs: job.pollIntervalMs || 250,
    platform: job.platform || process.platform,
    isRunningFn: deps.isRunningFn,
    sleepFn
  });

  if (!waitRes.exited) {
    return { ok: false, reason: "timeout" };
  }

  const postExitDelayMs = Math.max(0, Number(job.postExitDelayMs ?? 450));
  if (postExitDelayMs > 0) {
    await sleepFn(postExitDelayMs);
  }

  let syncResult = null;
  if (job.syncOnboarding !== false && job.email) {
    for (let attempt = 0; attempt < 4; attempt++) {
      syncResult = syncFn(job.email, {
        isGcpTos: Boolean(job.isGcpTos),
        dbPaths: Array.isArray(job.dbPaths) ? job.dbPaths : undefined
      });
      if (syncResult?.ok || !Array.isArray(syncResult?.errors) || syncResult.errors.length === 0) {
        break;
      }
      await sleepFn(350);
    }
  }

  const cleanEnv = sanitizeLaunchEnv(deps.env || process.env);
  const launchArgs = Array.isArray(job.launchArgs) ? job.launchArgs.map((a) => String(a)) : [];
  const child = spawnFn(exePath, launchArgs, {
    cwd: tmpdir(),
    env: cleanEnv,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  if (typeof child?.unref === "function") {
    child.unref();
  }

  return {
    ok: true,
    exePath,
    launchArgs,
    syncResult
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const jobFile = process.argv[2];
  if (!jobFile) {
    process.exit(1);
  }
  let job = null;
  try {
    const raw = readFileSync(jobFile, "utf8");
    job = JSON.parse(raw);
  } catch {
    process.exit(1);
  } finally {
    try {
      unlinkSync(jobFile);
    } catch {}
  }

  const res = await runColdRestartJob(job);
  process.exit(res.ok ? 0 : 2);
}
