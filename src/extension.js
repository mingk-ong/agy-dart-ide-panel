"use strict";

const vscode = require("vscode");
const { resolvePluginRoot, resolveSystemNodePath } = require("./paths");
const { AgyDartBackendClient } = require("./backendClient");
const { CapsuleClient } = require("./capsuleClient");
const { AccountStore } = require("./accountStore");
const { AccountManager } = require("./accountManager");
const { DashboardController } = require("./dashboardController");
const { StatusBarController } = require("./statusBar");

let activeBackendClient = null;
let activeCapsuleClient = null;
let activeStatusBar = null;
let activeAccountManager = null;

const LEGACY_CONFIG_KEYS = [
  "defaultTab",
  "statusBar.enabled",
  "statusBar.showCache",
  "statusBar.showSpeed",
  "statusBar.showQuota",
  "refreshIntervalSec",
  "defaultScope",
  "capsule.cacheWarnMin",
  "capsule.cacheColdMin",
  "capsule.queueWarnSec",
  "pluginPath",
  "nodePath"
];

/**
 * 首次升级至 agy-fusion-panel 时，自动将旧版 agyDartPanel.* 全局配置一次性迁移至 agyFusion.*。
 * @param {vscode.ExtensionContext} context
 * @param {{ log: (msg: string) => void }} logger
 * @param {typeof vscode} [vscodeApi]
 */
async function migrateLegacyConfiguration(context, logger, vscodeApi = vscode) {
  if (context.globalState.get("agyFusion.migratedFromLegacy")) {
    return 0;
  }

  const legacyCfg = vscodeApi.workspace.getConfiguration("agyDartPanel");
  const nextCfg = vscodeApi.workspace.getConfiguration("agyFusion");
  let migratedCount = 0;

  for (const key of LEGACY_CONFIG_KEYS) {
    try {
      const legacyInfo = legacyCfg.inspect?.(key);
      const nextInfo = nextCfg.inspect?.(key);
      if (
        legacyInfo &&
        legacyInfo.globalValue !== undefined &&
        (!nextInfo || nextInfo.globalValue === undefined)
      ) {
        await nextCfg.update(key, legacyInfo.globalValue, vscodeApi.ConfigurationTarget.Global);
        migratedCount++;
      }
    } catch {}
  }

  await context.globalState.update("agyFusion.migratedFromLegacy", true);
  if (migratedCount > 0) {
    logger.log(`[迁移] 已自动从旧版 agyDartPanel 迁移 ${migratedCount} 项用户配置至 agyFusion`);
  }
  return migratedCount;
}

/**
 * 首次升级至 v4.0.0 时，若用户之前处于旧默认 "ask"，自动升级为默认 "coldRestart"（若手动设为 auto/none 则保留）。
 * @param {vscode.ExtensionContext} context
 * @param {{ log: (msg: string) => void }} logger
 * @param {typeof vscode} [vscodeApi]
 */
async function migrateV4AccountConfig(context, logger, vscodeApi = vscode) {
  if (context.globalState.get("agyFusion.migratedV4ColdRestart")) {
    return false;
  }

  let upgraded = false;
  try {
    const cfg = vscodeApi.workspace.getConfiguration("agyFusion");
    const info = cfg.inspect?.("account.reloadAfterSwitch");
    if (info && info.globalValue === "ask") {
      await cfg.update("account.reloadAfterSwitch", "coldRestart", vscodeApi.ConfigurationTarget.Global);
      upgraded = true;
    }
  } catch {}

  await context.globalState.update("agyFusion.migratedV4ColdRestart", true);
  if (upgraded) {
    logger.log("[迁移] 已将切号策略从旧版弹窗确认升级为默认「冷重启 IDE 免引导弹窗」");
  }
  return upgraded;
}

