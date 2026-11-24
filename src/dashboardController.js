"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const vscode = require("vscode");
const { buildDashboardHtml, buildUnavailableHtml } = require("./htmlBuilder");
const { getAgyDartConfigPath } = require("./paths");
const { listRecentConversations } = require("./conversations");

const LANG_STATE_KEY = "agyFusion.preferredLang";
const CONV_MODE_STATE_KEY = "agyFusion.conversationSelection";
const ACTIVE_TAB_STATE_KEY = "agyFusion.activeTab";
const CAPSULE_UI_STATE_KEY = "agyFusion.capsuleUiState";

const LEGACY_LANG_STATE_KEY = "agyDartPanel.preferredLang";
const LEGACY_CONV_MODE_STATE_KEY = "agyDartPanel.conversationSelection";
const LEGACY_ACTIVE_TAB_STATE_KEY = "agyDartPanel.activeTab";
const LEGACY_CAPSULE_UI_STATE_KEY = "agyDartPanel.capsuleUiState";
const VALID_TABS = new Set(["capsule", "accounts", "dart"]);

const MUTATING_API_PATHS = new Set([
  "/api/cutoff",
  "/api/exemptions",
  "/api/toggle-active",
  "/api/paused",
  "/api/purge",
  "/api/maintenance",
  "/api/cli-filter",
  "/api/read-dedup"
]);

const PROTECTION_MODES = [
  {
    id: "host-45k",
    label: "host-45k (推荐默认 · 45 KiB / 800 行软护栏)",
    description: "对齐宿主上限，常规代码不打断，仅拦截超大文件/日志/diff"
  },
  {
    id: "fast-32k",
    label: "fast-32k (宽松 · 32 KB / 800 行)",
    description: "略收紧单次读取体积"
  },
  {
    id: "balanced-16k",
    label: "balanced-16k (平衡 · 16 KB / 410 行)",
    description: "更积极控制上下文体量，大源码改走大纲+切片"
  },
  {
    id: "strict-8k",
    label: "strict-8k (严格 · 8 KB / 205 行)",
    description: "极限压减单次读体积"
  },
  {
    id: "no-read-hook",
    label: "no-read-hook (极速方案 B · 仅管命令行)",
    description: "关闭 read_file Hook 同步开销，保留 CLI 过滤与监控"
  }
];

/**
 * 统一管理侧边栏视图、全宽编辑器标签页、三页签状态、对话追踪与快捷命令。
 */
