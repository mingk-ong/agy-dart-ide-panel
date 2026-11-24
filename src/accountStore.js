"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getHomeDir } = require("./paths");
const { normalizeExpiryIso, readGeminiCompatFiles } = require("./credentialBridge");
const {
  evaluateQuotaSnapshot,
  computeAccountQuotaScore,
  sortAccountsByQuota,
  formatCountdown
} = require("./quotaTracker");

const INDEX_STATE_KEY = "agyFusion.accountIndex.v1";
const LAST_HEALTHY_ACCOUNT_KEY = "agyFusion.lastHealthyAccountId";
const SECRET_KEY_PREFIX = "agyFusion.accountSecret.";

/**
 * 基于邮箱生成稳定的 16 位账号 ID（同一邮箱天然去重）。
 * @param {string} email
 * @returns {string}
 */
function makeAccountId(email) {
  const norm = String(email || "").trim().toLowerCase();
  if (!norm) {
    throw new Error("账号邮箱不能为空");
  }
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

/**
 * 归一化各来源的配额池数组结构。
 * @param {unknown} rawGroups
 * @returns {Array<{ displayName: string, description: string, buckets: Array<{ bucketId: string, window: string, remainingFraction: number, resetTime: string }> }>}
 */
function normalizeQuotaGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  const out = [];
  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    const displayName = String(g.displayName ?? g.display_name ?? "").trim();
    if (!displayName) continue;
    const description = String(g.description || "").trim();

    let rawBuckets = [];
    if (Array.isArray(g.buckets)) {
      rawBuckets = g.buckets;
    } else if (g.buckets && typeof g.buckets === "object") {
      if (Array.isArray(g.buckets.buckets)) {
        rawBuckets = g.buckets.buckets;
      } else {
        rawBuckets = Object.entries(g.buckets).map(([k, v]) =>
          v && typeof v === "object" ? { window: k, ...v } : { window: k, remainingFraction: Number(v) }
        );
      }
    }

    const buckets = [];
    for (const b of rawBuckets) {
      if (!b || typeof b !== "object") continue;
      const win = String(b.window || b.bucketWindow || b.displayName || "").trim();
      const bucketId = String(b.bucketId || b.bucket_id || win).trim();
      let frac = b.remainingFraction ?? b.remaining_fraction;
      if (frac === undefined && Number.isFinite(Number(b.percentage))) {
        frac = Number(b.percentage) / 100;
      }
      const numFrac = Number(frac);
      if (!Number.isFinite(numFrac)) continue;
      const resetTime = String(b.resetTime ?? b.reset_time ?? "").trim();
      buckets.push({
        bucketId,
        window: win || bucketId || "quota",
        remainingFraction: Math.max(0, Math.min(1, numFrac)),
        resetTime
      });
    }

    if (buckets.length > 0) {
      const groupObj = { displayName, description, buckets };
      if (Array.isArray(g.modelIds) && g.modelIds.length > 0) {
        groupObj.modelIds = [...new Set(g.modelIds.map((m) => String(m || "").trim()).filter(Boolean))];
      }
      out.push(groupObj);
    }
  }
  return out;
}

/**
 * 将 .antigravity_tools 的 quota.models 摘要兜底归纳为可展示配额池。
 * @param {unknown} rawModels
 */
function fallbackQuotaGroupsFromModels(rawModels) {
  if (!Array.isArray(rawModels) || rawModels.length === 0) return [];
  let minGemini = 1;
  let geminiReset = "";
  let hasGemini = false;
  let minThirdParty = 1;
  let thirdReset = "";
  let hasThird = false;
  for (const m of rawModels) {
    if (!m || typeof m !== "object") continue;
    const label = String(m.display_name || m.name || m.model || "").toLowerCase();
    const pct = Number(m.percentage);
    if (!Number.isFinite(pct)) continue;
    const frac = Math.max(0, Math.min(1, pct / 100));
    const rst = String(m.reset_time || "").trim();
    if (/claude|sonnet|opus|haiku|gpt/.test(label)) {
      hasThird = true;
      if (frac < minThirdParty) {
        minThirdParty = frac;
        thirdReset = rst;
      }
    } else {
      hasGemini = true;
      if (frac < minGemini) {
        minGemini = frac;
        geminiReset = rst;
      }
    }
  }
  const groups = [];
  if (hasGemini) {
    groups.push({
      displayName: "Gemini Models",
      description: "",
      buckets: [{ bucketId: "gemini", window: "5h", remainingFraction: minGemini, resetTime: geminiReset }]
    });
  }
  if (hasThird) {
    groups.push({
      displayName: "Claude and GPT models",
      description: "",
      buckets: [{ bucketId: "3p", window: "5h", remainingFraction: minThirdParty, resetTime: thirdReset }]
    });
  }
  return groups;
}

