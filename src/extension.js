"use strict";

const vscode = require("vscode");
const { resolvePluginRoot, resolveSystemNodePath } = require("./paths");
const { AgyDartBackendClient } = require("./backendClient");
const { CapsuleClient } = require("./capsuleClient");
const { DashboardController } = require("./dashboardController");
const { StatusBarController } = require("./statusBar");

let activeBackendClient = null;
let activeCapsuleClient = null;
let activeStatusBar = null;

/**
 * 扩展激活入口：装配 DART 后端代理、Capsule 遥测引擎、融合双页签视图与 3 枚状态栏微胶囊。
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("agy-dart");
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
    const cfg = vscode.workspace.getConfiguration("agyDartPanel");
    return resolveSystemNodePath(cfg.get("nodePath", ""));
  };

  const resolveRuntime = () => {
    const cfg = vscode.workspace.getConfiguration("agyDartPanel");
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
  const dashboard = new DashboardController({
    context,
    backendClient,
    capsuleClient,
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
    resolveRuntime,
    logger
  });
  activeStatusBar = statusBar;

  context.subscriptions.push(
    outputChannel,
    statusBar,
    {
      dispose() {
        backendClient.dispose();
        capsuleClient.dispose();
      }
    },
    vscode.window.registerWebviewViewProvider("agyDartPanel.sidebarView", dashboard, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("agyDartPanel.focusSidebar", () => dashboard.focusSidebar()),
    vscode.commands.registerCommand("agyDartPanel.openTelemetryTab", () => dashboard.focusSidebar("capsule")),
    vscode.commands.registerCommand("agyDartPanel.openGuardTab", () => dashboard.focusSidebar("dart")),
    vscode.commands.registerCommand("agyDartPanel.openEditorTab", () => dashboard.openEditorTab()),
    vscode.commands.registerCommand("agyDartPanel.refresh", () => {
      void dashboard.refreshAll();
      void statusBar.refreshNow();
    }),
    vscode.commands.registerCommand("agyDartPanel.togglePause", () => dashboard.togglePause()),
    vscode.commands.registerCommand("agyDartPanel.switchMode", () => dashboard.switchMode()),
    vscode.commands.registerCommand("agyDartPanel.runDoctor", () => dashboard.runDoctor()),
    vscode.commands.registerCommand("agyDartPanel.copyHandoffBrief", () => dashboard.copyHandoffBrief()),
    vscode.commands.registerCommand("agyDartPanel.openConfig", () => dashboard.openConfig()),
    vscode.commands.registerCommand("agyDartPanel.restartBackend", () => dashboard.restartBackend()),
    vscode.commands.registerCommand("agyDartPanel.showLogs", () => logger.show()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("agyDartPanel")) return;
      statusBar.applyConfiguration();
      if (e.affectsConfiguration("agyDartPanel.pluginPath") || e.affectsConfiguration("agyDartPanel.nodePath")) {
        void dashboard.restartBackend();
      } else if (e.affectsConfiguration("agyDartPanel.defaultScope") || e.affectsConfiguration("agyDartPanel.defaultTab")) {
        void dashboard.refreshAll({ reloadHtml: true });
      }
    })
  );

  let extVersion = "2.0.1";
  try {
    extVersion = require("../package.json").version || extVersion;
  } catch {}
  statusBar.applyConfiguration();
  logger.log(`agy-dart 融合控制台扩展 (v${extVersion}) 已激活`);
}

function deactivate() {
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
  activate,
  deactivate
};
