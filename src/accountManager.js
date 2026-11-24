"use strict";

const crypto = require("node:crypto");
const defaultVscode = require("vscode");
const defaultBridge = require("./credentialBridge");
const defaultAuthHealth = require("./authHealth");
const defaultIdeRestart = require("./ideRestart");
const { makeAccountId, normalizeQuotaGroups } = require("./accountStore");
const {
  evaluateQuotaSnapshot,
  sortAccountsByQuota,
  formatCountdown
} = require("./quotaTracker");

const GUARD_CHECK_INTERVAL_MS = 30_000;
const HEAL_PROMPT_COOLDOWN_MS = 5 * 60_000;
const AUTO_HEAL_COOLDOWN_MS = 10 * 60_000;
const MISSING_CRED_GRACE_MS = 60_000;
const EXIT_SNAPSHOT_TIMEOUT_MS = 2500;

function hashTokenShort(token) {
  const clean = String(token || "").trim();
  if (!clean) return "";
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 12);
}

/**
 * 为当前系统凭据生成脱敏指纹（仅用于比对凭据是否发生换号或续期变化，绝不留存明文）。
 * @param {object|null} sysCred
 * @returns {string}
 */
function buildCredentialFingerprint(sysCred) {
  if (!sysCred || !sysCred.ok) return "";
  return [
    String(sysCred.email || "").trim().toLowerCase(),
    String(sysCred.writerId || "").trim(),
    hashTokenShort(sysCred.refreshToken),
    hashTokenShort(sysCred.accessToken)
  ].join("|");
}

function isGcpTosAuthMethod(authMethod) {
  const m = String(authMethod || "").trim().toLowerCase();
  return m === "gcp" || m === "wif";
}

/**
 * 账号一键切换与纯本地余额追踪管理器：
 * - 当前在线账号从本地 Antigravity Hub 获取实时余额与 resetTime；
 * - 切走/登出前定格「退出时余额快照 + resetTime」，后台号纯本地实时倒计时回满；
 * - 支持冷重启 IDE（彻底清空主进程旧邮箱缓存，免除切号引导弹窗）、防掉线 5 维体检与免重登自愈。
 */
class AccountManager {
  /**
   * @param {{
   *   store: import("./accountStore").AccountStore,
   *   capsuleClient: import("./capsuleClient").CapsuleClient,
   *   resolveNodePath?: () => { ok: boolean, nodePath?: string, error?: string },
   *   ideRestart?: typeof defaultIdeRestart,
   *   bridge?: typeof defaultBridge,
   *   authHealth?: typeof defaultAuthHealth,
   *   vscodeApi?: typeof defaultVscode,
   *   guardIntervalMs?: number,
   *   missingGraceMs?: number,
   *   logger?: { log: (msg: string) => void },
   *   onAccountsChanged?: () => void
   * }} options
   */
  constructor(options) {
    this._store = options.store;
    this._capsule = options.capsuleClient;
    this._resolveNodePath = typeof options.resolveNodePath === "function" ? options.resolveNodePath : null;
    this._ideRestart = options.ideRestart || defaultIdeRestart;
    this._bridge = options.bridge || defaultBridge;
    this._authHealth = options.authHealth || defaultAuthHealth;
    this._vscode = options.vscodeApi || defaultVscode;
    this._logger = options.logger || { log() {} };
    this._onAccountsChanged = options.onAccountsChanged || (() => {});
    this._guardIntervalMs = Number.isFinite(options.guardIntervalMs)
      ? options.guardIntervalMs
      : GUARD_CHECK_INTERVAL_MS;
    this._missingGraceMs = Number.isFinite(options.missingGraceMs)
      ? Math.max(0, options.missingGraceMs)
      : MISSING_CRED_GRACE_MS;
    this._switchingPromise = null;
    this._isIntentionalAuthOp = false;
    this._lastGuardCheckAtMs = 0;
    this._lastHealPromptAtMs = 0;
    this._lastAutoHealAtMs = 0;
    this._guardMutedInSession = false;
    this._latestHealth = null;
    this._credMissingSinceMs = 0;
    this._lastObservedCredFp = "";
    this._disposed = false;
  }

  getLatestHealthSummary() {
    return this._latestHealth;
  }

  getAccountPrefs() {
    const cfg = this._vscode.workspace.getConfiguration("agyFusion");
    const reloadRaw = String(cfg.get("account.reloadAfterSwitch", "coldRestart") || "coldRestart").trim();
    const reloadAfterSwitch = ["coldRestart", "ask", "auto", "none"].includes(reloadRaw)
      ? reloadRaw
      : "coldRestart";
    const syncGeminiCli = cfg.get("account.syncGeminiCli", true) !== false;
    const syncOnboardingState = cfg.get("account.syncOnboardingState", true) !== false;
    const privacyMask = Boolean(cfg.get("account.privacyMask", false));
    const healRaw = String(cfg.get("account.autoHealMode", "ask") || "ask").trim();
    const autoHealMode = ["ask", "auto", "notify"].includes(healRaw) ? healRaw : "ask";
    const keepFreshBackup = cfg.get("account.keepFreshBackup", true) !== false;

    return {
      reloadAfterSwitch,
      syncGeminiCli,
      syncOnboardingState,
      privacyMask,
      autoHealMode,
      keepFreshBackup
    };
  }

  async saveAccountPrefs(patch = {}) {
    const cfg = this._vscode.workspace.getConfiguration("agyFusion");
    const updates = [];
    if (["coldRestart", "ask", "auto", "none"].includes(patch.reloadAfterSwitch)) {
      updates.push(
        cfg.update("account.reloadAfterSwitch", patch.reloadAfterSwitch, this._vscode.ConfigurationTarget.Global)
      );
    }
    if (typeof patch.syncGeminiCli === "boolean") {
      updates.push(
        cfg.update("account.syncGeminiCli", patch.syncGeminiCli, this._vscode.ConfigurationTarget.Global)
      );
    }
    if (typeof patch.syncOnboardingState === "boolean") {
      updates.push(
        cfg.update("account.syncOnboardingState", patch.syncOnboardingState, this._vscode.ConfigurationTarget.Global)
      );
    }
    if (typeof patch.privacyMask === "boolean") {
      updates.push(
        cfg.update("account.privacyMask", patch.privacyMask, this._vscode.ConfigurationTarget.Global)
      );
    }
    if (["ask", "auto", "notify"].includes(patch.autoHealMode)) {
      updates.push(
        cfg.update("account.autoHealMode", patch.autoHealMode, this._vscode.ConfigurationTarget.Global)
      );
    }
    if (typeof patch.keepFreshBackup === "boolean") {
      updates.push(
        cfg.update("account.keepFreshBackup", patch.keepFreshBackup, this._vscode.ConfigurationTarget.Global)
      );
    }
    await Promise.all(updates);
    this._onAccountsChanged();
    return this.getAccountPrefs();
  }

