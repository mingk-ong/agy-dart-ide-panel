"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getHomeDir } = require("./paths");

const ANOMALY_FILE_RE = /^(?:keyring-marker-|needs-auth-cache)/i;
const TAIL_READ_BYTES = 64 * 1024;
const DEFAULT_RECENT_WINDOW_MS = 30 * 60_000;
const AUTH_IN_PROGRESS_WINDOW_MS = 90_000;
const AUTH_SUCCESS_WINDOW_MS = 120_000;
const AUTH_LOGOUT_WINDOW_MS = 5 * 60_000;

const AUTH_IN_PROGRESS_STATES = new Set([
  "uninitialized",
  "validatingLogin",
  "loggingIn",
  "authenticating",
  "signingIn",
  "awaitingAuth",
  "redirecting"
]);

const AUTH_SIGNED_OUT_STATES = new Set([
  "signedOut",
  "loggedOut",
  "notSignedIn",
  "unauthenticated"
]);

function redactLogText(text) {
  return String(text || "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<EMAIL>")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "<ACCESS_TOKEN>")
    .replace(/1\/\/[A-Za-z0-9._-]+/g, "<REFRESH_TOKEN>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <TOKEN>")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<JWT>")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
}

/**
 * 获取各平台 Antigravity IDE 日志根目录。
 * @param {string} [platform]
 * @param {string} [homeDir]
 */
function getDefaultIdeLogsRoot(platform = process.platform, homeDir = getHomeDir()) {
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "Antigravity IDE", "logs");
  }
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Antigravity IDE", "logs");
  }
  return path.join(homeDir, ".config", "Antigravity IDE", "logs");
}

