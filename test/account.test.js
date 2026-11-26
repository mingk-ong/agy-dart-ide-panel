"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const {
  generateWriterId,
  maskEmail,
  normalizeExpiryIso,
  buildSystemCredentialPayload,
  parseSystemCredentialPayload,
  readSystemCredential,
  writeSystemCredential,
  readGeminiCompatFiles,
  syncGeminiCompatFiles,
  detectActiveHubInstances
} = require("../src/credentialBridge");
const {
  AccountStore,
  makeAccountId,
  computeAccountQuotaScore,
  sortAccountsByQuota
} = require("../src/accountStore");
const {
  formatTierShortName,
  isGeminiQuotaGroup,
  classifyBucketWindow,
  pickWindowBuckets,
  evaluateBucketStatus,
  evaluateQuotaSnapshot,
  formatCountdown,
  summarizeGeminiQuotaForHover
} = require("../src/quotaTracker");
const {
  getAccountCss,
  getAccountPaneHtml,
  getAccountClientScript
} = require("../src/accountUi");
const {
  inspectLatestAuthLog,
  detectKeyringAnomalies,
  clearKeyringAnomalyFiles,
  evaluateAuthHealth
} = require("../src/authHealth");
const {
  resolveIdeExecutable,
  buildRestartLaunchArgs,
  scheduleColdRestart
} = require("../src/ideRestart");

function createMockContext() {
  const stateMap = new Map();
  const secretMap = new Map();
  return {
    stateMap,
    secretMap,
    globalState: {
      get(k) {
        return stateMap.get(k);
      },
      async update(k, v) {
        if (v === undefined) stateMap.delete(k);
        else stateMap.set(k, v);
      }
    },
    secrets: {
      async get(k) {
        return secretMap.get(k);
      },
      async store(k, v) {
        secretMap.set(k, String(v));
      },
      async delete(k) {
        secretMap.delete(k);
      }
    }
  };
}