/**
 * 剥离一切敏感令牌字段，生成可安全发往 Webview 与 UI 的公开账号元数据。
 * @param {object} entry
 */
function toPublicMeta(entry) {
  return {
    id: String(entry.id || ""),
    email: String(entry.email || ""),
    name: String(entry.name || ""),
    alias: String(entry.alias || ""),
    authMethod: String(entry.authMethod || "consumer"),
    oauthClientKey: String(entry.oauthClientKey || ""),
    projectId: String(entry.projectId || ""),
    tierName: String(entry.tierName || ""),
    source: String(entry.source || "manual"),
    quotaSnapshot: entry.quotaSnapshot || null,
    createdAtMs: Number(entry.createdAtMs || 0),
    updatedAtMs: Number(entry.updatedAtMs || 0),
    lastSwitchedAtMs: Number(entry.lastSwitchedAtMs || 0),
    lastCapturedAtMs: Number(entry.lastCapturedAtMs || 0),
    lastExitedAtMs: Number(entry.lastExitedAtMs || 0),
    hasRefreshToken: Boolean(entry.hasRefreshToken),
    tokenExpiryMs: Number(entry.tokenExpiryMs || 0)
  };
}

function normalizeSecretInput(secret = {}) {
  const accessToken = String(secret.accessToken ?? secret.access_token ?? "").trim();
  const refreshToken = String(secret.refreshToken ?? secret.refresh_token ?? "").trim();
  const tokenType = String(secret.tokenType ?? secret.token_type ?? "Bearer").trim() || "Bearer";
  const idToken = String(secret.idToken ?? secret.id_token ?? "").trim();
  const scope = String(secret.scope || "").trim();
  const projectId = String(secret.projectId ?? secret.project_id ?? "").trim();
  const oauthClientKey = String(secret.oauthClientKey ?? secret.oauth_client_key ?? "").trim();
  const writerId = String(secret.writerId ?? secret.writer_id ?? "").trim();
  const { expiryIso, expiryMs } = normalizeExpiryIso(
    secret.expiryMs ?? secret.expiryIso ?? secret.expiry ?? secret.expiry_date ?? secret.expiry_timestamp ?? 0
  );
  const expiresInRaw = Number(secret.expiresIn ?? secret.expires_in ?? 3599);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.round(expiresInRaw) : 3599;

  return {
    accessToken,
    refreshToken,
    tokenType,
    idToken,
    scope,
    projectId,
    oauthClientKey,
    writerId,
    expiryIso,
    expiryMs,
    expiresIn
  };
}

/**
 * 加密账号保险库：敏感凭据存入 VS Code SecretStorage，非敏感索引与退出余额快照存入 globalState。
 */
class AccountStore {
  /**
   * @param {{ context: import("vscode").ExtensionContext, logger?: { log: (msg: string) => void } }} options
   */
  constructor(options) {
    this._context = options.context;
    this._logger = options.logger || { log() {} };
  }