function readTailText(filePath, maxBytes = TAIL_READ_BYTES) {
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size === 0) return "";
  const readSize = Math.min(maxBytes, st.size);
  const start = st.size - readSize;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(readSize);
    const bytesRead = fs.readSync(fd, buf, 0, readSize, start);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseLogLineTimestampMs(line) {
  const m = String(line || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 只读扫描最新的 Antigravity IDE auth.log，提取登录状态机、TLS 断连频次与 invalid_grant 线索。
 * @param {{ logsRoot?: string, nowMs?: number, recentWindowMs?: number }} [options]
 */
function inspectLatestAuthLog(options = {}) {
  const logsRoot = options.logsRoot || getDefaultIdeLogsRoot();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const recentWindowMs = Number.isFinite(options.recentWindowMs) ? options.recentWindowMs : DEFAULT_RECENT_WINDOW_MS;

  const empty = {
    found: false,
    logPath: "",
    latestState: "",
    latestStateAtMs: null,
    isAuthInProgress: false,
    isIntentionalLogout: false,
    recentAuthSuccess: false,
    tlsErrorCount: 0,
    invalidGrantDetected: false,
    lastErrorMessage: "",
    lastErrorAt: ""
  };

  if (!logsRoot || !fs.existsSync(logsRoot)) {
    return empty;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return empty;
  }

  const candidates = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const p = path.join(logsRoot, ent.name, "auth.log");
    try {
      const st = fs.statSync(p, { throwIfNoEntry: false });
      if (st?.isFile()) {
        candidates.push({ name: ent.name, path: p, mtimeMs: st.mtimeMs });
      }
    } catch {}
  }
  if (candidates.length === 0) {
    return empty;
  }

  candidates.sort((a, b) => b.name.localeCompare(a.name) || b.mtimeMs - a.mtimeMs);
  const target = candidates[0];

  let tail = "";
  try {
    tail = readTailText(target.path, TAIL_READ_BYTES);
  } catch {
    return { ...empty, found: true, logPath: target.path };
  }

  const lines = tail.split(/\r?\n/).filter(Boolean).slice(-120);
  let latestState = "";
  let latestStateAtMs = null;
  let tlsErrorCount = 0;
  let invalidGrantDetected = false;
  let lastErrorMessage = "";
  let lastErrorAt = "";
  let oauthTriggerAtMs = 0;
  let intentionalLogoutAtMs = 0;
  let recentAuthSuccess = false;

  for (const line of lines) {
    const lineTs = parseLogLineTimestampMs(line);
    const stateMatch = line.match(/Auth state changed to:\s*([A-Za-z0-9_]+)/i);
    if (stateMatch && stateMatch[1]) {
      latestState = stateMatch[1].trim();
      latestStateAtMs = lineTs;
      if (latestState === "signedIn" || latestState === "success") {
        oauthTriggerAtMs = 0;
        intentionalLogoutAtMs = 0;
        if (lineTs === null || nowMs - lineTs <= AUTH_SUCCESS_WINDOW_MS) {
          recentAuthSuccess = true;
        }
      } else if (latestState === "loginError") {
        oauthTriggerAtMs = 0;
        intentionalLogoutAtMs = 0;
      } else if (AUTH_SIGNED_OUT_STATES.has(latestState) && !invalidGrantDetected) {
        intentionalLogoutAtMs = lineTs ?? nowMs;
        oauthTriggerAtMs = 0;
      } else if (AUTH_IN_PROGRESS_STATES.has(latestState)) {
        intentionalLogoutAtMs = 0;
      }
    }

    const isRecent = lineTs === null || nowMs - lineTs <= recentWindowMs;

    if (/OAuth token changed,\s*executing antigravity\.handleAuthRefresh/i.test(line)) {
      if (lineTs === null || nowMs - lineTs <= AUTH_SUCCESS_WINDOW_MS) {
        recentAuthSuccess = true;
      }
    }

    if (/loginWithRedirect|\bsignIn\b|Opening browser|OAuth.*start|starting login/i.test(line)) {
      oauthTriggerAtMs = lineTs ?? nowMs;
      intentionalLogoutAtMs = 0;
    }

    if (
      /\blogout\b|\bsignOut\b|User signed out/i.test(line) &&
      !/invalid_grant|Refresh token invalid|logging out user|\[error\]/i.test(line)
    ) {
      intentionalLogoutAtMs = lineTs ?? nowMs;
      oauthTriggerAtMs = 0;
    }

    if (/invalid_grant|Refresh token invalid,\s*logging out user/i.test(line)) {
      invalidGrantDetected = true;
      intentionalLogoutAtMs = 0;
      lastErrorMessage = redactLogText(line).slice(0, 180);
      lastErrorAt = lineTs ? new Date(lineTs).toISOString() : "";
    }

    if (
      isRecent &&
      /Client network socket disconnected before secure TLS connection|ECONNRESET|ETIMEDOUT|TLS connection|\bEOF\b/i.test(line)
    ) {
      tlsErrorCount++;
    }

    if (/\[error\]/i.test(line)) {
      lastErrorMessage = redactLogText(line).slice(0, 180);
      lastErrorAt = lineTs ? new Date(lineTs).toISOString() : "";
    }
  }

  const latestStateRecent = latestStateAtMs === null || nowMs - latestStateAtMs <= AUTH_IN_PROGRESS_WINDOW_MS;
  const oauthRecent = oauthTriggerAtMs > 0 && nowMs - oauthTriggerAtMs <= AUTH_IN_PROGRESS_WINDOW_MS;
  const isAuthInProgress = Boolean(
    (AUTH_IN_PROGRESS_STATES.has(latestState) && latestStateRecent) ||
      (oauthRecent && latestState !== "signedIn" && latestState !== "success" && latestState !== "loginError")
  );
  const logoutRecent = intentionalLogoutAtMs > 0 && nowMs - intentionalLogoutAtMs <= AUTH_LOGOUT_WINDOW_MS;
  const isIntentionalLogout = Boolean(
    !invalidGrantDetected &&
      latestState !== "loginError" &&
      !isAuthInProgress &&
      (AUTH_SIGNED_OUT_STATES.has(latestState) ||
        (logoutRecent && latestState !== "signedIn" && latestState !== "success"))
  );

  return {
    found: true,
    logPath: target.path,
    latestState,
    latestStateAtMs,
    isAuthInProgress,
    isIntentionalLogout,
    recentAuthSuccess,
    tlsErrorCount,
    invalidGrantDetected,
    lastErrorMessage,
    lastErrorAt
  };
}

/**
 * 扫描 ~/.gemini 与 AppData 下可能由 agy.exe 降级写入的 Keyring 异常/未登录缓存标记文件。
 * @param {{ scanDirs?: string[], homeDir?: string, platform?: string }} [options]
 */
function detectKeyringAnomalies(options = {}) {
  const homeDir = options.homeDir || getHomeDir();
  const platform = options.platform || process.platform;
  const dirs = Array.isArray(options.scanDirs)
    ? options.scanDirs
    : (() => {
        const list = [];
        for (const product of ["antigravity", "antigravity-ide", "antigravity-cli"]) {
          const base = path.join(homeDir, ".gemini", product);
          list.push(base, path.join(base, "cache"));
        }
        if (platform === "win32") {
          const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
          list.push(path.join(appData, "Antigravity"), path.join(appData, "Antigravity IDE"));
        }
        return list;
      })();

  const markerFiles = [];
  const needsAuthFiles = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!ANOMALY_FILE_RE.test(name)) continue;
      const fullPath = path.join(dir, name);
      if (seen.has(fullPath)) continue;
      try {
        const st = fs.statSync(fullPath, { throwIfNoEntry: false });
        if (!st?.isFile()) continue;
        seen.add(fullPath);
        if (/^keyring-marker-/i.test(name)) markerFiles.push(fullPath);
        else needsAuthFiles.push(fullPath);
      } catch {}
    }
  }

  const allFiles = [...markerFiles, ...needsAuthFiles];
  return {
    markerFiles,
    needsAuthFiles,
    allFiles,
    hasAnomaly: allFiles.length > 0
  };
}