function createMockVscode(configInit = {}) {
  const cfgStore = new Map(Object.entries(configInit));
  const executedCommands = [];
  const messages = [];
  const statusItems = [];

  const mockVscode = {
    ConfigurationTarget: { Global: 1 },
    ProgressLocation: { Notification: 15 },
    QuickPickItemKind: { Separator: -1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: 1 },
    env: {
      appRoot: ""
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
    workspace: {
      workspaceFile: undefined,
      workspaceFolders: undefined,
      getConfiguration(section = "agyFusion") {
        const prefix = section ? `${section}.` : "";
        return {
          get(k, defVal) {
            return cfgStore.has(prefix + k) ? cfgStore.get(prefix + k) : defVal;
          },
          inspect(k) {
            return { globalValue: cfgStore.get(prefix + k) };
          },
          async update(k, v) {
            cfgStore.set(prefix + k, v);
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
      _nextMessageChoice: undefined,
      _nextQuickPick: undefined,
      _nextInputBox: undefined,
      async showInformationMessage(msg) {
        messages.push({ level: "info", msg });
        return mockVscode.window._nextMessageChoice;
      },
      async showWarningMessage(msg) {
        messages.push({ level: "warn", msg });
        return mockVscode.window._nextMessageChoice;
      },
      async showErrorMessage(msg) {
        messages.push({ level: "error", msg });
      },
      async showInputBox() {
        return mockVscode.window._nextInputBox;
      },
      async showQuickPick(items) {
        if (typeof mockVscode.window._nextQuickPick === "function") {
          return mockVscode.window._nextQuickPick(items);
        }
        return mockVscode.window._nextQuickPick;
      },
      async withProgress(_opts, fn) {
        return fn({ report() {} }, { isCancellationRequested: false });
      },
      createStatusBarItem(alignment, priority) {
        const item = {
          alignment,
          priority,
          text: "",
          tooltip: "",
          command: "",
          visible: false,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          dispose() {}
        };
        statusItems.push(item);
        return item;
      }
    }
  };

  return { mockVscode, cfgStore, executedCommands, messages, statusItems };
}

test("credentialBridge: 载荷编解码、时间归一化与邮箱打码", () => {
  assert.equal(maskEmail("alice.smith@gmail.com"), "al***@gmail.com");
  assert.equal(maskEmail("ab@example.com"), "a*@example.com");
  assert.equal(maskEmail(""), "");

  const wid = generateWriterId();
  assert.ok(wid.length >= 12);

  const secTs = normalizeExpiryIso(1800000000);
  assert.equal(secTs.expiryMs, 1800000000000);
  assert.ok(secTs.expiryIso.startsWith("2027-"));

  const payload = buildSystemCredentialPayload(
    { email: "user@test.dev", authMethod: "consumer" },
    { accessToken: "ya29.test", refreshToken: "1//refresh", expiryMs: 1800000000000, expiresIn: 3599 }
  );
  assert.equal(payload.id_token_email, "user@test.dev");
  assert.equal(payload.auth_method, "consumer");
  assert.equal(payload.token.access_token, "ya29.test");
  assert.equal(payload.token.refresh_token, "1//refresh");
  assert.ok(payload.writer_id.length >= 12);

  const parsed = parseSystemCredentialPayload(JSON.stringify(payload));
  assert.equal(parsed.email, "user@test.dev");
  assert.equal(parsed.accessToken, "ya29.test");
  assert.equal(parsed.refreshToken, "1//refresh");
  assert.equal(parsed.expiryMs, 1800000000000);
});

test("credentialBridge: Mock 系统凭据读写（不传明文到命令行参数）与临时 ~/.gemini 原子同步", () => {
  const fakeCreds = new Map();
  const mockExec = (bin, args, opts) => {
    assert.equal(bin, "powershell.exe");
    const joinedArgs = args.join(" ");
    assert.equal(joinedArgs.includes("secret-token"), false, "绝不能通过命令行参数传递令牌");

    if (opts.input && opts.input.includes("\t")) {
      const nl = opts.input.indexOf("\n");
      const header = opts.input.slice(0, nl).trim();
      const [target] = header.split("\t");
      fakeCreds.set(target, opts.input.slice(nl + 1));
      return { status: 0, stdout: "", stderr: "" };
    }
    const target = String(opts.input || "").trim();
    if (!fakeCreds.has(target)) {
      return { status: 2, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: fakeCreds.get(target), stderr: "" };
  };

  const emptyRead = readSystemCredential({ platform: "win32", exec: mockExec });
  assert.equal(emptyRead.ok, false);
  assert.equal(emptyRead.notFound, true);

  const wr = writeSystemCredential(
    {
      token: { access_token: "secret-token", refresh_token: "1//ref", token_type: "Bearer", expires_in: 3599 },
      auth_method: "consumer",
      id_token_email: "demo@example.com",
      writer_id: "w1"
    },
    { platform: "win32", exec: mockExec }
  );
  assert.equal(wr.ok, true);

  const rd = readSystemCredential({ platform: "win32", exec: mockExec });
  assert.equal(rd.ok, true);
  assert.equal(rd.email, "demo@example.com");
  assert.equal(rd.accessToken, "secret-token");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-fusion-cred-"));
  try {
    const geminiDir = path.join(tmpDir, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(
      path.join(geminiDir, "google_accounts.json"),
      JSON.stringify({ active: "old1@example.com", old: ["older@example.com"] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(geminiDir, "oauth_creds.json"),
      JSON.stringify({ scope: "custom-scope" }),
      "utf8"
    );

    syncGeminiCompatFiles(
      {
        email: "new@example.com",
        accessToken: "ya29.new",
        refreshToken: "1//new",
        expiryMs: 1800000000000
      },
      { geminiDir }
    );

    const compat = readGeminiCompatFiles({ geminiDir });
    assert.equal(compat.activeEmail, "new@example.com");
    assert.deepEqual(compat.accounts.old, ["old1@example.com", "older@example.com"]);
    assert.equal(compat.oauth.scope, "custom-scope");
    assert.equal(compat.oauth.access_token, "ya29.new");

    const daemonDir = path.join(tmpDir, "daemon");
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(path.join(daemonDir, "hub_1001.json"), JSON.stringify({ pid: 1001, httpPort: 8081 }), "utf8");
    fs.writeFileSync(path.join(daemonDir, "hub_1002.json"), JSON.stringify({ pid: 1002, httpPort: 8082 }), "utf8");
    fs.writeFileSync(path.join(daemonDir, "hub_dead.json"), JSON.stringify({ pid: 9999, httpPort: 8083 }), "utf8");

    const hubs = detectActiveHubInstances({
      daemonDirs: [daemonDir],
      isPidAlive: (pid) => pid === 1001 || pid === 1002
    });
    assert.equal(hubs.count, 2);
    assert.deepEqual(hubs.pids.sort(), [1001, 1002]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("accountStore: 加密存储、严格剥离公开字段密钥、退出快照记录、导入外部目录与 JSON 往返", async () => {
  const ctx = createMockContext();
  const store = new AccountStore({ context: ctx });

  const r1 = await store.upsertAccount(
    { email: "Alice@Example.com", alias: "主力号", tierName: "Pro", source: "captured" },
    { accessToken: "tok_a", refreshToken: "ref_a", expiryMs: 1800000000000 }
  );
  assert.equal(r1.isNew, true);

  const r2 = await store.upsertAccount(
    { email: "alice@example.com", tierName: "Ultra", source: "captured" },
    { accessToken: "tok_a2", refreshToken: "ref_a2" }
  );
  assert.equal(r2.isNew, false);
  assert.equal(r2.account.alias, "主力号");
  assert.equal(r2.account.tierName, "Ultra");

  const pubList = store.listPublicAccounts();
  assert.equal(pubList.length, 1);
  const jsonText = JSON.stringify(pubList);
  assert.equal(jsonText.includes("tok_a2"), false, "公开列表绝不能包含 accessToken");
  assert.equal(jsonText.includes("ref_a2"), false, "公开列表绝不能包含 refreshToken");

  const secret = await store.getAccountSecret(makeAccountId("alice@example.com"));
  assert.equal(secret.accessToken, "tok_a2");
  assert.equal(secret.refreshToken, "ref_a2");

  // recordExitQuotaSnapshot：记录新数据 + 未取到数据时保留原 groups 打标 exit
  const tExit1 = Date.now();
  await store.recordExitQuotaSnapshot("alice@example.com", {
    exitedAtMs: tExit1,
    quotaGroups: [
      { displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.42, resetTime: "2026-11-24T20:00:00Z" }] }
    ]
  });
  let aliceMeta = store.findByEmail("alice@example.com");
  assert.equal(aliceMeta.lastExitedAtMs, tExit1);
  assert.equal(aliceMeta.quotaSnapshot.snapshotKind, "exit");
  assert.equal(aliceMeta.quotaSnapshot.groups[0].buckets[0].remainingFraction, 0.42);

  const tExit2 = tExit1 + 5000;
  await store.recordExitQuotaSnapshot("alice@example.com", {
    exitedAtMs: tExit2,
    quotaGroups: []
  });
  aliceMeta = store.findByEmail("alice@example.com");
  assert.equal(aliceMeta.lastExitedAtMs, tExit2);
  assert.equal(aliceMeta.quotaSnapshot.exitedAtMs, tExit2);
  assert.equal(aliceMeta.quotaSnapshot.groups[0].buckets[0].remainingFraction, 0.42, "抓不到新配额时不得清空历史快照");

  // 一次性只读导入 .antigravity_tools
  const tmpTools = fs.mkdtempSync(path.join(os.tmpdir(), "agy-tools-import-"));
  try {
    const accDir = path.join(tmpTools, "accounts");
    fs.mkdirSync(accDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpTools, "accounts.json"),
      JSON.stringify({ accounts: [{ email: "bob@test.dev", name: "Bob" }] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(accDir, "bob.json"),
      JSON.stringify({
        email: "bob@test.dev",
        name: "Bob",
        token: { access_token: "bob_at", refresh_token: "bob_rt", expiry_timestamp: 1800000000 },
        quota: {
          subscription_tier: "PRO",
          quota_groups: [
            {
              display_name: "Gemini Models",
              buckets: { "5h": { remaining_fraction: 0.72, reset_time: "2026-11-24T16:00:00Z" } }
            }
          ]
        }
      }),
      "utf8"
    );

    const impRes = await store.importFromAntigravityTools(tmpTools);
    assert.equal(impRes.imported, 1);
    const bob = store.findByEmail("bob@test.dev");
    assert.ok(bob);
    assert.equal(bob.tierName, "PRO");
    assert.equal(bob.quotaSnapshot.snapshotKind, "imported");
    assert.equal(bob.quotaSnapshot.groups[0].buckets[0].remainingFraction, 0.72);

    const exportedNoSecret = JSON.parse(await store.exportToJsonBundle({ includeSecrets: false }));
    assert.equal(exportedNoSecret.accounts.length, 2);
    assert.equal(exportedNoSecret.accounts[0].secret, undefined);

    const exportedWithSecret = await store.exportToJsonBundle({ includeSecrets: true });
    const ctx2 = createMockContext();
    const store2 = new AccountStore({ context: ctx2 });
    const reImp = await store2.importFromJsonBundle(exportedWithSecret);
    assert.equal(reImp.imported, 2);

    assert.equal(await store.removeAccount(bob.id), true);
    assert.equal(store.listPublicAccounts().length, 1);

    const aliceId = makeAccountId("alice@example.com");
    await store.setLastHealthyAccountId(aliceId);
    assert.equal(store.getLastHealthyAccountId(), aliceId);

    const newerSync = await store.syncFreshSecretIfNewer("alice@example.com", {
      accessToken: "tok_a3_fresh",
      refreshToken: "ref_a2",
      writerId: "wid_new_999",
      expiryMs: Date.now() + 3600_000,
      oauthClientKey: "antigravity_enterprise"
    });
    assert.equal(newerSync.updated, true);
    assert.equal(store.getAccountMeta(aliceId).oauthClientKey, "antigravity_enterprise");
  } finally {
    fs.rmSync(tmpTools, { recursive: true, force: true });
  }
});

test("quotaTracker: 退出余量评估、越过 resetTime 自动回满、同余量最快回满优先排序与倒计时格式化", () => {
  const baseNow = Date.UTC(2026, 10, 24, 10, 0, 0);
  const pastIso = new Date(baseNow - 60_000).toISOString();
  const soonIso = new Date(baseNow + 20 * 60_000).toISOString();
  const laterIso = new Date(baseNow + 150 * 60_000).toISOString();

  // 1. evaluateBucketStatus 四种状态
  assert.equal(evaluateBucketStatus({ remainingFraction: 1, resetTime: "" }, baseNow).state, "full");
  assert.equal(evaluateBucketStatus({ remainingFraction: 0.35, resetTime: soonIso }, baseNow).state, "recovering");
  const recBucket = evaluateBucketStatus({ remainingFraction: 0.2, resetTime: pastIso }, baseNow);
  assert.equal(recBucket.state, "recovered");
  assert.equal(recBucket.recovered, true);
  assert.equal(recBucket.recordedPct, 20);
  assert.equal(recBucket.effectivePct, 100);
  assert.equal(evaluateBucketStatus({ remainingFraction: 0.5, resetTime: "" }, baseNow).state, "frozen");

  // 2. evaluateQuotaSnapshot 保留原快照且标注模式与最早回满时间
  const rawSnap = {
    fetchedAtMs: baseNow - 3600_000,
    exitedAtMs: baseNow - 3600_000,
    groups: [
      { displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.4, resetTime: laterIso }] },
      { displayName: "Claude and GPT models", buckets: [{ window: "5h", remainingFraction: 0.1, resetTime: pastIso }] }
    ]
  };
  const evExit = evaluateQuotaSnapshot(rawSnap, { nowMs: baseNow, isActive: false });
  assert.equal(evExit.mode, "exit_snapshot");
  assert.equal(evExit.hasRecovered, true);
  assert.equal(evExit.hasRecovering, true);
  assert.equal(evExit.earliestRecoveryAtMs, Date.parse(laterIso));
  assert.equal(rawSnap.groups[1].buckets[0].remainingFraction, 0.1, "纯函数不得修改原快照");

  // 3. sortAccountsByQuota：可用余量降序，同余量最快回满优先
  const accRecovered = {
    email: "recovered@test.dev",
    quotaSnapshot: { groups: [{ buckets: [{ remainingFraction: 0.1, resetTime: pastIso }] }] }
  };
  const accFull = {
    email: "full@test.dev",
    quotaSnapshot: { groups: [{ buckets: [{ remainingFraction: 1 }] }] }
  };
  const accZeroSoon = {
    email: "soon@test.dev",
    quotaSnapshot: { groups: [{ buckets: [{ remainingFraction: 0, resetTime: soonIso }] }] }
  };
  const accZeroLater = {
    email: "later@test.dev",
    quotaSnapshot: { groups: [{ buckets: [{ remainingFraction: 0, resetTime: laterIso }] }] }
  };
  const accUnknown = { email: "unknown@test.dev", quotaSnapshot: null };

  assert.equal(computeAccountQuotaScore(accRecovered, baseNow), 100);
  assert.equal(computeAccountQuotaScore(accUnknown, baseNow), -1);

  const sorted = sortAccountsByQuota([accUnknown, accZeroLater, accZeroSoon, accFull], baseNow);
  assert.deepEqual(
    sorted.map((a) => a.email),
    ["full@test.dev", "soon@test.dev", "later@test.dev", "unknown@test.dev"]
  );

  // 4. formatCountdown
  assert.equal(formatCountdown(0), "已回满");
  assert.equal(formatCountdown(-5000, { lang: "en" }), "Full");
  assert.equal(formatCountdown(45_000), "45s");
  assert.equal(formatCountdown(2 * 3600_000 + 5 * 60_000 + 9_000, { showSeconds: true }), "2h 05m 09s");
  assert.equal(formatCountdown(2 * 3600_000 + 5 * 60_000, { compact: true }), "2h5m");
});

test("accountManager: 退出余额定格、冷重启调用、失败自动回退重载、低配额推荐与底栏悬停倒计时", async () => {
  const origLoad = Module._load;
  const { mockVscode, executedCommands } = createMockVscode({
    "agyFusion.account.reloadAfterSwitch": "coldRestart",
    "agyFusion.account.syncGeminiCli": true,
    "agyFusion.account.syncOnboardingState": true,
    "agyFusion.account.privacyMask": false
  });
  const managerPath = require.resolve("../src/accountManager");
  const sbPath = require.resolve("../src/statusBar");
  delete require.cache[managerPath];
  delete require.cache[sbPath];
  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const { AccountManager } = require("../src/accountManager");
    const { StatusBarController } = require("../src/statusBar");
    const ctx = createMockContext();
    const store = new AccountStore({ context: ctx });

    const pastIso = new Date(Date.now() - 120_000).toISOString();
    const futureIso = new Date(Date.now() + 90 * 60_000).toISOString();

    await store.upsertAccount(
      {
        email: "active@example.com",
        tierName: "Pro",
        quotaSnapshot: {
          fetchedAtMs: Date.now(),
          tierName: "Pro",
          groups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.08, resetTime: futureIso }] }]
        }
      },
      { accessToken: "at_active", refreshToken: "rt_active", expiryMs: Date.now() + 3600_000 }
    );
    await store.upsertAccount(
      {
        email: "backup@example.com",
        alias: "满血备用",
        tierName: "Ultra",
        quotaSnapshot: {
          fetchedAtMs: Date.now() - 6 * 3600_000,
          tierName: "Ultra",
          groups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.25, resetTime: pastIso }] }]
        }
      },
      { accessToken: "at_backup", refreshToken: "rt_backup", expiryMs: Date.now() + 3600_000 }
    );
    await store.upsertAccount(
      {
        email: "cooling@example.com",
        tierName: "Free",
        quotaSnapshot: {
          fetchedAtMs: Date.now() - 1000,
          exitedAtMs: Date.now() - 1000,
          groups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.4, resetTime: futureIso }] }]
        }
      },
      { accessToken: "at_cool", refreshToken: "rt_cool", expiryMs: Date.now() + 3600_000 }
    );

    let currentSysEmail = "active@example.com";
    let failNextWrite = false;
    let hubQuotaFrac = 0.06;
    let coldRestartRes = { ok: true, exePath: "C:\\mock\\Antigravity IDE.exe" };
    let coldRestartCalls = [];
    let onboardingSyncCalls = [];

    const manager = new AccountManager({
      store,
      resolveNodePath: () => ({ ok: true, nodePath: process.execPath }),
      ideRestart: {
        scheduleColdRestart(opts) {
          coldRestartCalls.push(opts);
          return coldRestartRes;
        }
      },
      capsuleClient: {
        async getQuota() {
          return {
            ok: true,
            userEmail: currentSysEmail,
            userName: "Tester",
            userTierName: "Pro",
            quotaGroups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: hubQuotaFrac, resetTime: futureIso }] }]
          };
        },
        async syncOnboardingEmail(email, opts) {
          onboardingSyncCalls.push({ email, ...opts });
          return { ok: true };
        }
      },
      bridge: {
        maskEmail,
        generateWriterId,
        buildSystemCredentialPayload,
        readSystemCredential() {
          return {
            ok: true,
            email: currentSysEmail,
            authMethod: "consumer",
            writerId: "w_cur",
            accessToken: "at_cur",
            refreshToken: "rt_cur",
            raw: { id_token_email: currentSysEmail, token: { access_token: "at_cur", refresh_token: "rt_cur" } }
          };
        },
        writeSystemCredential(payload) {
          if (failNextWrite) {
            failNextWrite = false;
            return { ok: false, error: "模拟写入失败" };
          }
          currentSysEmail = payload.id_token_email;
          return { ok: true };
        },
        readGeminiCompatFiles: () => ({ activeEmail: currentSysEmail }),
        syncGeminiCompatFiles: () => ({ ok: true }),
        detectActiveHubInstances: () => ({ count: 1, pids: [11] })
      },
      vscodeApi: mockVscode,
      logger: { log() {} }
    });

    // 1. 低配额推荐应自动识别「已过重置点回满」的 backup@example.com 为 100%
    const st = await manager.getActiveState();
    assert.equal(st.activeEmail, "active@example.com");
    assert.ok(st.recommendation);
    assert.equal(st.recommendation.email, "backup@example.com");
    assert.equal(st.recommendation.candidateMinPct, 100);

    // 2. 写入失败自动回滚
    const backupId = makeAccountId("backup@example.com");
    failNextWrite = true;
    const failRes = await manager.switchAccount(backupId);
    assert.equal(failRes.ok, false);
    assert.equal(currentSysEmail, "active@example.com");

    // 3. coldRestart 模式切换：切走前应定格 active@example.com 最新退出余额 0.06，并执行 workbench.action.quit
    const swCold = await manager.switchAccount(backupId);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(swCold.ok, true);
    assert.equal(swCold.coldRestartScheduled, true);
    assert.equal(coldRestartCalls.length, 1);
    assert.equal(coldRestartCalls[0].email, "backup@example.com");
    assert.equal(coldRestartCalls[0].isGcpTos, false);
    assert.ok(executedCommands.some((c) => c.cmd === "workbench.action.quit"));

    const activeMetaAfterExit = store.findByEmail("active@example.com");
    assert.equal(activeMetaAfterExit.quotaSnapshot.snapshotKind, "exit");
    assert.equal(activeMetaAfterExit.quotaSnapshot.groups[0].buckets[0].remainingFraction, 0.06);
    assert.ok(activeMetaAfterExit.lastExitedAtMs > 0);

    // 4. 若 scheduleColdRestart 失败，绝不 quit，应安全回退调用 syncOnboardingEmail + reloadWindow
    const prevQuitCount = executedCommands.filter((c) => c.cmd === "workbench.action.quit").length;
    coldRestartRes = { ok: false, fallbackToReload: true, error: "no exe" };
    const activeId = makeAccountId("active@example.com");
    const swFallback = await manager.switchAccount(activeId);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(swFallback.ok, true);
    assert.equal(swFallback.coldRestartScheduled, false);
    assert.equal(executedCommands.filter((c) => c.cmd === "workbench.action.quit").length, prevQuitCount);
    assert.ok(executedCommands.some((c) => c.cmd === "workbench.action.reloadWindow"));
    assert.equal(onboardingSyncCalls[0].email, "active@example.com");

    // 5. 回归验证：切号前备份已入库账号保留原 source，在线 updateQuotaSnapshot 不污染 exitedAtMs，dispose 后守护直接跳过
    await store.upsertAccount(
      { email: "native-src@example.com", source: "official-login" },
      { accessToken: "at_ns", refreshToken: "rt_ns", expiryMs: Date.now() + 3600_000 }
    );
    currentSysEmail = "native-src@example.com";
    await manager.switchAccount(backupId, { reloadOverride: "none" });
    assert.equal(store.findByEmail("native-src@example.com").source, "official-login", "切号前自动备份不得覆盖原来源标签");

    await store.updateQuotaSnapshot("native-src@example.com", {
      snapshotKind: "live",
      quotaGroups: [{ displayName: "Gemini Models", buckets: [{ window: "5h", remainingFraction: 0.9 }] }]
    });
    assert.equal(store.findByEmail("native-src@example.com").quotaSnapshot.exitedAtMs, undefined, "live 快照不应混入旧退出时间");

    manager.dispose();
    const disposedGuard = await manager.keepFreshAndGuard({ force: true });
    assert.equal(disposedGuard.reason, "disposed");

    // 6. StatusBarController 悬停显示「套餐简称 + 仅 Gemini 5h/周额度与恢复倒计时」，无废弃指令
    const sb = new StatusBarController({
      backendClient: { async requestApi() { return { ok: false }; } },
      capsuleClient: { async inspectConversation() { return null; }, async getQuota() { return null; } },
      dashboardController: { syncConversations() {}, getResolvedConversationId() { return ""; }, getCapsulePrefs() { return {}; } },
      accountManager: manager,
      resolveRuntime: () => ({ ok: false }),
      logger: { log() {} }
    });
    const weekFutureIso = new Date(Date.now() + (4 * 86400 + 5 * 3600) * 1000).toISOString();
    await store.upsertAccount(
      {
        email: "recovered@example.com",
        alias: "已回满号",
        tierName: "Google AI Pro",
        quotaSnapshot: {
          fetchedAtMs: Date.now() - 6 * 3600_000,
          exitedAtMs: Date.now() - 6 * 3600_000,
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.09, resetTime: weekFutureIso },
                { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.2, resetTime: pastIso }
              ]
            },
            {
              displayName: "Claude and GPT models",
              buckets: [
                { bucketId: "3p-weekly", window: "weekly", remainingFraction: 1, resetTime: weekFutureIso },
                { bucketId: "3p-5h", window: "5h", remainingFraction: 1, resetTime: futureIso }
              ]
            }
          ]
        }
      },
      { accessToken: "at_rec", refreshToken: "rt_rec", expiryMs: Date.now() + 3600_000 }
    );
    await store.upsertAccount(
      {
        email: "starter@example.com",
        tierName: "Antigravity Starter Quota",
        quotaSnapshot: {
          fetchedAtMs: Date.now() - 1000,
          exitedAtMs: Date.now() - 1000,
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [{ bucketId: "gemini-5h", window: "5h", remainingFraction: 0.4, resetTime: futureIso }]
            }
          ]
        }
      },
      { accessToken: "at_st", refreshToken: "rt_st", expiryMs: Date.now() + 3600_000 }
    );
    sb._updateAccountCapsule({ userEmail: "active@example.com", userTierName: "Google AI Pro" });
    const tip = sb._accountItem.tooltip.value;
    assert.ok(tip.includes("· Pro\n"), "当前活跃行套餐应显示简称 Pro");
    assert.ok(tip.includes("\\[Pro\\]"), "列表套餐应显示简称 [Pro]");
    assert.ok(tip.includes("\\[Starter\\]"), "Antigravity Starter Quota 应压缩显示为 [Starter]");
    assert.equal(tip.includes("Google AI Pro"), false, "底栏悬停不应出现冗长套餐全称 Google AI Pro");
    assert.equal(tip.includes("Antigravity Starter Quota"), false, "底栏悬停不应出现冗长套餐全称");
    assert.equal(tip.includes("Claude"), false, "底栏悬停应只显示 Gemini 相关用量，排除 Claude/GPT");
    assert.ok(tip.includes("5h 100%\\(已回满\\)"), "已过重置点的 5h 桶应显示已回满");
    assert.ok(tip.includes("周 9%\\(满额 4d"), "周额度恢复中应同时显示周余量与恢复倒计时");
    assert.ok(tip.includes("5h 40%\\(满额 "), "倒计时中的后台号应显示 5h 退出余量与满额倒计时");
    assert.equal(sb._accountItem.tooltip.isTrusted.enabledCommands.includes("agyFusion.syncAllQuotas"), false);
    assert.equal(sb._accountItem.tooltip.isTrusted.enabledCommands.includes("agyFusion.warmupAllAccounts"), false);

    // 验证隐私打码
    await manager.saveAccountPrefs({ privacyMask: true });
    sb._updateAccountCapsule({ userEmail: "active@example.com", userTierName: "Google AI Pro" });
    assert.equal(sb._accountItem.text, "$(account) ac***");
    assert.equal(sb._accountItem.tooltip.value.includes("active@example.com"), false);
    sb.dispose();
  } finally {
    Module._load = origLoad;
    delete require.cache[managerPath];
    delete require.cache[sbPath];
  }
});

