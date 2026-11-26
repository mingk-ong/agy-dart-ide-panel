"use strict";

const fs = require("node:fs");
const vscode = require("vscode");
const { getAntigravityStateDirs, readSelectedAgentModelId } = require("./paths");
const { matchQuotaGroup, formatQuotaPoolShortName } = require("./quotaMatcher");
const { maskEmail } = require("./credentialBridge");
const {
  formatTierShortName,
  sortAccountsByQuota,
  summarizeGeminiQuotaForHover
} = require("./quotaTracker");

function escapeMarkdownLabel(text) {
  return String(text || "").replace(/[\\[\]()*`_|<>]/g, "\\$&");
}

const ERROR_LABELS = {
  quota_exhausted: "额度耗尽",
  rate_limited: "429 限流",
  request_timeout: "请求超时",
  network_error: "断连",
  context_overflow: "上下文超限",
  auth_error: "认证异常",
  service_unavailable: "服务繁忙",
  canceled: "已取消",
  unknown: "请求失败"
};

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTokens(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return "--";
  const n = Math.max(0, Number(val));
  if (n < 1000) return String(Math.round(n));
  const k = Math.round(n / 100) / 10;
  if (k < 100) return `${k.toFixed(1)}K`;
  const kInt = Math.round(n / 1000);
  if (kInt < 1000) return `${kInt}K`;
  const m = Math.round(n / 100000) / 10;
  return m >= 100 ? `${Math.round(n / 1000000)}M` : `${m.toFixed(1)}M`;
}

function formatReset(iso, compact = false) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return compact ? "即将" : "即将重置";
  const mins = Math.floor(diff / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (compact) {
    if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`;
    if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
    return `${Math.max(1, m)}m`;
  }
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

function formatAge(seconds, compact = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const sec = Math.floor(seconds);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) {
    if (!compact && m < 10 && sec % 60) {
      return `${m}m${sec % 60}s`;
    }
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (!compact && h < 10 && rm) {
    return `${h}h${rm}m`;
  }
  return `${h}h`;
}

/**
 * 底部状态栏多胶囊组件：账号切换胶囊 + 护栏/上下文胶囊 + 缓存命中率胶囊 + 速度/报错/等待胶囊 + 配额胶囊。
 */
class StatusBarController {
  /**
   * @param {{
   *   backendClient: import("./backendClient").AgyDartBackendClient,
   *   capsuleClient: import("./capsuleClient").CapsuleClient,
   *   dashboardController: import("./dashboardController").DashboardController,
   *   accountManager?: import("./accountManager").AccountManager,
   *   resolveRuntime: () => { ok: boolean, error?: string },
   *   logger: { log: (msg: string) => void }
   * }} options
   */
  constructor(options) {
    this._backend = options.backendClient;
    this._capsule = options.capsuleClient;
    this._dashboard = options.dashboardController;
    this._accountManager = options.accountManager || null;
    this._resolveRuntime = options.resolveRuntime;
    this._logger = options.logger;
    this._timer = null;
    this._polling = false;
    this._pendingRefresh = false;
    this._stateWatchers = [];
    this._watchDebounceTimer = null;
    this._lastSelectedModelId = "";
    this._disposed = false;

    this._accountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this._accountItem.command = "agyFusion.openAccountsTab";
    this._accountItem.text = "$(account) 账号";

    this._guardItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    this._guardItem.command = "agyFusion.openGuardTab";
    this._guardItem.text = "$(shield) 护栏";

    this._cacheItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
    this._cacheItem.command = "agyFusion.openGuardTab";
    this._cacheItem.text = "$(database) 缓存 --";

    this._speedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
    this._speedItem.command = "agyFusion.openTelemetryTab";
    this._speedItem.text = "$(pulse) 遥测";

    this._quotaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this._quotaItem.command = "agyFusion.openTelemetryTab";
    this._quotaItem.text = "$(pie-chart) 配额";
  }

  applyConfiguration() {
    this._stopTimer();
    this._stopModelSelectionWatch();
    if (this._disposed) return;

    const cfg = vscode.workspace.getConfiguration("agyFusion");
    const enabled = cfg.get("statusBar.enabled", true);
    if (!enabled) {
      this._accountItem.hide();
      this._guardItem.hide();
      this._cacheItem.hide();
      this._speedItem.hide();
      this._quotaItem.hide();
      return;
    }

    if (cfg.get("statusBar.showAccount", true)) this._accountItem.show();
    else this._accountItem.hide();

    this._guardItem.show();
    if (cfg.get("statusBar.showCache", true)) this._cacheItem.show();
    else this._cacheItem.hide();

    if (cfg.get("statusBar.showSpeed", true)) this._speedItem.show();
    else this._speedItem.hide();

    if (cfg.get("statusBar.showQuota", true)) this._quotaItem.show();
    else this._quotaItem.hide();

    this._startModelSelectionWatch();

    const secRaw = Number(cfg.get("refreshIntervalSec", 8));
    const intervalMs = Math.min(60, Math.max(3, Number.isFinite(secRaw) ? secRaw : 8)) * 1000;

    void this.refreshNow();
    this._timer = setInterval(() => {
      void this.refreshNow();
    }, intervalMs);
    if (typeof this._timer.unref === "function") {
      this._timer.unref();
    }
  }

  _startModelSelectionWatch() {
    this._stopModelSelectionWatch();
    try {
      this._lastSelectedModelId = readSelectedAgentModelId().modelId || "";
    } catch {
      this._lastSelectedModelId = "";
    }

    const dirs = getAntigravityStateDirs();
    for (const dir of dirs) {
      try {
        const watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
          if (this._disposed) return;
          if (filename && String(filename).toLowerCase() !== "antigravity_state.pbtxt") {
            return;
          }
          if (this._watchDebounceTimer !== null) {
            clearTimeout(this._watchDebounceTimer);
          }
          this._watchDebounceTimer = setTimeout(() => {
            this._watchDebounceTimer = null;
            if (this._disposed) return;
            const cur = readSelectedAgentModelId();
            if (cur.modelId && cur.modelId !== this._lastSelectedModelId) {
              this._lastSelectedModelId = cur.modelId;
              void this.refreshNow();
              this._dashboard.notifyModelSelectionChanged?.();
            }
          }, 60);
          if (typeof this._watchDebounceTimer.unref === "function") {
            this._watchDebounceTimer.unref();
          }
        });
        watcher.on("error", () => {});
        this._stateWatchers.push(watcher);
      } catch {}
    }
  }

  _stopModelSelectionWatch() {
    if (this._watchDebounceTimer !== null) {
      clearTimeout(this._watchDebounceTimer);
      this._watchDebounceTimer = null;
    }
    while (this._stateWatchers.length > 0) {
      const w = this._stateWatchers.pop();
      try {
        w.close();
      } catch {}
    }
  }

  async refreshNow() {
    if (this._disposed) return;
    if (this._polling) {
      this._pendingRefresh = true;
      return;
    }
    const cfg = vscode.workspace.getConfiguration("agyFusion");
    if (!cfg.get("statusBar.enabled", true)) return;

    this._polling = true;
    try {
      this._dashboard.syncConversations(true);
      const convId = this._dashboard.getResolvedConversationId();
      const scope = cfg.get("defaultScope", "conversation");
      const runtime = this._resolveRuntime();
      const needQuota = cfg.get("statusBar.showQuota", true) || cfg.get("statusBar.showAccount", true);

      const [stats, capSnap, quota] = await Promise.all([
        runtime.ok
          ? this._backend
              .requestApi("/api/stats", "POST", { scope, conversationId: convId })
              .then((r) => (r.ok ? r.data : null))
              .catch(() => null)
          : Promise.resolve(null),
        this._capsule.inspectConversation(convId).catch(() => null),
        needQuota
          ? this._capsule.getQuota(false).catch(() => null)
          : Promise.resolve(null)
      ]);

      if (this._accountManager && quota) {
        await this._accountManager.syncActiveAccountSnapshot(quota).catch(() => {});
      }
      if (this._accountManager?.keepFreshAndGuard) {
        await this._accountManager.keepFreshAndGuard({ quota, capSnap }).catch(() => {});
      }
      if (cfg.get("statusBar.showAccount", true)) {
        this._updateAccountCapsule(quota);
      }
      this._updateGuardCapsule(runtime, stats, capSnap, convId);
      if (cfg.get("statusBar.showCache", true)) {
        this._updateCacheCapsule(capSnap);
      }
      if (cfg.get("statusBar.showSpeed", true)) {
        this._updateSpeedCapsule(capSnap);
      }
      if (cfg.get("statusBar.showQuota", true)) {
        this._updateQuotaCapsule(quota, capSnap);
      }
    } catch (err) {
      this._logger.log(`[状态栏] 刷新异常: ${err.message}`);
    } finally {
      this._polling = false;
      if (this._pendingRefresh && !this._disposed) {
        this._pendingRefresh = false;
        queueMicrotask(() => {
          void this.refreshNow();
        });
      }
    }
  }

  _updateAccountCapsule(quota) {
    const email = String(quota?.userEmail || "").trim();
    const prefs = this._accountManager?.getAccountPrefs?.() || { privacyMask: false };
    const meta = email && this._accountManager?._store?.findByEmail ? this._accountManager._store.findByEmail(email) : null;
    const allAccounts = this._accountManager?._store?.listPublicAccounts
      ? this._accountManager._store.listPublicAccounts()
      : [];
    const allCount = allAccounts.length;
    const nowMs = Date.now();

    const health = this._accountManager?.getLatestHealthSummary?.() || null;
    const isCritical = health?.overall === "critical";
    const icon = isCritical ? "$(warning)" : "$(account)";

    let shortLabel = "账号";
    if (meta?.alias) {
      shortLabel = meta.alias;
    } else if (email) {
      const shown = prefs.privacyMask ? maskEmail(email) : email;
      const local = shown.split("@")[0] || shown;
      shortLabel = local.length > 14 ? `${local.slice(0, 12)}..` : local;
    }

    this._accountItem.text = isCritical ? `${icon} ${shortLabel} (异常)` : `${icon} ${shortLabel}`;
    this._accountItem.backgroundColor = undefined;

    const md = new vscode.MarkdownString("", true);
    md.supportThemeIcons = true;
    md.isTrusted = {
      enabledCommands: [
        "agyFusion.switchAccountById",
        "agyFusion.openAccountsTab",
        "agyFusion.captureCurrentAccount",
        "agyFusion.healAccount",
        "agyFusion.switchAccount"
      ]
    };

    md.appendMarkdown("**Antigravity 账号快捷切换** *(按 Gemini 可用余量与最快回满排序)*\n\n");
    if (email) {
      const shownActive = prefs.privacyMask ? maskEmail(email) : email;
      const activeTierShort = formatTierShortName(quota?.userTierName || meta?.tierName);
      const tierText = activeTierShort ? ` · ${escapeMarkdownLabel(activeTierShort)}` : "";
      md.appendMarkdown(`- **当前活跃**: ${escapeMarkdownLabel(shownActive)}${meta?.alias ? ` (${escapeMarkdownLabel(meta.alias)})` : ""}${tierText}\n`);
    } else {
      md.appendMarkdown("- **当前活跃**: 未检测到活跃登录态\n");
    }
    if (health && Array.isArray(health.issues) && health.issues.length > 0) {
      md.appendMarkdown(`- **护盾告警**: ${escapeMarkdownLabel(health.issues.map((i) => i.title).join("；"))}\n`);
    }

    if (allCount > 0) {
      const sortedAccounts = sortAccountsByQuota(allAccounts, nowMs, { geminiOnly: true });
      const shownAccounts = sortedAccounts.slice(0, 10);
      md.appendMarkdown("\n---\n\n");
      for (const acc of shownAccounts) {
        const isCurrent = Boolean(email && acc.email && acc.email.toLowerCase() === email.toLowerCase());
        const shownEmail = prefs.privacyMask ? maskEmail(acc.email) : acc.email;
        const displayName = escapeMarkdownLabel(acc.alias ? `${acc.alias} (${shownEmail})` : shownEmail);
        const tierShort = formatTierShortName(acc.tierName);
        const tierTag = tierShort ? ` ${escapeMarkdownLabel(`[${tierShort}]`)}` : "";
        const qText = escapeMarkdownLabel(summarizeGeminiQuotaForHover(acc, { isActive: isCurrent, nowMs }));
        if (isCurrent) {
          md.appendMarkdown(`- **$(check) ${displayName}**${tierTag} · ${qText} *(在线实时)*\n`);
        } else {
          const arg = encodeURIComponent(JSON.stringify([acc.id]));
          md.appendMarkdown(
            `- [$(arrow-swap) **${displayName}**${tierTag} · ${qText}](command:agyFusion.switchAccountById?${arg} "点击立即切换至该账号")\n`
          );
        }
      }
      if (sortedAccounts.length > shownAccounts.length) {
        md.appendMarkdown(`- *还有 ${sortedAccounts.length - shownAccounts.length} 个账号，点击打开左侧账号页查看*\n`);
      }
    } else {
      md.appendMarkdown("\n---\n\n- 暂无已保存账号，[$(cloud-download) 点击捕获当前账号](command:agyFusion.captureCurrentAccount)\n");
    }

    md.appendMarkdown("\n---\n\n");
    const footerActions = [
      "[$(account) 左侧账号页](command:agyFusion.openAccountsTab)",
      "[$(cloud-download) 捕获当前](command:agyFusion.captureCurrentAccount)"
    ];
    if (health?.canAutoHeal) {
      footerActions.push("[$(shield) 一键修复](command:agyFusion.healAccount)");
    }
    md.appendMarkdown(`${footerActions.join(" · ")}\n\n单击底栏打开左侧账号页 · 悬停点击账号即可秒切`);
    this._accountItem.tooltip = md;
  }

  _updateGuardCapsule(runtime, stats, capSnap, convId) {
    const ctxTokens = Number(capSnap?.contextTokens || 0);
    const maxTokens = Number(capSnap?.maxContextTokens || 0);
    const hasCtx = maxTokens > 0;
    const ctxRatio = hasCtx ? ctxTokens / maxTokens : 0;
    const ctxPct = hasCtx ? Math.round(ctxRatio * 100) : null;

    if (stats?.isPaused) {
      this._guardItem.text = "$(debug-pause) DART 已暂停";
      this._guardItem.backgroundColor = undefined;
    } else {
      const icon =
        capSnap?.requestError?.kind === "context_overflow" || ctxRatio >= 0.9
          ? "$(error)"
          : ctxRatio >= 0.75
            ? "$(warning)"
            : "$(shield)";
      const segments = [icon];
      if (ctxPct !== null) {
        segments.push(`上下文 ${ctxPct}%`);
      } else {
        segments.push("agy-dart");
      }

      if (stats) {
        const totalRaw = Number(stats.totalRawBytes || 0);
        const totalRet = Number(stats.totalReturnedBytes || 0);
        const keptOut = Number(stats.keptOutBytes !== undefined ? stats.keptOutBytes : Math.max(0, totalRaw - totalRet));
        if (totalRaw > 0) {
          const savePct = Math.round((keptOut / totalRaw) * 100);
          segments.push(`省 ${savePct}%`);
        }
      } else if (!runtime.ok && ctxPct === null) {
        segments.push("仅遥测");
      }

      this._guardItem.text = segments.join(" ");
      this._guardItem.backgroundColor = undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown("**agy-dart 融合监控**\n\n");
    if (convId) md.appendMarkdown(`- **追踪对话**: \`${convId.slice(0, 8)}...\`\n`);
    if (hasCtx) {
      md.appendMarkdown(`- **API 上下文**: ${formatTokens(ctxTokens)} / ${formatTokens(maxTokens)} (${ctxPct}%)\n`);
      if (ctxTokens > 0) {
        const cachedIn = Math.max(0, Number(capSnap?.cachedIn || 0));
        const hitPctText = ((Math.min(ctxTokens, cachedIn) / ctxTokens) * 100).toFixed(1);
        md.appendMarkdown(`- **缓存命中率**: ${hitPctText}%（命中 ${formatTokens(cachedIn)}）\n`);
      }
      if (capSnap?.activeModel) md.appendMarkdown(`- **活跃模型**: ${capSnap.activeModel}\n`);
    }
    if (stats) {
      const totalRaw = Number(stats.totalRawBytes || 0);
      const totalRet = Number(stats.totalReturnedBytes || 0);
      const keptOut = Number(stats.keptOutBytes !== undefined ? stats.keptOutBytes : Math.max(0, totalRaw - totalRet));
      const savePct = totalRaw > 0 ? ((keptOut / totalRaw) * 100).toFixed(1) : "0.0";
      md.appendMarkdown(`- **护栏状态**: ${stats.isPaused ? "已暂停" : "运行中"} (${stats.cutoffBytes === 0 ? "不限制" : formatBytes(stats.cutoffBytes)})\n`);
      md.appendMarkdown(`- **上下文节省**: ${savePct}%（已拦 ${formatBytes(keptOut)}）\n`);
    }
    md.appendMarkdown("\n点击跳转「护栏与缓存诊断」页面");
    this._guardItem.tooltip = md;
  }

  _updateCacheCapsule(capSnap) {
    const ctx = Math.max(0, Number(capSnap?.contextTokens || 0));
    const cached = Math.max(0, Number(capSnap?.cachedIn || 0));
    const uncached = Math.max(0, Number(capSnap?.uncachedIn !== undefined ? capSnap.uncachedIn : ctx - cached));
    const prefs = this._dashboard.getCapsulePrefs();
    const warnMin = Math.max(1, Number(prefs.cacheWarnMin) || 3);
    const coldMin = Math.max(warnMin + 1, Number(prefs.cacheColdMin) || 4);
    const warnSec = warnMin * 60;
    const coldSec = coldMin * 60;
    const ts = Number(capSnap?.lastStepEpochMs || 0);
    const ageSec = ctx > 0 && ts > 0 ? Math.max(0, Math.floor((Date.now() - ts) / 1000)) : null;

    if (ctx <= 0) {
      this._cacheItem.text = "$(database) 缓存 --";
      this._cacheItem.backgroundColor = undefined;
      const md = new vscode.MarkdownString();
      md.isTrusted = false;
      md.appendMarkdown("**Prompt 缓存命中率**\n\n");
      md.appendMarkdown("- 当前追踪对话暂无 API 请求缓存数据\n");
      md.appendMarkdown(`- **冷却阈值**: 变黄 ${warnMin}m · 变红 ${coldMin}m\n`);
      md.appendMarkdown("\n点击跳转「护栏与缓存诊断」页面");
      this._cacheItem.tooltip = md;
      return;
    }

    const ratio = Math.max(0, Math.min(1, cached / ctx));
    const hitPct = Math.round(ratio * 100);
    const hitPctExact = (ratio * 100).toFixed(1);
    let stateLabel = "新鲜";

    this._cacheItem.backgroundColor = undefined;
    if (ageSec !== null && ageSec >= coldSec) {
      stateLabel = "可能已冷";
      this._cacheItem.text = `$(history) 缓存 ${hitPct}% ○ ${formatAge(ageSec, true)}`;
    } else if (ageSec !== null && ageSec >= warnSec) {
      stateLabel = "临近失效";
      this._cacheItem.text = `$(clock) 缓存 ${hitPct}% ◐ ${formatAge(ageSec, true)}`;
    } else {
      this._cacheItem.text = `$(database) 缓存 ${hitPct}%`;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown("**Prompt 缓存命中率**\n\n");
    md.appendMarkdown(`- **命中率**: **${hitPctExact}%**\n`);
    md.appendMarkdown(`- **缓存读取 / 非缓存**: ${formatTokens(cached)} / ${formatTokens(uncached)}（总上下文 ${formatTokens(ctx)}）\n`);
    md.appendMarkdown(`- **缓存状态**: ${stateLabel}${ageSec !== null ? `（距上次请求 ${formatAge(ageSec, false)}）` : ""}\n`);
    md.appendMarkdown(`- **冷却阈值**: 变黄 ${warnMin}m · 变红 ${coldMin}m\n`);
    md.appendMarkdown("\n点击跳转「护栏与缓存诊断」页面");
    this._cacheItem.tooltip = md;
  }

  _updateSpeedCapsule(capSnap) {
    this._speedItem.backgroundColor = undefined;
    const kind = capSnap?.requestError?.kind || "none";
    const hasErr = Boolean(kind && kind !== "none" && ERROR_LABELS[kind]);
    if (hasErr) {
      this._speedItem.text = `$(error) ${ERROR_LABELS[kind]}`;
      this._speedItem.tooltip = `最近模型请求失败：${ERROR_LABELS[kind]}\n${capSnap.requestError.diagnostic || ""}\n点击跳转「实时遥测与用量」页面`;
      return;
    }

    const prefs = this._dashboard.getCapsulePrefs();
    const thresholdSec = prefs.queueWarnSec || 30;
    const tq = capSnap?.turnQueue;
    const slowWaits = Array.isArray(tq?.waits) ? tq.waits.filter((v) => Number.isFinite(v) && v >= thresholdSec) : [];
    const running = Boolean(capSnap?.turnSpeed?.hasActiveStep);
    const canLive = Boolean(tq && !tq.turnTerminal && Number.isFinite(tq.waitingSinceMs) && tq.waitingSinceMs > 0 && (running || tq.hasPendingPlanner));
    const liveSec = canLive ? Math.max(0, (Date.now() - tq.waitingSinceMs) / 1000) : 0;
    const liveHit = canLive && liveSec >= thresholdSec;
    const queueCount = slowWaits.length + (liveHit ? 1 : 0);

    if (queueCount > 0) {
      this._speedItem.text = liveHit
        ? `$(clock) 等待${queueCount > 1 ? `×${queueCount}` : ""} ${Math.floor(liveSec)}s`
        : `$(clock) 等待${queueCount > 1 ? `×${queueCount}` : ""}`;
      this._speedItem.tooltip = `本轮共有 ${queueCount} 段首字等待达 ${thresholdSec} 秒\n点击跳转「实时遥测与用量」页面`;
      return;
    }

    const gen = capSnap?.turnSpeed?.generation || capSnap?.generation;
    if (gen && gen.tps !== null && gen.tps !== undefined) {
      this._speedItem.text = `$(zap) ${gen.tps.toFixed(1)} tok/s`;
      const ttft = gen.ttft != null ? `${gen.ttft.toFixed(1)}s` : "--";
      const dur = gen.duration != null ? `${gen.duration.toFixed(1)}s` : "--";
      this._speedItem.tooltip = `最近请求：${gen.tps.toFixed(1)} tok/s · 耗时 ${ttft}–${dur} · 输出 ${formatTokens(gen.output)}\n点击跳转「实时遥测与用量」页面`;
    } else {
      this._speedItem.text = "$(pulse) 遥测就绪";
      this._speedItem.tooltip = "点击跳转「实时遥测与用量」页面";
    }
  }

  _updateQuotaCapsule(quota, capSnap) {
    if (!quota || !quota.ok) {
      this._quotaItem.hide();
      return;
    }
    const groups = Array.isArray(quota.quotaGroups) ? quota.quotaGroups : [];
    if (groups.length === 0) {
      this._quotaItem.hide();
      return;
    }

    this._quotaItem.show();
    const selectedModel = String(quota?.selectedModelLabel || "").trim();
    const activeModel = String(capSnap?.activeModel || "").trim();
    const primaryModel = selectedModel || activeModel;
    const fallbackModel = String(quota?.defaultModelLabel || "").trim();
    const targetGroup = matchQuotaGroup(groups, primaryModel, fallbackModel);
    const poolShort = formatQuotaPoolShortName(targetGroup);

    const buckets = Array.isArray(targetGroup?.buckets) ? targetGroup.buckets : [];
    const b5h = buckets.find((b) => b.window === "5h");
    const bWk = buckets.find((b) => b.window === "weekly");
    const parts = [];
    let minPct = 100;
    let hasPct = false;
    if (b5h && Number.isFinite(b5h.remainingFraction)) {
      const p = Math.round(Math.max(0, Math.min(1, b5h.remainingFraction)) * 100);
      minPct = Math.min(minPct, p);
      hasPct = true;
      const rst = formatReset(b5h.resetTime, true);
      parts.push(`5h ${p}%${rst ? `(${rst})` : ""}`);
    }
    if (bWk && Number.isFinite(bWk.remainingFraction)) {
      const p = Math.round(Math.max(0, Math.min(1, bWk.remainingFraction)) * 100);
      minPct = Math.min(minPct, p);
      hasPct = true;
      const rst = formatReset(bWk.resetTime, true);
      parts.push(`周 ${p}%${rst ? `(${rst})` : ""}`);
    }
    if (parts.length === 0) {
      const firstValid = buckets.find((b) => Number.isFinite(b?.remainingFraction));
      if (firstValid) {
        const p = Math.round(Math.max(0, Math.min(1, firstValid.remainingFraction)) * 100);
        minPct = Math.min(minPct, p);
        hasPct = true;
        const wLbl = String(firstValid.window || firstValid.displayName || "余量").trim();
        const rst = formatReset(firstValid.resetTime, true);
        parts.push(`${wLbl} ${p}%${rst ? `(${rst})` : ""}`);
      }
    }

    const quotaIcon =
      hasPct && minPct <= 10 ? "$(error)" : hasPct && minPct <= 25 ? "$(warning)" : "$(pie-chart)";
    this._quotaItem.text = parts.length > 0
      ? `${quotaIcon} ${poolShort} · ${parts.join(" · ")}`
      : `${quotaIcon} ${poolShort}`;
    this._quotaItem.backgroundColor = undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    const quotaTierShort = formatTierShortName(quota.userTierName);
    md.appendMarkdown(`**多模型配额池**${quotaTierShort ? ` (${escapeMarkdownLabel(quotaTierShort)})` : ""}\n\n`);
    if (primaryModel) {
      md.appendMarkdown(`- **当前模型**: ${primaryModel} → **${poolShort}**\n`);
      if (selectedModel && activeModel && selectedModel !== activeModel) {
        md.appendMarkdown(`- **上轮对话模型**: ${activeModel}\n`);
      }
      md.appendMarkdown("\n");
    } else if (fallbackModel) {
      md.appendMarkdown(`- **默认模型**: ${fallbackModel} → **${poolShort}**\n\n`);
    } else {
      md.appendMarkdown(`- **当前显示池**: **${poolShort}**\n\n`);
    }
    for (const g of groups) {
      const title = String(g.displayName || "未命名池").trim();
      const shortName = formatQuotaPoolShortName(g);
      const labelTitle = shortName && shortName !== title ? `**${title}** (${shortName})` : `**${title}**`;
      const prefix = g === targetGroup ? "[当前] " : "";
      const rows = (g.buckets || []).map((b) => {
        const wName = b.window === "5h" ? "5小时" : b.window === "weekly" ? "每周" : b.window;
        const pct = Math.round(Math.max(0, Math.min(1, Number(b.remainingFraction || 0))) * 100);
        const rst = formatReset(b.resetTime);
        return `${wName} **${pct}%**${rst ? ` (${rst})` : ""}`;
      });
      md.appendMarkdown(`- ${prefix}${labelTitle}: ${rows.join(" · ")}\n`);
    }
    md.appendMarkdown("\n点击跳转「实时遥测与用量」页面");
    this._quotaItem.tooltip = md;
  }

  _stopTimer() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  dispose() {
    this._disposed = true;
    this._stopTimer();
    this._stopModelSelectionWatch();
    this._accountItem.dispose();
    this._guardItem.dispose();
    this._cacheItem.dispose();
    this._speedItem.dispose();
    this._quotaItem.dispose();
  }
}

module.exports = {
  StatusBarController
};