/**
 * 仅清理白名单内的 Keyring 异常标记/缓存文件，严格防止误删普通文件。
 * @param {string[]} filePaths
 */
function clearKeyringAnomalyFiles(filePaths = []) {
  const removed = [];
  const failed = [];
  for (const p of Array.isArray(filePaths) ? filePaths : []) {
    if (typeof p !== "string" || !p.trim()) continue;
    const base = path.basename(p);
    if (!ANOMALY_FILE_RE.test(base)) {
      failed.push({ path: p, error: "不在白名单前缀范围内" });
      continue;
    }
    try {
      const st = fs.statSync(p, { throwIfNoEntry: false });
      if (!st?.isFile()) continue;
      fs.unlinkSync(p);
      removed.push(p);
    } catch (err) {
      failed.push({ path: p, error: err.message });
    }
  }
  return { removed, failed };
}

/**
 * 执行 5 维认证健康评估，识别掉号风险、不可自动恢复的 invalid_grant 以及可自愈目标账号。
 */
function evaluateAuthHealth({
  sysCred = null,
  quota = null,
  hubs = null,
  authLog = null,
  keyringAnomalies = null,
  lastHealthyAccountId = "",
  savedAccounts = [],
  capSnap = null,
  missingGraceActive = false
} = {}) {
  const issues = [];
  const sysOk = Boolean(sysCred && sysCred.ok);
  const sysEmail = String(sysCred?.email || "").trim();
  const hubEmail = String(quota?.userEmail || "").trim();
  const hubCount = Number(hubs?.count || 0);
  const tlsErrs = Number(authLog?.tlsErrorCount || 0);
  const invalidGrant = Boolean(authLog?.invalidGrantDetected);
  const loginErrorState = authLog?.latestState === "loginError";
  const capAuthErr = capSnap?.requestError?.kind === "auth_error";
  const hasMarkers = Boolean(keyringAnomalies?.hasAnomaly);
  const isAuthInProgress = Boolean(authLog?.isAuthInProgress);
  const isIntentionalLogout = Boolean(authLog?.isIntentionalLogout);
  const hasStrongDropSignal = Boolean(invalidGrant || loginErrorState || capAuthErr || hasMarkers);
  const suppressMissingCred = Boolean(
    isAuthInProgress ||
    (isIntentionalLogout && !invalidGrant && !loginErrorState && !capAuthErr) ||
    (missingGraceActive && !hasStrongDropSignal)
  );

  if (!sysOk && !suppressMissingCred) {
    issues.push({
      code: "SYS_CRED_MISSING",
      severity: "error",
      title: "系统主凭据丢失或不可读",
      detail: sysCred?.error || "Windows 凭据管理器中未检测到 gemini:antigravity",
      fixable: true
    });
  }

  const emailMismatch = Boolean(
    sysOk && sysEmail && hubEmail && sysEmail.toLowerCase() !== hubEmail.toLowerCase()
  );
  if (emailMismatch) {
    issues.push({
      code: "HUB_AUTH_MISMATCH",
      severity: "warn",
      title: "双端登录账号不一致",
      detail: "OS 主凭据账号与当前运行中的 agy 语言服务账号不同步，建议统一重写入库凭据或重载窗口。",
      fixable: true
    });
  }

  if (invalidGrant) {
    issues.push({
      code: "AUTH_LOG_INVALID_GRANT",
      severity: "error",
      title: "刷新令牌已失效 (invalid_grant)",
      detail: "Google 服务端已拒绝该刷新令牌，需重新走一次官方 OAuth 登录授权。",
      fixable: false
    });
  } else if (loginErrorState) {
    issues.push({
      code: "AUTH_LOG_LOGIN_ERROR",
      severity: "error",
      title: "IDE 主进程认证处于 loginError 异常态",
      detail: authLog?.lastErrorMessage || "IDE 启动或周期校验失败导致认证状态机进入 loginError。",
      fixable: true
    });
  }

  if (capAuthErr && !invalidGrant) {
    issues.push({
      code: "CAP_AUTH_ERROR",
      severity: "error",
      title: "最近模型请求触发认证异常 (401/403)",
      detail: capSnap?.requestError?.diagnostic || "请一键回填凭据并重载窗口，若仍失败请重新登录。",
      fixable: true
    });
  }

  if (tlsErrs >= 1) {
    issues.push({
      code: "TLS_FLAKY",
      severity: "warn",
      title: `近 30 分钟检测到 ${tlsErrs} 次 TLS 握手断连`,
      detail: "代理节点切换或连接空闲中断可能触发 IDE 登录校验失败，建议保持代理连接稳定。",
      fixable: false
    });
  }

  if (hubCount > 2) {
    issues.push({
      code: "MULTI_HUB_CONFLICT",
      severity: "warn",
      title: `检测到 ${hubCount} 个活跃 agy 后台实例`,
      detail: "多窗口或残留后台并发刷新凭据易引发写冲突，切号后请一并重载其他窗口。",
      fixable: false
    });
  }

  if (hasMarkers) {
    issues.push({
      code: "KEYRING_MARKER_FOUND",
      severity: "warn",
      title: `发现 ${keyringAnomalies.allFiles.length} 个 Keyring 异常标记文件`,
      detail: "存在 keyring-marker 或 needs-auth-cache 降级标记，一键修复将自动清理。",
      fixable: true
    });
  }

  // 解析最佳可自愈目标账号
  const accounts = Array.isArray(savedAccounts) ? savedAccounts : [];
  let targetAcc = null;
  if (lastHealthyAccountId) {
    const m = accounts.find((a) => a.id === lastHealthyAccountId && a.hasRefreshToken);
    if (m) targetAcc = m;
  }
  if (!targetAcc && hubEmail) {
    const m = accounts.find(
      (a) => a.email && a.email.toLowerCase() === hubEmail.toLowerCase() && a.hasRefreshToken
    );
    if (m) targetAcc = m;
  }
  if (!targetAcc && sysEmail) {
    const m = accounts.find(
      (a) => a.email && a.email.toLowerCase() === sysEmail.toLowerCase() && a.hasRefreshToken
    );
    if (m) targetAcc = m;
  }
  if (!targetAcc) {
    targetAcc = accounts.find((a) => a.hasRefreshToken) || null;
  }

  const hasFixable = issues.some((i) => i.fixable);
  const flowBlockedAutoHeal = Boolean(
    isAuthInProgress ||
    (isIntentionalLogout && !invalidGrant && !loginErrorState && !capAuthErr) ||
    (missingGraceActive && !hasStrongDropSignal)
  );
  const canAutoHeal = Boolean(targetAcc && hasFixable && !invalidGrant && !flowBlockedAutoHeal);
  const authFlowState = isAuthInProgress
    ? "signing_in"
    : isIntentionalLogout && !hasStrongDropSignal
      ? "signed_out"
      : missingGraceActive && !sysOk && !hasStrongDropSignal
        ? "grace_wait"
        : "normal";
  const overall = issues.some((i) => i.severity === "error")
    ? "critical"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "healthy";

  const checks = {
    osCredential: {
      status: sysOk
        ? "ok"
        : isAuthInProgress || (isIntentionalLogout && !hasStrongDropSignal)
          ? "ok"
          : missingGraceActive && !hasStrongDropSignal
            ? "warn"
            : "error",
      label: "OS 主凭据",
      detail: sysOk
        ? "gemini:antigravity 完整"
        : isAuthInProgress
          ? "官方登录校验中"
          : isIntentionalLogout && !hasStrongDropSignal
            ? "已主动登出"
            : missingGraceActive && !hasStrongDropSignal
              ? "等待登录同步"
              : "主凭据缺失"
    },
    hubSync: {
      status: !sysOk ? "warn" : emailMismatch ? "warn" : "ok",
      label: "双端同步",
      detail: emailMismatch ? "账号错位" : hubEmail ? "双端一致" : "待检测"
    },
    authLog: {
      status: invalidGrant || loginErrorState ? "error" : tlsErrs > 0 ? "warn" : "ok",
      label: "主进程日志",
      detail: invalidGrant
        ? "invalid_grant"
        : loginErrorState
          ? "loginError"
          : tlsErrs > 0
            ? `TLS 断连×${tlsErrs}`
            : authLog?.found
              ? authLog.latestState || "正常"
              : "无日志"
    },
    multiHub: {
      status: hubCount > 2 ? "warn" : "ok",
      label: "活跃实例",
      detail: `${hubCount} 个窗口`
    },
    keyringMarker: {
      status: hasMarkers ? "warn" : "ok",
      label: "Keyring 标记",
      detail: hasMarkers ? `异常×${keyringAnomalies.allFiles.length}` : "洁净"
    }
  };

  return {
    overall,
    authFlowState,
    checks,
    issues,
    canAutoHeal,
    healTargetId: targetAcc ? targetAcc.id : "",
    healTargetEmail: targetAcc ? targetAcc.email : "",
    checkedAtMs: Date.now()
  };
}

module.exports = {
  ANOMALY_FILE_RE,
  AUTH_IN_PROGRESS_STATES,
  AUTH_SIGNED_OUT_STATES,
  getDefaultIdeLogsRoot,
  inspectLatestAuthLog,
  detectKeyringAnomalies,
  clearKeyringAnomalyFiles,
  evaluateAuthHealth
};