test("onboardingSync & coldRestartHelper & ideRestart: 全引导键同步 + 真实子进程集成测试 + 超时不强杀 + 降级保护", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-cold-restart-"));
  try {
    const { DatabaseSync } = require("node:sqlite");
    const { syncOnboardingEmail } = await import("../src/onboardingSync.mjs");
    const {
      sanitizeLaunchEnv,
      waitForProcessExit,
      runColdRestartJob
    } = await import("../src/coldRestartHelper.mjs");

    // 1. 验证 sanitizeLaunchEnv 彻底清除 ELECTRON_RUN_AS_NODE 与 VSCODE_* 变量
    const cleanedEnv = sanitizeLaunchEnv({
      PATH: "C:\\Windows",
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_IPC_HOOK: "\\\\.\\pipe\\abc",
      VSCODE_PID: "999",
      HOME: "/home/u"
    });
    assert.equal(cleanedEnv.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(cleanedEnv.VSCODE_IPC_HOOK, undefined);
    assert.equal(cleanedEnv.VSCODE_PID, undefined);
    assert.equal(cleanedEnv.PATH, "C:\\Windows");

    // 2. 验证 syncOnboardingEmail 同步全部 6 处引导键含 isGcpTos 并清理 jetski 子键
    const dbPath = path.join(tmpDir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("agy.onboarding.lastLoginUsername", "old@test.dev");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("jetski.onboarding.lastLoginUsername", "old@test.dev");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "google.google-antigravity",
      JSON.stringify({
        "antigravity.accountTelemetryEnabled": true,
        "antigravity-storage": {
          "agy.onboarding.lastLoginUsername": "old@test.dev",
          "jetski.onboarding.lastLoginUsername": "stale@test.dev",
          "jetski.onboarding.lastLoginIsGcpTos": "true",
          "projectsOrder": ["keep-project-123"]
        }
      })
    );
    db.close();

    const syncRes = syncOnboardingEmail("next@test.dev", { dbPaths: [dbPath], isGcpTos: true });
    assert.equal(syncRes.ok, true);
    const checkDb = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'agy.onboarding.lastLoginUsername'").get().value, "next@test.dev");
    assert.equal(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'jetski.onboarding.lastLoginUsername'").get().value, "next@test.dev");
    assert.equal(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'agy.onboarding.lastLoginIsGcpTos'").get().value, "true");
    assert.equal(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'jetski.onboarding.lastLoginIsGcpTos'").get().value, "true");
    assert.equal(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityOnboarding'").get().value, "true");
    const gObj = JSON.parse(checkDb.prepare("SELECT value FROM ItemTable WHERE key = 'google.google-antigravity'").get().value);
    assert.equal(gObj["antigravity-storage"]["agy.onboarding.lastLoginUsername"], "next@test.dev");
    assert.equal(gObj["antigravity-storage"]["agy.onboarding.lastLoginIsGcpTos"], "true");
    assert.equal(gObj["antigravity-storage"]["jetski.onboarding.lastLoginUsername"], undefined);
    assert.equal(gObj["antigravity-storage"]["jetski.onboarding.lastLoginIsGcpTos"], undefined);
    assert.deepEqual(gObj["antigravity-storage"].projectsOrder, ["keep-project-123"]);
    checkDb.close();

    // 3. 验证 waitForProcessExit 超时绝不强杀
    const timeoutRes = await waitForProcessExit({
      waitTimeoutMs: 120,
      pollIntervalMs: 30,
      isRunningFn: () => true
    });
    assert.equal(timeoutRes.exited, false);
    assert.equal(timeoutRes.timedOut, true);

    const noRun = await runColdRestartJob(
      { exePath: path.join(tmpDir, "nonexistent.exe"), waitTimeoutMs: 120, pollIntervalMs: 30 },
      {
        isRunningFn: () => true,
        sleepFn: async () => {},
        spawnFn: () => { throw new Error("超时不得 spawn"); }
      }
    );
    assert.equal(noRun.ok, false);
    assert.equal(noRun.reason, "timeout");

    // 4. 真实子进程冷重启集成测试：运行 mock 目标进程 + 真 helper 进程等待退出 -> 更新 db -> 清洗环境启动新进程写出 marker
    const { spawn } = require("node:child_process");
    const mockExeTarget = process.execPath;
    const dbPath2 = path.join(tmpDir, "state2.vscdb");
    fs.copyFileSync(dbPath, dbPath2);
    const markerFile2 = path.join(tmpDir, "relaunched-exe.json");
    const sleeper2 = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 300);"], {
      stdio: "ignore",
      windowsHide: true
    });
    const relaunchPayloadScript = path.join(tmpDir, "write-marker.js");
    fs.writeFileSync(
      relaunchPayloadScript,
      `require("fs").writeFileSync(${JSON.stringify(markerFile2)}, JSON.stringify({
        electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
        vscodePid: process.env.VSCODE_PID || null
      }));`,
      "utf8"
    );

    const jobPath2 = path.join(tmpDir, "job2.json");
    fs.writeFileSync(
      jobPath2,
      JSON.stringify({
        exePath: mockExeTarget,
        processName: "",
        launchArgs: [relaunchPayloadScript],
        email: "cold-ok@test.dev",
        isGcpTos: false,
        syncOnboarding: true,
        dbPaths: [dbPath2],
        waitPids: [sleeper2.pid],
        waitTimeoutMs: 6000,
        pollIntervalMs: 60,
        postExitDelayMs: 100
      }),
      "utf8"
    );

    const helperRes = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.resolve(__dirname, "..", "src", "coldRestartHelper.mjs"), jobPath2],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VSCODE_PID: "7788" },
          windowsHide: true
        }
      );
      child.on("close", (code) => resolve(code));
    });
    assert.equal(helperRes, 0, "冷重启 helper 应正常退出并完成任务");

    const waitEnd = Date.now() + 3000;
    while (!fs.existsSync(markerFile2) && Date.now() < waitEnd) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(fs.existsSync(markerFile2), true, "冷重启 helper 应在旧进程退出后重新拉起新进程");
    const markerObj = JSON.parse(fs.readFileSync(markerFile2, "utf8"));
    assert.equal(markerObj.electronRunAsNode, null, "必须清除 ELECTRON_RUN_AS_NODE");
    assert.equal(markerObj.vscodePid, null, "必须清除 VSCODE_PID");
    assert.equal(fs.existsSync(jobPath2), false, "临时 job 文件应已自动清理");

    const dbCheck2 = new DatabaseSync(dbPath2, { readOnly: true });
    assert.equal(dbCheck2.prepare("SELECT value FROM ItemTable WHERE key = 'agy.onboarding.lastLoginUsername'").get().value, "cold-ok@test.dev");
    dbCheck2.close();

    // 5. ideRestart 路径探测与缺失降级保护
    const mockAppRootWrap = path.join(tmpDir, "FakeIDE");
    const mockAppRoot = path.join(mockAppRootWrap, "resources", "app");
    fs.mkdirSync(mockAppRoot, { recursive: true });
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(mockAppRootWrap, "Antigravity IDE.exe"), "stub", "utf8");
      const foundExe = resolveIdeExecutable({ appRoot: mockAppRoot, execPath: process.execPath, env: {} });
      assert.equal(foundExe, path.join(mockAppRootWrap, "Antigravity IDE.exe"));
    }

    const argsWithRestore = buildRestartLaunchArgs({ workspace: { getConfiguration: () => ({ get: () => "all" }) } });
    assert.deepEqual(argsWithRestore, []);
    const argsNoRestore = buildRestartLaunchArgs({
      workspace: {
        getConfiguration: () => ({ get: () => "none" }),
        workspaceFolders: [{ uri: { scheme: "file", fsPath: "D:\\proj" } }]
      }
    });
    assert.deepEqual(argsNoRestore, ["D:\\proj"]);

    const badNodeSched = scheduleColdRestart({ nodePath: path.join(tmpDir, "missing-node.exe"), exePath: mockExeTarget });
    assert.equal(badNodeSched.ok, false);
    assert.equal(badNodeSched.fallbackToReload, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("extension & accountUi: 配置迁移(含v4冷重启升级)/前端脚本语法/极简UI校验与零硬编码密钥断言", async () => {
  const css = getAccountCss();
  const html = getAccountPaneHtml();
  const scriptHtml = getAccountClientScript();
  const code = scriptHtml.replace(/^<script>/, "").replace(/<\/script>$/, "");
  assert.doesNotThrow(() => new Function(code));
  assert.equal(css.includes(".acc-oauth-"), false, "已移除 OAuth 配置箱样式");
  assert.equal(html.includes("acc-oauth-"), false, "已移除 OAuth 配置 DOM");
  assert.equal(html.includes("acc-sync-all-btn"), false, "已移除刷新全部按钮");
  assert.equal(html.includes("acc-warmup-all-btn"), false, "已移除预热按钮");
  assert.equal(html.includes('value="coldRestart"'), true);
  assert.equal(scriptHtml.includes("acc-countdown-chip"), true);
  assert.equal(css.includes(".acc-qgroup"), true, "详情页应包含双窗口分组样式");
  assert.equal(css.includes(".acc-qgroup-grid"), true, "详情页应包含双列并排紧凑布局样式");
  assert.equal(css.includes(".acc-win-tag.is-weekly"), true, "详情页应包含周额度徽标样式");
  assert.equal(scriptHtml.includes("pickWindowBucketsClient"), true, "详情页脚本应支持 5h/周双窗口排序渲染");
  assert.equal(scriptHtml.includes("formatCountdownCompactClient"), true, "详情页脚本应使用紧凑倒计时格式");
  assert.equal(scriptHtml.includes("shortTierName"), true, "详情页脚本应支持套餐简称");
  assert.equal(scriptHtml.includes('data-quota-window="'), true, "详情页应标注每个进度条窗口类型");

  // 零硬编码密钥扫描
  const forbiddenPrefix = "GOCSPX" + "-";
  for (const rel of [
    "src/quotaTracker.js",
    "src/onboardingSync.mjs",
    "src/coldRestartHelper.mjs",
    "src/ideRestart.js",
    "src/accountStore.js",
    "src/accountManager.js",
    "src/accountUi.js",
    "src/statusBar.js",
    "src/extension.js"
  ]) {
    const text = fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
    assert.equal(text.includes(forbiddenPrefix), false, `${rel} 绝不可包含硬编码密钥前缀`);
  }

  const origLoad = Module._load;
  const { mockVscode, cfgStore } = createMockVscode({
    "agyDartPanel.defaultTab": "dart",
    "agyDartPanel.refreshIntervalSec": 15,
    "agyFusion.account.reloadAfterSwitch": "ask"
  });
  const extPath = require.resolve("../src/extension");
  delete require.cache[extPath];
  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const { migrateLegacyConfiguration, migrateV4AccountConfig } = require("../src/extension");
    const ctx = createMockContext();
    const migrated = await migrateLegacyConfiguration(ctx, { log() {} }, mockVscode);
    assert.equal(migrated, 2);
    assert.equal(cfgStore.get("agyFusion.defaultTab"), "dart");

    // 首次升级 v4：若用户是旧默认 ask，自动升级为 coldRestart
    const upgraded = await migrateV4AccountConfig(ctx, { log() {} }, mockVscode);
    assert.equal(upgraded, true);
    assert.equal(cfgStore.get("agyFusion.account.reloadAfterSwitch"), "coldRestart");

    // 再次调用幂等
    cfgStore.set("agyFusion.account.reloadAfterSwitch", "auto");
    const secondV4 = await migrateV4AccountConfig(ctx, { log() {} }, mockVscode);
    assert.equal(secondV4, false);
    assert.equal(cfgStore.get("agyFusion.account.reloadAfterSwitch"), "auto");
  } finally {
    Module._load = origLoad;
    delete require.cache[extPath];
  }
});

