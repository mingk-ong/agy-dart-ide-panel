"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const {
  resolvePluginRoot,
  resolveSystemNodePath,
  parseNodeMajor,
  readSelectedAgentModelId
} = require("../src/paths");
const { isSafeConversationId, listRecentConversations, getLatestConversationId } = require("../src/conversations");
const { AgyDartBackendClient } = require("../src/backendClient");
const { CapsuleClient } = require("../src/capsuleClient");
const { getCapsuleClientScript } = require("../src/capsuleUi");
const { matchQuotaGroup, formatQuotaPoolShortName } = require("../src/quotaMatcher");
const { rewriteSyncDialogsInScript, buildDashboardHtml, buildUnavailableHtml } = require("../src/htmlBuilder");
const { packageVsix, RUNTIME_FILES } = require("../scripts/package-vsix");

test("paths: 正确探测全局已安装的 agy-dart 与系统 Node.js (>=22)", () => {
  const pluginRes = resolvePluginRoot();
  assert.equal(pluginRes.ok, true);
  assert.equal(pluginRes.source, "global");
  assert.ok(fs.existsSync(path.join(pluginRes.pluginRoot, "sidecars", "dashboard", "server.mjs")));

  const nodeRes = resolveSystemNodePath();
  assert.equal(nodeRes.ok, true);
  assert.ok(parseNodeMajor(nodeRes.version) >= 22);
  assert.ok(fs.existsSync(nodeRes.nodePath));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-state-pbtxt-"));
  try {
    const pbFile = path.join(tmpDir, "antigravity_state.pbtxt");
    fs.writeFileSync(pbFile, "agent_onboarding_completed: true\nlast_selected_agent_model: MODEL_PLACEHOLDER_M418\n", "utf8");
    const parsed = readSelectedAgentModelId([pbFile]);
    assert.equal(parsed.modelId, "MODEL_PLACEHOLDER_M418");
    assert.equal(parsed.filePath, pbFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("conversations: 安全校验与活跃对话列表读取", () => {
  assert.equal(isSafeConversationId("../etc"), false);
  assert.equal(isSafeConversationId("tempmediaStorage"), false);
  assert.equal(isSafeConversationId("d2619f79-36cb-4174-91fd-a9b8dd8f9b91"), true);

  const tmpBrain = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ide-panel-brain-"));
  try {
    const convA = path.join(tmpBrain, "11111111-1111-1111-1111-111111111111", ".system_generated", "logs");
    fs.mkdirSync(convA, { recursive: true });
    fs.writeFileSync(
      path.join(convA, "transcript.jsonl"),
      JSON.stringify({
        type: "USER_INPUT",
        content: "<USER_REQUEST>\n测试对话标题提取 $$100\n</USER_REQUEST>"
      }) + "\n",
      "utf8"
    );

    const list = listRecentConversations({ brainRoots: [tmpBrain], limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "11111111-1111-1111-1111-111111111111");
    assert.ok(list[0].title.includes("测试对话标题提取"));
    assert.equal(getLatestConversationId({ brainRoots: [tmpBrain] }), "11111111-1111-1111-1111-111111111111");
  } finally {
    fs.rmSync(tmpBrain, { recursive: true, force: true });
  }
});

test("htmlBuilder: 词法安全改写 confirm/alert 且全部脚本通过语法解析", () => {
  const sample = [
    `function esc(s) { return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }`,
    `const msg = "don't alert(1) or confirm(2)";`,
    `async function act() { if (!confirm(t('ask', { n: 1 }))) return; alert(t('err')); }`
  ].join("\n");

  const rewritten = rewriteSyncDialogsInScript(sample);
  assert.ok(rewritten.includes("await window.__agyIdeBridge.confirm(t('ask', { n: 1 }))"));
  assert.ok(rewritten.includes("window.__agyIdeBridge.alert(t('err'))"));
  assert.ok(rewritten.includes(`"don't alert(1) or confirm(2)"`));
  assert.doesNotThrow(() => new Function(rewritten));
});

test("capsuleClient 端到端: 真实拉起 capsuleWorker 读取本机对话库、配额与用量历史", async () => {
  const capsule = new CapsuleClient({
    resolveNodePath: () => resolveSystemNodePath(),
    logger: { log() {} }
  });

  try {
    const snap = await capsule.inspectConversation("");
    assert.equal(snap.found, true);
    assert.ok(snap.conversationId.length > 0);
    assert.ok(typeof snap.contextTokens === "number");
    assert.ok(typeof snap.maxContextTokens === "number");
    assert.ok(typeof snap.turn0Tokens === "number");
    assert.ok(snap.generation && "tps" in snap.generation);
    assert.ok(snap.requestError && typeof snap.requestError.kind === "string");

    const quota = await capsule.getQuota(true);
    assert.equal(typeof quota.ok, "boolean");
    assert.ok(Array.isArray(quota.quotaGroups));
    assert.equal(typeof quota.selectedModelId, "string");
    assert.equal(typeof quota.selectedModelLabel, "string");

    const usage = await capsule.getUsageHistory(snap.conversationId);
    assert.ok(Array.isArray(usage.days));
    assert.ok(usage.undated && typeof usage.undated.requests === "number");
    assert.ok(usage.scannedFiles >= 1);

    // 验证名副其实的 5 档分组柱状图 RPC：5h(每柱5h×6) / 日(每柱1天×7) / 3日(每柱3天×6) / 周(每柱1周×6) / 月(每柱1月×6) + 全库对话选项
    const aDay = await capsule.queryUsageAnalytics({
      activeConversationId: snap.conversationId,
      scope: "conversation",
      period: "day"
    });
    assert.equal(aDay.scope, "conversation");
    assert.equal(aDay.kpis.mode, "conversation");
    assert.equal(aDay.bars.length, 7, "日标签应按每柱1天展示7柱");
    assert.equal(aDay.bars[1].fromMs - aDay.bars[0].fromMs, 24 * 3600_000);
    assert.equal(typeof aDay.latestActiveAtMs, "number");
    assert.equal(typeof aDay.latestActiveDay, "string");
    assert.equal(typeof aDay.scopedTotalRequests, "number");
    assert.ok(Array.isArray(aDay.conversationOptions), "应返回全库对话下拉选项列表");

    const a5h = await capsule.queryUsageAnalytics({ activeConversationId: snap.conversationId, scope: "all", period: "5h" });
    assert.equal(a5h.bars.length, 6, "5h标签应按每柱5小时展示6柱");
    assert.equal(a5h.bars[0].toMs - a5h.bars[0].fromMs, 5 * 3600_000, "每柱应严格为5小时");

    const a3d = await capsule.queryUsageAnalytics({ activeConversationId: snap.conversationId, scope: "all", period: "3d" });
    assert.equal(a3d.bars.length, 6, "3日标签应按每柱3天展示6柱");
    assert.equal(a3d.bars[0].toMs - a3d.bars[0].fromMs, 3 * 24 * 3600_000, "每柱应严格为3天");

    const aWk = await capsule.queryUsageAnalytics({ activeConversationId: snap.conversationId, scope: "all", period: "week" });
    assert.equal(aWk.bars.length, 6, "周标签应按每柱1自然周展示6柱");
    assert.equal(aWk.bars[0].toMs - aWk.bars[0].fromMs, 7 * 24 * 3600_000, "每柱应严格为7天自然周");

    // 验证 week 模式传入历史 anchorDate 时精准对齐至包含该日的周一–周日自然周（作为末柱）
    const aWkAnchored = await capsule.queryUsageAnalytics({
      activeConversationId: snap.conversationId,
      scope: "all",
      period: "week",
      anchorDate: "2026-11-11"
    });
    assert.equal(aWkAnchored.bars.length, 6);
    assert.equal(aWkAnchored.bars[5].weekStartStr, "2026-11-09", "周三锚点应自动对齐到周一 2026-11-09");
    assert.equal(aWkAnchored.bars[5].dayStr, "2026-11-15", "末柱周日应为 2026-11-15");
    assert.equal(aWkAnchored.canNext, true);
    assert.equal(aWkAnchored.isLatest, false);

    const aMo = await capsule.queryUsageAnalytics({ activeConversationId: snap.conversationId, scope: "all", period: "month" });
    assert.equal(aMo.bars.length, 6, "月标签应按每柱1自然月展示6柱");
    assert.equal(aMo.kpis.mode, "all");
    assert.ok(aMo.kpis.today && aMo.kpis.week && aMo.kpis.month && aMo.kpis.all);
    assert.ok(Array.isArray(aMo.conversationOptions));
    if (aMo.conversationOptions.length > 0) {
      assert.ok(aMo.conversationOptions[0].conversationId);
      assert.ok(aMo.conversationOptions[0].title);
      assert.ok(typeof aMo.conversationOptions[0].net === "number");
    }
  } finally {
    capsule.dispose();
  }
  assert.equal(capsule.isRunning(), false);
});

test("backendClient & htmlBuilder 融合双页签端到端: 真实托管 server.mjs 与降级模式全部通过语法校验", async () => {
  const pluginRes = resolvePluginRoot();
  const nodeRes = resolveSystemNodePath();
  assert.equal(pluginRes.ok, true);
  assert.equal(nodeRes.ok, true);

  const client = new AgyDartBackendClient({
    resolveRuntime: () => ({ ok: true, pluginRoot: pluginRes.pluginRoot, nodePath: nodeRes.nodePath }),
    logger: { log() {} }
  });

  try {
    const info = await client.ensureStarted();
    assert.ok(info.port > 0);
    assert.ok(info.csrfToken.length >= 16);

    const stats = await client.requestApi("/api/stats", "POST", { scope: "lifetime" });
    assert.equal(stats.ok, true);
    assert.equal(stats.status, 200);

    // 校验 agy-dart v1.7.8 新增二级路由白名单与 Stall Watchdog 端点可达
    assert.equal(AgyDartBackendClient.validateApiPath("/api/watchdog/action"), "/api/watchdog/action");
    assert.throws(() => AgyDartBackendClient.validateApiPath("/api/../etc"), /非法 API 路径/);
    const wd = await client.requestApi("/api/watchdog", "POST", { conversationId: "test-conv-123" });
    assert.equal(wd.ok, true, "v1.7.8 /api/watchdog 应返回 200 OK");

    const rawHtml = await client.fetchDashboardHtml();
    const baseState = {
      lang: "zh",
      activeTab: "capsule",
      defaultScope: "conversation",
      selectionMode: "auto",
      resolvedConversationId: "test-conv-123",
      conversations: [{ id: "test-conv-123", title: "测试标题 $$100 $&", updatedLabel: "12:00" }],
      capsulePrefs: { cacheWarnMin: 3, cacheColdMin: 4, queueWarnSec: 30 }
    };

    for (const mode of ["sidebar", "editor"]) {
      const converted = buildDashboardHtml({
        rawHtml,
        mode,
        initialState: baseState
      });

      assert.equal(converted.includes('/preload.js'), false, "应移除 /preload.js");
      assert.ok(converted.includes('http-equiv="Content-Security-Policy"'));
      assert.ok(converted.includes(`data-ide-mode="${mode}"`));
      assert.ok(converted.includes('data-active-tab="capsule"'));
      assert.ok(converted.includes('id="ide-conv-select"'));
      assert.ok(converted.includes('id="ide-pane-capsule"'));
      assert.ok(converted.includes('id="ide-pane-accounts"'));
      assert.ok(converted.includes('id="ide-tab-btn-accounts"'));
      assert.ok(converted.includes('id="ide-dart-pane"'));
      assert.ok(converted.includes("window.__agyCapsuleUi"));
      assert.ok(converted.includes("window.__agyAccountUi"));
      assert.ok(converted.includes("window.__agyIdeBridge"));

      // 校验顶栏层级：主页签置于最顶上，护栏专属标题与「模式/体检/配置」收进 dart-only-section
      const tabsIdx = converted.indexOf('class="ide-main-tabs"');
      const convIdx = converted.indexOf('id="ide-conv-select"');
      const dartHeadIdx = converted.indexOf('class="ide-dart-header dart-only-section"');
      const brandIdx = converted.indexOf('class="brand-group"');
      const modeBtnIdx = converted.indexOf("runCommand('switchMode')");
      assert.ok(tabsIdx > 0 && convIdx > tabsIdx, "主页签应位于全局对话栏与一切内容的最顶上");
      assert.ok(dartHeadIdx > convIdx && brandIdx > dartHeadIdx && modeBtnIdx > dartHeadIdx, "护栏标题与模式/体检/配置按钮应归属护栏专属区 dart-only-section");
      assert.ok(converted.indexOf('id="lang-zh-btn"') > convIdx && converted.indexOf('id="lang-zh-btn"') < dartHeadIdx, "双语切换与刷新按钮应留在全局工具栏中");

      // 校验 agy-dart v1.7.8 新增头部控件（保活控制组、启停按钮、版本检测与更新横幅）完整保留并归入护栏专属区
      assert.ok(converted.includes('class="ide-dart-pills dart-only-section"'), "应完整保留 v1.7.8 .topbar-pills 护栏状态与保活控件");
      assert.ok(converted.includes('id="toggle-active-btn"'), "应保留护栏启停按钮");
      assert.ok(converted.includes('id="kv-keepalive-btn"'), "应保留 Auto-Keepalive 保活开关");
      assert.ok(converted.includes('id="version-check-btn"'), "应保留版本更新检查按钮");
      assert.ok(/<div\b[^>]*\bid="scope-switcher-row"[^>]*dart-only-section/i.test(converted), "scope 行应归入 dart-only-section");
      assert.ok(/<div\b[^>]*\bid="telemetry-banner"[^>]*dart-only-section/i.test(converted), "telemetry 横幅应归入 dart-only-section");
      assert.ok(/<div\b[^>]*\bid="version-update-banner"[^>]*dart-only-section/i.test(converted), "版本更新横幅应归入 dart-only-section");
      assert.ok(converted.includes("window.__agyIdeApplyHostLang"), "应采用防签名冲突的语言桥接以兼容 v1.7.8 setLanguage(lang, syncServer)");
      assert.ok(converted.includes("toggleConversation("), "window.sidecar.ui 应桥接点击会话跳转");

      const scripts = [];
      converted.replace(/<script>([\s\S]*?)<\/script>/gi, (_, code) => {
        scripts.push(code);
        return "";
      });
      assert.equal(scripts.length, 5, "应包含前置桥接、DART 主脚本、Capsule 脚本、账号脚本、后置联动脚本共 5 段");

      for (let idx = 0; idx < scripts.length; idx++) {
        assert.doesNotThrow(
          () => new Function(scripts[idx]),
          `第 ${idx + 1} 段脚本存在语法错误`
        );
      }

      const mainScript = scripts[1];
      assert.equal(/(?<![\w.$])confirm\s*\(/.test(mainScript.replace(/window\.__agyIdeBridge\.confirm/g, "")), false);
      assert.equal(/(?<![\w.$])alert\s*\(/.test(mainScript.replace(/window\.__agyIdeBridge\.alert/g, "")), false);
    }

    // 校验历史用量折叠面板的 SSR 展开状态记忆
    const collapsedHtml = buildDashboardHtml({
      rawHtml,
      mode: "sidebar",
      initialState: { ...baseState, capsuleUiState: { usageOpen: false, heatScale: "day", modelPeriod: "day" } }
    });
    assert.ok(collapsedHtml.includes('<details id="cap-usage-accordion" class="accordion-band">'));

    const expandedHtml = buildDashboardHtml({
      rawHtml,
      mode: "sidebar",
      initialState: { ...baseState, capsuleUiState: { usageOpen: true, heatScale: "week", modelPeriod: "month" } }
    });
    assert.ok(expandedHtml.includes('<details id="cap-usage-accordion" class="accordion-band" open>'));

    // 校验当 agy-dart 未安装时的降级三页签外壳也能正常解析全部脚本
    const fallbackHtml = buildDashboardHtml({
      rawHtml: "",
      dartUnavailableReason: "未找到插件",
      mode: "sidebar",
      initialState: baseState
    });
    assert.ok(fallbackHtml.includes('id="ide-pane-capsule"'));
    assert.ok(fallbackHtml.includes('id="ide-pane-accounts"'));
    assert.ok(fallbackHtml.includes("未找到插件"));
    const fbScripts = [];
    fallbackHtml.replace(/<script>([\s\S]*?)<\/script>/gi, (_, code) => {
      fbScripts.push(code);
      return "";
    });
    assert.equal(fbScripts.length, 4);
    for (const sc of fbScripts) {
      assert.doesNotThrow(() => new Function(sc));
    }

    const unavail = buildUnavailableHtml({ title: "测试标题", reason: "测试原因", details: "err" });
    assert.ok(unavail.includes("测试标题"));
  } finally {
    client.dispose();
  }
  assert.equal(client.isRunning(), false);
});

test("capsuleUi 运行时: 正确保留正则反斜杠并渲染按模型系列统计与本机历史数据", async () => {
  const scriptHtml = getCapsuleClientScript();
  assert.ok(scriptHtml.includes("replace(/^models\\//i, '')"), "应完整保留 /^models\\//i 正则");
  assert.ok(scriptHtml.includes("\\s*"), "应保留 \\s 转义");
  assert.ok(scriptHtml.includes("\\(") && scriptHtml.includes("\\)"), "应保留括号转义");
  assert.equal(scriptHtml.includes("/^models//i"), false, "不应出现被模板字符串吞掉反斜杠的 /^models//i");

  const code = scriptHtml.replace(/^<script>/, "").replace(/<\/script>$/, "");
  assert.doesNotThrow(() => new Function(code));

  const elements = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = new Set();
  const consoleErrors = [];

  const getEl = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      const listeners = new Map();
      elements.set(id, {
        id,
        textContent: "",
        innerHTML: "",
        value: "",
        disabled: false,
        open: id === "cap-usage-accordion" ? false : true,
        scrollLeft: 0,
        scrollWidth: 120,
        style: {},
        className: "",
        _attrs: {},
        _listeners: listeners,
        setAttribute(k, v) {
          this._attrs[k] = String(v);
        },
        getAttribute(k) {
          return this._attrs[k] ?? null;
        },
        classList: {
          add(...names) {
            for (const n of names) classes.add(n);
          },
          remove(...names) {
            for (const n of names) classes.delete(n);
          },
          contains(n) {
            return classes.has(n);
          }
        },
        addEventListener(ev, fn) {
          if (!listeners.has(ev)) listeners.set(ev, []);
          listeners.get(ev).push(fn);
        },
        dispatch(ev) {
          for (const fn of listeners.get(ev) || []) {
            fn({ type: ev, target: this });
          }
        }
      });
    }
    return elements.get(id);
  };

  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const localDayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const yest = new Date(now.getTime() - 86400000);
  const yestStr = `${yest.getFullYear()}-${pad2(yest.getMonth() + 1)}-${pad2(yest.getDate())}`;

  const queryCalls = [];
  let customAnalyticsOverride = null;

  function buildMockAnalytics(params = {}) {
    if (customAnalyticsOverride) return customAnalyticsOverride;
    const period = params.period || "day";
    const scope = params.scope === "all" ? "all" : "conversation";
    const mFlashH = { name: "Gemini 3.8 Flash (High)", requests: 2, uncached: 800, cacheRead: 6000, cacheWrite: 0, output: 200, net: 1000, total: 7000 };
    const mFlashM = { name: "Gemini 3.8 Flash (Medium)", requests: 1, uncached: 500, cacheRead: 5000, cacheWrite: 0, output: 200, net: 700, total: 5700 };
    const mClaude1 = { name: "Claude Opus 4.6 (Thinking)", requests: 1, uncached: 900, cacheRead: 8000, cacheWrite: 0, output: 300, net: 1200, total: 9200 };
    const mClaude2 = { name: "claude-opus-4-6-thinking", requests: 1, uncached: 600, cacheRead: 4000, cacheWrite: 0, output: 200, net: 800, total: 4800 };
    const mArgon = { name: "Gemini 4 Argon (Medium)", requests: 2, uncached: 1000, cacheRead: 3000, cacheWrite: 0, output: 500, net: 1500, total: 4500 };

    const barConfigs = period === "3d"
      ? [
          { label: "前天", name: "2026-11-20", dayStr: "2026-11-20", drillable: true, drillTarget: "day", models: [mFlashH] },
          { label: "昨天", name: yestStr, dayStr: yestStr, drillable: true, drillTarget: "day", models: [mFlashM, mArgon] },
          { label: "今天", name: localDayStr, dayStr: localDayStr, drillable: true, drillTarget: "day", models: [mClaude1, mClaude2] }
        ]
      : [
          { label: "08", name: `${localDayStr} 08:00–10:00`, dayStr: localDayStr, drillable: true, drillTarget: "5h", drillAnchorMs: Date.now() - 3600_000, models: [mFlashH, mFlashM] },
          { label: "10", name: `${localDayStr} 10:00–12:00`, dayStr: localDayStr, drillable: true, drillTarget: "5h", drillAnchorMs: Date.now(), models: [mClaude1, mClaude2, mArgon] },
          { label: "12", name: `${localDayStr} 12:00–14:00`, dayStr: localDayStr, drillable: true, drillTarget: "5h", drillAnchorMs: Date.now(), models: [] }
        ];

    const bars = barConfigs.map((b) => {
      const reqs = b.models.reduce((s, m) => s + m.requests, 0);
      const unc = b.models.reduce((s, m) => s + m.uncached, 0);
      const cr = b.models.reduce((s, m) => s + m.cacheRead, 0);
      const cw = b.models.reduce((s, m) => s + m.cacheWrite, 0);
      const out = b.models.reduce((s, m) => s + m.output, 0);
      return { ...b, requests: reqs, uncached: unc, cacheRead: cr, cacheWrite: cw, output: out, net: unc + cw + out, total: unc + cr + cw + out };
    });

    const convs = [
      {
        conversationId: "conv-test",
        title: "当前测试会话",
        isCurrentActive: true,
        isSelected: true,
        lastAtMs: Date.now(),
        requests: 5,
        uncached: 3300,
        cacheRead: 21000,
        cacheWrite: 0,
        output: 1100,
        net: 4400,
        total: 25400,
        cacheHitPct: 86,
        models: [mArgon, mClaude1, mFlashH]
      },
      {
        conversationId: "conv-other-1",
        title: "历史重构任务会话",
        isCurrentActive: false,
        isSelected: false,
        lastAtMs: Date.now() - 3600_000,
        requests: 2,
        uncached: 500,
        cacheRead: 5000,
        cacheWrite: 0,
        output: 300,
        net: 800,
        total: 5800,
        cacheHitPct: 91,
        models: [mFlashM]
      }
    ];

    return {
      scope,
      conversationId: params.conversationId || "conv-test",
      conversationTitle: params.conversationId === "conv-other-1" ? "历史重构任务会话" : "当前测试会话",
      activeConversationId: "conv-test",
      period,
      shift: params.shift || 0,
      rangeLabel: params.anchorDate || (period === "3d" ? `${yestStr} – ${localDayStr.slice(5)}` : localDayStr),
      canPrev: true,
      canNext: Boolean(params.anchorDate),
      isLatest: !params.anchorDate && !(params.shift < 0),
      kpis: scope === "conversation"
        ? { mode: "conversation", conversationId: params.conversationId || "conv-test", title: "当前测试会话", requests: 7, uncached: 3800, cacheRead: 26000, cacheWrite: 0, output: 1400, net: 5200, total: 31200, cacheHitPct: 87 }
        : {
            mode: "all",
            today: { requests: 7, uncached: 3800, cacheRead: 26000, cacheWrite: 0, output: 1400, net: 5200, total: 31200 },
            week: { requests: 12, uncached: 6000, cacheRead: 40000, cacheWrite: 0, output: 2000, net: 8000, total: 48000 },
            month: { requests: 20, uncached: 10000, cacheRead: 70000, cacheWrite: 0, output: 4000, net: 14000, total: 84000 },
            all: { requests: 30, uncached: 15000, cacheRead: 95000, cacheWrite: 0, output: 6000, net: 21000, total: 116000 }
          },
      bars,
      conversations: convs,
      heatmapDays: [
        { date: yestStr, requests: 3, net: 2200, total: 10200 },
        { date: localDayStr, requests: 4, net: 3000, total: 21000 }
      ],
      sinceDate: yestStr,
      unread: 0,
      scannedFiles: 6
    };
  }

  let currentInspectPayload = {
    found: true,
    conversationId: "conv-test",
    activeModel: "Gemini 3.8 Flash (High)",
    contextTokens: 10000,
    maxContextTokens: 100000,
    cachedIn: 8000,
    turn0Tokens: 2000,
    totalOutputTokens: 500,
    totalThinkingTokens: 300,
    requestError: { kind: "none" },
    turnMetrics: { state: "completed", requestCount: 1, thinking: 300, write: 500 },
    generation: { ttft: 0.5, streaming: 1.0, duration: 1.5, output: 500, tps: 333.3 }
  };

  let currentQuotaPayload = {
    ok: true,
    quotaGroups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash",
        buckets: [{ window: "5h", remainingFraction: 0.89 }, { window: "weekly", remainingFraction: 0.96 }]
      },
      {
        displayName: "Claude and GPT models",
        description: "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B",
        buckets: [{ window: "5h", remainingFraction: 1 }, { window: "weekly", remainingFraction: 1 }]
      },
      {
        displayName: "Gemini 4 Argon",
        description: "For paid Pro plans, Argon quota is separate.",
        buckets: [{ window: "weekly", remainingFraction: 1 }]
      }
    ],
    userTierName: "Pro",
    defaultModelLabel: "Gemini 4 Neon (High)"
  };

  const savedUiStates = [];
  const sandboxWindow = {
    __AGY_IDE_INIT__: { capsulePrefs: { cacheWarnMin: 3, cacheColdMin: 4, queueWarnSec: 30 } },
    __AGY_IDE_STATE__: { lang: "zh", activeTab: "capsule", resolvedConversationId: "conv-test" },
    __agyIdeBridge: {
      async capsuleCall(type, payload) {
        if (type === "capsuleInspect") {
          return { ok: true, data: currentInspectPayload };
        }
        if (type === "capsuleQuota") {
          return { ok: true, data: currentQuotaPayload };
        }
        if (type === "capsuleUsageQuery") {
          queryCalls.push(payload || {});
          return { ok: true, data: buildMockAnalytics(payload) };
        }
        throw new Error(`Unexpected call: ${type}`);
      },
      saveCapsulePrefs() {},
      saveCapsuleUiState(patch) {
        savedUiStates.push({ ...patch });
      }
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    }
  };

  const sandboxDocument = {
    querySelectorAll() {
      return [];
    },
    getElementById: getEl,
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    }
  };

  const sandbox = {
    window: sandboxWindow,
    document: sandboxDocument,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    JSON,
    Promise,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isFinite,
    console: {
      log() {},
      warn() {},
      error(...args) {
        consoleErrors.push(args.map((a) => String(a)).join(" "));
      }
    },
    setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      timers.add(id);
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
      clearInterval(id);
    }
  };
  sandboxWindow.window = sandboxWindow;
  sandbox.self = sandboxWindow;

  const capsule = new CapsuleClient({
    resolveNodePath: () => resolveSystemNodePath(),
    logger: { log() {} }
  });

  try {
    vm.runInNewContext(code, sandbox);

    for (const fn of docListeners.get("DOMContentLoaded") || []) {
      fn();
    }
    await sandboxWindow.__agyCapsuleUi.refreshAll(true);
    await sandboxWindow.__agyCapsuleUi.loadUsage(true);

    assert.equal(consoleErrors.length, 0, `不应产生运行时错误: ${consoleErrors.join("; ")}`);
    assert.equal(getEl("cap-usage-badge").textContent, "6 DB");
    assert.equal(getEl("cap-heat-accordion").open, false, "热力图次级折叠应默认收起");
    assert.equal(queryCalls.at(-1).scope, "conversation", "默认应先统计当前对话");
    assert.ok(getEl("cap-bars-range").textContent.includes(localDayStr));
    assert.ok(getEl("cap-bars-total").textContent.includes("5.2K"));

    const totalsHtml = getEl("cap-usage-totals").innerHTML;
    assert.equal(totalsHtml.includes("\\n"), false, "totals tooltip 不应出现字面量 \\\\n");
    assert.ok(totalsHtml.includes("净耗") && totalsHtml.includes("命中率"), "当前对话 KPI 应展示净耗与命中率");

    const barsHtml = getEl("cap-bars-chart").innerHTML;
    assert.ok(barsHtml.includes("cap-bar-col"), "应渲染柱状图列");
    assert.ok(barsHtml.includes("cap-bar-stack"), "应渲染堆叠柱块");
    assert.equal(barsHtml.includes("\\n"), false, "bars tooltip 不应出现字面量 \\\\n");
    assert.ok(barsHtml.includes("\n"), "bars tooltip 应包含真实换行");

    // 1. 按配额池分组模型统计 + 系列合并检查
    const rowsHtml = getEl("cap-model-rows").innerHTML;
    assert.ok(rowsHtml.includes("cap-pool-section"), "默认应按配额池分组展示");
    assert.ok(rowsHtml.includes("Gemini 池"), "应包含 Gemini 池");
    assert.ok(rowsHtml.includes("Claude/GPT 池"), "应包含 Claude/GPT 池");
    assert.ok(rowsHtml.includes("Argon 池"), "应包含 Argon 池");
    assert.ok(rowsHtml.includes("Gemini 3.8 Flash"), "应合并高低档位并显示 Gemini 3.8 Flash");
    assert.ok(rowsHtml.includes("Claude Opus 4.6"), "应将 slug 与显示名合并为 Claude Opus 4.6");
    assert.ok(rowsHtml.includes("Gemini 4 Argon"), "应显示 Argon 系列");

    // 2. 切换指标口径（总量 / 次数）
    sandboxWindow.__agyCapsuleUi.setUsageMetric("total");
    assert.ok(getEl("cap-bars-total").textContent.includes("31.2K"), "切换总量口径后应立即更新合计");
    sandboxWindow.__agyCapsuleUi.setUsageMetric("requests");
    assert.ok(getEl("cap-bars-total").textContent.includes("7 次请求"), "切换次数口径后应展示请求总数");
    sandboxWindow.__agyCapsuleUi.setUsageMetric("net");

    // 3. 单击柱子筛选时段（常驻详情栏无抖动更新、取消双击）、展开模型四维详情、聚焦模型高亮且无多余取消聚焦文字提示
    assert.equal(barsHtml.includes("ondblclick="), false, "柱状图应彻底取消双击下钻");
    assert.equal(barsHtml.includes("onmouseenter="), false, "柱状图不应启用悬停实时预览");
    assert.equal((barsHtml.match(/class="cap-bar-x"/g) || []).length, 3, "每根柱子下方都应展示对应的时间简写");

    sandboxWindow.__agyCapsuleUi.toggleBarSelect(0);
    assert.ok(getEl("cap-bars-chart").innerHTML.includes("is-selected"), "选中柱子应高亮");
    assert.equal(getEl("cap-model-rows").innerHTML.includes("Claude Opus 4.6"), false, "选中第 0 柱后不应再含其他柱的模型");
    assert.ok(getEl("cap-bar-detail-bar").className.includes("is-active"), "常驻柱详情标题栏应切换为选中态");
    assert.ok(getEl("cap-bar-detail-bar").innerHTML.includes("进入 5h"), "常驻详情栏应提供显式细化按钮");
    assert.equal(getEl("cap-bar-detail-bar").innerHTML.includes("取消聚焦"), false, "不应出现多余的取消聚焦文字提示");
    sandboxWindow.__agyCapsuleUi.clearBarSelect();
    assert.equal(getEl("cap-bar-detail-bar").className, "cap-bar-detail-bar", "取消选中后常驻详情栏恢复静默态且占位不变");

    sandboxWindow.__agyCapsuleUi.toggleFocusModel("gemini-4-argon");
    assert.ok(getEl("cap-bars-chart").innerHTML.includes("cap-bar-seg is-dimmed"), "聚焦模型应反向淡化柱内其他模型段");
    assert.ok(getEl("cap-model-rows").innerHTML.includes("cap-model-row is-focused"), "被聚焦的模型行应高亮");
    sandboxWindow.__agyCapsuleUi.clearFocusModel();

    sandboxWindow.__agyCapsuleUi.toggleExpandModel("claude-opus-4-6");
    assert.ok(getEl("cap-model-rows").innerHTML.includes("cap-model-detail"), "展开模型应显示四维 Token 与思考档位明细");

    // 4. 切换 3日 视图与通过详情栏按钮下钻
    await sandboxWindow.__agyCapsuleUi.setModelPeriod("3d");
    assert.equal(queryCalls.at(-1).period, "3d");
    await sandboxWindow.__agyCapsuleUi.drillBar(1);
    assert.equal(queryCalls.at(-1).period, "day", "点击下钻按钮应下钻到日视图");
    assert.equal(queryCalls.at(-1).anchorDate, yestStr);

    // 5. 统一双处对话选择器双向同步切换（当前对话 / 全部对话 / 指定具体历史对话） + 热力图跳单日
    await sandboxWindow.__agyCapsuleUi.onUsageScopeSelect("conv:conv-other-1");
    assert.equal(queryCalls.at(-1).scope, "conversation");
    assert.equal(queryCalls.at(-1).conversationId, "conv-other-1");
    assert.equal(getEl("cap-scope-select-top").value, "conv:conv-other-1", "顶部对话选择器应同步选中该具体对话");
    assert.equal(getEl("cap-scope-select-model").value, "conv:conv-other-1", "模型区对话选择器应同步选中同一具体对话");

    await sandboxWindow.__agyCapsuleUi.jumpToDate(yestStr);
    assert.equal(queryCalls.at(-1).anchorDate, yestStr);

    // 6. 接着喂入本机真实对话库扫描结果，确认真实数据零报错渲染
    customAnalyticsOverride = await capsule.queryUsageAnalytics({ activeConversationId: "", scope: "all", period: "month" });
    await sandboxWindow.__agyCapsuleUi.setUsageScope("all");
    assert.equal(consoleErrors.length, 0, `真实数据渲染不应报错: ${consoleErrors.join("; ")}`);
    assert.equal(getEl("cap-usage-badge").textContent, `${customAnalyticsOverride.scannedFiles} DB`);

    // 7. 测试侧边栏配额卡片对 Orchestrator (Argon) 唯一高亮 Gemini 4 Argon 池
    customAnalyticsOverride = null;
    currentInspectPayload = { ...currentInspectPayload, activeModel: "Orchestrator (Argon)" };
    await sandboxWindow.__agyCapsuleUi.refreshAll(true);
    const quotaHtml = getEl("cap-quota-list").innerHTML;
    assert.equal((quotaHtml.match(/cap-quota-group is-current/g) || []).length, 1, "侧边栏应仅高亮 1 个配额池");
    assert.ok(
      quotaHtml.includes('<div class="cap-quota-group is-current"><div class="cap-quota-head"><span>Gemini 4 Argon</span>'),
      "Orchestrator (Argon) 应精确高亮 Gemini 4 Argon 池"
    );

    // 当对话历史还是 Gemini 3.8 Flash，但用户在模型选择器中刚切换为 Claude Opus 5.5 (尚未开始新对话) 时，侧边栏立即切换高亮到 Claude 池
    currentInspectPayload = { ...currentInspectPayload, activeModel: "Gemini 3.8 Flash (High)" };
    currentQuotaPayload = { ...currentQuotaPayload, selectedModelLabel: "Claude Opus 5.5 (High)" };
    await sandboxWindow.__agyCapsuleUi.refreshAll(true);
    const quotaHtmlAfterSelect = getEl("cap-quota-list").innerHTML;
    assert.equal((quotaHtmlAfterSelect.match(/cap-quota-group is-current/g) || []).length, 1);
    assert.ok(
      quotaHtmlAfterSelect.includes('<div class="cap-quota-group is-current"><div class="cap-quota-head"><span>Claude and GPT models</span>'),
      "选择器切换为 Claude Opus 5.5 时侧边栏应立即切换高亮至 Claude and GPT models"
    );

    // 8. 验证折叠面板与视图选项切换写入持久化状态
    const accEl = getEl("cap-usage-accordion");
    savedUiStates.length = 0;
    accEl.open = true;
    accEl.dispatch("toggle");
    accEl.open = false;
    accEl.dispatch("toggle");
    sandboxWindow.__agyCapsuleUi.setHeatScale("week");
    sandboxWindow.__agyCapsuleUi.setModelPeriod("month");
    assert.equal(savedUiStates.length, 4);
    assert.equal(savedUiStates[0].usageOpen, true);
    assert.equal(savedUiStates[1].usageOpen, false);
    assert.equal(savedUiStates[2].heatScale, "week");
    assert.equal(savedUiStates[3].modelPeriod, "month");

    // 9. 独立沙箱验证：重新打开面板并携带已记忆的 { usageOpen: true, usageScope: "all", usageMetric: "total", modelPeriod: "month" } 时自动展开并加载
    const els2 = new Map();
    const docL2 = new Map();
    const winL2 = new Map();
    const timers2 = new Set();
    let usageCalls2 = 0;
    const getEl2 = (id) => {
      if (!els2.has(id)) {
        const classes = new Set();
        els2.set(id, {
          id,
          textContent: "",
          innerHTML: "",
          value: "",
          disabled: false,
          open: false,
          scrollLeft: 0,
          scrollWidth: 100,
          style: {},
          className: "",
          classList: { add: (...ns) => ns.forEach((n) => classes.add(n)), remove: (...ns) => ns.forEach((n) => classes.delete(n)) },
          addEventListener() {}
        });
      }
      return els2.get(id);
    };
    const sbWin2 = {
      __AGY_IDE_INIT__: {
        capsulePrefs: { cacheWarnMin: 3, cacheColdMin: 4, queueWarnSec: 30 },
        capsuleUiState: {
          usageOpen: true,
          usageScope: "all",
          usageMetric: "total",
          heatScale: "week",
          modelPeriod: "month"
        }
      },
      __AGY_IDE_STATE__: { lang: "zh", activeTab: "capsule", resolvedConversationId: "conv-test" },
      __agyIdeBridge: {
        async capsuleCall(type, payload) {
          if (type === "capsuleInspect") return { ok: true, data: currentInspectPayload };
          if (type === "capsuleQuota") return { ok: true, data: currentQuotaPayload };
          if (type === "capsuleUsageQuery") {
            usageCalls2++;
            return { ok: true, data: buildMockAnalytics(payload) };
          }
          throw new Error(type);
        },
        saveCapsulePrefs() {},
        saveCapsuleUiState() {}
      },
      addEventListener(ev, fn) {
        if (!winL2.has(ev)) winL2.set(ev, []);
        winL2.get(ev).push(fn);
      }
    };
    sbWin2.window = sbWin2;
    const sb2 = {
      window: sbWin2,
      self: sbWin2,
      document: {
        querySelectorAll: () => [],
        getElementById: getEl2,
        addEventListener(ev, fn) {
          if (!docL2.has(ev)) docL2.set(ev, []);
          docL2.get(ev).push(fn);
        }
      },
      Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Error, RegExp, parseInt, parseFloat, isFinite,
      console: { log() {}, warn() {}, error() {} },
      setInterval(fn, ms) {
        const id = setInterval(fn, ms);
        timers2.add(id);
        return id;
      },
      clearInterval(id) {
        timers2.delete(id);
        clearInterval(id);
      }
    };
    try {
      vm.runInNewContext(code, sb2);
      for (const fn of docL2.get("DOMContentLoaded") || []) fn();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(getEl2("cap-usage-accordion").open, true, "应自动恢复为展开状态");
      assert.equal(getEl2("cap-scope-select-top").value, "__all__", "顶部选择器应恢复全量模式");
      assert.equal(getEl2("cap-scope-select-model").value, "__all__", "模型区选择器应同步恢复全量模式");
      assert.ok(getEl2("cap-metric-total").className.includes("is-active"));
      assert.ok(getEl2("cap-heat-week-btn").className.includes("is-active"));
      assert.ok(getEl2("cap-period-month").className.includes("is-active"));
      assert.ok(usageCalls2 >= 1, "已记忆为展开态时初始化后应自动加载历史用量");
      assert.ok(getEl2("cap-bars-chart").innerHTML.includes("cap-bar-col"));
    } finally {
      for (const fn of winL2.get("beforeunload") || []) fn();
      for (const id of timers2) clearInterval(id);
    }
  } finally {
    for (const fn of winListeners.get("beforeunload") || []) {
      fn();
    }
    for (const id of timers) clearInterval(id);
    capsule.dispose();
  }
});

test("capsuleUi v2.1.1 审查优化专项: 竞态守卫、翻页归一化、柱联动按对话、第7+模型聚焦、slug变体归并与空态引导", async () => {
  const code = getCapsuleClientScript().replace(/^<script>/, "").replace(/<\/script>$/, "");
  const elements = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = new Set();
  const consoleErrors = [];

  const getEl = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id,
        textContent: "",
        innerHTML: "",
        value: "",
        disabled: false,
        open: id === "cap-usage-accordion",
        scrollLeft: 0,
        scrollWidth: 120,
        style: {},
        className: "",
        classList: {
          add(...names) { for (const n of names) classes.add(n); },
          remove(...names) { for (const n of names) classes.delete(n); },
          contains(n) { return classes.has(n); }
        },
        addEventListener() {}
      });
    }
    return elements.get(id);
  };

  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const rpcLog = [];
  let customResponder = null;

  const mkM = (name, net, cacheRead = 1000, cacheWrite = 0, reqs = 1) => ({
    name,
    requests: reqs,
    uncached: Math.floor(net * 0.7),
    cacheRead,
    cacheWrite,
    output: net - Math.floor(net * 0.7) - cacheWrite,
    net,
    total: net + cacheRead
  });

  const makePayload = (overrides = {}) => ({
    scope: "conversation",
    conversationId: "conv-1",
    conversationTitle: "当前会话",
    activeConversationId: "conv-1",
    period: "day",
    shift: 0,
    rangeLabel: todayStr,
    canPrev: true,
    canNext: false,
    isLatest: true,
    latestActiveDay: todayStr,
    scopedTotalRequests: 10,
    kpis: {
      mode: "conversation",
      conversationId: "conv-1",
      title: "当前会话",
      requests: 10,
      uncached: 4000,
      cacheRead: 20000,
      cacheWrite: 1000,
      output: 1000,
      net: 6000,
      total: 26000,
      cacheHitPct: 80
    },
    bars: [
      {
        label: "08",
        name: `${todayStr} 08:00–10:00`,
        dayStr: todayStr,
        drillable: true,
        drillTarget: "5h",
        drillAnchorMs: Date.now() - 3600_000,
        requests: 9,
        uncached: 4200,
        cacheRead: 18000,
        cacheWrite: 0,
        output: 1800,
        net: 6000,
        total: 24000,
        models: [
          mkM("Gemini 3.8 Flash (High)", 1200, 3000, 0, 2),
          mkM("gemini-3.8-flash-n", 500, 1000, 0, 1),
          mkM("gemini-3.8-flash-tiered", 300, 500, 0, 1),
          mkM("Claude Opus 4.6 (Thinking)", 1000),
          mkM("Gemini 4 Neon (High)", 900),
          mkM("Gemini 4 Argon (Medium)", 800),
          mkM("Gemini 4 Hydrogen (Orchestrator)", 600),
          mkM("GPT-OSS 120B (Medium)", 500),
          mkM("Alpha Extra 7th", 150),
          mkM("Beta Extra 8th", 50)
        ],
        conversations: [
          {
            conversationId: "conv-bar-0",
            title: "仅出现在08点柱的会话",
            isCurrentActive: true,
            lastAtMs: Date.now(),
            requests: 4,
            net: 2000,
            total: 8000,
            cacheHitPct: 75,
            models: [mkM("Gemini 3.8 Flash (High)", 2000)]
          }
        ]
      },
      {
        label: "10",
        name: `${todayStr} 10:00–12:00`,
        dayStr: todayStr,
        drillable: true,
        drillTarget: "5h",
        drillAnchorMs: Date.now(),
        requests: 1,
        uncached: 700,
        cacheRead: 2000,
        cacheWrite: 0,
        output: 300,
        net: 1000,
        total: 3000,
        models: [mkM("Claude Opus 4.6 (Thinking)", 1000)],
        conversations: [
          {
            conversationId: "conv-bar-1",
            title: "仅出现在10点柱的会话",
            isCurrentActive: false,
            lastAtMs: Date.now(),
            requests: 1,
            net: 1000,
            total: 3000,
            cacheHitPct: 74,
            models: [mkM("Claude Opus 4.6 (Thinking)", 1000)]
          }
        ]
      }
    ],
    conversationOptions: [
      {
        conversationId: "conv-bar-0",
        title: "仅出现在08点柱的会话",
        isCurrentActive: true,
        lastAtMs: Date.now(),
        latestDay: todayStr,
        requests: 4,
        net: 2000,
        total: 8000
      },
      {
        conversationId: "conv-bar-1",
        title: "仅出现在10点柱的会话",
        isCurrentActive: false,
        lastAtMs: Date.now() - 1000,
        latestDay: todayStr,
        requests: 1,
        net: 1000,
        total: 3000
      }
    ],
    heatmapDays: [{ date: todayStr, requests: 10, net: 7000, total: 27000 }],
    sinceDate: todayStr,
    unread: 0,
    scannedFiles: 3,
    ...overrides
  });

  const sbWin = {
    __AGY_IDE_INIT__: { capsulePrefs: { cacheWarnMin: 3, cacheColdMin: 4, queueWarnSec: 30 } },
    __AGY_IDE_STATE__: { lang: "zh", activeTab: "capsule", resolvedConversationId: "conv-1" },
    __agyIdeBridge: {
      async capsuleCall(type, payload) {
        if (type === "capsuleInspect") return { ok: true, data: { found: true, conversationId: "conv-1" } };
        if (type === "capsuleQuota") return { ok: true, data: { ok: true, quotaGroups: [] } };
        if (type === "capsuleUsageQuery") {
          rpcLog.push({ ...(payload || {}) });
          if (customResponder) return customResponder(payload || {});
          return { ok: true, data: makePayload({ period: payload?.period || "day", scope: payload?.scope || "conversation" }) };
        }
        throw new Error(type);
      },
      saveCapsulePrefs() {},
      saveCapsuleUiState() {}
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    }
  };
  sbWin.window = sbWin;

  const sb = {
    window: sbWin,
    self: sbWin,
    document: {
      querySelectorAll: () => [],
      getElementById: getEl,
      addEventListener(ev, fn) {
        if (!docListeners.has(ev)) docListeners.set(ev, []);
        docListeners.get(ev).push(fn);
      }
    },
    Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Error, RegExp, parseInt, parseFloat, isFinite,
    console: { log() {}, warn() {}, error: (...a) => consoleErrors.push(a.join(" ")) },
    setInterval(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval(id) { timers.delete(id); clearInterval(id); }
  };

  try {
    vm.runInNewContext(code, sb);
    await sbWin.__agyCapsuleUi.loadUsage(true);

    // 1. 当前对话 KPI 随 metric 高亮，两处自定义对话下拉选择器结构与选中值完全一致（固定区独立于具体对话滚动区）
    assert.equal(getEl("cap-bars-range").textContent, todayStr);
    assert.ok(getEl("cap-usage-totals").innerHTML.includes("is-active-kpi"), "默认 net 应高亮第 1 个 KPI 卡片");
    assert.equal(getEl("cap-scope-select-top").value, "__active__");
    assert.equal(getEl("cap-scope-select-model").value, "__active__");
    const topMenuHtml = getEl("cap-scope-menu-top").innerHTML;
    assert.equal(topMenuHtml, getEl("cap-scope-menu-model").innerHTML, "两处自定义对话下拉菜单应完全同步");
    const pinnedSplit = topMenuHtml.split('<div class="cap-scope-scroll');
    assert.equal(pinnedSplit.length, 2, "下拉菜单应分为固定区与具体对话独立滚动区");
    assert.ok(pinnedSplit[0].includes('cap-scope-pinned') && pinnedSplit[0].includes('__active__') && pinnedSplit[0].includes('__all__'), "固定区应包含当前对话与全部对话");
    assert.equal(pinnedSplit[1].includes('__active__'), false, "当前对话不应混入具体对话滚动区");
    assert.equal(pinnedSplit[1].includes('__all__'), false, "全部对话不应混入具体对话滚动区");
    assert.ok(pinnedSplit[1].includes('仅出现在08点柱的会话') && pinnedSplit[1].includes('仅出现在10点柱的会话'), "具体对话列表应位于独立滚动区");

    // 1b. 测试下拉展开互斥、底部空间不足自动 dropup（固定区自动贴近选择框）及选中即闭
    sbWin.innerHeight = 700;
    getEl("cap-scope-btn-top").getBoundingClientRect = () => ({ top: 80, bottom: 114 });
    getEl("cap-scope-btn-model").getBoundingClientRect = () => ({ top: 610, bottom: 644 });
    sbWin.__agyCapsuleUi.toggleScopeDropdown("top");
    assert.equal(getEl("cap-scope-select-top").classList.contains("is-open"), true);
    assert.equal(getEl("cap-scope-select-top").classList.contains("is-dropup"), false, "顶部空间充足时向下展开");
    assert.equal(getEl("cap-scope-menu-top").classList.contains("hidden"), false);
    sbWin.__agyCapsuleUi.toggleScopeDropdown("model");
    assert.equal(getEl("cap-scope-select-top").classList.contains("is-open"), false, "展开另一处下拉时应自动关闭前一个");
    assert.equal(getEl("cap-scope-select-model").classList.contains("is-open"), true);
    assert.equal(getEl("cap-scope-select-model").classList.contains("is-dropup"), true, "下方空间不足时应自动向上展开并使固定区紧贴选择框");
    await sbWin.__agyCapsuleUi.pickScopeOption("conv:conv-bar-1");
    assert.equal(getEl("cap-scope-select-model").classList.contains("is-open"), false, "选中后应自动关闭下拉");
    assert.equal(getEl("cap-scope-select-top").value, "conv:conv-bar-1");
    assert.equal(getEl("cap-scope-select-model").value, "conv:conv-bar-1");
    assert.ok(getEl("cap-scope-label-top").textContent.includes("仅出现在10点柱的会话"));
    assert.equal(getEl("cap-scope-label-top").textContent, getEl("cap-scope-label-model").textContent);
    await sbWin.__agyCapsuleUi.pickScopeOption("__active__");

    // 2. gemini-3.8-flash-n 与 gemini-3.8-flash-tiered 归并进 Gemini 3.8 Flash，点击模型行同步聚焦柱图并展开详情，再点同时取消
    const rowsBefore = getEl("cap-model-rows").innerHTML;
    assert.equal(rowsBefore.includes("gemini-3.8-flash-n"), false, "不应分裂展示 gemini-3.8-flash-n");
    assert.equal(rowsBefore.includes("gemini-3.8-flash-tiered"), false, "不应分裂展示 gemini-3.8-flash-tiered");
    assert.ok(rowsBefore.includes("Gemini 3.8 Flash"));
    assert.equal(rowsBefore.includes("cap-model-detail"), false, "初始不应展开详情");

    // 点击模型行 -> 同时高亮柱图聚焦 + 展开该模型四维与档位详情
    sbWin.__agyCapsuleUi.toggleFocusModel("gemini-3-8-flash");
    const rowsClickFocus = getEl("cap-model-rows").innerHTML;
    assert.ok(rowsClickFocus.includes("cap-model-row is-focused"), "点击模型行应高亮聚焦");
    assert.ok(rowsClickFocus.includes("cap-model-detail"), "点击模型行应同步展开详情");
    assert.ok(rowsClickFocus.includes("High") && rowsClickFocus.includes("n ") && rowsClickFocus.includes("tiered "), "展开应呈现 High/n/tiered 档位占比");
    assert.ok(getEl("cap-bars-chart").innerHTML.includes("cap-bar-seg is-dimmed"), "柱状图应同步聚焦该模型");

    // 再次点击同一模型行 -> 同时取消柱图聚焦 + 取消详情展开
    sbWin.__agyCapsuleUi.toggleFocusModel("gemini-3-8-flash");
    const rowsClickUnfocus = getEl("cap-model-rows").innerHTML;
    assert.equal(rowsClickUnfocus.includes("cap-model-row is-focused"), false, "再次点击应取消聚焦");
    assert.equal(rowsClickUnfocus.includes("cap-model-detail"), false, "再次点击应同步取消详情展开");
    assert.equal(getEl("cap-bars-chart").innerHTML.includes("cap-bar-seg is-dimmed"), false, "再次点击应取消柱图淡化");

    // 3. 第 7+ 模型（Alpha Extra 7th，落入溢出槽）聚焦时，柱图中自身高亮段不带 is-dimmed，且同步展开详情、不弹出多余取消聚焦文字提示
    sbWin.__agyCapsuleUi.toggleFocusModel("alpha-extra-7th");
    const barsFocused7th = getEl("cap-bars-chart").innerHTML;
    assert.ok(barsFocused7th.includes('<i class="cap-bar-seg" style="flex:'), "第 7+ 模型聚焦段不应被错误标记为 is-dimmed");
    assert.ok(barsFocused7th.includes('cap-bar-seg is-dimmed'), "同柱其他非聚焦段应正常淡化");
    assert.ok(getEl("cap-model-rows").innerHTML.includes("cap-model-detail"), "点击第 7+ 模型也应同步展开详情");
    assert.equal(getEl("cap-bar-detail-bar").innerHTML.includes("取消聚焦"), false, "高亮已代表聚焦，不应出现取消聚焦文字提示");
    sbWin.__agyCapsuleUi.clearFocusModel();
    assert.equal(getEl("cap-model-rows").innerHTML.includes("cap-model-detail"), false, "清除聚焦应同步收起详情");

    // 4. 单击柱子更新常驻详情标题栏，且顶部导航行全窗合计保持稳定不跳动；再次单击取消选中
    sbWin.__agyCapsuleUi.toggleBarSelect(0);
    assert.ok(getEl("cap-bar-detail-bar").className.includes("is-active"));
    assert.ok(getEl("cap-bar-detail-bar").innerHTML.includes("6.0K"), "常驻详情栏应展示所选柱净耗");
    assert.ok(getEl("cap-bars-total").textContent.includes("7.0K"), "导航栏全窗合计应保持全窗稳定值");
    sbWin.__agyCapsuleUi.toggleBarSelect(0);
    assert.equal(getEl("cap-bar-detail-bar").className, "cap-bar-detail-bar", "再次单击同一柱应取消选中");

    // 4b. 在底部选择器切换为全部对话，顶部与底部下拉框即时双向同步
    await sbWin.__agyCapsuleUi.onUsageScopeSelect("__all__");
    assert.equal(rpcLog.at(-1).scope, "all");
    assert.equal(getEl("cap-scope-select-top").value, "__all__");
    assert.equal(getEl("cap-scope-select-model").value, "__all__");
    await sbWin.__agyCapsuleUi.onUsageScopeSelect("__active__");

    // 5. 翻页边界拦截与历史锚点回到最新页自动归零
    const prevCount = rpcLog.length;
    await sbWin.__agyCapsuleUi.shiftModelPage(1); // canNext === false 时应直接拦截
    assert.equal(rpcLog.length, prevCount, "已在最新页时点击下一页不应发出冗余 RPC 或漂移 shift");

    customResponder = (p) => ({
      ok: true,
      data: makePayload({
        period: p.period,
        rangeLabel: p.shift > 0 ? todayStr : "2026-11-20",
        canPrev: true,
        canNext: !(p.shift > 0),
        isLatest: p.shift > 0
      })
    });
    await sbWin.__agyCapsuleUi.jumpToDate("2026-11-20");
    assert.equal(getEl("cap-shift-today").classList.contains("hidden"), false, "位于历史日期时应显示「今」按钮");
    await sbWin.__agyCapsuleUi.shiftModelPage(1); // 翻回最新页，isLatest=true 应自动归零 anchorDate 和 shift
    assert.equal(getEl("cap-shift-today").classList.contains("hidden"), true, "翻回最新页后「今」按钮应自动隐藏");
    await sbWin.__agyCapsuleUi.shiftModelPage(-1); // 再点上一页，shift 应直接为 -1 且 anchorDate 为空
    assert.equal(rpcLog.at(-1).shift, -1);
    assert.equal(rpcLog.at(-1).anchorDate, "");

    // 6. 并发异步竞态守卫：先发慢请求(5h)，后发快请求(week)，慢请求晚到时不得覆盖 week 视图
    let resolveSlow;
    const slowPromise = new Promise((r) => { resolveSlow = r; });
    customResponder = (p) => {
      if (p.period === "5h") {
        return slowPromise.then(() => ({ ok: true, data: makePayload({ period: "5h", rangeLabel: "SLOW-STALE-5H" }) }));
      }
      return Promise.resolve({ ok: true, data: makePayload({ period: p.period, rangeLabel: "FAST-FRESH-WEEK" }) });
    };
    const pSlow = sbWin.__agyCapsuleUi.setModelPeriod("5h");
    const pFast = sbWin.__agyCapsuleUi.setModelPeriod("week");
    await pFast;
    assert.equal(getEl("cap-bars-range").textContent, "FAST-FRESH-WEEK");
    resolveSlow();
    await pSlow;
    assert.equal(getEl("cap-bars-range").textContent, "FAST-FRESH-WEEK", "过期慢响应不得覆盖最新查询视图");

    // 7. 空态智能引导：当前对话今日无记录但有历史活跃日，展示一键跳转与查看全部对话按钮
    customResponder = () => Promise.resolve({
      ok: true,
      data: makePayload({
        scope: "conversation",
        period: "day",
        rangeLabel: todayStr,
        latestActiveDay: "2026-11-18",
        bars: [{ label: "00", name: `${todayStr} 00:00–02:00`, dayStr: todayStr, requests: 0, net: 0, total: 0, models: [], conversations: [] }],
        conversations: []
      })
    });
    await sbWin.__agyCapsuleUi.setModelPeriod("day");
    const emptyHtml = getEl("cap-model-rows").innerHTML;
    assert.ok(emptyHtml.includes("jumpToDate('2026-11-18')"), "空态应提供一键跳至最近活跃日按钮");
    assert.ok(emptyHtml.includes("setUsageScope('all')"), "当前对话空态应提供查看全部对话按钮");

    // 8. 热力图每周模式点击格子绑定 jumpToWeek 并切至 week + anchorDate
    customResponder = null;
    sbWin.__agyCapsuleUi.setHeatScale("week");
    assert.ok(getEl("cap-heat-wrap").innerHTML.includes("window.__agyCapsuleUi.jumpToWeek("), "每周热力图格子应绑定 jumpToWeek");
    assert.equal(getEl("cap-heat-hint").textContent, "点击格子可直接跳转到该周用量");
    await sbWin.__agyCapsuleUi.jumpToWeek("2026-11-09");
    assert.equal(rpcLog.at(-1).period, "week");
    assert.equal(rpcLog.at(-1).anchorDate, "2026-11-09");
    assert.equal(consoleErrors.length, 0, `专项验证零报错: ${consoleErrors.join("; ")}`);
  } finally {
    for (const fn of winListeners.get("beforeunload") || []) fn();
    for (const id of timers) clearInterval(id);
  }
});

