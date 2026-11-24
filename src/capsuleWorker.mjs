// 独立 stdio JSON-RPC Worker：只读解码 Antigravity 本地对话数据库、按需增量统计历史用量，以及通过 daemon hub 查询多模型配额。
// 遵循 MIT 协议，核心 Protobuf 解析与配额/用量算法参考并精简适配自 Lumidarin/agy-capsule。
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// 先抑制 Node 22+ 内置 SQLite 实验性警告，再动态导入 node:sqlite，保持 stderr 绝对干净
const origEmitWarning = process.emitWarning;
process.emitWarning = function filteredWarning(warning, ...args) {
  const msg = typeof warning === "string" ? warning : warning?.message || "";
  if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) {
    return;
  }
  return origEmitWarning.call(process, warning, ...args);
};
const { DatabaseSync } = await import("node:sqlite");

const ACTIVE_STEP_STATUSES = new Set([1, 2, 8, 9, 11]);
const TOKEN_KEYS = ["read", "cachedRead", "uncachedRead", "write", "thinking"];
const COUNTERS = ["uncached", "cacheRead", "cacheWrite", "output"];
const QUOTA_TTL_MS = 10_000;
const RECENT_WRITE_MS = 60_000;
const MIN_USAGE_EPOCH_S = 1577836800; // 2020-01-01T00:00:00Z

function getHomeDir() {
  if (process.platform === "win32") {
    return process.env.USERPROFILE || process.env.HOME || homedir();
  }
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getConversationDirs() {
  const home = getHomeDir();
  return ["antigravity", "antigravity-ide", "antigravity-cli"].map((product) =>
    join(home, ".gemini", product, "conversations")
  );
}

function getDaemonDirs() {
  const home = getHomeDir();
  return ["antigravity", "antigravity-ide", "antigravity-cli"].map((product) =>
    join(home, ".gemini", product, "daemon")
  );
}

import { getStateVscdbPaths, syncOnboardingEmail } from "./onboardingSync.mjs";
export { getStateVscdbPaths, syncOnboardingEmail };

// =====================================================================
// 1. 零依赖 Protobuf Wire-Format 通用解码器
// =====================================================================

function readVarint(buf, offset) {
  let val = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length && i - offset < 10) {
    const b = buf[i++];
    if (i - offset === 10 && b > 1) {
      throw new RangeError("Invalid 64-bit protobuf varint");
    }
    val |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return [Number(val), i];
    }
    shift += 7n;
  }
  throw new RangeError("Truncated protobuf varint");
}

