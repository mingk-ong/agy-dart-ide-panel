"use strict";

const POOL_STOP_WORDS = new Set([
  "gemini",
  "model",
  "models",
  "and",
  "the",
  "for",
  "pro",
  "plan",
  "plans",
  "quota",
  "limit"
]);

const MODEL_FAMILY_KEYWORDS = [
  "carbon",
  "argon",
  "neon",
  "hydrogen",
  "flash",
  "claude",
  "sonnet",
  "opus",
  "haiku",
  "gpt"
];

/**
 * 去除模型名称末尾的思考档位标识（保留 Neon / Argon / Orchestrator 等池区分标识）。
 * @param {string} modelName
 * @returns {string}
 */
function stripThinkingTier(modelName) {
  return String(modelName || "")
    .trim()
    .replace(/\s*\((?:thinking[\s,/-]+)?(?:off|minimal|low|medium|high|xhigh|extra(?:\s+high)?|max)(?:\s+thinking)?\)\s*$/i, "")
    .replace(/\s*\(thinking\)\s*$/i, "")
    .trim();
}

/**
 * 从配额池描述文本中提取 "Models within this group: ..." 所列模型名清单。
 * 注意避免将 "Gemini 3.8 Flash" 中的版本号小数点误判为句末分隔符。
 * @param {string} description
 * @returns {{ list: string[], text: string }}
 */
function extractModelsInGroup(description) {
  const match = String(description || "").match(/models within this group:\s*([^\n]+?)(?:\.(?:\s|$)|$)/im);
  if (!match) {
    return { list: [], text: "" };
  }
  const list = match[1]
    .split(/\s*,\s*/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    list,
    text: list.join(", ")
  };
}

/**
 * 将完整的配额池标题格式化为适合底栏微胶囊展示的简短池名称。
 * @param {object|string} groupOrName
 * @returns {string}
 */
function formatQuotaPoolShortName(groupOrName) {
  const raw = String(
    typeof groupOrName === "string" ? groupOrName : groupOrName?.displayName || ""
  ).trim();
  if (!raw) return "配额";

  const low = raw.toLowerCase();
  if (low === "gemini models" || low === "gemini") {
    return "Gemini";
  }

  const hasClaude = low.includes("claude");
  const hasGpt = low.includes("gpt");
  if (hasClaude && hasGpt) return "Claude/GPT";
  if (hasClaude) return "Claude";
  if (hasGpt) return "GPT";

  const tierSubMatch = raw.match(/^gemini\s+\d+(?:\.\d+)?\s+([a-z0-9][a-z0-9_-]*)$/i);
  if (tierSubMatch && tierSubMatch[1]) {
    return tierSubMatch[1];
  }

  const cleaned = raw.replace(/\s+(?:models?|quota|limit)s?$/i, "").trim() || raw;
  if (cleaned.length <= 12) {
    return cleaned;
  }

  const slice = cleaned.slice(0, 12);
  if (cleaned[12] !== " ") {
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace > 0) {
      return slice.slice(0, lastSpace).trim() || slice.trim();
    }
  }
  return slice.trim();
}

function normalizeTokenText(val) {
  return String(val || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * 根据活跃模型（为空时回退至默认模型）从配额池列表中智能匹配归属池。
 * 兼容 Pro（Argon 独立池）与 Ultra（Argon 并入 Gemini Models）两类账号结构。
 * @param {Array<object>} groups
 * @param {string} [activeModel]
 * @param {string} [fallbackModel]
 * @returns {object|null}
 */
function matchQuotaGroup(groups, activeModel = "", fallbackModel = "") {
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }

  const modelText = String(activeModel || fallbackModel || "").trim();
  const mt = modelText.toLowerCase();
  const baseMt = stripThinkingTier(modelText).toLowerCase();
  const mtNorm = normalizeTokenText(modelText);
  const baseMtNorm = normalizeTokenText(baseMt);

  const meta = groups.map((group) => {
    const rawName = String(group?.displayName || "").trim().toLowerCase();
    const isGenericGemini = rawName === "gemini models" || rawName === "gemini";
    const { list: modelsList, text: modelsText } = extractModelsInGroup(group?.description || "");
    const bucketIds = (Array.isArray(group?.buckets) ? group.buckets : [])
      .map((b) => String(b?.bucketId || "").toLowerCase())
      .join(" ");
    return {
      group,
      rawName,
      isGenericGemini,
      modelsList,
      modelsText,
      bucketIds
    };
  });

  if (mt) {
    // 1. 精确命中 "Models within this group" 条目（多个命中时取最长条目所属池）
    let bestEntryGroup = null;
    let bestEntryLen = -1;
    for (const item of meta) {
      for (const entry of item.modelsList) {
        if (entry.length < 3) continue;
        const entryNorm = normalizeTokenText(entry);
        const hit =
          mt === entry ||
          baseMt === entry ||
          mt.includes(entry) ||
          (entryNorm.length >= 3 && (mtNorm === entryNorm || baseMtNorm === entryNorm || mtNorm.includes(entryNorm)));
        if (hit && entry.length > bestEntryLen) {
          bestEntryLen = entry.length;
          bestEntryGroup = item.group;
        }
      }
    }
    if (bestEntryGroup) return bestEntryGroup;

    // 2. 匹配专有/非通用池标题（跳过通用 Gemini Models）
    const isThirdPartyModel = /claude|sonnet|opus|haiku|gpt|openai/.test(mt);
    for (const item of meta) {
      if (item.isGenericGemini) continue;
      if (
        (item.rawName.includes("claude") || item.rawName.includes("gpt") || item.bucketIds.includes("3p")) &&
        isThirdPartyModel
      ) {
        return item.group;
      }
      const titleTokens = item.rawName
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !POOL_STOP_WORDS.has(t));
      if (titleTokens.some((t) => mt.includes(t) || mtNorm.includes(t))) {
        return item.group;
      }
    }

    // 3. 按模型家族关键词匹配 description 文本（兼容 Ultra 等聚合描述）
    const activeKeys = MODEL_FAMILY_KEYWORDS.filter((k) => mt.includes(k));
    if (activeKeys.length > 0) {
      const descMatched = meta.find((item) =>
        activeKeys.some((k) => item.modelsText && item.modelsText.includes(k))
      );
      if (descMatched) return descMatched.group;
    }

    // 4a. 按模型家族特征匹配
    if (isThirdPartyModel) {
      const thirdPartyPool = meta.find(
        (item) => item.rawName.includes("claude") || item.rawName.includes("gpt") || item.bucketIds.includes("3p")
      );
      if (thirdPartyPool) return thirdPartyPool.group;
    }
    if (/gemini|neon|hydrogen|flash/.test(mt)) {
      const geminiPool = meta.find(
        (item) =>
          item.isGenericGemini ||
          (item.rawName.includes("gemini") && !item.rawName.includes("argon") && !item.rawName.includes("carbon"))
      );
      if (geminiPool) return geminiPool.group;
    }
  }

  // 4b. 最终兜底：优先通用 Gemini 池，其次首个配额池
  return meta.find((item) => item.isGenericGemini)?.group || groups[0];
}

module.exports = {
  stripThinkingTier,
  extractModelsInGroup,
  formatQuotaPoolShortName,
  matchQuotaGroup
};