test("statusBar & dashboardController: 底栏胶囊命令绑定与定向页签跳转握手", async () => {
  const statusItems = [];
  const executedCommands = [];
  const configValues = new Map([
    ["defaultTab", "capsule"],
    ["defaultScope", "conversation"],
    ["statusBar.enabled", true],
    ["statusBar.showAccount", true],
    ["statusBar.showCache", true],
    ["statusBar.showSpeed", true],
    ["statusBar.showQuota", true],
    ["refreshIntervalSec", 60]
  ]);

  const mockVscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: 1 },
    ThemeColor: class ThemeColor {
      constructor(id) {
        this.id = id;
      }
    },
    MarkdownString: class MarkdownString {
      constructor() {
        this.value = "";
        this.isTrusted = false;
      }
      appendMarkdown(s) {
        this.value += s;
      }
    },
    Uri: {
      file(fsPath) {
        return { fsPath };
      }
    },
    env: { language: "zh-cn", clipboard: { async writeText() {} } },
    workspace: {
      getConfiguration() {
        return {
          get(k, defVal) {
            return configValues.has(k) ? configValues.get(k) : defVal;
          },
          async update(k, v) {
            configValues.set(k, v);
          }
        };
      }
    },
    commands: {
      async executeCommand(cmd, ...args) {
        executedCommands.push({ cmd, args });
      }
    },
    window: {
      createStatusBarItem(alignment, priority) {
        const item = {
          alignment,
          priority,
          command: "",
          text: "",
          tooltip: "",
          backgroundColor: undefined,
          visible: false,
          show() {
            this.visible = true;
          },
          hide() {
            this.visible = false;
          },
          dispose() {}
        };
        statusItems.push(item);
        return item;
      },
      createWebviewPanel() {
        return null;
      },
      showInformationMessage() {},
      showWarningMessage() {},
      showErrorMessage() {}
    }
  };

  const origLoad = Module._load;
  const statusBarPath = require.resolve("../src/statusBar");
  const controllerPath = require.resolve("../src/dashboardController");
  delete require.cache[statusBarPath];
  delete require.cache[controllerPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  let statusBar = null;
  try {
    const { StatusBarController } = require("../src/statusBar");
    const { DashboardController } = require("../src/dashboardController");

    const stateStore = new Map();
    const mockContext = {
      extensionPath: path.resolve(__dirname, ".."),
      globalState: {
        get(k) {
          return stateStore.get(k);
        },
        async update(k, v) {
          stateStore.set(k, v);
        }
      }
    };

    const controller = new DashboardController({
      context: mockContext,
      backendClient: {
        async fetchDashboardHtml() {
          return "<html><head><style></style></head><body><header class=\"topbar\"><div class=\"topbar-row\"><div class=\"segmented\"><button id=\"scope-conv-btn\"></button></div></div></header><div class=\"shell\"></div><script></script></body></html>";
        },
        async requestApi() {
          return { ok: false, status: 503, data: null };
        }
      },
      capsuleClient: {
        async inspectConversation() {
          return null;
        },
        async getQuota() {
          return null;
        }
      },
      resolveRuntime: () => ({ ok: false, error: "mock" }),
      resolveNodePath: () => resolveSystemNodePath(),
      logger: { log() {}, show() {} }
    });

    statusBar = new StatusBarController({
      backendClient: controller._backend,
      capsuleClient: controller._capsule,
      dashboardController: controller,
      resolveRuntime: () => ({ ok: false }),
      logger: { log() {} }
    });

    // 校验 5 枚状态栏胶囊的点击命令绑定
    assert.equal(statusItems.length, 5);
    assert.equal(statusBar._accountItem.command, "agyFusion.openAccountsTab");
    assert.equal(statusBar._guardItem.command, "agyFusion.openGuardTab");
    assert.equal(statusBar._cacheItem.command, "agyFusion.openGuardTab");
    assert.equal(statusBar._speedItem.command, "agyFusion.openTelemetryTab");
    assert.equal(statusBar._quotaItem.command, "agyFusion.openTelemetryTab");

    const posted = [];
    let receiveHandler = null;
    const mockSidebarView = {
      visible: true,
      showCalls: 0,
      show() {
        this.showCalls++;
      },
      onDidDispose() {},
      webview: {
        options: {},
        html: "",
        onDidReceiveMessage(fn) {
          receiveHandler = fn;
        },
        postMessage(msg) {
          posted.push(msg);
        }
      }
    };

    controller.resolveWebviewView(mockSidebarView);
    assert.ok(typeof receiveHandler === "function");

    // 1. 点击底栏「融合监控」-> 跳转「护栏与缓存诊断」('dart')
    await controller.focusSidebar("dart");
    assert.equal(controller._activeTab, "dart");
    assert.equal(stateStore.get("agyFusion.activeTab"), "dart");
    assert.ok(executedCommands.some((c) => c.cmd === "workbench.view.extension.agyFusion"));
    assert.ok(posted.some((m) => m.type === "setActiveTab" && m.tab === "dart"));

    // 1b. 跳转「账号切换」('accounts')
    await controller.focusSidebar("accounts");
    assert.equal(controller._activeTab, "accounts");
    assert.equal(stateStore.get("agyFusion.activeTab"), "accounts");
    assert.ok(posted.some((m) => m.type === "setActiveTab" && m.tab === "accounts"));

    await controller.focusSidebar("dart");

    // 2. Webview 冷启动就绪握手 -> 宿主立即回发当前 activeTab
    posted.length = 0;
    await receiveHandler({ type: "webviewReady" });
    assert.deepEqual(posted, [{ type: "setActiveTab", tab: "dart" }]);

    // 3. 点击底栏「配额 / 遥测」-> 跳转「实时遥测与用量」('capsule')
    posted.length = 0;
    await controller.focusSidebar("capsule");
    assert.equal(controller._activeTab, "capsule");
    assert.equal(stateStore.get("agyFusion.activeTab"), "capsule");
    assert.ok(posted.some((m) => m.type === "setActiveTab" && m.tab === "capsule"));

    // 4. 全宽编辑器标签页已打开且可见时，点击底栏原地 reveal 并切换页签
    const editorPosted = [];
    let editorRevealed = false;
    const execCountBefore = executedCommands.length;
    controller._editorPanel = {
      visible: true,
      viewColumn: 1,
      reveal() {
        editorRevealed = true;
      },
      webview: {
        postMessage(msg) {
          editorPosted.push(msg);
        }
      }
    };
    await controller.focusSidebar("dart");
    assert.equal(editorRevealed, true);
    assert.equal(executedCommands.length, execCountBefore, "编辑器标签页可见时应原地切页而非强制聚焦侧栏");
    assert.ok(editorPosted.some((m) => m.type === "setActiveTab" && m.tab === "dart"));

    // 4b. 历史用量展开状态与多维视图偏好持久化 + 新实例还原 + 跨 Webview 同步
    editorPosted.length = 0;
    const expectedUiState = {
      usageOpen: true,
      usageScope: "all",
      usageMetric: "total",
      modelPeriod: "5h",
      heatOpen: true,
      heatScale: "week"
    };
    await receiveHandler({
      type: "setCapsuleUiState",
      state: expectedUiState
    });
    assert.deepEqual(stateStore.get("agyFusion.capsuleUiState"), expectedUiState);
    assert.deepEqual(editorPosted, [{ type: "capsuleUiState", state: expectedUiState }]);

    const controllerRestored = new DashboardController({
      context: mockContext,
      backendClient: controller._backend,
      capsuleClient: controller._capsule,
      resolveRuntime: () => ({ ok: false, error: "mock" }),
      resolveNodePath: () => resolveSystemNodePath(),
      logger: { log() {}, show() {} }
    });
    assert.deepEqual(controllerRestored._capsuleUiState, expectedUiState);
    const restoredWebview = { options: {}, html: "", onDidReceiveMessage() {}, postMessage() {} };
    await controllerRestored._renderWebview(restoredWebview, "sidebar");
    assert.ok(
      restoredWebview.html.includes('<details id="cap-usage-accordion" class="accordion-band" open>'),
      "重开实例渲染应保留历史用量展开状态"
    );
    assert.ok(
      restoredWebview.html.includes('<details id="cap-heat-accordion" class="cap-sub-accordion" open>'),
      "重开实例渲染应保留热力图次级折叠展开状态"
    );

    // 5. 底栏配额微胶囊随活跃模型动态切换池并标注池简称及重置剩余时长
    const proQuota = {
      ok: true,
      userTierName: "Pro",
      defaultModelLabel: "Gemini 4 Neon (High)",
      quotaGroups: [
        {
          displayName: "Gemini Models",
          description: "Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash",
          buckets: [
            { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.88581014, resetTime: new Date(Date.now() + 90 * 60000 + 15000).toISOString() },
            { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.9602315, resetTime: new Date(Date.now() + (2 * 1440 + 180) * 60000 + 15000).toISOString() }
          ]
        },
        {
          displayName: "Claude and GPT models",
          description: "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B",
          buckets: [
            { bucketId: "3p-5h", window: "5h", remainingFraction: 1 },
            { bucketId: "3p-weekly", window: "weekly", remainingFraction: 1 }
          ]
        },
        {
          displayName: "Gemini 4 Argon",
          description: "For paid Pro plans, Argon quota is separate.",
          buckets: [{ bucketId: "gemini-argon-wtu-weekly", window: "weekly", remainingFraction: 1 }]
        }
      ]
    };

    statusBar._updateQuotaCapsule(proQuota, { activeModel: "Gemini 4 Neon (High)" });
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Gemini · 5h 89%(1h30m) · 周 96%(2d3h)");
    assert.equal(statusBar._quotaItem.backgroundColor, undefined);
    assert.ok(statusBar._quotaItem.tooltip.value.includes("Gemini 4 Neon (High) → **Gemini**"));
    assert.ok(statusBar._quotaItem.tooltip.value.includes("- [当前] **Gemini Models** (Gemini):"));

    statusBar._updateQuotaCapsule(proQuota, { activeModel: "Claude Opus 5.5 (High)" });
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Claude/GPT · 5h 100% · 周 100%");
    assert.ok(statusBar._quotaItem.tooltip.value.includes("- [当前] **Claude and GPT models** (Claude/GPT):"));

    statusBar._updateQuotaCapsule(proQuota, { activeModel: "Orchestrator (Argon)" });
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Argon · 周 100%");
    assert.ok(statusBar._quotaItem.tooltip.value.includes("Orchestrator (Argon) → **Argon**"));
    assert.ok(statusBar._quotaItem.tooltip.value.includes("- [当前] **Gemini 4 Argon** (Argon):"));

    // 当用户在模型选择器切换为 Gemini 4 Argon (Medium)（尚未发送消息，对话上轮还是 Orchestrator (Neon)）时，底栏立即切换为 Argon
    statusBar._updateQuotaCapsule(
      { ...proQuota, selectedModelId: "MODEL_PLACEHOLDER_M418", selectedModelLabel: "Gemini 4 Argon (Medium)" },
      { activeModel: "Orchestrator (Neon)" }
    );
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Argon · 周 100%");
    assert.ok(statusBar._quotaItem.tooltip.value.includes("当前模型**: Gemini 4 Argon (Medium) → **Argon**"));
    assert.ok(statusBar._quotaItem.tooltip.value.includes("上轮对话模型**: Orchestrator (Neon)"));
    assert.ok(statusBar._quotaItem.tooltip.value.includes("- [当前] **Gemini 4 Argon** (Argon):"));

    // 验证已到点/临近重置时间显示为 (即将)，整点小时省略 0m
    statusBar._updateQuotaCapsule(
      {
        ...proQuota,
        quotaGroups: [
          proQuota.quotaGroups[0],
          proQuota.quotaGroups[1],
          {
            ...proQuota.quotaGroups[2],
            buckets: [{ bucketId: "gemini-argon-wtu-weekly", window: "weekly", remainingFraction: 1, resetTime: new Date(Date.now() - 5000).toISOString() }]
          }
        ]
      },
      { activeModel: "Gemini 4 Argon (Medium)" }
    );
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Argon · 周 100%(即将)");

    // 空模型回退至 defaultModelLabel
    statusBar._updateQuotaCapsule(proQuota, { activeModel: "" });
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Gemini · 5h 89%(1h30m) · 周 96%(2d3h)");
    assert.ok(statusBar._quotaItem.tooltip.value.includes("默认模型**: Gemini 4 Neon (High) → **Gemini**"));

    statusBar._updateQuotaCapsule({ ...proQuota, defaultModelLabel: "Claude Sonnet 5.5 (Medium)" }, { activeModel: "" });
    assert.equal(statusBar._quotaItem.text, "$(pie-chart) Claude/GPT · 5h 100% · 周 100%");

    // 低余量改以图标符号提醒，保持底栏无刺眼整块底色
    const warnQuota = {
      ...proQuota,
      quotaGroups: [
        { ...proQuota.quotaGroups[0], buckets: [{ window: "5h", remainingFraction: 0.2 }, { window: "weekly", remainingFraction: 0.9 }] },
        proQuota.quotaGroups[1],
        proQuota.quotaGroups[2]
      ]
    };
    statusBar._updateQuotaCapsule(warnQuota, { activeModel: "Gemini 3.8 Flash (High)" });
    assert.equal(statusBar._quotaItem.text, "$(warning) Gemini · 5h 20% · 周 90%");
    assert.equal(statusBar._quotaItem.backgroundColor, undefined);

    const errQuota = {
      ...proQuota,
      quotaGroups: [
        { ...proQuota.quotaGroups[0], buckets: [{ window: "5h", remainingFraction: 0.08 }, { window: "weekly", remainingFraction: 0.9 }] },
        proQuota.quotaGroups[1],
        proQuota.quotaGroups[2]
      ]
    };
    statusBar._updateQuotaCapsule(errQuota, { activeModel: "Gemini 3.8 Flash (High)" });
    assert.equal(statusBar._quotaItem.text, "$(error) Gemini · 5h 8% · 周 90%");
    assert.equal(statusBar._quotaItem.backgroundColor, undefined);

    // 6. 底栏缓存命中率胶囊：改用图形符号（● / ◐ / ○ 与时钟/历史图标），无背景色块
    statusBar._updateCacheCapsule({ contextTokens: 0, cachedIn: 0, uncachedIn: 0, lastStepEpochMs: 0 });
    assert.equal(statusBar._cacheItem.text, "$(database) 缓存 --");
    assert.equal(statusBar._cacheItem.backgroundColor, undefined);

    const nowMs = Date.now();
    statusBar._updateCacheCapsule({
      contextTokens: 100000,
      cachedIn: 92000,
      uncachedIn: 8000,
      lastStepEpochMs: nowMs - 30 * 1000
    });
    assert.equal(statusBar._cacheItem.text, "$(database) 缓存 92%");
    assert.equal(statusBar._cacheItem.backgroundColor, undefined);
    assert.ok(statusBar._cacheItem.tooltip.value.includes("**92.0%**"));
    assert.ok(statusBar._cacheItem.tooltip.value.includes("92.0K / 8.0K"));

    statusBar._updateCacheCapsule({
      contextTokens: 100000,
      cachedIn: 92000,
      uncachedIn: 8000,
      lastStepEpochMs: nowMs - 200 * 1000
    });
    assert.equal(statusBar._cacheItem.text, "$(clock) 缓存 92% ◐ 3m");
    assert.equal(statusBar._cacheItem.backgroundColor, undefined);
    assert.ok(statusBar._cacheItem.tooltip.value.includes("临近失效"));

    statusBar._updateCacheCapsule({
      contextTokens: 100000,
      cachedIn: 92000,
      uncachedIn: 8000,
      lastStepEpochMs: nowMs - 310 * 1000
    });
    assert.equal(statusBar._cacheItem.text, "$(history) 缓存 92% ○ 5m");
    assert.equal(statusBar._cacheItem.backgroundColor, undefined);
    assert.ok(statusBar._cacheItem.tooltip.value.includes("可能已冷"));

    // 7. 护栏胶囊按上下文水位切换单色图形符号，无背景色块
    statusBar._updateGuardCapsule(
      { ok: true },
      { totalRawBytes: 1000, totalReturnedBytes: 200, cutoffBytes: 46080, isPaused: false },
      { contextTokens: 78000, maxContextTokens: 100000 },
      "conv-guard-1"
    );
    assert.ok(statusBar._guardItem.text.startsWith("$(warning) 上下文 78%"));
    assert.equal(statusBar._guardItem.backgroundColor, undefined);

    statusBar._updateGuardCapsule(
      { ok: true },
      { totalRawBytes: 1000, totalReturnedBytes: 200, cutoffBytes: 46080, isPaused: false },
      { contextTokens: 93000, maxContextTokens: 100000 },
      "conv-guard-1"
    );
    assert.ok(statusBar._guardItem.text.startsWith("$(error) 上下文 93%"));
    assert.equal(statusBar._guardItem.backgroundColor, undefined);
  } finally {
    if (statusBar) statusBar.dispose();
    Module._load = origLoad;
    delete require.cache[statusBarPath];
    delete require.cache[controllerPath];
  }
});