function parsePbMap(buf) {
  const fields = new Map();
  let i = 0;
  while (i < buf.length) {
    try {
      const [tag, nextI] = readVarint(buf, i);
      i = nextI;
      const fn = tag >>> 3;
      const wt = tag & 7;
      if (fn === 0) break;
      if (!fields.has(fn)) fields.set(fn, []);
      if (wt === 0) {
        const [val, nI] = readVarint(buf, i);
        i = nI;
        fields.get(fn).push(val);
      } else if (wt === 2) {
        const [len, nI] = readVarint(buf, i);
        i = nI;
        if (len < 0 || i + len > buf.length) break;
        fields.get(fn).push(buf.subarray(i, i + len));
        i += len;
      } else if (wt === 5) {
        fields.get(fn).push(buf.subarray(i, i + 4));
        i += 4;
      } else if (wt === 1) {
        fields.get(fn).push(buf.subarray(i, i + 8));
        i += 8;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return fields;
}

// =====================================================================
// 2. 错误分类与单次请求/轮次指标汇总
// =====================================================================

export function classifyRequestError(value = "") {
  const text = String(value || "").trim();
  const diagnostic = text
    .replace(/https?:\/\/[^\s"'<>]+/g, "<API>")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 400);
  const result = (kind, retryAfterSec = null) => ({ kind, diagnostic, retryAfterSec });
  if (!text) return result("none");
  if (/\bcontext cancel(?:ed|led)\b|user cancel(?:led|ed)|cancel(?:led|ed) by user|request was aborted|AbortError/i.test(text)) {
    return result("canceled");
  }
  if (/\b(?:deadline[ _]exceeded|(?:idle|request|connect(?:ion)?|i\/o) timeout|timed out|ETIMEDOUT|TimeoutError)\b/i.test(text)) {
    return result("request_timeout");
  }
  if (/input token count(?:\s*\([^)]*\)|\s+[\d,]+)?\s+exceeds|context\s*(?:window|length|tokens?|limit|size|capacity)?.{0,35}(?:exceed|too long)|maximum context length|prompt exceeds maximum context length|prompt (?:is )?too long|max_tokens exceeded/i.test(text)) {
    return result("context_overflow");
  }
  if (/UNAUTHENTICATED|PERMISSION_DENIED|\b401\b|\b403\b|invalid api key|credentials expired|permission denied/i.test(text)) {
    return result("auth_error");
  }
  if (/UNAVAILABLE|\b50[234]\b|server overloaded|high demand|Bad Gateway|Service Unavailable/i.test(text)) {
    return result("service_unavailable");
  }
  if (/\bEOF\b|ECONNRESET|ECONNREFUSED|ENOTFOUND|connection reset|connection refused|socket hang up|fetch failed|NetworkError/i.test(text)) {
    return result("network_error");
  }
  if (/quota\s*(?:exceeded|reached|limit|exhausted)|out\s+of\s+quota|exhausted.*(?:capacity|quota)|resource_exhausted.*(?:quota|capacity|billing)|free\s+tier\s+quota|daily\s+quota|weekly\s+quota/i.test(text)) {
    return result("quota_exhausted");
  }
  if (/rate\s*limit|too\s+many\s+requests|\b429\b|RateLimitError|RESOURCE_EXHAUSTED.*rate/i.test(text)) {
    const wait = text.match(/(?:retry\s+in|retry-after|wait)\s*[:=]?\s*([\d.]+)\s*(?:s|sec|seconds)?/i);
    const seconds = wait ? Number(wait[1]) : null;
    return result("rate_limited", Number.isFinite(seconds) ? seconds : null);
  }
  return result("unknown");
}

function summarizeGeneration(raw = null) {
  const num = (v) =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const ttft = num(raw?.ttft);
  const streaming = num(raw?.streaming);
  const duration = ttft !== null && streaming !== null ? ttft + streaming : null;
  const output = num(raw?.output);
  const reply = num(raw?.reply);
  const thinking = num(raw?.thinking);
  const splitMatches = output !== null && reply !== null && thinking !== null && output === reply + thinking;
  return {
    requestIndex: raw?.requestIndex ?? null,
    ttft,
    streaming,
    duration,
    output,
    reply: splitMatches ? reply : null,
    thinking: splitMatches ? thinking : null,
    tps: output !== null && output > 0 && duration !== null && duration > 0 ? output / duration : null
  };
}

function latestMeasuredSpeed(requests, steps, userStepIndex = null) {
  const childExecution = userStepIndex === null;
  const stepMap = new Map(steps.map((s) => [s.idx, s]));
  let generation = null;
  let completedAtMs = 0;
  for (const request of requests) {
    if ((!childExecution && request.lastStepIndex < userStepIndex) || request.requestError?.kind !== "none") {
      continue;
    }
    const response = request.stepIndices
      ?.map((idx) => stepMap.get(idx))
      .find((step) => step?.step_type === 15 && (childExecution || step.idx > userStepIndex) && step.status === 3);
    if (!response) continue;
    const candidate = summarizeGeneration(request.generation);
    if (candidate.tps === null) continue;
    generation = candidate;
    completedAtMs =
      (childExecution ? response.recordedCompletedAtMs || response.terminalAtMs : response.completedAtMs) || 0;
  }
  return { generation, completedAtMs };
}

function summarizeTurnSpeed(requests, steps, userStepIndex) {
  if (!Number.isInteger(userStepIndex)) return null;
  return {
    userStepIndex,
    ...latestMeasuredSpeed(requests, steps, userStepIndex),
    hasActiveStep: steps.some(
      (step) => step.idx > userStepIndex && step.step_type !== 14 && ACTIVE_STEP_STATUSES.has(step.status)
    )
  };
}

function summarizeSubagentTurnSpeed(requests, steps, execution) {
  return {
    executionId: execution.executionId,
    ...latestMeasuredSpeed(requests, steps),
    hasActiveStep: execution.state === "running" || execution.state === "queued"
  };
}

const validEpoch = (v) => (Number.isFinite(v) && v > 0 ? v : null);

function summarizeTurnQueue(requests, steps, userStepIndex, executors = [], childExecution = false) {
  if (!Number.isInteger(userStepIndex)) return null;
  const priorPlannerLinks = new Set();
  const currentPlannerLinks = new Set();
  for (const request of childExecution ? [] : requests) {
    const input = request.lastStepIndex;
    if (!Number.isInteger(input) || input < 0) continue;
    const links = input < userStepIndex ? priorPlannerLinks : currentPlannerLinks;
    for (const idx of request.stepIndices || []) {
      if (idx > userStepIndex) links.add(idx);
    }
  }
  const isPriorLink = (idx) => priorPlannerLinks.has(idx) && !currentPlannerLinks.has(idx);
  const isPriorPlanner = (step) => step.step_type === 15 && isPriorLink(step.idx);
  const scope = steps.filter((step) => step.idx >= userStepIndex && !isPriorPlanner(step));
  const user = scope.find((step) => step.idx === userStepIndex && step.step_type === 14);
  if (!user && !childExecution) return null;

  const active = scope.some((step) => step.step_type !== 14 && ACTIVE_STEP_STATUSES.has(step.status));
  const executor = executors.filter((item) => item.lastStepIndex >= userStepIndex).at(-1);
  const finalStep = executor && scope.find((step) => step.idx === executor.lastStepIndex);
  const laterExecution =
    executor && scope.some((step) => step.idx > executor.lastStepIndex && ![14, 101, 17].includes(step.step_type));
  const executionMatches =
    finalStep && (!executor.executionId || !finalStep.executionId || executor.executionId === finalStep.executionId);
  const executorEnded = Boolean(
    executor && executionMatches && !laterExecution && ![0, 7, 12].includes(executor.reason)
  );
  const turnTerminal = childExecution
    ? executorEnded
    : !active && (executorEnded || ([6, 12].includes(user?.status) && scope.every((step) => step.step_type === 14)));

  const plannerIndices = new Set(scope.filter((step) => step.step_type === 15).map((step) => step.idx));
  const coveredSteps = new Set();
  const waits = [];
  for (const request of requests) {
    const input = request.lastStepIndex;
    const links = request.stepIndices || [];
    if (!childExecution) {
      if (Number.isInteger(input) && input >= 0) {
        if (input < userStepIndex) continue;
      } else if (
        !links.some((idx) => plannerIndices.has(idx)) ||
        links.some((idx) => idx <= userStepIndex || isPriorLink(idx))
      ) {
        continue;
      }
    }
    const ttft = request.generation?.ttft;
    if (ttft !== null && ttft !== undefined && Number.isFinite(ttft) && ttft >= 0) {
      waits.push(ttft);
      for (const idx of links) coveredSteps.add(idx);
    }
  }
  for (const step of scope) {
    if (step.step_type !== 15 || coveredSteps.has(step.idx)) continue;
    const created = validEpoch(step.createdAtMs);
    const generating = validEpoch(step.generatingAtMs);
    if (created && generating && generating >= created) {
      waits.push((generating - created) / 1000);
    }
  }

  const hasActiveTool = scope.some(
    (step) => step.step_type !== 14 && step.step_type !== 15 && ACTIVE_STEP_STATUSES.has(step.status)
  );
  const hasStreamingPlanner = scope.some((step) => step.step_type === 15 && step.status === 8);
  const hasPriorActivePlanner = steps.some((step) => isPriorPlanner(step) && ACTIVE_STEP_STATUSES.has(step.status));
  const pendingPlanner = scope.findLast((step) => step.step_type === 15 && [1, 2].includes(step.status));
  const waitingPendingPlanner = Boolean(
    pendingPlanner && !coveredSteps.has(pendingPlanner.idx) && !validEpoch(pendingPlanner.generatingAtMs)
  );
  let waitingSinceMs = null;
  if (!turnTerminal && !hasActiveTool && !hasStreamingPlanner) {
    if (pendingPlanner) {
      if (waitingPendingPlanner) {
        waitingSinceMs = validEpoch(pendingPlanner.createdAtMs);
      }
    } else if (!childExecution && !hasPriorActivePlanner) {
      const relevant = scope.filter(
        (step) => !(step.step_type === 14 && step.status === 11) && ![101, 17].includes(step.step_type)
      );
      const last = relevant.at(-1);
      if (last) {
        if (last.step_type === 14) {
          waitingSinceMs = validEpoch(last.inputStartedAtMs);
        } else if (last.step_type !== 15 || last.status === 3) {
          waitingSinceMs = validEpoch(last.recordedCompletedAtMs) || validEpoch(last.terminalAtMs);
        }
      }
    }
  }

  return {
    userStepIndex,
    waits,
    waitingSinceMs,
    hasPendingPlanner: waitingPendingPlanner,
    turnTerminal
  };
}

function summarizeAttempts(attributable, ambiguous) {
  const attempts = attributable.flatMap((r) => r.attempts || []);
  const missing = attributable.reduce((sum, r) => sum + (r.missingAttempts || 0), 0);
  const pending = attributable.some((r) => r.pendingAttempt);
  const knownTotals = Object.fromEntries(
    TOKEN_KEYS.map((key) => [key, attempts.reduce((sum, a) => sum + (a.usage[key] ?? 0), 0)])
  );
  const totals = Object.fromEntries(
    TOKEN_KEYS.map((key) => [
      key,
      ambiguous || pending || missing || attempts.some((a) => a.usage[key] === null) ? null : knownTotals[key]
    ])
  );
  return {
    requestCount: ambiguous || pending ? null : attempts.length + missing,
    knownRequestCount: attempts.length + missing,
    missingUsageRequests: missing + attempts.filter((a) => TOKEN_KEYS.some((k) => a.usage[k] === null)).length,
    pending,
    associationIncomplete: ambiguous,
    knownTotals,
    ...totals
  };
}

function summarizeTurnMetrics(requests, steps, userStepIndex, executors = []) {
  const user = steps.find((step) => step.idx === userStepIndex && step.step_type === 14);
  if (!user) return null;
  const scope = steps.filter((step) => step.idx >= userStepIndex);
  const attributable = requests.filter((request) => request.lastStepIndex >= userStepIndex);
  const ambiguous = requests.some(
    (request) => request.lastStepIndex < 0 && request.stepIndices?.some((idx) => idx > userStepIndex)
  );
  let state = "unknown";
  let endedAtMs = null;
  const active = scope.some((step) => step.step_type !== 14 && ACTIVE_STEP_STATUSES.has(step.status));
  const executor = executors.filter((item) => item.lastStepIndex >= userStepIndex).at(-1);
  const finalStep = executor && scope.find((step) => step.idx === executor.lastStepIndex);
  const laterExecution =
    executor && scope.some((step) => step.idx > executor.lastStepIndex && ![14, 101, 17].includes(step.step_type));
  const executionMatches =
    finalStep && (!executor.executionId || !finalStep.executionId || executor.executionId === finalStep.executionId);
  if (user.status === 11) {
    state = "queued";
  } else if (active) {
    state = "running";
  } else if (executor && executionMatches && !laterExecution && ![0, 7, 12].includes(executor.reason)) {
    state = executor.reason === 1 ? "failed" : [2, 3, 6, 11].includes(executor.reason) ? "interrupted" : "completed";
    if (executor.reason === 2) {
      const lastCompleted = validEpoch(finalStep.completedAtMs) || validEpoch(finalStep.terminalAtMs);
      const cancellations = scope
        .filter(
          (step) =>
            [6, 12].includes(step.status) &&
            (!executor.executionId || !step.executionId || executor.executionId === step.executionId)
        )
        .map((step) => validEpoch(step.terminalAtMs) || validEpoch(step.completedAtMs))
        .filter((v) => v && (!lastCompleted || v >= lastCompleted));
      endedAtMs = cancellations.length ? Math.max(...cancellations) : null;
    } else {
      const errorStep =
        executor.reason === 1 && scope.findLast((step) => step.step_type === 17 && step.idx >= executor.lastStepIndex);
      const end = errorStep || finalStep;
      endedAtMs = validEpoch(end?.completedAtMs) || validEpoch(end?.terminalAtMs);
    }
  } else if ([6, 12].includes(user.status) && scope.every((step) => step.step_type === 14)) {
    state = "interrupted";
    endedAtMs = validEpoch(user.terminalAtMs);
  }
  const startedAtMs = validEpoch(user.createdAtMs);
  if (startedAtMs && endedAtMs && endedAtMs < startedAtMs) endedAtMs = null;
  return {
    userStepIndex,
    state,
    startedAtMs,
    endedAtMs,
    duration: startedAtMs && endedAtMs ? (endedAtMs - startedAtMs) / 1000 : null,
    ...summarizeAttempts(attributable, ambiguous)
  };
}

function summarizeSubagentExecution(steps, executors) {
  if (!steps.length) return null;
  const first = steps[0];
  const lastWork = steps.findLast((step) => ![17, 23, 101].includes(step.step_type));
  const executor = executors.at(-1);
  const finalStep = executor && steps.find((step) => step.idx === executor.lastStepIndex);
  const confirmed =
    finalStep && (!lastWork || lastWork.idx <= finalStep.idx) && ![0, 7, 12].includes(executor.reason);
  const cancelTime = (step) => validEpoch(step.terminalAtMs) || validEpoch(step.recordedCompletedAtMs);
  const doneTime = (step) => validEpoch(step.recordedCompletedAtMs) || validEpoch(step.terminalAtMs);
  let state = "unknown";
  let endedAtMs = null;
  if (confirmed) {
    state = executor.reason === 1 ? "failed" : [2, 3, 6, 11].includes(executor.reason) ? "interrupted" : "completed";
    if (state === "interrupted") {
      const lastDoneAt = [6, 12].includes(finalStep.status) ? null : doneTime(finalStep);
      for (const step of steps) {
        const time = [6, 12].includes(step.status) && step.idx >= finalStep.idx ? cancelTime(step) : null;
        if (time && (!lastDoneAt || time >= lastDoneAt)) endedAtMs = Math.max(endedAtMs || 0, time);
      }
    } else {
      const end = state === "failed" && steps.findLast((step) => step.step_type === 17 && step.idx >= finalStep.idx);
      endedAtMs = doneTime(end || finalStep);
    }
  } else if (lastWork && [6, 12].includes(lastWork.status)) {
    state = "interrupted";
    endedAtMs = cancelTime(lastWork);
  } else if (steps.some((step) => ACTIVE_STEP_STATUSES.has(step.status))) {
    state = first.status === 11 ? "queued" : "running";
  }
  const startedAtMs = validEpoch(first.createdAtMs);
  if (startedAtMs && endedAtMs && endedAtMs < startedAtMs) endedAtMs = null;
  return {
    executionId: first.executionId,
    state,
    startedAtMs,
    endedAtMs,
    duration: startedAtMs && endedAtMs ? (endedAtMs - startedAtMs) / 1000 : null
  };
}

function summarizeSubagentTurnMetrics(requests, execution, associationIncomplete) {
  return { ...execution, ...summarizeAttempts(requests, associationIncomplete) };
}

// =====================================================================
// 3. 文件指纹缓存与单对话快照解码
// =====================================================================

function fileStamp(filePath) {
  try {
    const s = statSync(filePath, { bigint: true });
    if (!s.isFile()) return null;
    return { size: s.size, mtimeMs: Number(s.mtimeNs / 1_000_000n), key: `${s.ino}:${s.size}:${s.mtimeNs}` };
  } catch {
    return null;
  }
}

function recordedTokenUsage(fields, confirmedZero = false) {
  const reported = confirmedZero || [2, 3, 5, 9, 10].some((key) => fields.has(key));
  const value = (key) => fields.get(key)?.[0] || 0;
  const splitMatches = value(3) === value(9) + value(10);
  return {
    read: reported ? value(2) + value(5) : null,
    cachedRead: reported ? value(5) : null,
    uncachedRead: reported ? value(2) : null,
    write: reported && splitMatches ? value(10) : null,
    thinking: reported && splitMatches ? value(9) : null
  };
}

function parseGenRow(idx, data, includeTurnMetrics = true) {
  if (!data || !Buffer.isBuffer(data)) data = Buffer.from(data || []);
  const top = parsePbMap(data);
  if (!top.has(1)) return null;

  const stepIndices = [];
  for (const value of top.get(2) || []) {
    if (typeof value === "number") stepIndices.push(value);
    else {
      for (let offset = 0; offset < value.length; ) {
        const [sIdx, next] = readVarint(value, offset);
        stepIndices.push(sIdx);
        offset = next;
      }
    }
  }
  const m1 = parsePbMap(top.get(1)[0]);
  const usageBuf = m1.has(4) ? m1.get(4)[0] : Buffer.alloc(0);
  const usage = parsePbMap(usageBuf);

  const uncachedIn = usage.has(2) ? usage.get(2)[0] : 0;
  const cachedIn = usage.has(5) ? usage.get(5)[0] : 0;
  const thinkTokens = usage.has(9) ? usage.get(9)[0] : 0;
  const outTokens = usage.has(10) ? usage.get(10)[0] : 0;
  const contextTokens = uncachedIn + cachedIn;
  const duration = (field) => {
    if (!m1.has(field)) return null;
    const fields = parsePbMap(m1.get(field)[0]);
    return (fields.get(1)?.[0] || 0) + (fields.get(2)?.[0] || 0) / 1e9;
  };
  const ttft = duration(11);
  const streaming = duration(12);
  const lastRetry = m1.get(17)?.at(-1);
  const retryError = lastRetry ? parsePbMap(lastRetry).get(3)?.[0] : null;
  const requestError = classifyRequestError(Buffer.isBuffer(retryError) ? retryError.toString("utf8") : "");
  const hasOutput = m1.has(4) && (usage.has(3) || (ttft !== null && streaming !== null));

  let attempts = [];
  let missingAttempts = 0;
  let pendingAttempt = false;
  if (includeTurnMetrics) {
    const retries = m1.get(17) || [];
    const count = m1.get(14)?.[0];
    const retryCount = Number.isInteger(count) && count >= 0 && count <= 0x7fffffff ? count : 0;
    const hasAttempt =
      retries.length > 0 || hasOutput || ttft !== null || streaming !== null || top.has(5) || retryCount > 0;
    attempts = retries.map((value, index) => {
      const info = parsePbMap(value);
      const counters = parsePbMap(info.get(2)?.[0] || Buffer.alloc(0));
      const finalSuccess = index === retries.length - 1 && !info.get(3)?.[0]?.length && hasOutput;
      const reported = [2, 3, 5, 9, 10].some((key) => counters.has(key));
      return { usage: recordedTokenUsage(finalSuccess && !reported ? usage : counters, finalSuccess) };
    });
    if (hasAttempt && attempts.length === 0) attempts.push({ usage: recordedTokenUsage(usage, hasOutput) });
    if (hasAttempt) missingAttempts = Math.max(0, retryCount + 1 - attempts.length);
    pendingAttempt = !hasAttempt && stepIndices.length > 0;
  }

  let maxContextTokens = 0;
  if (m1.has(9)) {
    const m9 = parsePbMap(m1.get(9)[0]);
    if (m9.has(10)) {
      const m10 = parsePbMap(m9.get(10)[0]);
      if (m10.has(4)) {
        maxContextTokens = m10.get(4)[0];
      }
    }
  }

  let lastStepIndex = -1;
  if (m1.has(20)) {
    for (const kvBuf of m1.get(20)) {
      const kv = parsePbMap(kvBuf);
      const key = kv.has(1) ? kv.get(1)[0].toString("utf8") : "";
      if (key === "last_step_index" && kv.has(2)) {
        const n = Number(kv.get(2)[0].toString("utf8"));
        if (Number.isFinite(n)) lastStepIndex = n;
        break;
      }
    }
  }

  const readText = (field) => (Buffer.isBuffer(m1.get(field)?.[0]) ? m1.get(field)[0].toString("utf8").trim() : "");
  const modelDisplayName = readText(21) || readText(19);

  return {
    turn: idx,
    uncachedIn,
    cachedIn,
    contextTokens,
    outTokens,
    thinkTokens,
    maxContextTokens,
    lastStepIndex,
    stepIndices,
    requestError,
    attempts,
    missingAttempts,
    pendingAttempt,
    modelDisplayName,
    generation: {
      requestIndex: idx,
      ttft,
      streaming,
      output: hasOutput ? usage.get(3)?.[0] || 0 : null,
      reply: hasOutput ? outTokens : null,
      thinking: hasOutput ? thinkTokens : null
    }
  };
}

function visibleLocalRequestError(request, steps) {
  const error = request?.requestError ?? classifyRequestError();
  if (error.kind === "none" || !request.stepIndices.length) return error;
  const lastOutputIndex = request.stepIndices.reduce((last, idx) => Math.max(last, idx), -1);
  const lastOutput = steps.find((step) => step.idx === lastOutputIndex);
  if (!lastOutput) return error;
  const failedAt = lastOutput.recordedCompletedAtMs || lastOutput.terminalAtMs;
  const resumed = steps.some(
    (step) =>
      step.idx > lastOutputIndex &&
      step.step_type === 15 &&
      (step.status === 8 || (step.status === 3 && step.generatingAtMs > 0)) &&
      (!lastOutput.executionId || step.executionId === lastOutput.executionId) &&
      (!failedAt || step.createdAtMs >= failedAt)
  );
  return resumed ? classifyRequestError() : error;
}

function readConversationSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 200 });
  let rawRows = [];
  let cpRows = [];
  let lastStepEpochMs = 0;
  let userStepIndex = null;
  let turnSteps = [];
  let metricsUserStepIndex = null;
  let executors = [];
  let subagent = false;
  try {
    db.exec("PRAGMA busy_timeout = 200;");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'").get()) {
      const blob = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id='main'").get()?.data;
      const meta = parsePbMap(Buffer.from(blob || []));
      subagent = !!(meta.get(5)?.[0]?.length && meta.get(8)?.[0]?.length);
    }
    rawRows = db.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx ASC").all();
    cpRows = db.prepare("SELECT idx FROM steps WHERE step_type = 23 ORDER BY idx DESC").all();
    userStepIndex =
      db.prepare("SELECT idx FROM steps WHERE step_type = 14 AND status != 11 ORDER BY idx DESC LIMIT 1").get()?.idx ?? null;
    metricsUserStepIndex = db.prepare("SELECT idx FROM steps WHERE step_type = 14 ORDER BY idx DESC LIMIT 1").get()?.idx ?? null;

    const firstTurnStep = subagent ? 0 : userStepIndex ?? metricsUserStepIndex;
    if (firstTurnStep !== null) {
      turnSteps = db
        .prepare("SELECT idx, step_type, status, metadata FROM steps WHERE idx >= ? ORDER BY idx")
        .all(firstTurnStep)
        .map((step) => {
          const fields = parsePbMap(Buffer.from(step.metadata || []));
          const stamp = fields.get(7)?.[0] || fields.get(8)?.[0];
          const time = stamp ? parsePbMap(stamp) : new Map();
          const epoch = (value) => {
            const parts = parsePbMap(value || Buffer.alloc(0));
            return parts.has(1) ? parts.get(1)[0] * 1000 + (parts.get(2)?.[0] || 0) / 1e6 : null;
          };
          const transitions = (parsePbMap(fields.get(26)?.[0] || Buffer.alloc(0)).get(1) || []).map((v) =>
            parsePbMap(v)
          );
          const generating = transitions
            .filter((item) => item.get(1)?.[0] === 8)
            .map((item) => epoch(item.get(2)?.[0]))
            .filter((v) => v !== null);
          const terminal = transitions
            .filter((item) => [3, 6, 7, 12].includes(item.get(1)?.[0]))
            .map((item) => epoch(item.get(2)?.[0]))
            .filter((v) => v !== null);
          let inputStartedAtMs = null;
          if (step.step_type === 14) {
            for (const item of transitions) {
              const status = item.get(1)?.[0];
              if (status === 11) inputStartedAtMs = null;
              else if (status === 2 || status === 3) inputStartedAtMs ??= epoch(item.get(2)?.[0]);
            }
          }
          return {
            idx: step.idx,
            step_type: step.step_type,
            status: step.status,
            completedAtMs: (time.get(1)?.[0] || 0) * 1000 + (time.get(2)?.[0] || 0) / 1e6,
            recordedCompletedAtMs: epoch(fields.get(8)?.[0]),
            createdAtMs: epoch(fields.get(1)?.[0]),
            inputStartedAtMs,
            generatingAtMs: generating.length ? Math.min(...generating) : null,
            terminalAtMs: terminal.length ? Math.max(...terminal) : null,
            executionId: fields.get(12)?.[0]?.toString("utf8") || ""
          };
        });
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='executor_metadata'").get()) {
        executors = db
          .prepare("SELECT data FROM executor_metadata ORDER BY idx")
          .all()
          .map((row) => {
            const fields = parsePbMap(Buffer.from(row.data || []));
            return {
              reason: fields.get(1)?.[0] || 0,
              lastStepIndex: fields.size ? fields.get(3)?.[0] ?? 0 : -1,
              executionId: fields.get(9)?.[0]?.toString("utf8") || ""
            };
          });
      }
    }

    const stepRow = db.prepare("SELECT metadata FROM steps ORDER BY idx DESC LIMIT 1").get();
    if (stepRow?.metadata) {
      const sm = parsePbMap(Buffer.from(stepRow.metadata));
      if (sm.has(1)) {
        const tsMap = parsePbMap(sm.get(1)[0]);
        if (tsMap.has(1)) {
          lastStepEpochMs = Number(tsMap.get(1)[0]) * 1000;
        }
      }
    }
  } finally {
    db.close();
  }

  if (!lastStepEpochMs) {
    try {
      lastStepEpochMs = Math.max(
        statSync(dbPath).mtimeMs,
        existsSync(dbPath + "-wal") ? statSync(dbPath + "-wal").mtimeMs : 0
      );
    } catch {}
  }

  const turns = [];
  let maxContextTokens = 0;
  let latestGeneration = null;
  let latestTurnRequest = null;
  const parsedRequests = [];

  for (const row of rawRows) {
    const parsed = parseGenRow(row.idx, row.data, true);
    if (!parsed) continue;
    parsedRequests.push(parsed);
    latestGeneration = parsed.generation;
    const earlierRequest = userStepIndex !== null && parsed.lastStepIndex >= 0 && parsed.lastStepIndex < userStepIndex;
    if (!earlierRequest) latestTurnRequest = parsed;
    if (parsed.maxContextTokens > 0) {
      maxContextTokens = parsed.maxContextTokens;
    }
    if (parsed.contextTokens === 0) continue;
    turns.push(parsed);
  }

  let epochStart = 0;
  if (turns.length > 0) {
    for (const cp of cpRows) {
      const postIdx = turns.findIndex((t) => t.lastStepIndex >= cp.idx);
      if (postIdx >= 0) {
        epochStart = postIdx;
        break;
      }
    }
    for (let i = epochStart + 1; i < turns.length; i++) {
      if (turns[i].contextTokens < turns[i - 1].contextTokens * 0.7) {
        epochStart = i;
      }
    }
  }

  const latest = turns[turns.length - 1] || {
    uncachedIn: 0,
    cachedIn: 0,
    contextTokens: 0,
    outTokens: 0,
    thinkTokens: 0
  };
  if (turns.length === 0 || latest.contextTokens === 0) {
    lastStepEpochMs = 0;
  }

  let rawOut = 0;
  let rawThink = 0;
  for (let i = epochStart; i < turns.length - 1; i++) {
    rawOut += turns[i].outTokens;
    rawThink += turns[i].thinkTokens;
  }

  const turn0Tokens = Math.min(turns[epochStart]?.contextTokens || 0, latest.contextTokens);
  const availGen = Math.max(0, latest.contextTokens - turn0Tokens);
  const genSum = rawOut + rawThink;
  const genScale = genSum > availGen && genSum > 0 ? availGen / genSum : 1;
  const totalOutputTokens = Math.round(rawOut * genScale);
  const totalThinkingTokens = Math.round(rawThink * genScale);

  let turnQueue;
  let requestError;
  let turnSpeed = null;
  let childTurnMetrics = null;

  if (subagent) {
    const latestStep = turnSteps.findLast((step) => ![17, 23].includes(step.step_type));
    const executionId = latestStep?.executionId;
    const steps = executionId ? turnSteps.filter((step) => step.executionId === executionId) : [];
    const executionByStep = new Map(turnSteps.map((step) => [step.idx, step.executionId]));
    const requests = executionId
      ? parsedRequests.filter((request) => {
          if (!request.stepIndices.length) return executionByStep.get(request.lastStepIndex) === executionId;
          const linked = request.stepIndices.map((idx) => executionByStep.get(idx)).filter(Boolean);
          return linked.length > 0 && linked.every((id) => id === executionId);
        })
      : [];
    const childExecutors = executors.filter((item) => item.executionId === executionId);
    turnQueue = summarizeTurnQueue(requests, steps, steps[0]?.idx, childExecutors, true);
    requestError = visibleLocalRequestError(requests.at(-1), steps);
    const execution = summarizeSubagentExecution(steps, childExecutors);
    if (execution) {
      let associationIncomplete = false;
      const executionRequests = parsedRequests.filter((request) => {
        const fromCurrentInput = executionByStep.get(request.lastStepIndex) === executionId;
        if (!request.stepIndices.length) return fromCurrentInput;
        const linked = request.stepIndices.map((idx) => executionByStep.get(idx));
        if (linked.every((id) => id === executionId)) return true;
        if (
          linked.includes(executionId) ||
          (linked.includes(undefined) && fromCurrentInput) ||
          (linked.every((id) => !id) && request.stepIndices.some((idx) => idx >= steps[0].idx))
        ) {
          associationIncomplete = true;
        }
        return false;
      });
      turnSpeed = summarizeSubagentTurnSpeed(executionRequests, steps, execution);
      childTurnMetrics = summarizeSubagentTurnMetrics(executionRequests, execution, associationIncomplete);
    }
  } else {
    turnQueue = summarizeTurnQueue(parsedRequests, turnSteps, userStepIndex, executors);
    turnSpeed = summarizeTurnSpeed(parsedRequests, turnSteps, userStepIndex);
    requestError = visibleLocalRequestError(latestTurnRequest, turnSteps);
  }

  const activeModel = parsedRequests.at(-1)?.modelDisplayName || "";
  const effectiveMax = subagent ? latest.maxContextTokens || maxContextTokens : maxContextTokens;

  return {
    found: true,
    conversationId: basename(dbPath, ".db"),
    subagent: subagent ? { model: activeModel } : null,
    activeModel,
    turnSpeed,
    turnQueue,
    turnMetrics: subagent
      ? childTurnMetrics
      : summarizeTurnMetrics(
          parsedRequests,
          turnSteps.map((step) => ({ ...step, completedAtMs: step.recordedCompletedAtMs })),
          metricsUserStepIndex,
          executors
        ),
    requestError,
    generation: summarizeGeneration(latestGeneration),
    cachedIn: latest.cachedIn,
    uncachedIn: latest.uncachedIn,
    contextTokens: latest.contextTokens,
    maxContextTokens: effectiveMax,
    lastStepEpochMs,
    turn0Tokens,
    totalOutputTokens,
    totalThinkingTokens
  };
}