test("authHealth & 防掉线护盾 & 新官方登录覆盖: 登录中/主动登出/60秒宽限期不拦截 + 写前终极熔断闸 + 新号捕获与旧号覆盖", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-anti-intercept-"));
  const origLoad = Module._load;
  const { mockVscode } = createMockVscode({
    "agyFusion.account.autoHealMode": "auto",
    "agyFusion.account.keepFreshBackup": true,
    "agyFusion.account.syncGeminiCli": true
  });
  const managerPath = require.resolve("../src/accountManager");
  delete require.cache[managerPath];

  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const logDirSigningIn = path.join(tmpDir, "logs-signin", "20261124T140000");
    fs.mkdirSync(logDirSigningIn, { recursive: true });
    fs.writeFileSync(
      path.join(logDirSigningIn, "auth.log"),
      [
        "2026-11-24 14:20:00.000 [info] [Auth] Auth state changed to: validatingLogin",
        "2026-11-24 14:20:01.000 [info] [Auth] Opening browser for OAuth loginWithRedirect"
      ].join("\n"),
      "utf8"
    );
    const nowSignin = Date.parse("2026-11-24T14:20:20");
    const parsedSignin = inspectLatestAuthLog({ logsRoot: path.join(tmpDir, "logs-signin"), nowMs: nowSignin });
    assert.equal(parsedSignin.isAuthInProgress, true);

    const logDirLogout = path.join(tmpDir, "logs-logout", "20261124T140000");
    fs.mkdirSync(logDirLogout, { recursive: true });
    fs.writeFileSync(
      path.join(logDirLogout, "auth.log"),
      [
        "2026-11-24 14:20:00.000 [info] [Auth] User signed out cleanly",
        "2026-11-24 14:20:01.000 [info] [Auth] Auth state changed to: signedOut"
      ].join("\n"),
      "utf8"
    );
    const parsedLogout = inspectLatestAuthLog({ logsRoot: path.join(tmpDir, "logs-logout"), nowMs: nowSignin });
    assert.equal(parsedLogout.isIntentionalLogout, true);

    const logDirRevoked = path.join(tmpDir, "logs-revoked", "20261124T140000");
    fs.mkdirSync(logDirRevoked, { recursive: true });
    fs.writeFileSync(
      path.join(logDirRevoked, "auth.log"),
      [
        "2026-11-24 14:20:00.000 [error] [Auth] Refresh token invalid, logging out user (invalid_grant)",
        "2026-11-24 14:20:01.000 [info] [Auth] Auth state changed to: signedOut"
      ].join("\n"),
      "utf8"
    );
    const parsedRevoked = inspectLatestAuthLog({ logsRoot: path.join(tmpDir, "logs-revoked"), nowMs: nowSignin });
    assert.equal(parsedRevoked.invalidGrantDetected, true);
    assert.equal(parsedRevoked.isIntentionalLogout, false);

    const markerDir = path.join(tmpDir, "gemini-agy");
    fs.mkdirSync(markerDir, { recursive: true });
    const markerFile = path.join(markerDir, "keyring-marker-123");
    const normalFile = path.join(markerDir, "antigravity_state.pbtxt");
    fs.writeFileSync(markerFile, "1", "utf8");
    fs.writeFileSync(normalFile, "keep-me", "utf8");
    const anomalies = detectKeyringAnomalies({ scanDirs: [markerDir] });
    assert.equal(anomalies.allFiles.length, 1);
    clearKeyringAnomalyFiles([...anomalies.allFiles, normalFile]);
    assert.equal(fs.existsSync(normalFile), true);
    assert.equal(fs.existsSync(markerFile), false);

    const { AccountManager } = require("../src/accountManager");
    const ctx = createMockContext();
    const store = new AccountStore({ context: ctx });

    await store.upsertAccount(
      {
        email: "old-tools@test.dev",
        oauthClientKey: "antigravity_enterprise",
        source: "antigravity-tools"
      },
      { accessToken: "at_old_tools", refreshToken: "rt_old_tools", expiryMs: Date.now() + 1000 }
    );

    let mockSysCred = { ok: false, error: "NotFound" };
    let mockLogState = {
      found: true,
      latestState: "validatingLogin",
      isAuthInProgress: true,
      isIntentionalLogout: false,
      recentAuthSuccess: false,
      tlsErrorCount: 0,
      invalidGrantDetected: false
    };
    let mockQuota = null;
    let writtenPayloads = [];
    let geminiSyncedEmails = [];

    const manager = new AccountManager({
      store,
      capsuleClient: { async getQuota() { return mockQuota; } },
      bridge: {
        maskEmail,
        buildSystemCredentialPayload,
        readSystemCredential: () => mockSysCred,
        writeSystemCredential: (p) => { writtenPayloads.push(p); return { ok: true }; },
        syncGeminiCompatFiles: (c) => { geminiSyncedEmails.push(c.email); return { ok: true }; },
        detectActiveHubInstances: () => ({ count: 1, pids: [1] })
      },
      authHealth: {
        inspectLatestAuthLog: () => mockLogState,
        detectKeyringAnomalies: () => ({ allFiles: [], hasAnomaly: false }),
        clearKeyringAnomalyFiles: () => ({ removed: [], failed: [] }),
        evaluateAuthHealth
      },
      vscodeApi: mockVscode,
      missingGraceMs: 60,
      logger: { log() {} }
    });

    assert.equal((await manager.keepFreshAndGuard({ force: true })).action, "signing_in");
    assert.equal(writtenPayloads.length, 0);

    mockLogState = { ...mockLogState, latestState: "signedOut", isAuthInProgress: false, isIntentionalLogout: true };
    assert.equal((await manager.keepFreshAndGuard({ force: true })).action, "signed_out");
    assert.equal(writtenPayloads.length, 0);

    mockLogState = { ...mockLogState, latestState: "signedIn", isIntentionalLogout: false };
    assert.equal((await manager.keepFreshAndGuard({ force: true })).action, "grace_wait");
    assert.equal(writtenPayloads.length, 0);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await manager.keepFreshAndGuard({ force: true })).action, "auto-healed");
    assert.equal(writtenPayloads.length, 1);

    mockSysCred = {
      ok: true,
      email: "brand-new@test.dev",
      writerId: "w-new-official",
      accessToken: "at_new_official",
      refreshToken: "rt_new_official",
      expiryMs: Date.now() + 3600_000
    };
    const abortedRes = await manager.healActiveAccount({ silent: true });
    assert.equal(abortedRes.aborted, "active_or_signing_in");
    assert.equal(writtenPayloads.length, 1);

    mockQuota = {
      ok: true,
      userEmail: "brand-new@test.dev",
      userName: "NewOfficial",
      userTierName: "Google AI Ultra",
      quotaGroups: [{ displayName: "Gemini Models", buckets: [{ bucketId: "g-5h", window: "5h", remainingFraction: 1 }] }]
    };
    await manager.keepFreshAndGuard({ force: true });
    const capturedNew = store.findByEmail("brand-new@test.dev");
    assert.equal(capturedNew.source, "official-login");
    assert.ok(geminiSyncedEmails.includes("brand-new@test.dev"));

    mockSysCred = {
      ok: true,
      email: "old-tools@test.dev",
      writerId: "w-relogin-clean",
      accessToken: "at_relogin_fresh",
      refreshToken: "rt_relogin_fresh",
      expiryMs: Date.now() + 3600_000
    };
    mockQuota = {
      ok: true,
      userEmail: "old-tools@test.dev",
      userTierName: "Google AI Pro",
      quotaGroups: [{ displayName: "Gemini Models", buckets: [{ bucketId: "g-5h", window: "5h", remainingFraction: 0.96 }] }]
    };
    await manager.keepFreshAndGuard({ force: true });
    const overwrittenMeta = store.findByEmail("old-tools@test.dev");
    const overwrittenSecret = await store.getAccountSecret(overwrittenMeta.id);
    assert.equal(overwrittenSecret.accessToken, "at_relogin_fresh");
    assert.equal(overwrittenSecret.refreshToken, "rt_relogin_fresh");
    assert.equal(overwrittenMeta.oauthClientKey, "");
    assert.equal(overwrittenMeta.source, "official-login");
  } finally {
    Module._load = origLoad;
    delete require.cache[managerPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("quotaTracker & accountUi: 套餐简称映射、仅 Gemini 过滤与排序、5h+周双窗口悬停摘要及详情页双桶渲染", () => {
  // 1. 套餐简称映射
  assert.equal(formatTierShortName("Google AI Pro"), "Pro");
  assert.equal(formatTierShortName("Google AI Ultra"), "Ultra");
  assert.equal(formatTierShortName("Antigravity Starter Quota"), "Starter");
  assert.equal(formatTierShortName("Google AI Free"), "Free");
  assert.equal(formatTierShortName("Google AI Enterprise"), "Ent");
  assert.equal(formatTierShortName("Google AI Business"), "Biz");
  assert.equal(formatTierShortName(""), "");

  // 2. Gemini 相关池判定
  assert.equal(isGeminiQuotaGroup({ displayName: "Gemini Models", buckets: [{ bucketId: "gemini-5h" }] }), true);
  assert.equal(isGeminiQuotaGroup({ displayName: "Gemini 3.8 Argon", buckets: [{ bucketId: "argon-5h" }] }), true);
  assert.equal(
    isGeminiQuotaGroup({
      displayName: "Claude and GPT models",
      buckets: [{ bucketId: "3p-weekly" }, { bucketId: "3p-5h" }]
    }),
    false
  );
  assert.equal(isGeminiQuotaGroup({ displayName: "Third-Party", buckets: [{ bucketId: "3p-5h" }] }), false);

  // 3. 窗口识别与 5h 优先排序（兼容 Hub 返回 weekly 在前）
  assert.equal(classifyBucketWindow({ bucketId: "gemini-5h", window: "5h" }), "5h");
  assert.equal(classifyBucketWindow({ bucketId: "gemini-weekly", window: "weekly" }), "weekly");
  const picked = pickWindowBuckets([
    { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.09 },
    { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.9 }
  ]);
  assert.equal(picked.ordered[0].window, "5h");
  assert.equal(picked.ordered[1].window, "weekly");

  // 4. geminiOnly 排序与仅 Gemini 双窗口悬停摘要
  const now = Date.parse("2026-11-26T12:00:00Z");
  const h2Iso = new Date(now + (2 * 3600 + 15 * 60) * 1000).toISOString();
  const d4Iso = new Date(now + (4 * 86400 + 11 * 3600) * 1000).toISOString();
  const pastIso = new Date(now - 300_000).toISOString();

  const accLowGemWeek = {
    email: "low-gem@test.dev",
    tierName: "Google AI Pro",
    quotaSnapshot: {
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.09, resetTime: d4Iso },
            { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.2, resetTime: pastIso }
          ]
        },
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "3p-weekly", window: "weekly", remainingFraction: 1, resetTime: d4Iso },
            { bucketId: "3p-5h", window: "5h", remainingFraction: 1, resetTime: h2Iso }
          ]
        }
      ]
    }
  };
  const accFullGem = {
    email: "full-gem@test.dev",
    tierName: "Google AI Pro",
    quotaSnapshot: {
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.9999, resetTime: d4Iso },
            { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.9999, resetTime: h2Iso }
          ]
        },
        {
          displayName: "Claude and GPT models",
          buckets: [{ bucketId: "3p-5h", window: "5h", remainingFraction: 0.05, resetTime: h2Iso }]
        }
      ]
    }
  };

  const gemSorted = sortAccountsByQuota([accLowGemWeek, accFullGem], now, { geminiOnly: true });
  assert.deepEqual(
    gemSorted.map((a) => a.email),
    ["full-gem@test.dev", "low-gem@test.dev"],
    "geminiOnly 排序应忽略 Claude/GPT 低余量，优先 Gemini 满血账号"
  );

  const bgSummary = summarizeGeminiQuotaForHover(accLowGemWeek, { isActive: false, nowMs: now });
  assert.equal(bgSummary, "Gemini 5h 100%(已回满) · 周 9%(满额 4d11h)");
  assert.equal(bgSummary.includes("Claude"), false);

  const activeSummary = summarizeGeminiQuotaForHover(
    {
      email: "live@test.dev",
      quotaSnapshot: {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.45, resetTime: d4Iso },
              { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.18, resetTime: h2Iso }
            ]
          },
          {
            displayName: "Claude and GPT models",
            buckets: [{ bucketId: "3p-5h", window: "5h", remainingFraction: 0.5, resetTime: h2Iso }]
          }
        ]
      }
    },
    { isActive: true, nowMs: now }
  );
  assert.equal(activeSummary, "Gemini 5h 18%(2h15m) · 周 45%(4d11h)");

  const fullSummary = summarizeGeminiQuotaForHover(accFullGem, { isActive: true, nowMs: now });
  assert.equal(fullSummary, "Gemini 5h 100% · 周 100%");

  // 5. 沙盒实测 accountUi 渲染：验证详情页卡片同时渲染 5h 与周额度进度条、恢复倒计时及套餐简称
  const vm = require("node:vm");
  const scriptCode = getAccountClientScript().replace(/^<script>/, "").replace(/<\/script>$/, "");
  const domMap = new Map();
  const makeEl = (id) => ({
    id,
    innerHTML: "",
    textContent: "",
    title: "",
    value: "",
    checked: false,
    className: "",
    classList: { add() {}, remove() {} },
    setAttribute() {},
    getAttribute() { return ""; },
    addEventListener() {}
  });
  for (const id of [
    "acc-active-email", "acc-active-sub", "acc-active-badges", "acc-hub-badge",
    "acc-recommend-banner", "acc-recommend-text", "acc-recommend-btn",
    "acc-count-badge", "acc-full-count-badge", "acc-list", "acc-privacy-btn",
    "ide-tab-dot-accounts", "acc-health-badge", "acc-health-grid", "acc-health-issues"
  ]) {
    domMap.set(id, makeEl(id));
  }
  let domReadyCb = null;
  const mockPayload = {
    activeEmail: "active@test.dev",
    activeName: "Tester",
    activeTierName: "Google AI Pro",
    activeAccountId: "id_active",
    isCaptured: true,
    systemCredentialPresent: true,
    activeHubCount: 1,
    prefs: { privacyMask: false, reloadAfterSwitch: "coldRestart" },
    health: null,
    recommendation: null,
    accounts: [
      {
        id: "id_active",
        email: "active@test.dev",
        tierName: "Google AI Pro",
        source: "captured",
        hasRefreshToken: true,
        quotaSnapshot: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.45, resetTime: new Date(Date.now() + 3 * 86400_000 + 2 * 3600_000).toISOString() },
                { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.6, resetTime: new Date(Date.now() + 90 * 60_000).toISOString() }
              ]
            }
          ]
        }
      },
      {
        id: "id_bg",
        email: "bg@test.dev",
        tierName: "Antigravity Starter Quota",
        source: "captured",
        hasRefreshToken: true,
        quotaSnapshot: {
          exitedAtMs: Date.now() - 600_000,
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.09, resetTime: new Date(Date.now() + 4 * 86400_000 + 5 * 3600_000).toISOString() },
                { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.2, resetTime: new Date(Date.now() - 60_000).toISOString() }
              ]
            }
          ]
        }
      }
    ]
  };
  const timers = [];
  const sandbox = {
    window: {
      __AGY_IDE_STATE__: { lang: "zh" },
      __agyIdeBridge: {
        async accountCall() {
          return { data: mockPayload };
        }
      }
    },
    document: {
      hidden: false,
      getElementById: (id) => domMap.get(id) || null,
      querySelectorAll: () => [],
      addEventListener: (ev, fn) => {
        if (ev === "DOMContentLoaded") domReadyCb = fn;
      }
    },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      if (typeof id.unref === "function") id.unref();
      timers.push(id);
      return id;
    },
    clearInterval: (id) => clearInterval(id),
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    RegExp,
    JSON,
    Boolean
  };
  vm.runInNewContext(scriptCode, sandbox);
  assert.ok(typeof domReadyCb === "function");
  domReadyCb();
  return sandbox.window.__agyAccountUi.refresh(true).then(() => {
    for (const id of timers) clearInterval(id);
    const listHtml = domMap.get("acc-list").innerHTML;
    assert.ok(listHtml.includes('class="acc-qgroup-grid"'), "详情页卡片应使用 2 列并排紧凑配额布局");
    assert.ok(listHtml.includes('data-quota-window="5h"'), "详情页卡片应渲染 5h 进度条块");
    assert.ok(listHtml.includes('data-quota-window="weekly"'), "详情页卡片应渲染周额度进度条块");
    assert.ok(listHtml.includes('class="acc-win-tag is-weekly">周</span>'), "详情页应显示周额度标签");
    assert.ok(listHtml.includes(">↻4d"), "后台号周额度应以紧凑格式 ↻4d.. 显示恢复倒计时");
    assert.ok(listHtml.includes('title="满额 4d'), "后台号周额度悬停提示应保留完整中文倒计时");
    assert.ok(listHtml.includes(">3d2h<") || listHtml.includes(">3d1h<"), "在线号周额度应以紧凑格式显示重置倒计时");
    assert.ok(listHtml.includes('class="acc-qbucket-meta is-recovered"') && listHtml.includes(">✓<"), "后台号已过重置点的 5h 桶应紧凑显示绿色 ✓");
    assert.ok(listHtml.includes('title="Antigravity Starter Quota">Starter</span>'), "卡片套餐徽标应展示简称并在 title 保留全称");
  });
});