test("quotaMatcher: 精准匹配 Pro/Ultra 账号模型归属池并格式化池简称", () => {
  assert.equal(formatQuotaPoolShortName({ displayName: "Gemini Models" }), "Gemini");
  assert.equal(formatQuotaPoolShortName({ displayName: "Claude and GPT models" }), "Claude/GPT");
  assert.equal(formatQuotaPoolShortName({ displayName: "Gemini 4 Argon" }), "Argon");
  assert.equal(formatQuotaPoolShortName({ displayName: "Gemini 4 Carbon" }), "Carbon");
  assert.equal(formatQuotaPoolShortName({ displayName: "Claude Models" }), "Claude");
  assert.equal(formatQuotaPoolShortName(""), "配额");

  const proGroups = [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash",
      buckets: [{ bucketId: "gemini-5h", window: "5h" }, { bucketId: "gemini-weekly", window: "weekly" }]
    },
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B",
      buckets: [{ bucketId: "3p-5h", window: "5h" }, { bucketId: "3p-weekly", window: "weekly" }]
    },
    {
      displayName: "Gemini 4 Argon",
      description: "For paid Pro plans, Argon quota is separate.",
      buckets: [{ bucketId: "gemini-argon-wtu-weekly", window: "weekly" }]
    }
  ];

  for (const m of [
    "Gemini 4 Neon (High)",
    "Gemini 4 Hydrogen (Orchestrator)",
    "Orchestrator (Neon)",
    "Gemini 3.8 Flash (High)"
  ]) {
    assert.equal(matchQuotaGroup(proGroups, m)?.displayName, "Gemini Models", `${m} 应归属 Gemini Models`);
  }

  for (const m of ["Gemini 4 Argon (High)", "Orchestrator (Argon)"]) {
    assert.equal(matchQuotaGroup(proGroups, m)?.displayName, "Gemini 4 Argon", `${m} 应归属 Gemini 4 Argon`);
  }

  for (const m of [
    "Claude Opus 5.5 (High)",
    "Claude Sonnet 5.5 (Medium)",
    "claude-opus-4-6-thinking",
    "GPT-OSS 120B (Medium)"
  ]) {
    assert.equal(matchQuotaGroup(proGroups, m)?.displayName, "Claude and GPT models", `${m} 应归属 Claude and GPT models`);
  }

  assert.equal(
    matchQuotaGroup(proGroups, "", "Claude Opus 5.5 (Medium)")?.displayName,
    "Claude and GPT models",
    "空 activeModel 应回退至 fallbackModel"
  );
  assert.equal(matchQuotaGroup(proGroups, "", "")?.displayName, "Gemini Models", "两者均空时应兜底返回 Gemini Models");

  // Ultra 账号结构：无独立 Argon 池，Argon 已归入 Gemini Models 描述中
  const ultraGroups = [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini 4 Neon, Gemini 4 Argon, Orchestrator (Argon), Gemini 3.8 Flash",
      buckets: [{ bucketId: "gemini-5h", window: "5h" }, { bucketId: "gemini-weekly", window: "weekly" }]
    },
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B",
      buckets: [{ bucketId: "3p-5h", window: "5h" }, { bucketId: "3p-weekly", window: "weekly" }]
    }
  ];

  assert.equal(matchQuotaGroup(ultraGroups, "Gemini 4 Argon (High)")?.displayName, "Gemini Models");
  assert.equal(matchQuotaGroup(ultraGroups, "Orchestrator (Argon)")?.displayName, "Gemini Models");
});

test("package-vsix: 成功打包当前版本标准 VSIX 且包含全部新增运行时文件", () => {
  const rootDir = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const res = packageVsix(rootDir);
  assert.ok(fs.existsSync(res.vsixPath));
  assert.ok(res.vsixPath.endsWith(`${pkg.name}-${pkg.version}.vsix`));
  assert.equal(res.entryCount, RUNTIME_FILES.length + 2);
  assert.ok(res.bytes > 15000);
});