const snapshotCache = new Map();

function resolveConversationDb(conversationId) {
  const dirs = getConversationDirs();
  if (conversationId && typeof conversationId === "string" && /^[0-9a-zA-Z_-]+$/.test(conversationId)) {
    for (const dir of dirs) {
      const candidate = join(dir, `${conversationId}.db`);
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
        return candidate;
      }
    }
  }
  let latest = null;
  let newest = -Infinity;
  for (const dir of dirs) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of names) {
      if (!file.endsWith(".db")) continue;
      const p = join(dir, file);
      const st = statSync(p, { throwIfNoEntry: false });
      if (st?.isFile() && st.mtimeMs > newest) {
        newest = st.mtimeMs;
        latest = p;
      }
    }
  }
  return latest;
}

export function inspectConversation(conversationId = "") {
  const dbPath = resolveConversationDb(conversationId);
  if (!dbPath) {
    return {
      found: false,
      conversationId: "",
      subagent: null,
      activeModel: "",
      turnSpeed: null,
      turnQueue: null,
      turnMetrics: null,
      requestError: classifyRequestError(),
      generation: summarizeGeneration(),
      cachedIn: 0,
      uncachedIn: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      lastStepEpochMs: 0,
      turn0Tokens: 0,
      totalOutputTokens: 0,
      totalThinkingTokens: 0
    };
  }
  const dbStamp = fileStamp(dbPath);
  if (!dbStamp || dbStamp.size === 0n) {
    return {
      found: false,
      conversationId: basename(dbPath, ".db"),
      requestError: classifyRequestError(),
      generation: summarizeGeneration(),
      contextTokens: 0,
      maxContextTokens: 0
    };
  }
  const walStamp = fileStamp(dbPath + "-wal");
  const key = dbStamp.key + "|" + (walStamp?.key || "no-wal");
  const cached = snapshotCache.get(dbPath);
  if (cached && cached.key === key) {
    return cached.value;
  }
  try {
    const value = readConversationSnapshot(dbPath);
    snapshotCache.delete(dbPath);
    snapshotCache.set(dbPath, { key, value });
    if (snapshotCache.size > 10) {
      snapshotCache.delete(snapshotCache.keys().next().value);
    }
    return value;
  } catch (err) {
    if (cached?.value) {
      return cached.value;
    }
    return {
      found: false,
      conversationId: basename(dbPath, ".db"),
      error: err?.message || String(err),
      requestError: classifyRequestError(),
      generation: summarizeGeneration(),
      contextTokens: 0,
      maxContextTokens: 0
    };
  }
}