class DashboardController {
  /**
   * @param {{
   *   context: vscode.ExtensionContext,
   *   backendClient: import("./backendClient").AgyDartBackendClient,
   *   capsuleClient: import("./capsuleClient").CapsuleClient,
   *   accountManager?: import("./accountManager").AccountManager,
   *   resolveRuntime: () => { ok: boolean, pluginRoot?: string, nodePath?: string, error?: string },
   *   resolveNodePath: () => { ok: boolean, nodePath?: string, error?: string },
   *   logger: { log: (msg: string) => void, show: () => void },
   *   onTelemetryMutated?: () => void
   * }} options
   */
  constructor(options) {
    this._context = options.context;
    this._backend = options.backendClient;
    this._capsule = options.capsuleClient;
    this._accountManager = options.accountManager || null;
    this._resolveRuntime = options.resolveRuntime;
    this._resolveNodePath = options.resolveNodePath;
    this._logger = options.logger;
    this._onTelemetryMutated = options.onTelemetryMutated || (() => {});

    this._sidebarView = null;
    this._editorPanel = null;

    const getStateWithLegacy = (key, legacyKey) => {
      const cur = this._context.globalState.get(key);
      return cur !== undefined ? cur : this._context.globalState.get(legacyKey);
    };

    const storedLang = getStateWithLegacy(LANG_STATE_KEY, LEGACY_LANG_STATE_KEY);
    if (storedLang === "zh" || storedLang === "en") {
      this._lang = storedLang;
    } else {
      this._lang = String(vscode.env.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
    }

    const storedSel = getStateWithLegacy(CONV_MODE_STATE_KEY, LEGACY_CONV_MODE_STATE_KEY);
    this._selectionMode = typeof storedSel === "string" && storedSel.trim() ? storedSel.trim() : "auto";

    const cfgDefaultTab = vscode.workspace.getConfiguration("agyFusion").get("defaultTab", "capsule");
    const storedTab = getStateWithLegacy(ACTIVE_TAB_STATE_KEY, LEGACY_ACTIVE_TAB_STATE_KEY);
    this._activeTab = VALID_TABS.has(storedTab)
      ? storedTab
      : (VALID_TABS.has(cfgDefaultTab) ? cfgDefaultTab : "capsule");

    const storedCapUi = getStateWithLegacy(CAPSULE_UI_STATE_KEY, LEGACY_CAPSULE_UI_STATE_KEY);
    this._capsuleUiState = {
      usageOpen: Boolean(storedCapUi && storedCapUi.usageOpen),
      usageScope: storedCapUi && storedCapUi.usageScope === "all" ? "all" : "conversation",
      usageMetric: storedCapUi && ["net", "total", "requests"].includes(storedCapUi.usageMetric) ? storedCapUi.usageMetric : "net",
      modelPeriod: storedCapUi && ["5h", "day", "3d", "week", "month"].includes(storedCapUi.modelPeriod)
        ? storedCapUi.modelPeriod
        : "day",
      heatOpen: Boolean(storedCapUi && storedCapUi.heatOpen),
      heatScale: storedCapUi && storedCapUi.heatScale === "week" ? "week" : "day"
    };

    this._conversations = [];
    this._resolvedConversationId = "";
    this.syncConversations(false);
  }

  getResolvedConversationId() {
    return this._resolvedConversationId;
  }

  getCapsulePrefs() {
    const cfg = vscode.workspace.getConfiguration("agyFusion");
    const warnMin = Math.max(1, Math.min(998, Number(cfg.get("capsule.cacheWarnMin", 3)) || 3));
    let coldMin = Math.max(2, Math.min(999, Number(cfg.get("capsule.cacheColdMin", 4)) || 4));
    if (coldMin <= warnMin) coldMin = Math.min(999, warnMin + 1);
    const queueWarnSec = Math.max(1, Math.min(999, Number(cfg.get("capsule.queueWarnSec", 30)) || 30));
    return { cacheWarnMin: warnMin, cacheColdMin: coldMin, queueWarnSec };
  }

  syncConversations(notifyWebviews = true) {
    const list = listRecentConversations({ limit: 20 });
    this._conversations = list;

    let nextId = "";
    if (this._selectionMode === "auto") {
      nextId = list[0]?.id || "";
    } else {
      const matched = list.find((item) => item.id === this._selectionMode);
      if (matched) {
        nextId = matched.id;
      } else {
        this._selectionMode = "auto";
        this._context.globalState.update(CONV_MODE_STATE_KEY, "auto");
        nextId = list[0]?.id || "";
      }
    }

    const changed = nextId !== this._resolvedConversationId;
    this._resolvedConversationId = nextId;

    if (notifyWebviews) {
      this._postStateSync(changed);
    }
    return changed;
  }

  resolveWebviewView(webviewView) {
    this._sidebarView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.onDidDispose(() => {
      if (this._sidebarView === webviewView) {
        this._sidebarView = null;
      }
    });
    this._attachMessageHandler(webviewView.webview);
    void this._renderWebview(webviewView.webview, "sidebar");
  }

  async openEditorTab() {
    if (this._editorPanel) {
      this._editorPanel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "agyFusion.editorView",
      "Antigravity 融合面板",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this._editorPanel = panel;
    panel.iconPath = vscode.Uri.file(path.join(this._context.extensionPath, "assets", "icon.svg"));
    panel.onDidDispose(() => {
      if (this._editorPanel === panel) {
        this._editorPanel = null;
      }
    });
    this._attachMessageHandler(panel.webview);
    await this._renderWebview(panel.webview, "editor");
  }

  async focusSidebar(targetTab) {
    if (VALID_TABS.has(targetTab)) {
      this._activeTab = targetTab;
      await this._context.globalState.update(ACTIVE_TAB_STATE_KEY, targetTab);
      this._postToAll({ type: "setActiveTab", tab: targetTab });
    }
    if (this._editorPanel && this._editorPanel.visible) {
      this._editorPanel.reveal(this._editorPanel.viewColumn, false);
      this._postToAll({ type: "setActiveTab", tab: this._activeTab });
      return;
    }
    await vscode.commands.executeCommand("workbench.view.extension.agyFusion");
    if (this._sidebarView) {
      this._sidebarView.show?.(true);
    }
    this._postToAll({ type: "setActiveTab", tab: this._activeTab });
  }

  async refreshAll(options = {}) {
    this.syncConversations(false);
    if (options.reloadHtml) {
      if (this._sidebarView) {
        await this._renderWebview(this._sidebarView.webview, "sidebar");
      }
      if (this._editorPanel) {
        await this._renderWebview(this._editorPanel.webview, "editor");
      }
      return;
    }
    this._postToAll({ type: "refresh" });
    this._postStateSync(false);
  }

  notifyModelSelectionChanged() {
    this._postToAll({ type: "refresh" });
  }

  notifyAccountsChanged() {
    this._postToAll({ type: "accountsUpdated" });
  }

  async _renderWebview(webview, mode) {
    this.syncConversations(false);
    const nodeRes = this._resolveNodePath();
    if (!nodeRes.ok) {
      webview.html = buildUnavailableHtml({
        title: "需要 Node.js (>= 22)",
        reason: nodeRes.error || "未找到可用的系统 Node.js (>= 22)。"
      });
      return;
    }

    let rawHtml = "";
    let dartUnavailableReason = "";
    try {
      rawHtml = await this._backend.fetchDashboardHtml();
    } catch (err) {
      const runtime = this._resolveRuntime();
      dartUnavailableReason = runtime.ok
        ? `启动 agy-dart 面板后端失败：${err.message}`
        : (runtime.error || err.message);
    }

    const cfg = vscode.workspace.getConfiguration("agyFusion");
    const defaultScope = cfg.get("defaultScope", "conversation");
    const initialState = {
      lang: this._lang,
      activeTab: this._activeTab,
      defaultScope,
      selectionMode: this._selectionMode,
      resolvedConversationId: this._resolvedConversationId,
      conversations: this._conversations,
      capsulePrefs: this.getCapsulePrefs(),
      capsuleUiState: { ...this._capsuleUiState }
    };

    try {
      webview.html = buildDashboardHtml({
        rawHtml,
        dartUnavailableReason,
        mode,
        initialState
      });
    } catch (err) {
      webview.html = buildUnavailableHtml({
        title: "融合控制台渲染异常",
        reason: err.message,
        details: err.stack ? String(err.stack).split("\n").slice(0, 4).join("\n") : ""
      });
    }
  }

  _attachMessageHandler(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "apiRequest") {
        try {
          const resp = await this._backend.requestApi(msg.path, msg.method, msg.body);
          webview.postMessage({
            type: "apiResponse",
            id: msg.id,
            ok: resp.ok,
            status: resp.status,
            data: resp.data,
            text: resp.text
          });
          if (resp.ok && MUTATING_API_PATHS.has(msg.path)) {
            this._onTelemetryMutated();
            this._broadcastOtherWebview(webview, { type: "refresh" });
          }
        } catch (err) {
          webview.postMessage({
            type: "apiResponse",
            id: msg.id,
            ok: false,
            status: 500,
            data: { error: err.message },
            error: err.message
          });
        }
        return;
      }

      if (msg.type === "capsuleInspect") {
        try {
          const convId = msg.conversationId || this._resolvedConversationId;
          const data = await this._capsule.inspectConversation(convId);
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: true, data });
        } catch (err) {
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: false, error: err.message });
        }
        return;
      }

      if (msg.type === "capsuleQuota") {
        try {
          const data = await this._capsule.getQuota(Boolean(msg.force));
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: true, data });
        } catch (err) {
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: false, error: err.message });
        }
        return;
      }

      if (msg.type === "capsuleUsage") {
        try {
          const convId = msg.conversationId || this._resolvedConversationId;
          const data = await this._capsule.getUsageHistory(convId);
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: true, data });
        } catch (err) {
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: false, error: err.message });
        }
        return;
      }

      if (msg.type === "capsuleUsageQuery") {
        try {
          const data = await this._capsule.queryUsageAnalytics({
            activeConversationId: this._resolvedConversationId,
            scope: msg.scope,
            conversationId: msg.conversationId,
            period: msg.period,
            shift: msg.shift,
            anchorDate: msg.anchorDate,
            anchorEndMs: msg.anchorEndMs
          });
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: true, data });
        } catch (err) {
          webview.postMessage({ type: "capsuleResult", id: msg.id, ok: false, error: err.message });
        }
        return;
      }

      if (msg.type === "saveCapsulePrefs" && msg.prefs && typeof msg.prefs === "object") {
        const cfg = vscode.workspace.getConfiguration("agyFusion");
        const warn = Math.max(1, Math.min(998, Number(msg.prefs.cacheWarnMin) || 3));
        const cold = Math.max(warn + 1, Math.min(999, Number(msg.prefs.cacheColdMin) || 4));
        const queue = Math.max(1, Math.min(999, Number(msg.prefs.queueWarnSec) || 30));
        await Promise.all([
          cfg.update("capsule.cacheWarnMin", warn, vscode.ConfigurationTarget.Global),
          cfg.update("capsule.cacheColdMin", cold, vscode.ConfigurationTarget.Global),
          cfg.update("capsule.queueWarnSec", queue, vscode.ConfigurationTarget.Global)
        ]);
        this._onTelemetryMutated();
        return;
      }

      if (msg.type === "webviewReady") {
        webview.postMessage({ type: "setActiveTab", tab: this._activeTab });
        return;
      }

      if (msg.type === "setActiveTab" && VALID_TABS.has(msg.tab)) {
        this._activeTab = msg.tab;
        await this._context.globalState.update(ACTIVE_TAB_STATE_KEY, msg.tab);
        this._broadcastOtherWebview(webview, { type: "setActiveTab", tab: msg.tab });
        return;
      }

      if (msg.type && String(msg.type).startsWith("account")) {
        if (!this._accountManager) {
          webview.postMessage({ type: "accountResult", id: msg.id, ok: false, error: "账号模块未初始化" });
          return;
        }
        try {
          let data = null;
          switch (msg.type) {
            case "accountState":
              data = await this._accountManager.getActiveState({ forceQuota: Boolean(msg.forceQuota) });
              break;
            case "accountCapture":
              data = await this._accountManager.captureCurrentAccount({ silent: false });
              break;
            case "accountSwitch":
              data = await this._accountManager.switchAccount(msg.accountId);
              break;
            case "accountRename":
              data = await this._accountManager.renameAccount(msg.accountId, msg.alias);
              break;
            case "accountDelete":
              data = await this._accountManager.deleteAccount(msg.accountId);
              break;
            case "accountImportTools":
              data = await this._accountManager.importExternalAccounts();
              break;
            case "accountImportFile":
              data = await this._accountManager.importFromJsonFile();
              break;
            case "accountExport":
              data = await this._accountManager.exportToJsonFile();
              break;
            case "accountOAuthLogin":
              data = await this._accountManager.addAccountViaOfficialOAuth();
              break;
            case "accountSavePrefs":
              data = await this._accountManager.saveAccountPrefs(msg.prefs || {});
              break;
            case "accountHealth":
              data = await this._accountManager.runAuthHealthCheck({ forceQuota: true });
              break;
            case "accountHeal":
              data = await this._accountManager.healActiveAccount({
                targetAccountId: msg.targetAccountId
              });
              break;
            default:
              throw new Error(`未知账号操作: ${msg.type}`);
          }
          webview.postMessage({ type: "accountResult", id: msg.id, ok: true, data });
        } catch (err) {
          webview.postMessage({ type: "accountResult", id: msg.id, ok: false, error: err.message });
        }
        return;
      }

      if (msg.type === "setCapsuleUiState" && msg.state && typeof msg.state === "object") {
        const next = { ...this._capsuleUiState };
        if (typeof msg.state.usageOpen === "boolean") {
          next.usageOpen = msg.state.usageOpen;
        }
        if (msg.state.usageScope === "conversation" || msg.state.usageScope === "all") {
          next.usageScope = msg.state.usageScope;
        }
        if (["net", "total", "requests"].includes(msg.state.usageMetric)) {
          next.usageMetric = msg.state.usageMetric;
        }
        if (["5h", "day", "3d", "week", "month"].includes(msg.state.modelPeriod)) {
          next.modelPeriod = msg.state.modelPeriod;
        }
        if (typeof msg.state.heatOpen === "boolean") {
          next.heatOpen = msg.state.heatOpen;
        }
        if (msg.state.heatScale === "day" || msg.state.heatScale === "week") {
          next.heatScale = msg.state.heatScale;
        }
        this._capsuleUiState = next;
        await this._context.globalState.update(CAPSULE_UI_STATE_KEY, next);
        this._broadcastOtherWebview(webview, { type: "capsuleUiState", state: { ...next } });
        return;
      }

      if (msg.type === "confirm") {
        const answer = await vscode.window.showWarningMessage(
          String(msg.message || "确认执行此操作吗？"),
          { modal: true },
          "确认"
        );
        webview.postMessage({
          type: "confirmResult",
          id: msg.id,
          confirmed: answer === "确认"
        });
        return;
      }

      if (msg.type === "alert") {
        void vscode.window.showWarningMessage(String(msg.message || ""));
        return;
      }

      if (msg.type === "copyText") {
        try {
          await vscode.env.clipboard.writeText(String(msg.text || ""));
          webview.postMessage({ type: "copyTextResult", id: msg.id, copied: true });
        } catch {
          webview.postMessage({ type: "copyTextResult", id: msg.id, copied: false });
        }
        return;
      }

      if (msg.type === "selectConversation") {
        const val = typeof msg.value === "string" && msg.value.trim() ? msg.value.trim() : "auto";
        this._selectionMode = val;
        await this._context.globalState.update(CONV_MODE_STATE_KEY, val);
        this.syncConversations(true);
        this._onTelemetryMutated();
        return;
      }

      if (msg.type === "setLanguage" && (msg.lang === "zh" || msg.lang === "en")) {
        this._lang = msg.lang;
        await this._context.globalState.update(LANG_STATE_KEY, msg.lang);
        this._broadcastOtherWebview(webview, { type: "setLanguage", lang: msg.lang });
        return;
      }

      if (msg.type === "runCommand") {
        await this._dispatchUiCommand(msg.command);
      }
    });
  }

  async _dispatchUiCommand(command) {
    switch (command) {
      case "openEditorTab":
        await this.openEditorTab();
        break;
      case "switchMode":
        await this.switchMode();
        break;
      case "runDoctor":
        await this.runDoctor();
        break;
      case "openConfig":
        await this.openConfig();
        break;
      case "restartBackend":
        await this.restartBackend();
        break;
      case "showLogs":
        this._logger.show();
        break;
      default:
        break;
    }
  }

  _postStateSync(forceRefresh) {
    this._postToAll({
      type: "stateSync",
      selectionMode: this._selectionMode,
      resolvedConversationId: this._resolvedConversationId,
      conversations: this._conversations,
      forceRefresh: Boolean(forceRefresh)
    });
  }

  _postToAll(message) {
    if (this._sidebarView) this._sidebarView.webview.postMessage(message);
    if (this._editorPanel) this._editorPanel.webview.postMessage(message);
  }

  _broadcastOtherWebview(sourceWebview, message) {
    if (this._sidebarView && this._sidebarView.webview !== sourceWebview) {
      this._sidebarView.webview.postMessage(message);
    }
    if (this._editorPanel && this._editorPanel.webview !== sourceWebview) {
      this._editorPanel.webview.postMessage(message);
    }
  }

  async togglePause() {
    try {
      const convId = this._resolvedConversationId;
      const statsResp = await this._backend.requestApi("/api/stats", "POST", {
        scope: "lifetime",
        conversationId: convId
      });
      const currentPaused = Boolean(statsResp.data && statsResp.data.isPaused);
      const nextPaused = !currentPaused;
      const mutResp = await this._backend.requestApi("/api/toggle-active", "POST", {
        scope: "lifetime",
        conversationId: convId,
        paused: nextPaused
      });
      if (!mutResp.ok) {
        throw new Error(mutResp.data?.error || `HTTP ${mutResp.status}`);
      }
      this._onTelemetryMutated();
      this._postToAll({ type: "refresh" });
      void vscode.window.showInformationMessage(
        nextPaused ? "agy-dart 全局上下文护栏已暂停" : "agy-dart 全局上下文护栏已恢复运行"
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`切换 agy-dart 护栏状态失败: ${err.message}`);
    }
  }

  async switchMode() {
    const runtime = this._resolveRuntime();
    if (!runtime.ok || !runtime.pluginRoot || !runtime.nodePath) {
      void vscode.window.showErrorMessage(runtime.error || "未找到有效的 agy-dart 安装目录或 Node.js");
      return;
    }

    const picked = await vscode.window.showQuickPick(PROTECTION_MODES, {
      placeHolder: "选择要切换的 agy-dart 保护模式",
      ignoreFocusOut: true
    });
    if (!picked) return;

    const installScript = path.join(runtime.pluginRoot, "scripts", "install.mjs");
    const result = await this._execCli(runtime.nodePath, [installScript, "mode", picked.id], runtime.pluginRoot);
    if (result.code === 0) {
      this._logger.log(`[模式切换] ${result.stdout.trim()}`);
      this._onTelemetryMutated();
      this._postToAll({ type: "refresh" });
      void vscode.window.showInformationMessage(`已切换 agy-dart 模式为 ${picked.id}`);
    } else {
      this._logger.log(`[模式切换失败] ${result.stderr || result.stdout}`);
      void vscode.window.showErrorMessage(`切换模式失败: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  async runDoctor() {
    const runtime = this._resolveRuntime();
    if (!runtime.ok || !runtime.pluginRoot || !runtime.nodePath) {
      void vscode.window.showErrorMessage(runtime.error || "未找到有效的 agy-dart 安装目录或 Node.js");
      return;
    }

    this._logger.show();
    this._logger.log("========== 运行 agy-dart 健康体检 (doctor) ==========");
    const installScript = path.join(runtime.pluginRoot, "scripts", "install.mjs");
    const result = await this._execCli(runtime.nodePath, [installScript, "doctor"], runtime.pluginRoot);
    if (result.stdout) this._logger.log(result.stdout.trimEnd());
    if (result.stderr) this._logger.log(`[stderr] ${result.stderr.trimEnd()}`);
    this._logger.log("===================================================");
    if (result.code === 0) {
      void vscode.window.showInformationMessage("agy-dart 健康体检全部通过 (详细报告见「agy-dart」输出面板)");
    } else {
      void vscode.window.showWarningMessage("agy-dart 健康体检发现异常，请查看「agy-dart」输出面板");
    }
  }

  async copyHandoffBrief() {
    try {
      this.syncConversations(false);
      const resp = await this._backend.requestApi("/api/handoff", "POST", {
        scope: "conversation",
        conversationId: this._resolvedConversationId
      });
      if (!resp.ok || !resp.data || !resp.data.markdown) {
        throw new Error(resp.data?.error || "交接简报内容为空");
      }
      await vscode.env.clipboard.writeText(resp.data.markdown);
      void vscode.window.showInformationMessage(
        `已复制交接简报 (${resp.data.bytes || Buffer.byteLength(resp.data.markdown, "utf8")} 字节)`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`生成或复制交接简报失败: ${err.message}`);
    }
  }

  async openConfig() {
    const cfgPath = getAgyDartConfigPath();
    if (!fs.existsSync(cfgPath)) {
      const choice = await vscode.window.showInformationMessage(
        `配置文件尚不存在 (${cfgPath})，当前运行于默认配置 + 环境变量模式。是否创建基础配置文件？`,
        "创建并打开",
        "取消"
      );
      if (choice !== "创建并打开") return;
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      const starter = {
        readGuardMode: "soft",
        readDedup: true,
        diffRead: false,
        cliFilter: true,
        cacheWatch: true,
        sensitiveFileGuard: "off"
      };
      fs.writeFileSync(cfgPath, `${JSON.stringify(starter, null, 2)}\n`, "utf8");
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
    await vscode.window.showTextDocument(doc);
  }

  async restartBackend() {
    const errors = [];
    try {
      await this._capsule.restart();
    } catch (err) {
      errors.push(`Capsule: ${err.message}`);
    }
    try {
      await this._backend.restart();
    } catch (err) {
      errors.push(`DART: ${err.message}`);
    }
    await this.refreshAll({ reloadHtml: true });
    this._onTelemetryMutated();
    if (errors.length === 0) {
      void vscode.window.showInformationMessage("Antigravity 融合面板后端已重启并就绪");
    } else {
      void vscode.window.showWarningMessage(`后端重启完成，部分服务提示：${errors.join("；")}`);
    }
  }

  _execCli(bin, args, cwd) {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve({ code: -1, stdout, stderr: `${stderr}\n执行超时` });
      }, 20000);
      if (typeof timer.unref === "function") timer.unref();
      child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
      child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: err.message }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    });
  }
}

module.exports = {
  DashboardController,
  PROTECTION_MODES
};
