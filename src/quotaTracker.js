"use strict";

/**
 * 纯本地配额追踪与恢复倒计时引擎（零网络、零外部依赖）：
 * - 在线账号展示本地 Hub 实时余量；
 * - 后台休眠账号基于「退出时余额快照 + resetTime」在纯本地计算恢复满额实时倒计时；
 * - 跨过 resetTime 后自动翻转为「100% · 已回满」，并在排序时支持同分最快回满优先。
 */

/**
 * 解析单个模型池桶的当前可用状态与倒计时信息。
 * @param {object} bucket
 * @param {number} [nowMs]
 */
function evaluateBucketStatus(bucket, nowMs = Date.now()) {
  const b = bucket && typeof bucket === "object" ? bucket : {};
  const rawFrac = Number(
    b.originalFraction !== undefined && b.estimatedReset ? b.originalFraction : b.remainingFraction
  );
  const recordedFraction = Number.isFinite(rawFrac) ? Math.max(0, Math.min(1, rawFrac)) : 0;
  const recordedPct = Math.round(recordedFraction * 100);

  const resetTime = String(b.resetTime ?? b.reset_time ?? "").trim();
  const parsedResetMs = resetTime ? Date.parse(resetTime) : NaN;
  const resetAtMs = Number.isFinite(parsedResetMs) && parsedResetMs > 0 ? parsedResetMs : 0;
  const remainingMs = resetAtMs > nowMs ? resetAtMs - nowMs : 0;

  const isFull = recordedFraction >= 0.999;
  const recovered = !isFull && resetAtMs > 0 && resetAtMs <= nowMs;
  const effectiveFraction = recovered ? 1 : recordedFraction;
  const effectivePct = Math.round(effectiveFraction * 100);

  let state = "frozen";
  if (isFull) {
    state = "full";
  } else if (recovered) {
    state = "recovered";
  } else if (resetAtMs > nowMs) {
    state = "recovering";
  }

  return {
    ...b,
    bucketId: String(b.bucketId || b.bucket_id || b.window || "").trim(),
    window: String(b.window || b.bucketWindow || b.displayName || "quota").trim() || "quota",
    resetTime,
    resetAtMs,
    remainingMs,
    recordedFraction,
    recordedPct,
    effectiveFraction,
    effectivePct,
    remainingFraction: effectiveFraction,
    originalFraction: recordedFraction,
    isFull,
    recovered,
    estimatedReset: recovered,
    state
  };
}

/**
 * 评估整个账号的配额快照（返回不可变副本，保留历史记录并附带各桶状态与整体恢复时间戳）。
 * @param {object | null} quotaSnapshot
 * @param {{ nowMs?: number, isActive?: boolean }} [options]
 */
function evaluateQuotaSnapshot(quotaSnapshot, options = {}) {
  if (!quotaSnapshot || typeof quotaSnapshot !== "object") {
    return quotaSnapshot || null;
  }
  const nowMs = Number(options.nowMs) > 0 ? Number(options.nowMs) : Date.now();
  const isActive = Boolean(options.isActive);
  const rawGroups = Array.isArray(quotaSnapshot.groups) ? quotaSnapshot.groups : [];

  let hasRecovered = false;
  let hasRecovering = false;
  let earliestRecoveryAtMs = 0;
  let allFullAtMs = 0;
  let minEffectiveFraction = Infinity;
  let sumEffectiveFraction = 0;
  let validBucketCount = 0;

  const groups = rawGroups.map((g) => {
    const rawBuckets = Array.isArray(g?.buckets) ? g.buckets : [];
    const buckets = rawBuckets.map((b) => {
      const ev = evaluateBucketStatus(b, nowMs);
      if (ev.recovered) hasRecovered = true;
      if (ev.state === "recovering" && ev.resetAtMs > 0) {
        hasRecovering = true;
        if (earliestRecoveryAtMs === 0 || ev.resetAtMs < earliestRecoveryAtMs) {
          earliestRecoveryAtMs = ev.resetAtMs;
        }
        if (ev.resetAtMs > allFullAtMs) {
          allFullAtMs = ev.resetAtMs;
        }
      }
      if (Number.isFinite(ev.effectiveFraction)) {
        if (ev.effectiveFraction < minEffectiveFraction) {
          minEffectiveFraction = ev.effectiveFraction;
        }
        sumEffectiveFraction += ev.effectiveFraction;
        validBucketCount++;
      }
      return ev;
    });
    return {
      ...g,
      buckets
    };
  });

  const hasValid = validBucketCount > 0 && Number.isFinite(minEffectiveFraction);
  const avgEffectiveFraction = hasValid ? sumEffectiveFraction / validBucketCount : null;

  return {
    ...quotaSnapshot,
    mode: isActive ? "live" : "exit_snapshot",
    snapshotKind: String(quotaSnapshot.snapshotKind || (isActive ? "live" : "exit")).trim(),
    exitedAtMs: Number(quotaSnapshot.exitedAtMs || 0),
    groups,
    hasRecovered,
    hasEstimatedReset: hasRecovered,
    hasRecovering,
    earliestRecoveryAtMs,
    allFullAtMs,
    minEffectiveFraction: hasValid ? minEffectiveFraction : null,
    avgEffectiveFraction
  };
}