  _readIndexMap() {
    const raw = this._context.globalState.get(INDEX_STATE_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return { ...raw };
  }

  async _writeIndexMap(mapObj) {
    await this._context.globalState.update(INDEX_STATE_KEY, mapObj);
  }

  /**
   * 列出全部账号的安全元数据（绝不含任何明文令牌）。
   */
  listPublicAccounts() {
    const mapObj = this._readIndexMap();
    return Object.values(mapObj)
      .filter((item) => item && item.id && item.email)
      .map(toPublicMeta)
      .sort((a, b) => {
        if (b.lastSwitchedAtMs !== a.lastSwitchedAtMs) {
          return b.lastSwitchedAtMs - a.lastSwitchedAtMs;
        }
        if (b.updatedAtMs !== a.updatedAtMs) {
          return b.updatedAtMs - a.updatedAtMs;
        }
        return a.email.localeCompare(b.email);
      });
  }

  getAccountMeta(id) {
    const mapObj = this._readIndexMap();
    const entry = mapObj[String(id || "").trim()];
    return entry ? toPublicMeta(entry) : null;
  }

  findByEmail(email) {
    const target = String(email || "").trim().toLowerCase();
    if (!target) return null;
    const id = makeAccountId(target);
    return this.getAccountMeta(id);
  }

  async getAccountSecret(id) {
    const cleanId = String(id || "").trim();
    if (!cleanId) return null;
    const raw = await this._context.secrets.get(`${SECRET_KEY_PREFIX}${cleanId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return normalizeSecretInput(parsed);
    } catch {
      return null;
    }
  }

  /**
   * 新增或合并账号（先持久化 SecretStorage，再更新 globalState 索引）。
   * @param {object} meta
   * @param {object} secret
   */
  async upsertAccount(meta = {}, secret = {}) {
    const email = String(meta.email || secret.email || "").trim();
    if (!email) {
      throw new Error("无法入库：账号邮箱为空");
    }
    const id = makeAccountId(email);
    const now = Date.now();
    const mapObj = this._readIndexMap();
    const existing = mapObj[id] || null;
    const prevSecret = await this.getAccountSecret(id);

    const normSecret = normalizeSecretInput(secret);
    const mergedSecret = {
      accessToken: normSecret.accessToken || prevSecret?.accessToken || "",
      refreshToken: normSecret.refreshToken || prevSecret?.refreshToken || "",
      tokenType: normSecret.tokenType || prevSecret?.tokenType || "Bearer",
      idToken: normSecret.idToken || prevSecret?.idToken || "",
      scope: normSecret.scope || prevSecret?.scope || "",
      projectId: normSecret.projectId || prevSecret?.projectId || "",
      oauthClientKey: normSecret.oauthClientKey || prevSecret?.oauthClientKey || "",
      writerId: normSecret.writerId || prevSecret?.writerId || "",
      expiryIso: normSecret.expiryIso || prevSecret?.expiryIso || "",
      expiryMs: normSecret.expiryMs || prevSecret?.expiryMs || 0,
      expiresIn: normSecret.expiresIn || prevSecret?.expiresIn || 3599
    };

    if (!mergedSecret.accessToken && !mergedSecret.refreshToken) {
      throw new Error("无法入库：缺少 access_token 与 refresh_token");
    }

    await this._context.secrets.store(`${SECRET_KEY_PREFIX}${id}`, JSON.stringify(mergedSecret));

    const nextQuotaSnapshot =
      meta.quotaSnapshot && Array.isArray(meta.quotaSnapshot.groups) && meta.quotaSnapshot.groups.length > 0
        ? meta.quotaSnapshot
        : existing?.quotaSnapshot || null;

    const entry = {
      id,
      email,
      name: String(meta.name || existing?.name || "").trim(),
      alias: String(meta.alias !== undefined ? meta.alias : existing?.alias || "").trim(),
      authMethod: String(meta.authMethod || existing?.authMethod || "consumer").trim() || "consumer",
      oauthClientKey: String(
        meta.oauthClientKey || mergedSecret.oauthClientKey || existing?.oauthClientKey || ""
      ).trim(),
      projectId: String(meta.projectId || mergedSecret.projectId || existing?.projectId || "").trim(),
      tierName: String(meta.tierName || nextQuotaSnapshot?.tierName || existing?.tierName || "").trim(),
      source: String(meta.source || existing?.source || "captured").trim(),
      quotaSnapshot: nextQuotaSnapshot,
      createdAtMs: Number(existing?.createdAtMs || meta.createdAtMs || now),
      updatedAtMs: now,
      lastSwitchedAtMs: Number(meta.lastSwitchedAtMs ?? existing?.lastSwitchedAtMs ?? 0),
      lastCapturedAtMs: Number(meta.lastCapturedAtMs ?? now),
      lastExitedAtMs: Number(meta.lastExitedAtMs ?? existing?.lastExitedAtMs ?? 0),
      hasRefreshToken: Boolean(mergedSecret.refreshToken),
      tokenExpiryMs: Number(mergedSecret.expiryMs || 0)
    };

    mapObj[id] = entry;
    await this._writeIndexMap(mapObj);
    return {
      isNew: !existing,
      account: toPublicMeta(entry)
    };
  }

  async updateAlias(id, alias) {
    const cleanId = String(id || "").trim();
    const mapObj = this._readIndexMap();
    const existing = mapObj[cleanId];
    if (!existing) return null;
    existing.alias = String(alias || "").trim();
    existing.updatedAtMs = Date.now();
    mapObj[cleanId] = existing;
    await this._writeIndexMap(mapObj);
    return toPublicMeta(existing);
  }

  async updateQuotaSnapshot(emailOrId, snapshot = {}) {
    const raw = String(emailOrId || "").trim();
    if (!raw) return null;
    const mapObj = this._readIndexMap();
    const id = mapObj[raw] ? raw : raw.includes("@") ? makeAccountId(raw) : "";
    if (!id || !mapObj[id]) return null;

    const existing = mapObj[id];
    const groups = normalizeQuotaGroups(snapshot.quotaGroups || snapshot.groups);
    const tierName = String(snapshot.tierName || existing.tierName || "").trim();
    const name = String(snapshot.name || existing.name || "").trim();
    const projectId = String(snapshot.projectId || existing.projectId || "").trim();
    const fetchedAtMs = Number(snapshot.fetchedAtMs || Date.now());
    const snapshotKind = String(snapshot.snapshotKind || existing.quotaSnapshot?.snapshotKind || "live").trim();
    const exitedAtMs = Number(snapshot.exitedAtMs || 0);

    existing.tierName = tierName;
    existing.name = name;
    if (projectId) {
      existing.projectId = projectId;
    }
    if (exitedAtMs > 0) {
      existing.lastExitedAtMs = exitedAtMs;
    }

    if (groups.length > 0) {
      const nextSnap = {
        fetchedAtMs,
        tierName,
        snapshotKind,
        groups
      };
      if (exitedAtMs > 0 && snapshotKind !== "live") {
        nextSnap.exitedAtMs = exitedAtMs;
      }
      existing.quotaSnapshot = nextSnap;
    }
    existing.updatedAtMs = Date.now();
    mapObj[id] = existing;
    await this._writeIndexMap(mapObj);
    return toPublicMeta(existing);
  }

  /**
   * 切走或登出账号前调用：记录「退出时余额快照 + resetTime + 退出时间」；
   * 若当时未能采集到新快照但账号已有旧记录，则保留原 groups 仅打标 exit 与退出时间，绝不丢失旧记录。
   * @param {string} emailOrId
   * @param {object} [snapshot]
   */
  async recordExitQuotaSnapshot(emailOrId, snapshot = {}) {
    const raw = String(emailOrId || "").trim();
    if (!raw) return null;
    const mapObj = this._readIndexMap();
    const id = mapObj[raw] ? raw : raw.includes("@") ? makeAccountId(raw) : "";
    if (!id || !mapObj[id]) return null;

    const existing = mapObj[id];
    const exitedAtMs = Number(snapshot.exitedAtMs || Date.now());
    const freshGroups = normalizeQuotaGroups(snapshot.quotaGroups || snapshot.groups);
    const tierName = String(snapshot.tierName || existing.tierName || "").trim();
    const name = String(snapshot.name || existing.name || "").trim();

    existing.tierName = tierName;
    existing.name = name;
    existing.lastExitedAtMs = exitedAtMs;

    if (freshGroups.length > 0) {
      existing.quotaSnapshot = {
        fetchedAtMs: Number(snapshot.fetchedAtMs || exitedAtMs),
        tierName,
        snapshotKind: "exit",
        exitedAtMs,
        groups: freshGroups
      };
    } else if (existing.quotaSnapshot && Array.isArray(existing.quotaSnapshot.groups) && existing.quotaSnapshot.groups.length > 0) {
      existing.quotaSnapshot = {
        ...existing.quotaSnapshot,
        snapshotKind: "exit",
        exitedAtMs
      };
    }

    existing.updatedAtMs = Date.now();
    mapObj[id] = existing;
    await this._writeIndexMap(mapObj);
    return toPublicMeta(existing);
  }

  async markSwitched(id) {
    const cleanId = String(id || "").trim();
    const mapObj = this._readIndexMap();
    const existing = mapObj[cleanId];
    if (!existing) return null;
    const now = Date.now();
    existing.lastSwitchedAtMs = now;
    existing.updatedAtMs = now;
    mapObj[cleanId] = existing;
    await this._writeIndexMap(mapObj);
    return toPublicMeta(existing);
  }

  getLastHealthyAccountId() {
    const val = this._context.globalState.get(LAST_HEALTHY_ACCOUNT_KEY);
    return typeof val === "string" ? val.trim() : "";
  }

  async setLastHealthyAccountId(id) {
    const cleanId = String(id || "").trim();
    if (!cleanId) return;
    if (this.getLastHealthyAccountId() === cleanId) return;
    await this._context.globalState.update(LAST_HEALTHY_ACCOUNT_KEY, cleanId);
  }

  /**
   * 持续保鲜备份：仅当目标账号已入库且系统新令牌有效且更新时，静默回写加密保险库。
   * @param {string} email
   * @param {object} freshCred
   */
  async syncFreshSecretIfNewer(email, freshCred = {}) {
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return { updated: false, reason: "no-email" };
    const existing = this.findByEmail(cleanEmail);
    if (!existing) return { updated: false, reason: "not-in-vault" };

    const norm = normalizeSecretInput(freshCred);
    if (!norm.accessToken || !norm.refreshToken) {
      return { updated: false, reason: "incomplete-token" };
    }

    const prev = await this.getAccountSecret(existing.id);
    if (
      prev &&
      prev.accessToken === norm.accessToken &&
      prev.refreshToken === norm.refreshToken &&
      prev.writerId === norm.writerId &&
      prev.expiryMs === norm.expiryMs
    ) {
      return { updated: false, reason: "unchanged" };
    }

    const isNewer =
      !prev ||
      !prev.refreshToken ||
      norm.expiryMs > Number(prev.expiryMs || 0) ||
      (norm.writerId && norm.writerId !== prev.writerId) ||
      norm.accessToken !== prev.accessToken ||
      norm.refreshToken !== prev.refreshToken;

    if (!isNewer) {
      return { updated: false, reason: "stale" };
    }

    const res = await this.upsertAccount(
      {
        email: existing.email,
        authMethod: freshCred.authMethod || existing.authMethod,
        lastCapturedAtMs: Date.now()
      },
      norm
    );
    return { updated: true, account: res.account };
  }

  /**
   * 同步新的官方登录凭据：
   * - 新邮箱自动加密入库（source: "official-login"）
   * - 已有邮箱凭据更新或存在历史外部 Client 标记时，强制以新官方凭据覆盖并清洗标记
   * @param {{
   *   email: string,
   *   name?: string,
   *   tierName?: string,
   *   quotaGroups?: Array<object>,
   *   fetchedAtMs?: number,
   *   freshCred: object
   * }} params
   */
  async syncOfficialLoginCredential(params = {}) {
    const cleanEmail = String(params.email || params.freshCred?.email || "").trim();
    if (!cleanEmail) {
      return { action: "skipped", updated: false, reason: "no-email" };
    }

    const norm = normalizeSecretInput(params.freshCred || {});
    if (!norm.accessToken && !norm.refreshToken) {
      return { action: "skipped", updated: false, reason: "incomplete-token" };
    }

    const groups = normalizeQuotaGroups(params.quotaGroups);
    const tierName = String(params.tierName || "").trim();
    const name = String(params.name || "").trim();
    const fetchedAtMs = Number(params.fetchedAtMs || Date.now());
    const quotaSnapshot =
      groups.length > 0 ? { fetchedAtMs, tierName, snapshotKind: "live", groups } : null;

    const existing = this.findByEmail(cleanEmail);
    if (!existing) {
      const res = await this.upsertAccount(
        {
          email: cleanEmail,
          name,
          tierName,
          authMethod: params.freshCred?.authMethod || "consumer",
          oauthClientKey: "",
          source: "official-login",
          quotaSnapshot,
          lastCapturedAtMs: Date.now()
        },
        { ...norm, oauthClientKey: "" }
      );
      return {
        action: "captured_new",
        updated: true,
        refreshTokenChanged: Boolean(norm.refreshToken),
        account: res.account
      };
    }

    const prev = await this.getAccountSecret(existing.id);
    const tokenChanged = Boolean(
      !prev ||
      (norm.accessToken && norm.accessToken !== prev.accessToken) ||
      (norm.refreshToken && norm.refreshToken !== prev.refreshToken) ||
      (norm.writerId && norm.writerId !== prev.writerId) ||
      (norm.expiryMs > 0 && norm.expiryMs !== Number(prev.expiryMs || 0))
    );
    const refreshTokenChanged = Boolean(
      norm.refreshToken && (!prev || norm.refreshToken !== prev.refreshToken)
    );
    const needsStateWash = existing.oauthClientKey === "antigravity_enterprise";

    if (tokenChanged || needsStateWash) {
      const res = await this.upsertAccount(
        {
          email: existing.email,
          name: name || existing.name,
          tierName: tierName || existing.tierName,
          authMethod: params.freshCred?.authMethod || existing.authMethod || "consumer",
          oauthClientKey: "",
          source: needsStateWash ? "official-login" : existing.source,
          quotaSnapshot,
          lastCapturedAtMs: Date.now()
        },
        { ...norm, oauthClientKey: "" }
      );
      const mapObj = this._readIndexMap();
      if (mapObj[existing.id]) {
        mapObj[existing.id].oauthClientKey = "";
        if (needsStateWash) {
          mapObj[existing.id].source = "official-login";
        }
        await this._writeIndexMap(mapObj);
      }
      return {
        action: "overwritten_existing",
        updated: true,
        refreshTokenChanged,
        account: this.getAccountMeta(existing.id) || res.account
      };
    }

    if (quotaSnapshot) {
      const updated = await this.updateQuotaSnapshot(existing.id, {
        tierName,
        name,
        quotaGroups: groups,
        snapshotKind: "live",
        fetchedAtMs
      });
      return {
        action: "unchanged",
        updated: false,
        refreshTokenChanged: false,
        account: updated || existing
      };
    }

    return {
      action: "unchanged",
      updated: false,
      refreshTokenChanged: false,
      account: existing
    };
  }

  async removeAccount(id) {
    const cleanId = String(id || "").trim();
    if (!cleanId) return false;
    const mapObj = this._readIndexMap();
    const existed = Boolean(mapObj[cleanId]);
    if (existed) {
      delete mapObj[cleanId];
      await this._writeIndexMap(mapObj);
    }
    await this._context.secrets.delete(`${SECRET_KEY_PREFIX}${cleanId}`);
    return existed;
  }

  /**
   * 手动一次性只读导入本机 ~/.antigravity_tools 账号库，绝不改写原目录任何文件。
   * @param {string} [toolsDir]
   */
  async importFromAntigravityTools(toolsDir = path.join(getHomeDir(), ".antigravity_tools")) {
    const resolvedDir = path.resolve(toolsDir);
    const accountsJsonPath = path.join(resolvedDir, "accounts.json");
    const accountsSubDir = path.join(resolvedDir, "accounts");

    const summaryMap = new Map();
    if (fs.existsSync(accountsJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(accountsJsonPath, "utf8").replace(/^\uFEFF/, ""));
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.accounts) ? parsed.accounts : [];
        for (const item of arr) {
          if (item && item.email) {
            summaryMap.set(String(item.email).trim().toLowerCase(), item);
          }
        }
      } catch {}
    }

    const candidates = [];
    if (fs.existsSync(accountsSubDir)) {
      const files = fs.readdirSync(accountsSubDir).filter((f) => f.endsWith(".json")).sort();
      for (const file of files) {
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(accountsSubDir, file), "utf8").replace(/^\uFEFF/, ""));
          if (obj && typeof obj === "object") {
            candidates.push(obj);
          }
        } catch {}
      }
    }

    if (candidates.length === 0 && summaryMap.size === 0) {
      return { imported: 0, updated: 0, skipped: 0, total: 0, foundDir: fs.existsSync(resolvedDir) };
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of candidates) {
      const email = String(item.email || item.token?.email || "").trim();
      const tok = item.token && typeof item.token === "object" ? item.token : item;
      const accessToken = String(tok.access_token || "").trim();
      const refreshToken = String(tok.refresh_token || "").trim();
      if (!email || (!accessToken && !refreshToken)) {
        skipped++;
        continue;
      }

      const summary = summaryMap.get(email.toLowerCase()) || {};
      const tierName = String(item.quota?.subscription_tier || item.quota?.raw_tier || "").trim();
      let groups = normalizeQuotaGroups(item.quota?.quota_groups);
      if (groups.length === 0) {
        groups = fallbackQuotaGroupsFromModels(item.quota?.models);
      }
      const fetchedAtMs = Number(item.quota?.last_updated || 0)
        ? Number(item.quota.last_updated) * (Number(item.quota.last_updated) < 1e12 ? 1000 : 1)
        : Date.now();

      const res = await this.upsertAccount(
        {
          email,
          name: String(item.name || summary.name || "").trim(),
          authMethod: "consumer",
          tierName,
          source: "antigravity-tools",
          quotaSnapshot: groups.length > 0 ? { fetchedAtMs, tierName, snapshotKind: "imported", groups } : null
        },
        tok
      );
      if (res.isNew) imported++;
      else updated++;
    }

    return {
      imported,
      updated,
      skipped,
      total: candidates.length,
      foundDir: true
    };
  }

  /**
   * 只读导入 ~/.gemini/oauth_creds.json 与 google_accounts.json。
   * @param {string} [geminiDir]
   */
  async importFromGeminiDir(geminiDir) {
    const compat = readGeminiCompatFiles({ geminiDir });
    const email = compat.activeEmail;
    const oauth = compat.oauth;
    if (!email || !oauth || (!oauth.access_token && !oauth.refresh_token)) {
      return { imported: 0, updated: 0, skipped: 1 };
    }
    const res = await this.upsertAccount(
      {
        email,
        authMethod: "consumer",
        source: "gemini-cli"
      },
      oauth
    );
    return {
      imported: res.isNew ? 1 : 0,
      updated: res.isNew ? 0 : 1,
      skipped: 0
    };
  }

  /**
   * 导出备份 JSON（默认不含明文令牌，含密钥时由上层做二次确认）。
   * @param {{ includeSecrets?: boolean }} [options]
   */
  async exportToJsonBundle(options = {}) {
    const includeSecrets = Boolean(options.includeSecrets);
    const list = this.listPublicAccounts();
    const accounts = [];
    for (const meta of list) {
      if (includeSecrets) {
        const secret = await this.getAccountSecret(meta.id);
        accounts.push({ meta, secret });
      } else {
        accounts.push({ meta });
      }
    }
    return JSON.stringify(
      {
        schema: "agy-fusion-accounts-v1",
        exportedAt: new Date().toISOString(),
        includeSecrets,
        accounts
      },
      null,
      2
    );
  }

  /**
   * 从导出的备份 JSON 或精简数组导入账号。
   * @param {string} rawJsonText
   */
  async importFromJsonBundle(rawJsonText) {
    const clean = String(rawJsonText || "").replace(/^\uFEFF/, "").trim();
    if (!clean) {
      throw new Error("导入文件为空");
    }
    const parsed = JSON.parse(clean);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.accounts)
        ? parsed.accounts
        : parsed && typeof parsed === "object" && parsed.email
          ? [parsed]
          : [];

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      if (!item || typeof item !== "object") {
        skipped++;
        continue;
      }
      const meta = item.meta && typeof item.meta === "object" ? item.meta : item;
      const secret =
        item.secret && typeof item.secret === "object"
          ? item.secret
          : item.token && typeof item.token === "object"
            ? item.token
            : item;
      const email = String(meta.email || secret.email || meta.id_token_email || "").trim();
      const hasToken = Boolean(
        String(secret.accessToken ?? secret.access_token ?? "").trim() ||
          String(secret.refreshToken ?? secret.refresh_token ?? "").trim()
      );
      if (!email || !hasToken) {
        skipped++;
        continue;
      }

      const res = await this.upsertAccount(
        {
          email,
          name: meta.name || "",
          alias: meta.alias || "",
          authMethod: meta.authMethod || meta.auth_method || "consumer",
          tierName: meta.tierName || "",
          source: meta.source || "json-import",
          quotaSnapshot: meta.quotaSnapshot || null
        },
        secret
      );
      if (res.isNew) imported++;
      else updated++;
    }

    return { imported, updated, skipped };
  }
}

module.exports = {
  INDEX_STATE_KEY,
  LAST_HEALTHY_ACCOUNT_KEY,
  SECRET_KEY_PREFIX,
  makeAccountId,
  normalizeQuotaGroups,
  toPublicMeta,
  evaluateQuotaSnapshot,
  computeAccountQuotaScore,
  sortAccountsByQuota,
  formatCountdown,
  AccountStore
};