// =====================================================================
// 4. daemon hub 探测与多模型配额查询
// =====================================================================

let cachedQuota = null;
let lastQuotaFetchMs = 0;
const modelIdToLabelMap = new Map();

function readSelectedModelIdFromPbtxt() {
  const home = getHomeDir();
  let latestPath = "";
  let latestMtime = -Infinity;
  for (const product of ["antigravity", "antigravity-ide", "antigravity-cli"]) {
    const candidate = join(home, ".gemini", product, "antigravity_state.pbtxt");
    try {
      const st = statSync(candidate, { throwIfNoEntry: false });
      if (st?.isFile() && st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latestPath = candidate;
      }
    } catch {}
  }
  if (!latestPath) return "";
  try {
    const content = readFileSync(latestPath, "utf8");
    const match = content.match(/^\s*last_selected_agent_model:\s*["']?([A-Za-z0-9_.:/-]+)["']?/m);
    return match && match[1] ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function withLiveSelectedModel(baseQuota) {
  const selectedModelId = readSelectedModelIdFromPbtxt();
  const selectedModelLabel = (selectedModelId && modelIdToLabelMap.get(selectedModelId)) || "";
  return {
    ...baseQuota,
    selectedModelId,
    selectedModelLabel
  };
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function listCandidateHubs() {
  const hubs = [];
  for (const dir of getDaemonDirs()) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of names) {
      if (!/^hub_.*\.json$/i.test(file)) continue;
      const fullPath = join(dir, file);
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        const parsed = JSON.parse(readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
        const port = Number(parsed?.httpPort);
        const token = typeof parsed?.csrfToken === "string" ? parsed.csrfToken.trim() : "";
        const pid = Number(parsed?.pid);
        if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) continue;
        hubs.push({
          port,
          token,
          pid,
          alive: isPidAlive(pid),
          mtimeMs: st.mtimeMs
        });
      } catch {}
    }
  }
  return hubs.sort((a, b) => Number(b.alive) - Number(a.alive) || b.mtimeMs - a.mtimeMs);
}

export async function getQuota(force = false) {
  const now = Date.now();
  const currentSelectedId = readSelectedModelIdFromPbtxt();
  const needMapRefresh = Boolean(currentSelectedId && !modelIdToLabelMap.has(currentSelectedId));
  if (!force && !needMapRefresh && cachedQuota && now - lastQuotaFetchMs < QUOTA_TTL_MS) {
    return withLiveSelectedModel(cachedQuota);
  }

  const hubs = listCandidateHubs();
  for (const hub of hubs.slice(0, 6)) {
    const callRpc = (method) =>
      fetch(`http://127.0.0.1:${hub.port}/exa.language_server_pb.LanguageServerService/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": hub.token
        },
        body: "{}",
        signal: AbortSignal.timeout(3000)
      });

    try {
      const res = await callRpc("RetrieveUserQuotaSummary");
      if (!res.ok) continue;
      const data = await res.json();
      const groups = data?.response?.groups ?? data?.groups;
      const quotaGroups = Array.isArray(groups) ? groups : [];
      let cloudPaygo = false;
      let userTierName = "";
      let userEmail = "";
      let userName = "";
      let defaultModelLabel = "";
      try {
        const statusRes = await callRpc("GetUserStatus");
        if (statusRes.ok) {
          const statusJson = await statusRes.json();
          const tier = statusJson?.userStatus?.userTier;
          cloudPaygo = tier?.id === "agy-business-paygo-tier";
          userTierName = String(tier?.name || "").trim();
          userEmail = String(statusJson?.userStatus?.email || "").trim();
          userName = String(statusJson?.userStatus?.name || "").trim();
          const cascadeCfg = statusJson?.userStatus?.cascadeModelConfigData;
          const defaultModelCfg = cascadeCfg?.defaultOverrideModelConfig;
          const defaultModelId = defaultModelCfg?.modelOrAlias?.model || "";
          const clientConfigs = Array.isArray(cascadeCfg?.clientModelConfigs)
            ? cascadeCfg.clientModelConfigs
            : [];
          for (const cfgItem of clientConfigs) {
            const label = String(cfgItem?.label || "").trim();
            if (!label) continue;
            for (const idCand of [
              cfgItem?.modelOrAlias?.model,
              cfgItem?.modelOrAlias?.alias,
              cfgItem?.modelId
            ]) {
              if (typeof idCand === "string" && idCand.trim()) {
                modelIdToLabelMap.set(idCand.trim(), label);
              }
            }
          }
          defaultModelLabel = String(
            defaultModelCfg?.label ||
            (defaultModelId && modelIdToLabelMap.get(defaultModelId)) ||
            ""
          ).trim();
        }
      } catch {}

      cachedQuota = {
        ok: true,
        quotaGroups,
        cloudPaygo,
        userTierName,
        userEmail,
        userName,
        defaultModelLabel,
        fetchedAtMs: Date.now()
      };
      lastQuotaFetchMs = Date.now();
      return withLiveSelectedModel(cachedQuota);
    } catch {
      // 尝试下一个候选 hub
    }
  }

  return withLiveSelectedModel(
    cachedQuota || {
      ok: false,
      quotaGroups: [],
      cloudPaygo: false,
      userTierName: "",
      userEmail: "",
      userName: "",
      defaultModelLabel: "",
      fetchedAtMs: Date.now()
    }
  );
}

// =====================================================================
// 5. 按需全库历史用量增量扫描（带 immutable=1 防脏文件）与多维度分析聚合
// =====================================================================

const usageFileCache = new Map();
const convTitleCache = new Map();
let cachedOrderedRequests = [];
let cachedDedupeRequests = [];
let cachedUsageTotals = null;
let usageScanPromise = null;

const HOUR_MS = 3600_000;
const FIVE_HOUR_MS = 5 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

function isValidEpochSec(v) {
  return Number.isSafeInteger(v) && v >= MIN_USAGE_EPOCH_S && v < 4e9;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localDay(epochMs) {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatMonthDay(epochMs) {
  const d = new Date(epochMs);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatHHMM(epochMs) {
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseLocalDayStartMs(dayStr) {
  const parts = String(dayStr || "").split("-");
  if (parts.length !== 3) return NaN;
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return NaN;
  return new Date(y, m, d).getTime();
}

const CONV_TITLE_RECHECK_MS = 30_000;

function readAnnotationTitle(convId) {
  const home = getHomeDir();
  const products = ["antigravity", "antigravity-ide", "antigravity-cli"];
  for (const prod of products) {
    const annPath = join(home, ".gemini", prod, "annotations", `${convId}.pbtxt`);
    try {
      if (!statSync(annPath, { throwIfNoEntry: false })?.isFile()) continue;
      const raw = readFileSync(annPath, "utf8");
      const m = raw.match(/title:\s*"((?:\\.|[^"\\])*)"/);
      if (m && m[1]) {
        let title = m[1];
        try {
          title = JSON.parse(`"${m[1]}"`);
        } catch {}
        title = String(title || "").replace(/\s+/g, " ").trim();
        if (title) return title;
      }
    } catch {}
  }
  return "";
}

function setConvTitleCache(convId, title, fromAnnotation) {
  if (convTitleCache.size > 300) convTitleCache.clear();
  convTitleCache.set(convId, { title, fromAnnotation, checkedAtMs: Date.now() });
}

function resolveConversationTitle(convId) {
  if (!convId || typeof convId !== "string") return "";
  const now = Date.now();
  const cached = convTitleCache.get(convId);
  if (cached) {
    if (cached.fromAnnotation || now - cached.checkedAtMs < CONV_TITLE_RECHECK_MS) {
      return cached.title;
    }
    // 临时标题超过重检窗口后仅探测 annotations 是否已生成正式标题
    const upgraded = readAnnotationTitle(convId);
    if (upgraded) {
      setConvTitleCache(convId, upgraded, true);
      return upgraded;
    }
    cached.checkedAtMs = now;
    return cached.title;
  }

  // 1. 优先读取 annotations/<convId>.pbtxt 中的人工/系统标题
  const annTitle = readAnnotationTitle(convId);
  if (annTitle) {
    setConvTitleCache(convId, annTitle, true);
    return annTitle;
  }

  // 2. 回退读取 transcript.jsonl 首条用户提问
  const home = getHomeDir();
  const products = ["antigravity", "antigravity-ide", "antigravity-cli"];
  for (const prod of products) {
    const tPath = join(home, ".gemini", prod, "brain", convId, ".system_generated", "logs", "transcript.jsonl");
    let fd = null;
    try {
      const st = statSync(tPath, { throwIfNoEntry: false });
      if (!st?.isFile() || st.size <= 0) continue;
      const readLen = Math.min(16 * 1024, st.size);
      fd = openSync(tPath, "r");
      const buf = Buffer.allocUnsafe(readLen);
      const n = readSync(fd, buf, 0, readLen, 0);
      const text = buf.subarray(0, n).toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line || !line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== "USER_INPUT" && obj.source !== "USER") continue;
          const rawContent =
            typeof obj.content === "string"
              ? obj.content
              : (obj.user_input && typeof obj.user_input.user_response === "string" ? obj.user_input.user_response : "");
          const reqMatch = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
          const candidate = (reqMatch ? reqMatch[1] : rawContent).replace(/\s+/g, " ").trim();
          if (candidate) {
            const title = candidate.length > 28 ? `${candidate.slice(0, 28)}...` : candidate;
            setConvTitleCache(convId, title, false);
            return title;
          }
        } catch {}
      }
    } catch {} finally {
      if (fd !== null) {
        try { closeSync(fd); } catch {}
      }
    }
  }

  const fallback = `会话 ${convId.slice(0, 8)}`;
  setConvTitleCache(convId, fallback, false);
  return fallback;
}

function emptyUsageBucket() {
  return { requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

function findBarIndex(barStates, ts) {
  let lo = 0;
  let hi = barStates.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const b = barStates[mid];
    if (ts < b.fromMs) {
      hi = mid - 1;
    } else if (ts >= b.toMs) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

function withUsageMetrics(b) {
  const net = (b.uncached || 0) + (b.cacheWrite || 0) + (b.output || 0);
  const total = net + (b.cacheRead || 0);
  return { ...b, net, total };
}

function pairStamp(filePath) {
  const db = fileStamp(filePath);
  if (!db || db.size === 0n) return null;
  const wal = fileStamp(filePath + "-wal");
  const activeWal = wal && wal.size > 0n ? wal : null;
  return {
    key: db.key + "|" + (activeWal?.key || "no-wal"),
    hasWal: Boolean(activeWal),
    mtimeMs: Math.max(db.mtimeMs, activeWal?.mtimeMs || 0)
  };
}

function parseUsageRow(data, stepMetadata) {
  const bytes = (v) =>
    v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.alloc(0);
  const top = parsePbMap(bytes(data));
  const chat = parsePbMap(bytes(top.get(1)?.[0]));
  const usage = parsePbMap(bytes(chat.get(4)?.[0]));
  const count = (f) => (Number.isSafeInteger(usage.get(f)?.[0]) ? usage.get(f)[0] : 0);
  const text = (f) => bytes(usage.get(f)?.[0]).toString("utf8");
  const tokens = { uncached: count(2), cacheRead: count(5), cacheWrite: count(4), output: count(3) };
  if (!Object.values(tokens).some(Boolean)) return null;

  const seconds = (stamp) => parsePbMap(bytes(stamp)).get(1)?.[0];
  let startedAt = seconds(parsePbMap(bytes(chat.get(9)?.[0])).get(4)?.[0]);
  if (!isValidEpochSec(startedAt)) {
    startedAt = null;
    for (const entry of top.get(2) || []) {
      if (typeof entry === "number") {
        const candidate = seconds(parsePbMap(bytes(stepMetadata(entry))).get(1)?.[0]);
        if (isValidEpochSec(candidate)) {
          startedAt = candidate;
          break;
        }
      } else if (entry?.length) {
        let offset = 0;
        while (offset < entry.length) {
          let stepIndex;
          try {
            [stepIndex, offset] = readVarint(entry, offset);
          } catch {
            break;
          }
          const candidate = seconds(parsePbMap(bytes(stepMetadata(stepIndex))).get(1)?.[0]);
          if (isValidEpochSec(candidate)) {
            startedAt = candidate;
            break;
          }
        }
        if (startedAt !== null) break;
      }
    }
  }
  const responseId = text(11);
  const messageId = text(7);
  const name = (f) => bytes(chat.get(f)?.[0]).toString("utf8").trim().slice(0, 80);
  return {
    at: isValidEpochSec(startedAt) ? startedAt * 1000 : null,
    id: responseId ? `r${count(6)}:${responseId}` : messageId ? `m${count(6)}:${messageId}` : "",
    model: name(21) || name(19),
    ...tokens
  };
}

function readConversationUsage(dbPath, { immutable = true } = {}) {
  const hasActiveWal = (statSync(dbPath + "-wal", { throwIfNoEntry: false })?.size || 0) > 0;
  const useImmutable = immutable && !hasActiveWal;
  let location = dbPath;
  if (useImmutable) {
    location = pathToFileURL(dbPath);
    location.searchParams.set("immutable", "1");
  }
  const db = new DatabaseSync(location, { readOnly: true, timeout: 150 });
  try {
    if (!useImmutable) db.exec("PRAGMA busy_timeout = 150;");
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gen_metadata'").get()) return [];
    const hasSteps = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='steps'").get());
    let stepRow = null;
    const stepMetadata = hasSteps
      ? (index) => (stepRow ??= db.prepare("SELECT metadata FROM steps WHERE idx = ?")).get(index)?.metadata
      : () => undefined;
    return db
      .prepare("SELECT data FROM gen_metadata ORDER BY idx ASC")
      .all()
      .map((row) => parseUsageRow(row.data, stepMetadata))
      .filter(Boolean);
  } finally {
    db.close();
  }
}

function dedupeUsageRequests(requests) {
  const tokensOfReq = (req) => COUNTERS.reduce((s, k) => s + req[k], 0);
  const preferRequest = (cand, known) => {
    const diff = tokensOfReq(cand) - tokensOfReq(known);
    if (diff !== 0) return diff > 0;
    const candDated = cand.at !== null;
    const knownDated = known.at !== null;
    if (candDated !== knownDated) return candDated;
    if (candDated && cand.at !== known.at) return cand.at < known.at;
    if (Boolean(cand.model) !== Boolean(known.model)) return Boolean(cand.model);
    if (cand.model !== known.model) return (cand.model || "") < (known.model || "");
    return (cand.source || "") < (known.source || "");
  };

  const identified = new Map();
  const counted = [];
  for (const r of requests) {
    if (!r.id) {
      counted.push(r);
      continue;
    }
    const known = identified.get(r.id);
    if (!known || preferRequest(r, known)) identified.set(r.id, r);
  }
  for (const r of identified.values()) counted.push(r);
  return counted;
}

function summarizeUsage(counted) {
  const add = (b, r) => {
    b.requests++;
    for (const k of COUNTERS) b[k] += r[k];
  };
  const days = new Map();
  const undated = emptyUsageBucket();
  for (const r of counted) {
    if (r.at === null) {
      add(undated, r);
      continue;
    }
    const date = localDay(r.at);
    const day = days.get(date) ?? days.set(date, { total: emptyUsageBucket(), models: new Map() }).get(date);
    add(day.total, r);
    const model = r.model || "";
    add(day.models.get(model) ?? day.models.set(model, emptyUsageBucket()).get(model), r);
  }
  const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    days: [...days].sort(byKey).map(([date, day]) => ({
      date,
      ...day.total,
      models: [...day.models].sort(byKey).map(([name, bucket]) => ({ name, ...bucket }))
    })),
    undated
  };
}

async function ensureUsageCacheFresh(activeConversationId = "") {
  if (usageScanPromise) return usageScanPromise;
  usageScanPromise = (async () => {
    const activeIds = new Set(activeConversationId ? [activeConversationId] : []);
    const present = new Set();
    let changed = cachedUsageTotals === null;
    let unchanged = 0;
    let unread = 0;
    const dirs = getConversationDirs();

    for (const dir of dirs) {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      let names = [];
      try {
        names = readdirSync(dir).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".db")) continue;
        const p = join(dir, name);
        const before = pairStamp(p);
        if (!before) continue;
        present.add(p);
        const convId = name.slice(0, -3);
        const stale = usageFileCache.get(p)?.key !== before.key;
        if (stale) {
          const recentlyModified = Date.now() - before.mtimeMs < RECENT_WRITE_MS;
          const immutable = !before.hasWal && !activeIds.has(convId) && !recentlyModified;
          try {
            const reqs = readConversationUsage(p, { immutable });
            const after = pairStamp(p);
            if (!after) {
              present.delete(p);
            } else if (after.key === before.key) {
              usageFileCache.set(p, {
                key: before.key,
                convId,
                mtimeMs: before.mtimeMs,
                requests: reqs.map((req) => ({ ...req, source: req.source || p, convId }))
              });
              changed = true;
            } else {
              unread++;
            }
          } catch {
            unread++;
          }
        }
        if (stale || ++unchanged % 64 === 0) {
          await new Promise((r) => setImmediate(r));
        }
      }
    }

    for (const p of usageFileCache.keys()) {
      if (!present.has(p)) {
        usageFileCache.delete(p);
        changed = true;
      }
    }
    if (changed) {
      cachedOrderedRequests = [...usageFileCache.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .flatMap(([, file]) => file.requests);
      cachedDedupeRequests = dedupeUsageRequests(cachedOrderedRequests);
      cachedUsageTotals = summarizeUsage(cachedDedupeRequests);
    }
    return {
      dedupedRequests: cachedDedupeRequests,
      totals: cachedUsageTotals,
      unread,
      scannedFiles: present.size,
      changed
    };
  })().finally(() => {
    usageScanPromise = null;
  });
  return usageScanPromise;
}

export async function getUsageHistory(activeConversationId = "") {
  const scan = await ensureUsageCacheFresh(activeConversationId);
  return {
    ...scan.totals,
    unread: scan.unread,
    scannedFiles: scan.scannedFiles
  };
}

function buildTimeWindowAndBars(period, shift, anchorDate, anchorEndMs, nowMs = Date.now()) {
  const nowD = new Date(nowMs);
  const nowY = nowD.getFullYear();
  const todayStartMs = new Date(nowY, nowD.getMonth(), nowD.getDate()).getTime();
  const tomorrowStartMs = new Date(nowY, nowD.getMonth(), nowD.getDate() + 1).getTime();

  const bars = [];
  let rangeStartMs = 0;
  let rangeEndMs = 0;
  let latestWindowEndMs = tomorrowStartMs;
  let rangeLabel = "";

  if (period === "5h") {
    // 5h 标签：每柱 5 小时，展示 6 柱（共 30 小时）
    const barCount = 6;
    const windowMs = barCount * FIVE_HOUR_MS;
    const latestEndMs = (Math.floor(nowMs / HOUR_MS) + 1) * HOUR_MS;
    const baseEndMs =
      anchorEndMs > 0
        ? Math.min(latestEndMs, Math.ceil(anchorEndMs / HOUR_MS) * HOUR_MS)
        : latestEndMs;
    rangeEndMs = Math.min(latestEndMs, baseEndMs + shift * windowMs);
    rangeStartMs = rangeEndMs - windowMs;
    latestWindowEndMs = latestEndMs;
    for (let i = 0; i < barCount; i++) {
      const fromMs = rangeStartMs + i * FIVE_HOUR_MS;
      const toMs = fromMs + FIVE_HOUR_MS;
      const fromD = new Date(fromMs);
      const toD = new Date(toMs);
      const endDisplayMs = toMs - 1;
      const sameDay = localDay(fromMs) === localDay(endDisplayMs);
      bars.push({
        label: `${pad2(fromD.getHours())}-${pad2(toD.getHours())}`,
        name: sameDay
          ? `${formatMonthDay(fromMs)} ${formatHHMM(fromMs)}–${formatHHMM(toMs)}`
          : `${formatMonthDay(fromMs)} ${formatHHMM(fromMs)}–${formatMonthDay(endDisplayMs)} ${formatHHMM(toMs)}`,
        dayStr: localDay(fromMs),
        fromMs,
        toMs,
        drillable: false,
        drillTarget: "",
        drillAnchorMs: 0
      });
    }
    rangeLabel = `${formatMonthDay(rangeStartMs)} ${formatHHMM(rangeStartMs)} – ${formatMonthDay(rangeEndMs - 1)} ${formatHHMM(rangeEndMs)}`;
  } else if (period === "day") {
    // 日标签：每柱 1 天，展示 7 柱（7 天）
    const barCount = 7;
    const parsedAnchor = anchorDate ? parseLocalDayStartMs(anchorDate) : NaN;
    const baseEndDay = Number.isFinite(parsedAnchor)
      ? new Date(Math.min(todayStartMs, parsedAnchor))
      : nowD;
    const shiftedEndMs = new Date(
      baseEndDay.getFullYear(),
      baseEndDay.getMonth(),
      baseEndDay.getDate() + shift * barCount
    ).getTime();
    const clampedEndDay = new Date(Math.min(todayStartMs, shiftedEndMs));
    latestWindowEndMs = tomorrowStartMs;
    for (let i = 0; i < barCount; i++) {
      const cur = new Date(clampedEndDay.getFullYear(), clampedEndDay.getMonth(), clampedEndDay.getDate() - (barCount - 1 - i));
      const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      const fromMs = cur.getTime();
      const toMs = next.getTime();
      const dayStr = localDay(fromMs);
      bars.push({
        label: `${cur.getMonth() + 1}/${cur.getDate()}`,
        name: dayStr,
        dayStr,
        fromMs,
        toMs,
        drillable: true,
        drillTarget: "5h",
        drillAnchorMs: toMs
      });
    }
    rangeStartMs = bars[0].fromMs;
    rangeEndMs = bars[barCount - 1].toMs;
    rangeLabel = `${bars[0].dayStr} – ${formatMonthDay(bars[barCount - 1].fromMs)}`;
  } else if (period === "3d") {
    // 3日标签：每柱 3 天，展示 6 柱（18 天）
    const barCount = 6;
    const parsedAnchor = anchorDate ? parseLocalDayStartMs(anchorDate) : NaN;
    const baseEndDay = Number.isFinite(parsedAnchor)
      ? new Date(Math.min(todayStartMs, parsedAnchor))
      : nowD;
    const shiftedEndMs = new Date(
      baseEndDay.getFullYear(),
      baseEndDay.getMonth(),
      baseEndDay.getDate() + shift * barCount * 3
    ).getTime();
    const clampedEndDay = new Date(Math.min(todayStartMs, shiftedEndMs));
    latestWindowEndMs = tomorrowStartMs;
    for (let i = 0; i < barCount; i++) {
      const endD = new Date(clampedEndDay.getFullYear(), clampedEndDay.getMonth(), clampedEndDay.getDate() - (barCount - 1 - i) * 3);
      const startD = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 2);
      const nextD = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() + 1);
      const fromMs = startD.getTime();
      const toMs = nextD.getTime();
      const endDayStr = localDay(endD.getTime());
      const sameMonth = startD.getMonth() === endD.getMonth();
      bars.push({
        label: sameMonth
          ? `${startD.getDate()}-${endD.getDate()}`
          : `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getDate()}`,
        name: `${localDay(fromMs)} – ${formatMonthDay(endD.getTime())}`,
        dayStr: endDayStr,
        fromMs,
        toMs,
        drillable: true,
        drillTarget: "day",
        drillAnchorMs: 0
      });
    }
    rangeStartMs = bars[0].fromMs;
    rangeEndMs = bars[barCount - 1].toMs;
    rangeLabel = `${localDay(bars[0].fromMs)} – ${formatMonthDay(bars[barCount - 1].toMs - 1)}`;
  } else if (period === "week") {
    // 周标签：每柱 1 自然周（周一–周日），展示 6 柱（6 周）
    const barCount = 6;
    const monOffset = (nowD.getDay() + 6) % 7;
    const thisMon = new Date(nowY, nowD.getMonth(), nowD.getDate() - monOffset);
    const thisMonMs = thisMon.getTime();
    latestWindowEndMs = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + 7).getTime();
    const parsedAnchor = anchorDate ? parseLocalDayStartMs(anchorDate) : NaN;
    let endMon;
    if (Number.isFinite(parsedAnchor)) {
      const aD = new Date(parsedAnchor);
      const aMon = new Date(aD.getFullYear(), aD.getMonth(), aD.getDate() - ((aD.getDay() + 6) % 7));
      const baseMon = new Date(Math.min(thisMonMs, aMon.getTime()));
      const shiftedMon = new Date(baseMon.getFullYear(), baseMon.getMonth(), baseMon.getDate() + shift * barCount * 7);
      endMon = new Date(Math.min(thisMonMs, shiftedMon.getTime()));
    } else {
      const clampedShift = Math.min(0, shift);
      endMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + clampedShift * barCount * 7);
    }
    for (let i = 0; i < barCount; i++) {
      const wMon = new Date(endMon.getFullYear(), endMon.getMonth(), endMon.getDate() - (barCount - 1 - i) * 7);
      const wSun = new Date(wMon.getFullYear(), wMon.getMonth(), wMon.getDate() + 6);
      const wNextMon = new Date(wMon.getFullYear(), wMon.getMonth(), wMon.getDate() + 7);
      const fromMs = wMon.getTime();
      const toMs = wNextMon.getTime();
      const monStr = localDay(fromMs);
      const sunStr = localDay(wSun.getTime());
      bars.push({
        label: `${wMon.getMonth() + 1}/${wMon.getDate()}`,
        name: `${monStr} – ${formatMonthDay(wSun.getTime())}`,
        dayStr: sunStr,
        weekStartStr: monStr,
        fromMs,
        toMs,
        drillable: true,
        drillTarget: "day",
        drillAnchorMs: 0
      });
    }
    rangeStartMs = bars[0].fromMs;
    rangeEndMs = bars[barCount - 1].toMs;
    rangeLabel = `${localDay(bars[0].fromMs)} – ${formatMonthDay(bars[barCount - 1].toMs - 1)}`;
  } else {
    // 月标签：每柱 1 自然月，展示 6 柱（6 个月）
    const barCount = 6;
    const thisMo = new Date(nowY, nowD.getMonth(), 1);
    const thisMoMs = thisMo.getTime();
    latestWindowEndMs = new Date(nowY, nowD.getMonth() + 1, 1).getTime();
    const parsedAnchor = anchorDate ? parseLocalDayStartMs(anchorDate) : NaN;
    let endMo;
    if (Number.isFinite(parsedAnchor)) {
      const aD = new Date(parsedAnchor);
      const aMo = new Date(aD.getFullYear(), aD.getMonth(), 1);
      const baseMo = new Date(Math.min(thisMoMs, aMo.getTime()));
      const shiftedMo = new Date(baseMo.getFullYear(), baseMo.getMonth() + shift * barCount, 1);
      endMo = new Date(Math.min(thisMoMs, shiftedMo.getTime()));
    } else {
      const clampedShift = Math.min(0, shift);
      endMo = new Date(nowY, nowD.getMonth() + clampedShift * barCount, 1);
    }
    for (let i = 0; i < barCount; i++) {
      const cur = new Date(endMo.getFullYear(), endMo.getMonth() - (barCount - 1 - i), 1);
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const fromMs = cur.getTime();
      const toMs = new Date(y, m + 1, 1).getTime();
      const lastDayMs = Math.min(todayStartMs, new Date(y, m + 1, 0).getTime());
      bars.push({
        label: y === nowY ? `${m + 1}月` : `${String(y).slice(2)}/${pad2(m + 1)}`,
        yearNum: y,
        monthNum: m + 1,
        name: `${y}-${pad2(m + 1)}`,
        dayStr: localDay(lastDayMs),
        fromMs,
        toMs,
        drillable: true,
        drillTarget: "week",
        drillAnchorMs: 0
      });
    }
    rangeStartMs = bars[0].fromMs;
    rangeEndMs = bars[barCount - 1].toMs;
    rangeLabel = `${bars[0].name} – ${bars[barCount - 1].name}`;
  }

  return { bars, rangeStartMs, rangeEndMs, latestWindowEndMs, rangeLabel };
}

export async function queryUsageAnalytics(params = {}) {
  const activeConversationId = String(params.activeConversationId || "").trim();
  const scope = params.scope === "all" ? "all" : "conversation";
  const requestedConvId = String(params.conversationId || "").trim();
  const period = ["5h", "day", "3d", "week", "month"].includes(params.period) ? params.period : "day";
  const shiftRaw = Number(params.shift);
  const shift = Number.isFinite(shiftRaw) ? Math.trunc(shiftRaw) : 0;
  const anchorDate = typeof params.anchorDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.anchorDate)
    ? params.anchorDate
    : "";
  const anchorEndMsRaw = Number(params.anchorEndMs);
  const anchorEndMs = Number.isFinite(anchorEndMsRaw) && anchorEndMsRaw > 0 ? anchorEndMsRaw : 0;

  const scan = await ensureUsageCacheFresh(activeConversationId);
  const allRequests = scan.dedupedRequests;

  let targetConvId = "";
  if (scope === "conversation") {
    targetConvId = requestedConvId || activeConversationId;
    if (!targetConvId && allRequests.length > 0) {
      let newestAt = -Infinity;
      for (const r of allRequests) {
        if ((r.at || 0) >= newestAt && r.convId) {
          newestAt = r.at || 0;
          targetConvId = r.convId;
        }
      }
    }
  }

  const scopedRequests = scope === "conversation"
    ? (targetConvId ? allRequests.filter((r) => r.convId === targetConvId) : [])
    : allRequests;

  const nowMs = Date.now();
  const { bars: barTemplates, rangeStartMs, rangeEndMs, latestWindowEndMs, rangeLabel } = buildTimeWindowAndBars(
    period,
    shift,
    anchorDate,
    anchorEndMs,
    nowMs
  );

  // 1. 计算 KPI
  let kpis;
  if (scope === "conversation") {
    const sum = emptyUsageBucket();
    for (const r of scopedRequests) {
      sum.requests++;
      for (const k of COUNTERS) sum[k] += r[k];
    }
    const m = withUsageMetrics(sum);
    const inSum = m.uncached + m.cacheRead + m.cacheWrite;
    kpis = {
      mode: "conversation",
      conversationId: targetConvId,
      title: targetConvId ? resolveConversationTitle(targetConvId) : "",
      ...m,
      cacheHitPct: inSum > 0 ? Math.round((m.cacheRead / inSum) * 100) : 0
    };
  } else {
    const todayStr = localDay(nowMs);
    const nowD = new Date(nowMs);
    const wkOffset = (nowD.getDay() + 6) % 7;
    const wkStr = localDay(new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - wkOffset).getTime());
    const moStr = todayStr.slice(0, 7);
    const todayB = emptyUsageBucket();
    const weekB = emptyUsageBucket();
    const monthB = emptyUsageBucket();
    const allB = emptyUsageBucket();
    const bump = (dst, r) => {
      dst.requests++;
      for (const k of COUNTERS) dst[k] += r[k];
    };
    for (const r of allRequests) {
      bump(allB, r);
      if (r.at === null) continue;
      const dt = localDay(r.at);
      if (dt > todayStr) continue;
      if (dt === todayStr) bump(todayB, r);
      if (dt >= wkStr) bump(weekB, r);
      if (dt.slice(0, 7) === moStr) bump(monthB, r);
    }
    kpis = {
      mode: "all",
      today: withUsageMetrics(todayB),
      week: withUsageMetrics(weekB),
      month: withUsageMetrics(monthB),
      all: withUsageMetrics(allB)
    };
  }

  // 2. 填装柱状图及各柱模型统计
  const barStates = barTemplates.map((tpl) => ({
    ...tpl,
    bucket: emptyUsageBucket(),
    modelMap: new Map()
  }));

  let earliestAtMs = Infinity;
  let latestActiveAtMs = -Infinity;
  const heatmapMap = new Map();

  for (const r of scopedRequests) {
    if (r.at === null) continue;
    if (r.at < earliestAtMs) earliestAtMs = r.at;
    if (r.at > latestActiveAtMs) latestActiveAtMs = r.at;

    // 同步聚合作用于热力图的日期汇总
    const dt = localDay(r.at);
    let hd = heatmapMap.get(dt);
    if (!hd) {
      hd = emptyUsageBucket();
      heatmapMap.set(dt, hd);
    }
    hd.requests++;
    for (const k of COUNTERS) hd[k] += r[k];

    if (r.at < rangeStartMs || r.at >= rangeEndMs) continue;
    const bIdx = findBarIndex(barStates, r.at);
    if (bIdx < 0) continue;
    const bar = barStates[bIdx];

    bar.bucket.requests++;
    for (const k of COUNTERS) bar.bucket[k] += r[k];
    const mName = r.model || "";
    let mBucket = bar.modelMap.get(mName);
    if (!mBucket) {
      mBucket = emptyUsageBucket();
      bar.modelMap.set(mName, mBucket);
    }
    mBucket.requests++;
    for (const k of COUNTERS) mBucket[k] += r[k];
  }

  // 3. 汇总全库对话选择器选项（不受当前时间窗口翻页限制，随时可切任意历史对话）
  const allConvMap = new Map();
  for (const r of allRequests) {
    const cid = r.convId;
    if (!cid) continue;
    let entry = allConvMap.get(cid);
    if (!entry) {
      entry = { conversationId: cid, bucket: emptyUsageBucket(), lastAtMs: 0 };
      allConvMap.set(cid, entry);
    }
    entry.bucket.requests++;
    for (const k of COUNTERS) entry.bucket[k] += r[k];
    if (r.at !== null && r.at > entry.lastAtMs) entry.lastAtMs = r.at;
  }

  const conversationOptions = [...allConvMap.values()]
    .map((entry) => {
      const m = withUsageMetrics(entry.bucket);
      return {
        conversationId: entry.conversationId,
        title: resolveConversationTitle(entry.conversationId),
        isCurrentActive: Boolean(activeConversationId && entry.conversationId === activeConversationId),
        lastAtMs: entry.lastAtMs,
        latestDay: entry.lastAtMs > 0 ? localDay(entry.lastAtMs) : "",
        requests: m.requests,
        net: m.net,
        total: m.total
      };
    })
    .sort((a, b) => b.lastAtMs - a.lastAtMs || b.net - a.net);

  const bars = barStates.map((b) => ({
    label: b.label,
    yearNum: b.yearNum,
    monthNum: b.monthNum,
    weekStartStr: b.weekStartStr,
    name: b.name,
    dayStr: b.dayStr,
    fromMs: b.fromMs,
    toMs: b.toMs,
    drillable: b.drillable,
    drillTarget: b.drillTarget,
    drillAnchorMs: b.drillAnchorMs,
    ...withUsageMetrics(b.bucket),
    models: [...b.modelMap.entries()]
      .map(([name, mb]) => ({ name, ...withUsageMetrics(mb) }))
      .sort((a, x) => x.net - a.net || a.name.localeCompare(x.name))
  }));

  // 4. 轻量热力图日序列表
  const heatmapDays = [...heatmapMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, hb]) => ({ date, ...withUsageMetrics(hb) }));
  const sinceDate = heatmapDays[0]?.date || "";

  const canPrev = Number.isFinite(earliestAtMs) && earliestAtMs < rangeStartMs;
  const canNext = rangeEndMs < latestWindowEndMs;

  return {
    scope,
    conversationId: targetConvId,
    conversationTitle: targetConvId ? resolveConversationTitle(targetConvId) : "",
    activeConversationId,
    activeConversationTitle: activeConversationId ? resolveConversationTitle(activeConversationId) : "",
    period,
    shift,
    rangeStartMs,
    rangeEndMs,
    rangeLabel,
    canPrev,
    canNext,
    isLatest: !canNext,
    latestActiveAtMs: Number.isFinite(latestActiveAtMs) ? latestActiveAtMs : 0,
    latestActiveDay: Number.isFinite(latestActiveAtMs) ? localDay(latestActiveAtMs) : "",
    scopedTotalRequests: scopedRequests.length,
    kpis,
    bars,
    conversationOptions,
    heatmapDays,
    sinceDate,
    unread: scan.unread,
    scannedFiles: scan.scannedFiles
  };
}

// =====================================================================
// 6. stdio JSON-RPC 主循环
// =====================================================================

async function handleRpc(req) {
  const method = req?.method;
  const params = req?.params || {};
  switch (method) {
    case "ping":
      return { pong: true };
    case "inspectConversation":
      return inspectConversation(params.conversationId || "");
    case "getQuota":
      return getQuota(Boolean(params.force));
    case "getUsageHistory":
      return getUsageHistory(params.activeConversationId || "");
    case "queryUsageAnalytics":
      return queryUsageAnalytics(params);
    case "syncOnboardingEmail":
      return syncOnboardingEmail(params.email || "", params);
    default:
      throw new Error(`未知 RPC 方法: ${method}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line || !line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const id = req?.id ?? null;
    try {
      const data = await handleRpc(req);
      process.stdout.write(`${JSON.stringify({ id, ok: true, data })}\n`);
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ id, ok: false, error: err?.message || String(err) })}\n`);
    }
  });
  rl.on("close", () => {
    process.exit(0);
  });
}