/**
 * 计算账号当前综合可用配额评分（0~100，无记录返回 -1）。
 * @param {object} account
 * @param {number} [nowMs]
 * @returns {number}
 */
function computeAccountQuotaScore(account, nowMs = Date.now()) {
  const rawSnap = account?.effectiveQuotaSnapshot || account?.quotaSnapshot;
  if (!rawSnap || !Array.isArray(rawSnap.groups) || rawSnap.groups.length === 0) {
    return -1;
  }
  const ev = evaluateQuotaSnapshot(rawSnap, { nowMs });
  if (ev.minEffectiveFraction === null || ev.avgEffectiveFraction === null) {
    return -1;
  }
  return Math.round((ev.minEffectiveFraction * 0.6 + ev.avgEffectiveFraction * 0.4) * 10000) / 100;
}

/**
 * 按当前可用余量降序排列；同余量时最快恢复满额的排在前面，其次按最近使用、邮箱排序。
 * @param {Array<object>} accounts
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
function sortAccountsByQuota(accounts = [], nowMs = Date.now()) {
  const evaluated = (Array.isArray(accounts) ? accounts : []).map((acc) => {
    const rawSnap = acc?.effectiveQuotaSnapshot || acc?.quotaSnapshot;
    const snap = rawSnap ? evaluateQuotaSnapshot(rawSnap, { nowMs }) : null;
    const score =
      snap && snap.minEffectiveFraction !== null && snap.avgEffectiveFraction !== null
        ? Math.round((snap.minEffectiveFraction * 0.6 + snap.avgEffectiveFraction * 0.4) * 10000) / 100
        : -1;
    return {
      acc,
      score,
      earliestRecoveryAtMs: Number(snap?.earliestRecoveryAtMs || 0)
    };
  });

  evaluated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aRec = a.earliestRecoveryAtMs;
    const bRec = b.earliestRecoveryAtMs;
    if (aRec > 0 && bRec > 0 && aRec !== bRec) {
      return aRec - bRec;
    }
    if ((aRec > 0) !== (bRec > 0)) {
      return aRec > 0 ? -1 : 1;
    }

    const swDiff =
      Number(b.acc?.lastSwitchedAtMs || b.acc?.updatedAtMs || 0) -
      Number(a.acc?.lastSwitchedAtMs || a.acc?.updatedAtMs || 0);
    if (swDiff !== 0) return swDiff;

    return String(a.acc?.email || "").localeCompare(String(b.acc?.email || ""));
  });

  return evaluated.map((item) => item.acc);
}

/**
 * 格式化恢复满额倒计时。
 * @param {number} remainingMs
 * @param {{ compact?: boolean, showSeconds?: boolean, lang?: "zh" | "en" }} [options]
 * @returns {string}
 */
function formatCountdown(remainingMs, options = {}) {
  const compact = Boolean(options.compact);
  const showSeconds = Boolean(options.showSeconds);
  const lang = options.lang === "en" ? "en" : "zh";
  const ms = Number(remainingMs);

  if (!Number.isFinite(ms) || ms <= 0) {
    return lang === "en" ? "Full" : "已回满";
  }

  const totalSec = Math.max(1, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad2 = (n) => String(n).padStart(2, "0");

  if (d > 0) {
    if (compact) return h > 0 ? `${d}d${h}h` : `${d}d`;
    const parts = [`${d}d`];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(" ");
  }

  if (h > 0) {
    if (compact) {
      return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    if (showSeconds) {
      return `${h}h ${pad2(m)}m ${pad2(s)}s`;
    }
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  if (m > 0) {
    if (compact) {
      return showSeconds ? `${m}m${pad2(s)}s` : `${m}m`;
    }
    if (showSeconds) {
      return `${m}m ${pad2(s)}s`;
    }
    return `${m}m`;
  }

  if (showSeconds || totalSec < 60) {
    return `${totalSec}s`;
  }
  return "1m";
}

module.exports = {
  evaluateBucketStatus,
  evaluateQuotaSnapshot,
  computeAccountQuotaScore,
  sortAccountsByQuota,
  formatCountdown
};