/**
 * 扩展激活入口：装配 DART 后端代理、Capsule 遥测引擎、多账号一键切换、融合三页签视图与 5 枚状态栏微胶囊。
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("Antigravity Fusion Panel");
  const logger = {
    log(msg) {
      const ts = new Date().toLocaleTimeString();
      outputChannel.appendLine(`[${ts}] ${msg}`);
    },
    show() {
      outputChannel.show(true);
    }
  };

  const resolveNodePath = () => {
    const cfg = vscode.workspace.getConfiguration("agyFusion");
    return resolveSystemNodePath(cfg.get("nodePath", ""));
  };

  const resolveRuntime = () => {
    const cfg = vscode.workspace.getConfiguration("agyFusion");
    const workspacePaths = Array.isArray(vscode.workspace.workspaceFolders)
      ? vscode.workspace.workspaceFolders.map((f) => f.uri.fsPath)
      : [];

    const pluginRes = resolvePluginRoot({
      configuredPath: cfg.get("pluginPath", ""),
      workspacePaths
    });
    if (!pluginRes.ok) {
      return {
        ok: false,
        error: `未找到有效的 agy-dart 插件目录（已检查：${pluginRes.checkedPaths.join(" ; ")}）`
      };
    }

    const nodeRes = resolveNodePath();
    if (!nodeRes.ok) {
      return { ok: false, error: nodeRes.error };
    }

    return {
      ok: true,
      pluginRoot: pluginRes.pluginRoot,
      nodePath: nodeRes.nodePath,
      nodeVersion: nodeRes.version
    };
  };

  const backendClient = new AgyDartBackendClient({ resolveRuntime, logger });
  const capsuleClient = new CapsuleClient({ resolveNodePath, logger });
  activeBackendClient = backendClient;
  activeCapsuleClient = capsuleClient;

  let statusBar = null;
  let dashboard = null;

  const accountStore = new AccountStore({ context, logger });
  const accountManager = new AccountManager({
    store: accountStore,
    capsuleClient,
    resolveNodePath,
    logger,
    onAccountsChanged: () => {
      if (dashboard) dashboard.notifyAccountsChanged();
      if (statusBar) void statusBar.refreshNow();
    }
  });
  activeAccountManager = accountManager;

  dashboard = new DashboardController({
    context,
    backendClient,
    capsuleClient,
    accountManager,
    resolveRuntime,
    resolveNodePath,
    logger,
    onTelemetryMutated: () => {
      if (statusBar) void statusBar.refreshNow();
    }
  });

  statusBar = new StatusBarController({
    backendClient,
    capsuleClient,
    dashboardController: dashboard,
    accountManager,
    resolveRuntime,
    logger
  });
  activeStatusBar = statusBar;

  context.subscriptions.push(
    outputChannel,
    statusBar,
    {
      dispose() {
        accountManager.dispose();
        backendClient.dispose();
        capsuleClient.dispose();
      }
    },
    vscode.window.registerWebviewViewProvider("agyFusion.sidebarView", dashboard, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("agyFusion.focusSidebar", () => dashboard.focusSidebar()),
    vscode.commands.registerCommand("agyFusion.openTelemetryTab", () => dashboard.focusSidebar("capsule")),
    vscode.commands.registerCommand("agyFusion.openAccountsTab", () => dashboard.focusSidebar("accounts")),
    vscode.commands.registerCommand("agyFusion.openGuardTab", () => dashboard.focusSidebar("dart")),
    vscode.commands.registerCommand("agyFusion.openEditorTab", () => dashboard.openEditorTab()),
    vscode.commands.registerCommand("agyFusion.switchAccount", () =>
      accountManager.showQuickSwitchPicker(() => void dashboard.focusSidebar("accounts"))
    ),
    vscode.commands.registerCommand("agyFusion.switchAccountById", (accountId) => {
      if (typeof accountId === "string" && accountId.trim()) {
        return accountManager.switchAccount(accountId.trim());
      }
      return accountManager.showQuickSwitchPicker(() => void dashboard.focusSidebar("accounts"));
    }),
    vscode.commands.registerCommand("agyFusion.captureCurrentAccount", () =>
      accountManager.captureCurrentAccount({ silent: false })
    ),
    vscode.commands.registerCommand("agyFusion.addOAuthAccount", () =>
      accountManager.addAccountViaOfficialOAuth()
    ),
    vscode.commands.registerCommand("agyFusion.importExternalAccounts", () =>
      accountManager.importExternalAccounts()
    ),
    vscode.commands.registerCommand("agyFusion.healAccount", () =>
      accountManager.healActiveAccount()
    ),
    vscode.commands.registerCommand("agyFusion.refresh", () => {
      void dashboard.refreshAll();
      void statusBar.refreshNow();
    }),
    vscode.commands.registerCommand("agyFusion.togglePause", () => dashboard.togglePause()),
    vscode.commands.registerCommand("agyFusion.switchMode", () => dashboard.switchMode()),
    vscode.commands.registerCommand("agyFusion.runDoctor", () => dashboard.runDoctor()),
    vscode.commands.registerCommand("agyFusion.copyHandoffBrief", () => dashboard.copyHandoffBrief()),
    vscode.commands.registerCommand("agyFusion.openConfig", () => dashboard.openConfig()),
    vscode.commands.registerCommand("agyFusion.restartBackend", () => dashboard.restartBackend()),
    vscode.commands.registerCommand("agyFusion.showLogs", () => logger.show()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("agyFusion")) return;
      statusBar.applyConfiguration();
      if (e.affectsConfiguration("agyFusion.pluginPath") || e.affectsConfiguration("agyFusion.nodePath")) {
        void dashboard.restartBackend();
      } else if (e.affectsConfiguration("agyFusion.defaultScope") || e.affectsConfiguration("agyFusion.defaultTab")) {
        void dashboard.refreshAll({ reloadHtml: true });
      } else if (e.affectsConfiguration("agyFusion.account")) {
        dashboard.notifyAccountsChanged();
      }
    })
  );

  void migrateLegacyConfiguration(context, logger).then((count) => {
    if (count > 0) {
      statusBar.applyConfiguration();
      void dashboard.refreshAll({ reloadHtml: true });
    }
  });
  void migrateV4AccountConfig(context, logger);

  // 若旧版 agy-dart-ide-panel 仍处于安装状态，友好提示卸载命令避免状态栏重复
  try {
    if (
      !context.globalState.get("agyFusion.dismissedLegacyNotice") &&
      vscode.extensions?.getExtension?.("local.agy-dart-ide-panel")
    ) {
      void Promise.resolve(
        vscode.window.showInformationMessage(
          "检测到旧版扩展 local.agy-dart-ide-panel 已安装，它已被整合升级为「Antigravity 融合面板 (agy-fusion-panel)」。建议卸载旧版以免状态栏重复显示。",
          "复制卸载命令",
          "不再提示"
        )
      ).then((choice) => {
        if (choice === "复制卸载命令") {
          void vscode.env.clipboard.writeText("antigravity-ide --uninstall-extension local.agy-dart-ide-panel");
          void vscode.window.showInformationMessage("已复制卸载命令，在终端运行后重载窗口即可。");
        } else if (choice === "不再提示") {
          void context.globalState.update("agyFusion.dismissedLegacyNotice", true);
        }
      });
    }
  } catch {}

  let extVersion = "4.0.2";
  try {
    extVersion = require("../package.json").version || extVersion;
  } catch {}
  statusBar.applyConfiguration();
  logger.log(`Antigravity 融合面板 (v${extVersion}) 已激活`);
}

function deactivate() {
  if (activeAccountManager) {
    activeAccountManager.dispose();
    activeAccountManager = null;
  }
  if (activeStatusBar) {
    activeStatusBar.dispose();
    activeStatusBar = null;
  }
  if (activeBackendClient) {
    activeBackendClient.dispose();
    activeBackendClient = null;
  }
  if (activeCapsuleClient) {
    activeCapsuleClient.dispose();
    activeCapsuleClient = null;
  }
}

module.exports = {
  LEGACY_CONFIG_KEYS,
  migrateLegacyConfiguration,
  migrateV4AccountConfig,
  activate,
  deactivate
};