  dispose() {
    this._disposed = true;
  }

  _minQuotaFraction(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return null;
    let minVal = Infinity;
    for (const g of groups) {
      for (const b of g?.buckets || []) {
        const f = Number(b?.effectiveFraction ?? b?.remainingFraction);
        if (Number.isFinite(f)) {
          minVal = Math.min(minVal, Math.max(0, Math.min(1, f)));
        }
      }
    }
    return Number.isFinite(minVal) ? minVal : null;
  }

  /**
   * 供状态栏轮询轻量同步当前活跃账号的实时配额快照。
   * @param {object} quota
   */
  async syncActiveAccountSnapshot(quota) {
    const email = String(quota?.userEmail || "").trim();
    if (!email || !quota?.ok) return;
    const existing = this._store.findByEmail(email);
    if (!existing) return;
    await this._store.updateQuotaSnapshot(existing.id, {
      tierName: quota.userTierName || "",
      name: quota.userName || "",
      quotaGroups: quota.quotaGroups || [],
      snapshotKind: "live",
      fetchedAtMs: quota.fetchedAtMs || Date.now()
    });
  }

  /**
   * 切走/登出当前账号前，抢先从本地 Hub 采集一次退出瞬间的真实余额与 resetTime（超时 2500ms 兜底沿用旧快照）。
   * @param {string} email
   */
  async _captureExitSnapshotBeforeLeave(email) {
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return null;
    const exitedAtMs = Date.now();

    let liveQuota = null;
    try {
      liveQuota = await Promise.race([
        this._capsule.getQuota(true).catch(() => null),
        new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), EXIT_SNAPSHOT_TIMEOUT_MS);
          if (typeof t.unref === "function") t.unref();
        })
      ]);
    } catch {
      liveQuota = null;
    }

    const matchedLive =
      liveQuota?.ok &&
      liveQuota.userEmail &&
      liveQuota.userEmail.trim().toLowerCase() === cleanEmail.toLowerCase();

    return this._store.recordExitQuotaSnapshot(cleanEmail, {
      tierName: matchedLive ? liveQuota.userTierName || "" : "",
      name: matchedLive ? liveQuota.userName || "" : "",
      quotaGroups: matchedLive ? liveQuota.quotaGroups || [] : [],
      fetchedAtMs: matchedLive ? liveQuota.fetchedAtMs || exitedAtMs : exitedAtMs,
      exitedAtMs
    });
  }

  /**
   * 汇总当前活跃账号状态、已入库账号列表、活跃窗口数与低配额推荐切换项。
   * @param {{ forceQuota?: boolean }} [options]
   */
  async getActiveState(options = {}) {
    const [quota, sysCred, hubs, compat, authLog, keyringAnomalies] = await Promise.all([
      this._capsule.getQuota(Boolean(options.forceQuota)).catch(() => null),
      Promise.resolve().then(() => this._bridge.readSystemCredential()),
      Promise.resolve().then(() => this._bridge.detectActiveHubInstances()),
      Promise.resolve().then(() => this._bridge.readGeminiCompatFiles()),
      Promise.resolve().then(() => this._authHealth.inspectLatestAuthLog()),
      Promise.resolve().then(() => this._authHealth.detectKeyringAnomalies())
    ]);

    const activeEmail = String(
      quota?.userEmail || (sysCred?.ok ? sysCred.email : "") || compat?.activeEmail || ""
    ).trim();
    const activeName = String(quota?.userName || "").trim();
    const activeTierName = String(quota?.userTierName || "").trim();

    let activeAccountId = "";
    if (activeEmail) {
      const matched = this._store.findByEmail(activeEmail);
      if (matched) {
        activeAccountId = matched.id;
        if (quota?.ok && Array.isArray(quota.quotaGroups) && quota.quotaGroups.length > 0) {
          await this._store.updateQuotaSnapshot(matched.id, {
            tierName: activeTierName,
            name: activeName,
            quotaGroups: quota.quotaGroups,
            snapshotKind: "live",
            fetchedAtMs: quota.fetchedAtMs || Date.now()
          });
        }
      }
    }

    const rawAccounts = this._store.listPublicAccounts();
    const prefs = this.getAccountPrefs();
    const nowMs = Date.now();
    const accounts = rawAccounts.map((acc) => ({
      ...acc,
      effectiveQuotaSnapshot: acc.quotaSnapshot
        ? evaluateQuotaSnapshot(acc.quotaSnapshot, {
            nowMs,
            isActive: Boolean(activeAccountId && acc.id === activeAccountId)
          })
        : null
    }));

    const health = this._authHealth.evaluateAuthHealth({
      sysCred,
      quota,
      hubs,
      authLog,
      keyringAnomalies,
      lastHealthyAccountId: this._store.getLastHealthyAccountId(),
      savedAccounts: accounts
    });
    this._latestHealth = health;

    // 若当前活跃账号存在低配额池（<=15%），推荐已满额/已过重置点回满或余量最充足的账号
    let recommendation = null;
    const activeGroups =
      (quota?.ok && Array.isArray(quota.quotaGroups) && quota.quotaGroups.length > 0
        ? quota.quotaGroups
        : accounts.find((a) => a.id === activeAccountId)?.effectiveQuotaSnapshot?.groups) || [];
    const activeMinFrac = this._minQuotaFraction(activeGroups);

    if (activeMinFrac !== null && activeMinFrac <= 0.15 && accounts.length > 1) {
      const candidates = sortAccountsByQuota(
        accounts.filter((acc) => acc.id !== activeAccountId),
        nowMs
      );
      const bestCandidate = candidates.find((acc) => {
        const f = this._minQuotaFraction(acc.effectiveQuotaSnapshot?.groups);
        return f !== null && f > 0.3;
      });
      if (bestCandidate) {
        const bestMinFrac = this._minQuotaFraction(bestCandidate.effectiveQuotaSnapshot?.groups) ?? 0;
        recommendation = {
          accountId: bestCandidate.id,
          email: bestCandidate.email,
          alias: bestCandidate.alias,
          tierName: bestCandidate.tierName,
          activeMinPct: Math.round(activeMinFrac * 100),
          candidateMinPct: Math.round(bestMinFrac * 100)
        };
      }
    }

    return {
      activeEmail,
      activeName,
      activeTierName,
      activeAccountId,
      isCaptured: Boolean(activeAccountId),
      systemCredentialPresent: Boolean(sysCred?.ok),
      activeHubCount: Number(hubs?.count || 0),
      accounts,
      prefs,
      health,
      recommendation,
      fetchedAtMs: nowMs
    };
  }

  /**
   * 运行 5 维认证健康体检并更新缓存结果。
   * @param {{ forceQuota?: boolean, capSnap?: object | null }} [options]
   */
  async runAuthHealthCheck(options = {}) {
    const [quota, sysCred, hubs, authLog, keyringAnomalies] = await Promise.all([
      this._capsule.getQuota(Boolean(options.forceQuota)).catch(() => null),
      Promise.resolve().then(() => this._bridge.readSystemCredential()),
      Promise.resolve().then(() => this._bridge.detectActiveHubInstances()),
      Promise.resolve().then(() => this._authHealth.inspectLatestAuthLog()),
      Promise.resolve().then(() => this._authHealth.detectKeyringAnomalies())
    ]);

    const health = this._authHealth.evaluateAuthHealth({
      sysCred,
      quota,
      hubs,
      authLog,
      keyringAnomalies,
      lastHealthyAccountId: this._store.getLastHealthyAccountId(),
      savedAccounts: this._store.listPublicAccounts(),
      capSnap: options.capSnap || null
    });
    this._latestHealth = health;
    return health;
  }

  /**
   * 后台防掉线守护与官方登录自动捕获覆盖：
   * - 检测到新的官方登录或同号重登时，自动加密入库/覆盖旧令牌
   * - 精准识别「登录进行中 / 主动退出 / 60 秒瞬时宽限期」，绝不误拦截正常官方登录
   * @param {{ quota?: object | null, capSnap?: object | null, force?: boolean }} [options]
   */
  async keepFreshAndGuard(options = {}) {
    if (this._disposed) {
      return { skipped: true, reason: "disposed" };
    }
    if (this._isIntentionalAuthOp || this._switchingPromise) {
      return { skipped: true, reason: "busy" };
    }
    const now = Date.now();
    if (!options.force && now - this._lastGuardCheckAtMs < this._guardIntervalMs) {
      return { skipped: true, reason: "throttled" };
    }
    this._lastGuardCheckAtMs = now;

    const prefs = this.getAccountPrefs();
    const sysCred = this._bridge.readSystemCredential();
    const hubs = this._bridge.detectActiveHubInstances();
    const authLog = this._authHealth.inspectLatestAuthLog();
    const keyringAnomalies = this._authHealth.detectKeyringAnomalies();

    let missingGraceActive = false;
    let activeQuota = options.quota || null;

    if (sysCred?.ok && (sysCred.refreshToken || sysCred.accessToken)) {
      this._credMissingSinceMs = 0;
      const fp = buildCredentialFingerprint(sysCred);
      const credEmail = String(sysCred.email || activeQuota?.userEmail || "").trim();

      if (prefs.keepFreshBackup && credEmail) {
        try {
          const existing = this._store.findByEmail(credEmail);
          const fpChanged = Boolean(fp && fp !== this._lastObservedCredFp);
          if (!existing || fpChanged || authLog?.recentAuthSuccess) {
            if (!activeQuota || !activeQuota.userEmail || activeQuota.userEmail.toLowerCase() !== credEmail.toLowerCase()) {
              const liveQ = await this._capsule.getQuota(true).catch(() => null);
              if (liveQ?.ok && liveQ.userEmail && liveQ.userEmail.toLowerCase() === credEmail.toLowerCase()) {
                activeQuota = liveQ;
              }
            }
            const matchedQuota =
              activeQuota?.ok && activeQuota.userEmail && activeQuota.userEmail.toLowerCase() === credEmail.toLowerCase()
                ? activeQuota
                : null;

            const syncRes = await this._store.syncOfficialLoginCredential({
              email: credEmail,
              name: matchedQuota?.userName || "",
              tierName: matchedQuota?.userTierName || "",
              quotaGroups: matchedQuota?.quotaGroups || [],
              fetchedAtMs: matchedQuota?.fetchedAtMs || Date.now(),
              freshCred: sysCred
            });
            this._lastObservedCredFp = fp;
            if (syncRes?.account?.id) {
              await this._store.setLastHealthyAccountId(syncRes.account.id);
            }
            if (syncRes?.updated) {
              if (
                prefs.syncGeminiCli &&
                (syncRes.action === "captured_new" || syncRes.refreshTokenChanged) &&
                typeof this._bridge.syncGeminiCompatFiles === "function"
              ) {
                try {
                  this._bridge.syncGeminiCompatFiles({
                    email: credEmail,
                    accessToken: sysCred.accessToken,
                    refreshToken: sysCred.refreshToken,
                    tokenType: sysCred.tokenType,
                    expiryMs: sysCred.expiryMs,
                    idToken: sysCred.idToken,
                    scope: sysCred.scope
                  });
                } catch (err) {
                  this._logger.log(`[护盾] 自动同步 ~/.gemini 兼容文件失败: ${err.message}`);
                }
              }
              const masked = this._bridge.maskEmail(credEmail);
              const reasonMsg =
                syncRes.action === "captured_new"
                  ? `检测到新官方登录，已自动捕获入库 (${masked})`
                  : `检测到官方重登/续期，已覆盖更新凭据 (${masked})`;
              this._logger.log(`[护盾] ${reasonMsg}`);
              this._onAccountsChanged();
            }
          }
        } catch (err) {
          this._logger.log(`[护盾] 官方登录自动捕获/保鲜同步异常: ${err.message}`);
        }
      }
    } else {
      if (authLog?.isAuthInProgress || authLog?.isIntentionalLogout) {
        this._credMissingSinceMs = 0;
        missingGraceActive = false;
      } else {
        const hasStrongDropSignal = Boolean(
          authLog?.latestState === "loginError" ||
          authLog?.invalidGrantDetected ||
          options.capSnap?.requestError?.kind === "auth_error" ||
          keyringAnomalies?.hasAnomaly
        );
        if (!hasStrongDropSignal) {
          if (!this._credMissingSinceMs) {
            this._credMissingSinceMs = now;
          }
          missingGraceActive = now - this._credMissingSinceMs < this._missingGraceMs;
        }
      }
    }

    const health = this._authHealth.evaluateAuthHealth({
      sysCred,
      quota: activeQuota,
      hubs,
      authLog,
      keyringAnomalies,
      lastHealthyAccountId: this._store.getLastHealthyAccountId(),
      savedAccounts: this._store.listPublicAccounts(),
      capSnap: options.capSnap || null,
      missingGraceActive
    });
    this._latestHealth = health;

    if (health.authFlowState && health.authFlowState !== "normal") {
      return { skipped: false, action: health.authFlowState, health };
    }

    const criticalDrop = health.issues.some(
      (i) => i.code === "SYS_CRED_MISSING" || i.code === "AUTH_LOG_LOGIN_ERROR" || i.code === "CAP_AUTH_ERROR"
    );
    if (!criticalDrop || !health.canAutoHeal || this._guardMutedInSession) {
      return { skipped: false, action: "checked", health };
    }

    if (prefs.autoHealMode === "auto" && now - this._lastAutoHealAtMs >= AUTO_HEAL_COOLDOWN_MS) {
      this._lastAutoHealAtMs = now;
      const healRes = await this.healActiveAccount({
        targetAccountId: health.healTargetId,
        silent: true,
        reloadOverride: "ask"
      });
      return { skipped: false, action: "auto-healed", health, healRes };
    }

    if (prefs.autoHealMode === "ask" && now - this._lastHealPromptAtMs >= HEAL_PROMPT_COOLDOWN_MS) {
      this._lastHealPromptAtMs = now;
      const masked = this._bridge.maskEmail(health.healTargetEmail);
      void Promise.resolve(
        this._vscode.window.showWarningMessage(
          `检测到 Antigravity 登录态异常或系统凭据丢失，但保险库中保存有完好凭据 (${masked})，可免重登直接修复。`,
          "一键免重登恢复",
          "查看认证体检",
          "本次不再提醒"
        )
      ).then((choice) => {
        if (choice === "一键免重登恢复") {
          void this.healActiveAccount({ targetAccountId: health.healTargetId });
        } else if (choice === "查看认证体检") {
          void this._vscode.commands.executeCommand("agyFusion.openAccountsTab");
        } else if (choice === "本次不再提醒") {
          this._guardMutedInSession = true;
        }
      });
      return { skipped: false, action: "prompted", health };
    }

    return { skipped: false, action: "notified", health };
  }

  /**
   * 执行后台冷重启（彻底释放主进程缓存并同步引导键）或失败自动回退为快速重载窗口。
   * @param {object} meta
   * @param {{ isGcpTos: boolean, syncOnboarding: boolean, displayTag: string, compatWarning?: string, hubCount?: number, messagePrefix?: string }} opts
   */
  async _triggerColdRestartOrFallback(meta, opts = {}) {
    const nodeRes = this._resolveNodePath ? this._resolveNodePath() : { ok: false };
    if (nodeRes?.ok && nodeRes.nodePath && typeof this._ideRestart?.scheduleColdRestart === "function") {
      const schedRes = this._ideRestart.scheduleColdRestart({
        nodePath: nodeRes.nodePath,
        email: meta.email,
        isGcpTos: Boolean(opts.isGcpTos),
        syncOnboarding: opts.syncOnboarding !== false,
        vscodeApi: this._vscode,
        logger: this._logger
      });
      if (schedRes?.ok) {
        const timer = setTimeout(() => {
          void this._vscode.commands.executeCommand("workbench.action.quit");
        }, 120);
        if (typeof timer.unref === "function") timer.unref();
        return {
          effectiveAction: "coldRestart",
          restarted: true,
          fallbackUsed: false,
          exePath: schedRes.exePath
        };
      }
      this._logger.log(`[冷重启] 回退至快速重载: ${schedRes?.error || "条件不满足"}`);
    }

    if (opts.syncOnboarding !== false && typeof this._capsule?.syncOnboardingEmail === "function") {
      try {
        await this._capsule.syncOnboardingEmail(meta.email, { isGcpTos: Boolean(opts.isGcpTos) });
      } catch (err) {
        this._logger.log(`[账号] 同步本地引导状态提醒: ${err.message}`);
      }
    }

    const timer = setTimeout(() => {
      void this._vscode.commands.executeCommand("workbench.action.reloadWindow");
    }, Number(opts.hubCount || 0) > 1 ? 300 : 30);
    if (typeof timer.unref === "function") timer.unref();
    return {
      effectiveAction: "reloadWindow",
      restarted: true,
      fallbackUsed: true
    };
  }

  async _syncOnboardingIfEnabled(email, isGcpTos, syncOnboarding) {
    if (!syncOnboarding || typeof this._capsule?.syncOnboardingEmail !== "function") return;
    try {
      await this._capsule.syncOnboardingEmail(email, { isGcpTos: Boolean(isGcpTos) });
    } catch (err) {
      this._logger.log(`[账号] 同步本地引导状态提醒: ${err.message}`);
    }
  }

  /**
   * 一键免重登自愈：清理 Keyring 异常标记文件，并从保险库回填完好凭据至系统主凭据与 ~/.gemini。
   * 静默自动恢复前会执行写前终极熔断检查，若用户已新登录或正在登录中则立即放行中止。
   * @param {{ targetAccountId?: string, clearMarkers?: boolean, silent?: boolean, forceOverwrite?: boolean, reloadOverride?: "coldRestart" | "ask" | "auto" | "none" }} [options]
   */
  async healActiveAccount(options = {}) {
    this._isIntentionalAuthOp = true;
    try {
      const clearMarkers = options.clearMarkers !== false;
      let clearedMarkers = 0;
      if (clearMarkers) {
        const anomalies = this._authHealth.detectKeyringAnomalies();
        if (anomalies.allFiles.length > 0) {
          const cleanRes = this._authHealth.clearKeyringAnomalyFiles(anomalies.allFiles);
          clearedMarkers = cleanRes.removed.length;
          if (clearedMarkers > 0) {
            this._logger.log(`[护盾] 已清理 ${clearedMarkers} 个 Keyring 异常标记文件`);
          }
        }
      }

      // 写前终极熔断闸（仅针对后台静默自愈）
      if (options.silent && !options.forceOverwrite) {
        const liveCred = this._bridge.readSystemCredential();
        const liveLog = this._authHealth.inspectLatestAuthLog();
        if (
          (liveCred?.ok && (liveCred.refreshToken || liveCred.accessToken)) ||
          liveLog?.isAuthInProgress ||
          liveLog?.isIntentionalLogout
        ) {
          this._logger.log("[护盾] 写前熔断：检测到系统已有新凭据或正处于登录/登出流程，已取消自动回填");
          return { ok: false, aborted: "active_or_signing_in", clearedMarkers };
        }
      }

      const accounts = this._store.listPublicAccounts();
      const candId =
        options.targetAccountId ||
        this._store.getLastHealthyAccountId() ||
        accounts.find((a) => a.hasRefreshToken)?.id ||
        accounts[0]?.id ||
        "";
      const meta = candId ? this._store.getAccountMeta(candId) : null;
      if (!meta) {
        const err = "本地保险库暂无可用于恢复的备份账号，请先捕获或登录账号";
        if (!options.silent) void this._vscode.window.showWarningMessage(err);
        return { ok: false, error: err, clearedMarkers };
      }

      const secret = await this._store.getAccountSecret(meta.id);
      if (!secret || (!secret.refreshToken && !secret.accessToken)) {
        const err = `账号 ${meta.email} 缺少可用 OAuth 令牌，无法免重登恢复`;
        if (!options.silent) void this._vscode.window.showWarningMessage(err);
        return { ok: false, error: err, clearedMarkers };
      }

      const payload = this._bridge.buildSystemCredentialPayload(meta, secret);
      const writeRes = this._bridge.writeSystemCredential(payload);
      if (!writeRes?.ok) {
        const err = writeRes?.error || "写回系统凭据失败";
        if (!options.silent) void this._vscode.window.showErrorMessage(`认证恢复失败: ${err}`);
        return { ok: false, error: err, clearedMarkers };
      }

      const prefs = this.getAccountPrefs();
      const isGcpTos = isGcpTosAuthMethod(meta.authMethod);
      if (prefs.syncGeminiCli) {
        try {
          this._bridge.syncGeminiCompatFiles({
            email: meta.email,
            accessToken: secret.accessToken,
            refreshToken: secret.refreshToken,
            tokenType: secret.tokenType,
            expiryMs: secret.expiryMs,
            idToken: secret.idToken,
            scope: secret.scope
          });
        } catch (err) {
          this._logger.log(`[护盾] 恢复时同步 ~/.gemini 兼容文件失败: ${err.message}`);
        }
      }

      await this._store.setLastHealthyAccountId(meta.id);
      const hubs = this._bridge.detectActiveHubInstances();
      const hubCount = Number(hubs?.count || 0);
      this._logger.log(`[护盾] 已免重登恢复系统凭据 (${this._bridge.maskEmail(meta.email)})`);

      await this.runAuthHealthCheck({ forceQuota: false });
      this._onAccountsChanged();

      let effectiveReload = options.reloadOverride || prefs.reloadAfterSwitch;
      if (options.silent && (effectiveReload === "auto" || effectiveReload === "coldRestart")) {
        effectiveReload = "ask";
      }

      const displayTag = meta.alias ? `${meta.alias} (${meta.email})` : meta.email;
      const markerNote = clearedMarkers > 0 ? `并清理了 ${clearedMarkers} 个异常标记文件，` : "";
      const multiHubNote = hubCount > 1 ? ` 检测到 ${hubCount} 个活跃窗口，建议重启全部窗口。` : "";

      if (effectiveReload === "coldRestart") {
        await this._triggerColdRestartOrFallback(meta, {
          isGcpTos,
          syncOnboarding: prefs.syncOnboardingState,
          displayTag,
          hubCount
        });
      } else if (effectiveReload === "auto") {
        await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
        const timer = setTimeout(() => {
          void this._vscode.commands.executeCommand("workbench.action.reloadWindow");
        }, hubCount > 1 ? 300 : 30);
        if (typeof timer.unref === "function") timer.unref();
      } else if (effectiveReload === "ask") {
        await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
        const msg = `${
          options.silent ? "[护盾自动自愈] " : ""
        }已为 ${displayTag} 回填完好系统凭据${markerNote}，建议冷重启 IDE 彻底免弹窗生效。${multiHubNote}`;
        void Promise.resolve(
          this._vscode.window.showInformationMessage(msg, "冷重启免弹窗（推荐）", "快速重载窗口", "稍后手动")
        ).then((choice) => {
          if (choice === "冷重启免弹窗（推荐）") {
            void this._triggerColdRestartOrFallback(meta, {
              isGcpTos,
              syncOnboarding: prefs.syncOnboardingState,
              displayTag,
              hubCount
            });
          } else if (choice === "快速重载窗口") {
            void this._vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
      } else if (!options.silent) {
        await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
        void this._vscode.window.showInformationMessage(
          `已为 ${displayTag} 回填完好系统凭据${markerNote}，手动重启或重载窗口后生效。${multiHubNote}`
        );
      }

      return {
        ok: true,
        healedEmail: meta.email,
        clearedMarkers,
        activeHubCount: hubCount
      };
    } finally {
      this._isIntentionalAuthOp = false;
    }
  }

  /**
   * 捕获本机当前已登录的 Antigravity 账号（OS 凭据为主，~/.gemini 为兜底）并加密入库。
   * @param {{ silent?: boolean }} [options]
   */
  async captureCurrentAccount(options = {}) {
    const silent = Boolean(options.silent);
    const [sysCred, quota, compat] = await Promise.all([
      Promise.resolve().then(() => this._bridge.readSystemCredential()),
      this._capsule.getQuota(true).catch(() => null),
      Promise.resolve().then(() => this._bridge.readGeminiCompatFiles())
    ]);

    let sourceCred = null;
    let sourceTag = "captured";
    if (sysCred?.ok && (sysCred.refreshToken || sysCred.accessToken)) {
      sourceCred = sysCred;
      sourceTag = "captured";
    } else if (compat?.oauth && (compat.oauth.refresh_token || compat.oauth.access_token)) {
      sourceCred = {
        email: compat.activeEmail,
        authMethod: "consumer",
        accessToken: compat.oauth.access_token,
        refreshToken: compat.oauth.refresh_token,
        tokenType: compat.oauth.token_type,
        idToken: compat.oauth.id_token,
        scope: compat.oauth.scope,
        expiryMs: compat.oauth.expiry_date
      };
      sourceTag = "gemini-cli";
    }

    if (!sourceCred) {
      const errMsg = sysCred?.error || "未能在本机凭据管理器或 ~/.gemini 中检测到有效登录凭据";
      if (!silent) {
        void this._vscode.window.showWarningMessage(`捕获当前账号失败: ${errMsg}`);
      }
      return { ok: false, error: errMsg };
    }

    let email = String(quota?.userEmail || sourceCred.email || compat?.activeEmail || "").trim();
    if (!email && !silent) {
      const input = await this._vscode.window.showInputBox({
        prompt: "已检测到本机 OAuth 令牌，但未能自动读取邮箱，请输入对应的 Google 账号邮箱以完成标识：",
        placeHolder: "example@gmail.com",
        ignoreFocusOut: true
      });
      email = String(input || "").trim();
    }

    if (!email) {
      return { ok: false, error: "未能确定当前登录账号邮箱" };
    }

    const groups = normalizeQuotaGroups(quota?.quotaGroups);
    const tierName = String(quota?.userTierName || "").trim();
    const res = await this._store.upsertAccount(
      {
        email,
        name: String(quota?.userName || "").trim(),
        authMethod: sourceCred.authMethod || "consumer",
        tierName,
        source: sourceTag,
        quotaSnapshot:
          groups.length > 0
            ? { fetchedAtMs: quota?.fetchedAtMs || Date.now(), tierName, snapshotKind: "live", groups }
            : null,
        lastCapturedAtMs: Date.now()
      },
      sourceCred
    );

    await this._store.setLastHealthyAccountId(res.account.id);
    this._logger.log(`[账号] 已捕获并${res.isNew ? "新增" : "更新"}账号 ${this._bridge.maskEmail(email)}`);
    this._onAccountsChanged();
    if (!silent) {
      void this._vscode.window.showInformationMessage(
        `已${res.isNew ? "捕获并入库" : "更新"}当前账号：${email}`
      );
    }
    return { ok: true, isNew: res.isNew, account: res.account };
  }

  /**
   * 一键切换至目标账号：互斥保护 -> 备份当前号并定格退出余额快照 -> 写主凭据（失败回滚）-> 同步兼容文件 -> 冷重启或重载窗口。
   * @param {string} accountId
   * @param {{ reloadOverride?: "coldRestart" | "ask" | "auto" | "none" }} [options]
   */
  async switchAccount(accountId, options = {}) {
    if (this._switchingPromise) {
      return { ok: false, error: "正在切换账号，请勿重复操作" };
    }

    this._isIntentionalAuthOp = true;
    const task = this._doSwitchAccount(accountId, options).finally(() => {
      this._switchingPromise = null;
      this._isIntentionalAuthOp = false;
    });
    this._switchingPromise = task;
    return task;
  }

  async _doSwitchAccount(accountId, options = {}) {
    const meta = this._store.getAccountMeta(accountId);
    if (!meta) {
      return { ok: false, error: "目标账号不存在或已被删除" };
    }
    const secret = await this._store.getAccountSecret(accountId);
    if (!secret || (!secret.refreshToken && !secret.accessToken)) {
      return { ok: false, error: `账号 ${meta.email} 缺少可用 OAuth 令牌，请重新登录或导入` };
    }
    if (!secret.refreshToken && secret.expiryMs > 0 && secret.expiryMs <= Date.now()) {
      return { ok: false, error: `账号 ${meta.email} 缺少 refresh_token 且访问令牌已过期` };
    }

    // 1. 写入前读取并安全快照当前主凭据 + 定格当前账号退出余额快照与恢复倒计时
    const prevCred = this._bridge.readSystemCredential();
    if (prevCred?.ok && prevCred.email && (prevCred.refreshToken || prevCred.accessToken)) {
      try {
        const existingPrev = this._store.findByEmail(prevCred.email);
        await this._store.upsertAccount(
          {
            email: prevCred.email,
            authMethod: prevCred.authMethod || "consumer",
            source: existingPrev ? existingPrev.source : "auto-backup",
            lastCapturedAtMs: Date.now()
          },
          prevCred
        );
        if (prevCred.email.trim().toLowerCase() !== meta.email.trim().toLowerCase()) {
          await this._captureExitSnapshotBeforeLeave(prevCred.email);
        }
      } catch (err) {
        this._logger.log(`[账号] 切号前备份或记录退出快照失败: ${err.message}`);
      }
    }

    // 2. 组装并写入 OS 凭据管理器主源 gemini:antigravity
    const payload = this._bridge.buildSystemCredentialPayload(meta, secret);
    const writeRes = this._bridge.writeSystemCredential(payload);
    if (!writeRes?.ok) {
      if (prevCred?.ok && prevCred.raw) {
        const rb = this._bridge.writeSystemCredential(prevCred.raw);
        this._logger.log(`[账号] 写入失败，回滚原凭据${rb?.ok ? "成功" : "失败"}`);
      }
      const errMsg = writeRes?.error || "写入系统凭据失败";
      void this._vscode.window.showErrorMessage(`切换账号失败: ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    // 3. 按配置同步 ~/.gemini 兼容文件（辅助失败不回滚主凭据）
    const prefs = this.getAccountPrefs();
    let compatWarning = "";
    if (prefs.syncGeminiCli) {
      try {
        this._bridge.syncGeminiCompatFiles({
          email: meta.email,
          accessToken: secret.accessToken,
          refreshToken: secret.refreshToken,
          tokenType: secret.tokenType,
          expiryMs: secret.expiryMs,
          idToken: secret.idToken,
          scope: secret.scope
        });
      } catch (err) {
        compatWarning = `（~/.gemini 同步提醒: ${err.message}）`;
        this._logger.log(`[账号] 同步 ~/.gemini 兼容文件失败: ${err.message}`);
      }
    }

    const updatedAccount = await this._store.markSwitched(accountId);
    await this._store.setLastHealthyAccountId(accountId);
    const hubs = this._bridge.detectActiveHubInstances();
    const hubCount = Number(hubs?.count || 0);
    this._logger.log(
      `[账号] 已切换凭据至 ${this._bridge.maskEmail(meta.email)}（活跃 agy 窗口数: ${hubCount}）`
    );
    this._onAccountsChanged();

    // 4. 按用户偏好执行冷重启或窗口重载
    const reloadMode = options.reloadOverride || prefs.reloadAfterSwitch;
    const isGcpTos = isGcpTosAuthMethod(meta.authMethod);
    const multiWindowTip =
      hubCount > 1
        ? `检测到 ${hubCount} 个活跃 Antigravity 窗口，建议关闭其他窗口后一并重启以免旧进程回写旧凭据。`
        : "";
    const displayTag = meta.alias ? `${meta.alias} (${meta.email})` : meta.email;

    if (reloadMode === "coldRestart") {
      if (hubCount > 1) {
        void this._vscode.window.showWarningMessage(
          `已切换至 ${displayTag}，正在自动冷重启当前 IDE。${multiWindowTip}${compatWarning}`
        );
      }
      const rst = await this._triggerColdRestartOrFallback(meta, {
        isGcpTos,
        syncOnboarding: prefs.syncOnboardingState,
        displayTag,
        compatWarning,
        hubCount
      });
      return {
        ok: true,
        account: updatedAccount || meta,
        activeHubCount: hubCount,
        reloadMode,
        coldRestartScheduled: !rst.fallbackUsed,
        multiWindowWarning: multiWindowTip
      };
    }

    if (reloadMode === "auto") {
      await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
      if (hubCount > 1) {
        void this._vscode.window.showWarningMessage(
          `已切换至 ${displayTag}，正在自动重载当前窗口。${multiWindowTip}${compatWarning}`
        );
      }
      const timer = setTimeout(() => {
        void this._vscode.commands.executeCommand("workbench.action.reloadWindow");
      }, hubCount > 1 ? 300 : 30);
      if (typeof timer.unref === "function") timer.unref();
    } else if (reloadMode === "ask") {
      await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
      const msg = `已写入账号 ${displayTag} 的凭据。冷重启 IDE 可彻底清空旧账号缓存免除引导弹窗（约 3-5 秒，自动恢复工作区）。${
        multiWindowTip ? ` ${multiWindowTip}` : ""
      }${compatWarning}`;
      void Promise.resolve(
        this._vscode.window.showInformationMessage(msg, "冷重启免弹窗（推荐）", "快速重载窗口", "稍后手动")
      ).then((choice) => {
        if (choice === "冷重启免弹窗（推荐）") {
          void this._triggerColdRestartOrFallback(meta, {
            isGcpTos,
            syncOnboarding: prefs.syncOnboardingState,
            displayTag,
            compatWarning,
            hubCount
          });
        } else if (choice === "快速重载窗口") {
          void this._vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
    } else {
      await this._syncOnboardingIfEnabled(meta.email, isGcpTos, prefs.syncOnboardingState);
      void this._vscode.window.showInformationMessage(
        `已写入账号 ${displayTag} 的凭据，手动重启或重载窗口后生效。${multiWindowTip}${compatWarning}`
      );
    }

    return {
      ok: true,
      account: updatedAccount || meta,
      activeHubCount: hubCount,
      reloadMode,
      multiWindowWarning: multiWindowTip
    };
  }

  /**
   * 重命名账号备注。
   * @param {string} accountId
   * @param {string} [alias]
   */
  async renameAccount(accountId, alias) {
    const meta = this._store.getAccountMeta(accountId);
    if (!meta) return { ok: false, error: "账号不存在" };

    let nextAlias = alias;
    if (nextAlias === undefined) {
      const input = await this._vscode.window.showInputBox({
        prompt: `为账号 ${meta.email} 设置便于识别的备注名称（留空则清除备注）`,
        value: meta.alias || "",
        placeHolder: "例如：主力 Pro / 备用号 A",
        ignoreFocusOut: true
      });
      if (input === undefined) return { ok: false, canceled: true };
      nextAlias = input;
    }

    const updated = await this._store.updateAlias(accountId, nextAlias);
    this._onAccountsChanged();
    return { ok: true, account: updated };
  }

  async deleteAccount(accountId) {
    const removed = await this._store.removeAccount(accountId);
    this._onAccountsChanged();
    return { ok: removed };
  }

  /**
   * 先备份当前号并记录退出快照，再调用官方内置登录流程新增账号并自动捕获入库（零硬编码密钥）。
   */
  async addAccountViaOfficialOAuth() {
    this._isIntentionalAuthOp = true;
    try {
      const backup = await this.captureCurrentAccount({ silent: true });
      if (backup.ok && backup.account?.email) {
        await this._captureExitSnapshotBeforeLeave(backup.account.email);
      }

      const prevCred = this._bridge.readSystemCredential();
      const prevEmail = String(prevCred?.ok ? prevCred.email : "").toLowerCase();
      const prevWriterId = String(prevCred?.ok ? prevCred.writerId : "");
      const prevRefresh = String(prevCred?.ok ? prevCred.refreshToken : "");

      const confirmMsg = backup.ok
        ? `已自动备份当前账号 (${backup.account.email}) 并保存退出余额快照。接下来将唤起 Antigravity 官方浏览器 OAuth 登录以新增账号，是否继续？`
        : "接下来将唤起 Antigravity 官方浏览器 OAuth 登录以新增账号（当前未检测到旧账号可备份）。是否继续？";
      const choice = await this._vscode.window.showInformationMessage(confirmMsg, { modal: true }, "继续登录");
      if (choice !== "继续登录") {
        return { ok: false, canceled: true };
      }

      try {
        await this._vscode.commands.executeCommand("antigravity.internal.logout");
      } catch {}

      try {
        await this._vscode.commands.executeCommand("antigravity.internal.loginWithRedirect");
      } catch {
        try {
          await this._vscode.commands.executeCommand("antigravity.signIn");
        } catch (err) {
          const msg = `未能触发官方登录命令: ${err.message}`;
          void this._vscode.window.showErrorMessage(msg);
          return { ok: false, error: msg };
        }
      }

      let capturedResult = null;
      await this._vscode.window.withProgress(
        {
          location: this._vscode.ProgressLocation.Notification,
          title: "正在等待 Antigravity 官方 OAuth 登录完成（最多 120 秒）...",
          cancellable: true
        },
        async (_progress, token) => {
          const deadline = Date.now() + 120_000;
          while (!token.isCancellationRequested && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2000));
            if (token.isCancellationRequested) break;
            const cur = this._bridge.readSystemCredential();
            if (!cur?.ok || (!cur.refreshToken && !cur.accessToken)) continue;
            const curEmail = String(cur.email || "").toLowerCase();
            const changed =
              (curEmail && curEmail !== prevEmail) ||
              (cur.writerId && cur.writerId !== prevWriterId) ||
              (cur.refreshToken && cur.refreshToken !== prevRefresh);
            if (changed) {
              const cap = await this.captureCurrentAccount({ silent: true });
              if (cap.ok) {
                capturedResult = cap;
                break;
              }
            }
          }
        }
      );

      if (capturedResult?.ok) {
        void this._vscode.window.showInformationMessage(
          `官方登录成功，已自动捕获账号 ${capturedResult.account.email} 入库`
        );
        return capturedResult;
      }
      return { ok: false, error: "等待官方 OAuth 登录超时或已取消，若已完成登录请点击「捕获当前账号」" };
    } finally {
      this._isIntentionalAuthOp = false;
    }
  }

  /**
   * 手动一次性只读导入 ~/.antigravity_tools 账号库（若存在 ~/.gemini 则补充导入）。
   */
  async importExternalAccounts() {
    const toolsRes = await this._store.importFromAntigravityTools();
    let msgParts = [];
    if (toolsRes.total > 0) {
      msgParts.push(
        `Antigravity Tools: 新增 ${toolsRes.imported}、更新 ${toolsRes.updated}${
          toolsRes.skipped ? `、跳过 ${toolsRes.skipped}` : ""
        }`
      );
    } else {
      const gemRes = await this._store.importFromGeminiDir();
      if (gemRes.imported > 0 || gemRes.updated > 0) {
        msgParts.push(`Gemini CLI (~/.gemini): 新增 ${gemRes.imported}、更新 ${gemRes.updated}`);
      }
    }

    this._onAccountsChanged();
    if (msgParts.length === 0) {
      void this._vscode.window.showInformationMessage(
        "未在本机 ~/.antigravity_tools 或 ~/.gemini 目录发现可导入的账号凭据"
      );
    } else {
      void this._vscode.window.showInformationMessage(`导入完成：${msgParts.join("；")}`);
    }
    return { ok: true, toolsRes };
  }

  async importFromJsonFile() {
    const picked = await this._vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
      openLabel: "导入账号 JSON"
    });
    if (!picked || !picked[0]) return { ok: false, canceled: true };
    const fs = require("node:fs");
    const content = fs.readFileSync(picked[0].fsPath, "utf8");
    const res = await this._store.importFromJsonBundle(content);
    this._onAccountsChanged();
    void this._vscode.window.showInformationMessage(
      `JSON 导入完成：新增 ${res.imported}、更新 ${res.updated}${res.skipped ? `、跳过 ${res.skipped}` : ""}`
    );
    return { ok: true, ...res };
  }

  async exportToJsonFile() {
    const modePick = await this._vscode.window.showWarningMessage(
      "导出的 JSON 文件是否包含 OAuth 令牌密钥？（含密钥文件请妥善保管，勿分享他人）",
      { modal: true },
      "包含密钥导出（完整迁移）",
      "仅导出脱敏索引（不含密钥）"
    );
    if (!modePick) return { ok: false, canceled: true };

    const includeSecrets = modePick === "包含密钥导出（完整迁移）";
    const jsonText = await this._store.exportToJsonBundle({ includeSecrets });
    const uri = await this._vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      saveLabel: "保存账号备份"
    });
    if (!uri) return { ok: false, canceled: true };
    const fs = require("node:fs");
    fs.writeFileSync(uri.fsPath, `${jsonText}\n`, "utf8");
    void this._vscode.window.showInformationMessage(`已导出账号备份至 ${uri.fsPath}`);
    return { ok: true, path: uri.fsPath, includeSecrets };
  }

  /**
   * 底部状态栏秒切入口：弹出 QuickPick 账号列表（按可用余量降序、同分最快回满优先）。
   * @param {() => void} [openAccountsTabFn]
   */
  async showQuickSwitchPicker(openAccountsTabFn) {
    const state = await this.getActiveState({ forceQuota: false });
    const mask = state.prefs.privacyMask;
    const formatDisplayEmail = (email) => (mask ? this._bridge.maskEmail(email) : email);
    const nowMs = Date.now();

    const summarizeForPicker = (acc, isActive) => {
      const rawSnap = acc.effectiveQuotaSnapshot || acc.quotaSnapshot;
      if (!rawSnap || !Array.isArray(rawSnap.groups) || rawSnap.groups.length === 0) {
        return "未记录";
      }
      const snap = evaluateQuotaSnapshot(rawSnap, { nowMs, isActive });
      const parts = [];
      for (const g of snap.groups.slice(0, 2)) {
        const b5h = (g.buckets || []).find((b) => b.window === "5h") || g.buckets?.[0];
        if (!b5h) continue;
        const shortName = String(g.displayName || "")
          .replace(/\s*models?$/i, "")
          .replace("Claude and GPT", "Claude/GPT");
        if (isActive) {
          const rst = b5h.remainingMs > 0 ? `(${formatCountdown(b5h.remainingMs, { compact: true })})` : "";
          parts.push(`${shortName} ${b5h.effectivePct}%${rst}`);
        } else if (b5h.state === "recovered") {
          parts.push(`${shortName} 100%(已回满)`);
        } else if (b5h.state === "recovering") {
          const cd = formatCountdown(b5h.remainingMs, { compact: true });
          parts.push(`${shortName} ${b5h.recordedPct}%(满额 ${cd})`);
        } else {
          parts.push(`${shortName} ${b5h.effectivePct}%`);
        }
      }
      return parts.join(" · ") || "未记录";
    };

    const items = [];
    const sortedAccounts = sortAccountsByQuota(state.accounts, nowMs);
    for (const acc of sortedAccounts) {
      const isActive = acc.id === state.activeAccountId;
      const shownEmail = formatDisplayEmail(acc.email);
      const label = `${isActive ? "$(check) " : "$(account) "}${acc.alias ? `${acc.alias} · ${shownEmail}` : shownEmail}`;
      const descParts = [];
      if (isActive) descParts.push("在线实时");
      if (acc.tierName) descParts.push(acc.tierName);
      descParts.push(summarizeForPicker(acc, isActive));
      items.push({
        label,
        description: descParts.join(" · "),
        detail: acc.hasRefreshToken ? "支持无感续期" : "仅访问令牌（可能过期）",
        action: "switch",
        accountId: acc.id,
        isActive
      });
    }

    if (items.length > 0) {
      items.push({ kind: this._vscode.QuickPickItemKind?.Separator ?? -1, label: "快捷操作" });
    }
    items.push({
      label: "$(cloud-download) 捕获当前已登录账号",
      description: state.activeEmail ? formatDisplayEmail(state.activeEmail) : "尚未捕获",
      action: "capture"
    });
    items.push({
      label: "$(sign-in) 官方 OAuth 登录新增账号",
      description: "自动先备份当前号并保存退出余额快照，再唤起官方登录",
      action: "oauth"
    });
    items.push({
      label: "$(folder-opened) 一键导入外部账号库",
      description: "手动只读扫描 ~/.antigravity_tools 与 ~/.gemini",
      action: "import"
    });
    items.push({
      label: "$(list-unordered) 打开多账号管理页签",
      description: "查看退出余额、实时满额倒计时与 5 维健康体检",
      action: "openTab"
    });

    const picked = await this._vscode.window.showQuickPick(items, {
      placeHolder: state.activeEmail
        ? `当前活跃: ${formatDisplayEmail(state.activeEmail)} — 选择目标账号一键切换`
        : "选择账号或导入/捕获凭据",
      ignoreFocusOut: true
    });
    if (!picked) return null;

    if (picked.action === "switch") {
      if (picked.isActive) {
        void this._vscode.window.showInformationMessage("该账号已是当前活跃账号");
        return { ok: true, alreadyActive: true };
      }
      return this.switchAccount(picked.accountId);
    }
    if (picked.action === "capture") return this.captureCurrentAccount({ silent: false });
    if (picked.action === "oauth") return this.addAccountViaOfficialOAuth();
    if (picked.action === "import") return this.importExternalAccounts();
    if (picked.action === "openTab" && typeof openAccountsTabFn === "function") {
      openAccountsTabFn();
      return { ok: true, openedTab: true };
    }
    return null;
  }
}

module.exports = {
  AccountManager,
  GUARD_CHECK_INTERVAL_MS,
  HEAL_PROMPT_COOLDOWN_MS,
  AUTO_HEAL_COOLDOWN_MS,
  MISSING_CRED_GRACE_MS,
  EXIT_SNAPSHOT_TIMEOUT_MS,
  buildCredentialFingerprint
};
