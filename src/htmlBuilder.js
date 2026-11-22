"use strict";

const {
  getCapsuleCss,
  getMainTabsHtml,
  getCapsulePaneHtml,
  getCapsuleClientScript
} = require("./capsuleUi");

/**
 * 判断字符是否为标识符组成部分（含数字、字母、下划线、美元符、点、短横线）。
 * @param {string} ch
 * @returns {boolean}
 */
function isMemberOrIdentChar(ch) {
  return Boolean(ch && /[A-Za-z0-9_$.-]/.test(ch));
}

const REGEX_PREV_KEYWORDS = new Set([
  "return",
  "case",
  "throw",
  "typeof",
  "void",
  "delete",
  "in",
  "instanceof",
  "new",
  "await",
  "yield",
  "else",
  "do"
]);

function canStartRegex(lastToken) {
  if (!lastToken) return true;
  if (REGEX_PREV_KEYWORDS.has(lastToken)) return true;
  return /^[=(\[,:;!&|?{}\n~^+\-*/%<>]$/.test(lastToken);
}

function scanRegexLiteralEnd(code, startIdx) {
  const len = code.length;
  let p = startIdx + 1;
  let inClass = false;
  while (p < len) {
    const c = code[p];
    if (c === "\\") {
      p += 2;
      continue;
    }
    if (c === "[") {
      inClass = true;
      p++;
      continue;
    }
    if (c === "]") {
      inClass = false;
      p++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      break;
    }
    if (c === "/" && !inClass) {
      p++;
      while (p < len && /[a-z]/i.test(code[p])) p++;
      return p;
    }
    p++;
  }
  return p;
}

function scanQuotedEnd(code, startIdx) {
  const len = code.length;
  const quote = code[startIdx];
  let p = startIdx + 1;
  while (p < len) {
    if (code[p] === "\\") {
      p += 2;
      continue;
    }
    if (code[p] === quote) {
      return p + 1;
    }
    p++;
  }
  return len;
}

function scanTemplateEnd(code, startIdx) {
  const len = code.length;
  let p = startIdx + 1;
  while (p < len) {
    const c = code[p];
    if (c === "\\") {
      p += 2;
      continue;
    }
    if (c === "$" && code[p + 1] === "{") {
      p += 2;
      let depth = 1;
      let lastTok = "(";
      while (p < len && depth > 0) {
        const ic = code[p];
        if (ic === "'" || ic === '"') {
          p = scanQuotedEnd(code, p);
          lastTok = "str";
          continue;
        }
        if (ic === "`") {
          p = scanTemplateEnd(code, p);
          lastTok = "str";
          continue;
        }
        if (ic === "/" && code[p + 1] === "/") {
          p += 2;
          while (p < len && code[p] !== "\n") p++;
          continue;
        }
        if (ic === "/" && code[p + 1] === "*") {
          p += 2;
          while (p < len && !(code[p] === "*" && code[p + 1] === "/")) p++;
          p += 2;
          continue;
        }
        if (ic === "/" && canStartRegex(lastTok)) {
          p = scanRegexLiteralEnd(code, p);
          lastTok = "regex";
          continue;
        }
        if (ic === "{") {
          depth++;
          lastTok = "{";
        } else if (ic === "}") {
          depth--;
          lastTok = "}";
        } else if (!/\s/.test(ic)) {
          lastTok = ic;
        }
        p++;
      }
      continue;
    }
    if (c === "`") {
      return p + 1;
    }
    p++;
  }
  return len;
}

/**
 * 词法安全地将脚本块内同步 confirm(...) 与 alert(...) 重写为异步 IDE 桥接调用。
 * @param {string} code
 * @returns {string}
 */
function rewriteSyncDialogsInScript(code) {
  let out = "";
  let i = 0;
  const len = code.length;
  let lastToken = "";

  const findClosingParen = (openIdx) => {
    let depth = 1;
    let p = openIdx + 1;
    let innerLastTok = "(";
    while (p < len && depth > 0) {
      const c = code[p];
      if (c === "'" || c === '"') {
        p = scanQuotedEnd(code, p);
        innerLastTok = "str";
        continue;
      }
      if (c === "`") {
        p = scanTemplateEnd(code, p);
        innerLastTok = "str";
        continue;
      }
      if (c === "/" && code[p + 1] === "/") {
        p += 2;
        while (p < len && code[p] !== "\n") p++;
        continue;
      }
      if (c === "/" && code[p + 1] === "*") {
        p += 2;
        while (p < len && !(code[p] === "*" && code[p + 1] === "/")) p++;
        p += 2;
        continue;
      }
      if (c === "/" && canStartRegex(innerLastTok)) {
        p = scanRegexLiteralEnd(code, p);
        innerLastTok = "regex";
        continue;
      }
      if (c === "(") {
        depth++;
        innerLastTok = "(";
      } else if (c === ")") {
        depth--;
        innerLastTok = ")";
        if (depth === 0) return p;
      } else if (!/\s/.test(c)) {
        innerLastTok = c;
      }
      p++;
    }
    return -1;
  };

  while (i < len) {
    const ch = code[i];

    if (ch === "'" || ch === '"') {
      const end = scanQuotedEnd(code, i);
      out += code.slice(i, end);
      i = end;
      lastToken = "str";
      continue;
    }

    if (ch === "`") {
      const end = scanTemplateEnd(code, i);
      out += code.slice(i, end);
      i = end;
      lastToken = "str";
      continue;
    }

    if (ch === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < len && code[i] !== "\n") i++;
      out += code.slice(start, i);
      continue;
    }

    if (ch === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      out += code.slice(start, i);
      continue;
    }

    if (ch === "/" && canStartRegex(lastToken)) {
      const end = scanRegexLiteralEnd(code, i);
      out += code.slice(i, end);
      i = end;
      lastToken = "regex";
      continue;
    }

    if (code.startsWith("confirm", i)) {
      const prev = i > 0 ? code[i - 1] : "";
      let after = i + 7;
      while (after < len && /\s/.test(code[after])) after++;
      if (!isMemberOrIdentChar(prev) && code[after] === "(") {
        const closeIdx = findClosingParen(after);
        if (closeIdx !== -1) {
          const inner = rewriteSyncDialogsInScript(code.slice(after + 1, closeIdx));
          out += `(await window.__agyIdeBridge.confirm(${inner}))`;
          i = closeIdx + 1;
          lastToken = ")";
          continue;
        }
      }
    }

    if (code.startsWith("alert", i)) {
      const prev = i > 0 ? code[i - 1] : "";
      let after = i + 5;
      while (after < len && /\s/.test(code[after])) after++;
      if (!isMemberOrIdentChar(prev) && code[after] === "(") {
        out += "window.__agyIdeBridge.alert(";
        i = after + 1;
        lastToken = "(";
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const idStart = i;
      i++;
      while (i < len && /[A-Za-z0-9_$]/.test(code[i])) i++;
      const word = code.slice(idStart, i);
      out += word;
      lastToken = word;
      continue;
    }

    if (ch === "\n") {
      lastToken = "\n";
    } else if (!/\s/.test(ch)) {
      lastToken = ch;
    }

    out += ch;
    i++;
  }

  return out;
}

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 构建注入到样式表末尾的 IDE 深浅色主题、窄屏自适应与顶部工具栏 CSS。
 */
function getIdeOverlayCss() {
  return `
    /* === Antigravity IDE Webview 主题与响应式适配 === */
    html, body {
      overflow-x: hidden;
    }

    body.vscode-light {
      --bg-canvas: var(--vscode-sideBar-background, #f7f8fa);
      --bg-panel: var(--vscode-editor-background, #ffffff);
      --bg-subtle: var(--vscode-input-background, #f1f3f6);
      --bg-hover: var(--vscode-list-hoverBackground, #e8ecf2);
      --bg-inset: var(--vscode-editorWidget-background, #f8f9fb);
      --border: var(--vscode-panel-border, #e3e8ee);
      --border-strong: var(--vscode-input-border, #cbd2dc);
      --text-primary: var(--vscode-foreground, #111827);
      --text-secondary: var(--vscode-descriptionForeground, #4b5563);
      --accent: #4a6e96;
      --accent-hover: #3d5d82;
      --accent-border: rgba(74, 110, 150, 0.28);
      --accent-soft: rgba(74, 110, 150, 0.08);
      --accent-text: #3c5b7d;
      --ok: #4d7c5f;
      --ok-text: #3e664d;
      --ok-soft: rgba(77, 124, 95, 0.08);
      --ok-border: rgba(77, 124, 95, 0.24);
      --warn: #9a7438;
      --warn-text: #7d5d2b;
      --warn-soft: rgba(154, 116, 56, 0.09);
      --warn-border: rgba(154, 116, 56, 0.24);
      --danger: #a35252;
      --danger-text: #864040;
      --danger-soft: rgba(163, 82, 82, 0.08);
      --danger-border: rgba(163, 82, 82, 0.24);
    }

    body[data-ide-mode="editor"].vscode-light {
      --bg-canvas: var(--vscode-editor-background, #f7f8fa);
    }

    body.vscode-dark,
    body.vscode-high-contrast {
      --bg-canvas: var(--vscode-sideBar-background, #18181b);
      --bg-panel: var(--vscode-editor-background, #1e1f24);
      --bg-subtle: var(--vscode-input-background, #272932);
      --bg-hover: var(--vscode-list-hoverBackground, #2f323d);
      --bg-inset: var(--vscode-editorWidget-background, #23252d);
      --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.12));
      --border-strong: var(--vscode-input-border, rgba(255, 255, 255, 0.22));
      --border-subtle: rgba(255, 255, 255, 0.08);
      --text-primary: var(--vscode-foreground, #e5e7eb);
      --text-secondary: var(--vscode-descriptionForeground, #a1a1aa);
      --text-muted: var(--vscode-disabledForeground, #8b8f9c);
      --accent: #5b7fa6;
      --accent-hover: #4e6f94;
      --accent-border: rgba(125, 162, 204, 0.26);
      --accent-soft: rgba(125, 162, 204, 0.08);
      --accent-text: #a5bdd8;
      --ok: #5e9672;
      --ok-text: #8bb89b;
      --ok-soft: rgba(94, 150, 114, 0.09);
      --ok-border: rgba(94, 150, 114, 0.22);
      --warn: #b58d4d;
      --warn-text: #cfaf78;
      --warn-soft: rgba(181, 141, 77, 0.09);
      --warn-border: rgba(181, 141, 77, 0.22);
      --danger: #b56565;
      --danger-text: #cf8a8a;
      --danger-soft: rgba(181, 101, 101, 0.09);
      --danger-border: rgba(181, 101, 101, 0.22);
    }

    body[data-ide-mode="editor"].vscode-dark,
    body[data-ide-mode="editor"].vscode-high-contrast {
      --bg-canvas: var(--vscode-editor-background, #18181b);
    }

    body.vscode-dark ::selection,
    body.vscode-high-contrast ::selection {
      background: rgba(125, 162, 204, 0.22);
      color: #ffffff;
    }

    body.vscode-dark .custom-scrollbar::-webkit-scrollbar-thumb,
    body.vscode-high-contrast .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
    }

    body.vscode-dark .custom-scrollbar::-webkit-scrollbar-thumb:hover,
    body.vscode-high-contrast .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.34);
    }

    body.vscode-dark .seg-btn.is-active,
    body.vscode-high-contrast .seg-btn.is-active {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), inset 0 0 0 1px var(--border-strong);
    }

    body.vscode-dark .btn-secondary:hover,
    body.vscode-high-contrast .btn-secondary:hover {
      border-color: rgba(255, 255, 255, 0.35);
    }

    body.vscode-dark .btn-secondary.is-warn:hover,
    body.vscode-high-contrast .btn-secondary.is-warn:hover {
      background: rgba(181, 141, 77, 0.14);
    }

    body.vscode-dark .cue-tag,
    body.vscode-high-contrast .cue-tag {
      background: rgba(181, 141, 77, 0.18);
    }

    body.vscode-dark select option,
    body.vscode-high-contrast select option {
      background: var(--bg-panel);
      color: var(--text-primary);
    }

    /* IDE 全局工具条（双页签共享） */
    .ide-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px 8px;
      flex-wrap: wrap;
    }

    .ide-conv-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 200px;
      min-width: 0;
    }

    .ide-conv-label {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .ide-conv-select {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      background: var(--bg-subtle);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 3px 6px;
      font-size: 11px;
      cursor: pointer;
      text-overflow: ellipsis;
    }

    .ide-conv-select:hover {
      border-color: var(--border-strong);
    }

    .ide-global-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex: 0 1 auto;
      flex-wrap: nowrap;
    }

    body[data-ide-mode="sidebar"] .ide-global-actions {
      flex: 1 1 100%;
    }

    .ide-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    /* 仅属于「护栏与缓存诊断」页签的专属顶栏区 */
    .ide-dart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
      flex-wrap: wrap;
    }

    .ide-chip-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 7px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 500;
      line-height: 1.25;
      white-space: nowrap;
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
    }

    .ide-chip-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
      color: var(--text-primary);
    }

    body[data-ide-mode="sidebar"] .shell {
      max-width: 100%;
      border-left: none;
      border-right: none;
    }

    body[data-ide-mode="editor"] .shell {
      max-width: 900px;
    }

    @media (max-width: 480px) {
      .topbar {
        padding: 10px 12px 10px;
        gap: 8px;
      }

      .band {
        padding: 12px 12px;
        gap: 9px;
      }

      details.accordion-band > summary.accordion-summary {
        padding: 11px 12px;
      }

      .accordion-body {
        padding: 2px 12px 12px;
      }

      .kpi-cell {
        padding: 8px 10px;
      }

      .kpi-value {
        font-size: 14px;
      }

      .seg-btn {
        padding: 4px 7px;
        font-size: 11px;
      }

      .cutoff-control {
        width: 100%;
        justify-content: space-between;
      }
    }
    ${getCapsuleCss()}
  `;
}

function getGlobalToolbarHtml(mode, headerActionsHtml = "") {
  const openEditorBtn = mode === "sidebar"
    ? `<button id="ide-open-editor-btn" type="button" onclick="window.__agyIdeBridge.runCommand('openEditorTab')" class="ide-chip-btn" data-ide-i18n="openEditor" data-ide-i18n-title="openEditorTip" title="在编辑器全宽标签页打开">全宽标签</button>`
    : "";
  return `
      <div class="ide-toolbar">
        <div class="ide-conv-wrap">
          <span class="ide-conv-label" data-ide-i18n="convLabel">对话：</span>
          <select id="ide-conv-select" class="ide-conv-select" onchange="window.__agyIdeBridge.selectConversation(this.value)" data-ide-i18n-title="convTip" title="选择要追踪的 Antigravity 对话">
            <option value="auto">自动追踪最新</option>
          </select>
        </div>
        <div class="ide-global-actions">
          <div class="ide-actions">${openEditorBtn}</div>
          ${headerActionsHtml}
        </div>
      </div>`;
}

function getDartActionsHtml() {
  return `<div class="ide-actions">
          <button type="button" onclick="window.__agyIdeBridge.runCommand('switchMode')" class="ide-chip-btn" data-ide-i18n="modeBtn" data-ide-i18n-title="modeTip" title="切换 agy-dart 保护模式">模式</button>
          <button type="button" onclick="window.__agyIdeBridge.runCommand('runDoctor')" class="ide-chip-btn" data-ide-i18n="doctorBtn" data-ide-i18n-title="doctorTip" title="运行 agy-dart 健康体检">体检</button>
          <button type="button" onclick="window.__agyIdeBridge.runCommand('openConfig')" class="ide-chip-btn" data-ide-i18n="configBtn" data-ide-i18n-title="configTip" title="打开 ~/.agy-dart/config.json">配置</button>
        </div>`;
}

function getDartHeaderRowHtml(brandGroupHtml = "") {
  return `
      <div class="ide-dart-header dart-only-section">
        ${brandGroupHtml}
        ${getDartActionsHtml()}
      </div>`;
}

function extractDivBlock(source, openRegex) {
  const m = openRegex.exec(source);
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let tagMatch;
  while ((tagMatch = tagRe.exec(source)) !== null) {
    if (tagMatch[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return { start, end: tagRe.lastIndex, html: source.slice(start, tagRe.lastIndex) };
      }
    } else {
      depth++;
    }
  }
  return null;
}

function getPreBridgeScript(initialState) {
  const safeInitJson = JSON.stringify(initialState)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script>
  (function() {
    const vscode = acquireVsCodeApi();
    const init = ${safeInitJson};
    const pendingRequests = new Map();
    let reqSeq = 0;

    window.__AGY_IDE_INIT__ = init;
    window.__AGY_IDE_STATE__ = {
      selectionMode: init.selectionMode || 'auto',
      resolvedConversationId: init.resolvedConversationId || '',
      conversations: Array.isArray(init.conversations) ? init.conversations : [],
      lang: init.lang === 'en' ? 'en' : 'zh',
      activeTab: init.activeTab === 'dart' ? 'dart' : 'capsule'
    };

    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem('agy-dart-ui-lang', window.__AGY_IDE_STATE__.lang);
      }
    } catch {}

    function postCall(type, payload) {
      const id = 'req-' + (++reqSeq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error('IDE 通信超时'));
        }, 30000);
        pendingRequests.set(id, { resolve, reject, timer });
        vscode.postMessage({ type, id, ...(payload || {}) });
      });
    }

    const IDE_I18N = {
      zh: {
        convLabel: '对话：',
        convTip: '选择要追踪的 Antigravity 对话上下文与遥测',
        autoOption: '自动追踪最新',
        openEditor: '全宽标签',
        openEditorTip: '在编辑器独立全宽标签页中打开面板',
        modeBtn: '模式',
        modeTip: '一键切换保护模式（host-45k / balanced-16k / no-read-hook 等）',
        doctorBtn: '体检',
        doctorTip: '运行 agy-dart 完整健康检查 (doctor)',
        configBtn: '配置',
        configTip: '打开 ~/.agy-dart/config.json'
      },
      en: {
        convLabel: 'Chat:',
        convTip: 'Select Antigravity conversation for telemetry & guard',
        autoOption: 'Auto (Latest)',
        openEditor: 'Full Tab',
        openEditorTip: 'Open dashboard in a full-width editor tab',
        modeBtn: 'Mode',
        modeTip: 'Switch protection mode (host-45k / balanced-16k / no-read-hook)',
        doctorBtn: 'Doctor',
        doctorTip: 'Run agy-dart health check (doctor)',
        configBtn: 'Config',
        configTip: 'Open ~/.agy-dart/config.json'
      }
    };

    function applyIdeToolbarTexts(lang) {
      const dict = IDE_I18N[lang === 'en' ? 'en' : 'zh'];
      document.querySelectorAll('[data-ide-i18n]').forEach((el) => {
        const key = el.getAttribute('data-ide-i18n');
        if (key && dict[key]) el.textContent = dict[key];
      });
      document.querySelectorAll('[data-ide-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-ide-i18n-title');
        if (key && dict[key]) el.title = dict[key];
      });
    }

    function escapeSimple(val) {
      return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderConversationOptions() {
      const sel = document.getElementById('ide-conv-select');
      if (!sel) return;
      const st = window.__AGY_IDE_STATE__;
      const dict = IDE_I18N[st.lang === 'en' ? 'en' : 'zh'];
      const latestItem = st.conversations[0];
      const latestHint = latestItem ? ' · ' + latestItem.title : '';

      const optionsHtml = [];
      optionsHtml.push('<option value="auto">' + escapeSimple(dict.autoOption + latestHint) + '</option>');
      for (const item of st.conversations) {
        const timePart = item.updatedLabel ? ' (' + item.updatedLabel + ')' : '';
        optionsHtml.push(
          '<option value="' + escapeSimple(item.id) + '">' +
          escapeSimple(item.title + timePart + ' [' + item.id.slice(0, 8) + ']') +
          '</option>'
        );
      }
      sel.innerHTML = optionsHtml.join('');
      const targetVal = st.selectionMode === 'auto' ? 'auto' : st.resolvedConversationId;
      sel.value = targetVal;
      if (sel.value !== targetVal) {
        sel.value = 'auto';
      }
    }

    function applyMainTab(tab, notifyHost, shouldRefresh = false) {
      const target = tab === 'dart' ? 'dart' : 'capsule';
      window.__AGY_IDE_STATE__.activeTab = target;
      if (document.body) {
        document.body.dataset.activeTab = target;
      }
      const capBtn = document.getElementById('ide-tab-btn-capsule');
      const dartBtn = document.getElementById('ide-tab-btn-dart');
      if (capBtn) {
        capBtn.className = target === 'capsule' ? 'ide-main-tab is-active' : 'ide-main-tab';
        capBtn.setAttribute('aria-selected', String(target === 'capsule'));
      }
      if (dartBtn) {
        dartBtn.className = target === 'dart' ? 'ide-main-tab is-active' : 'ide-main-tab';
        dartBtn.setAttribute('aria-selected', String(target === 'dart'));
      }
      if (notifyHost) {
        vscode.postMessage({ type: 'setActiveTab', tab: target });
      }
      if (shouldRefresh) {
        if (target === 'capsule') {
          if (window.__agyCapsuleUi) void window.__agyCapsuleUi.refreshAll(false);
        } else if (typeof window.refreshData === 'function') {
          window.refreshData(false);
        }
      }
    }

    window.__agyIdeBridge = {
      async fetch(apiPath, options = {}) {
        const method = String(options.method || 'POST').toUpperCase();
        let body = options.body;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body || '{}');
          } catch {
            body = {};
          }
        }
        const res = await postCall('apiRequest', {
          path: apiPath,
          method,
          body: body ?? {}
        });
        return {
          ok: Boolean(res.ok),
          status: Number(res.status || 500),
          async json() {
            return res.data;
          },
          async text() {
            return typeof res.text === 'string' ? res.text : JSON.stringify(res.data ?? {});
          }
        };
      },
      capsuleCall(type, payload) {
        return postCall(type, {
          conversationId: window.__AGY_IDE_STATE__.resolvedConversationId || '',
          ...(payload || {})
        });
      },
      saveCapsulePrefs(prefs) {
        vscode.postMessage({ type: 'saveCapsulePrefs', prefs });
      },
      saveCapsuleUiState(patch) {
        vscode.postMessage({ type: 'setCapsuleUiState', state: patch || {} });
      },
      switchMainTab(tab) {
        applyMainTab(tab, true, true);
      },
      async confirm(message) {
        try {
          const res = await postCall('confirm', { message: String(message || '') });
          return Boolean(res && res.confirmed);
        } catch {
          return false;
        }
      },
      alert(message) {
        vscode.postMessage({ type: 'alert', message: String(message || '') });
      },
      async copyText(text) {
        try {
          const res = await postCall('copyText', { text: String(text || '') });
          return Boolean(res && res.copied);
        } catch {
          return false;
        }
      },
      runCommand(command) {
        vscode.postMessage({ type: 'runCommand', command: String(command || '') });
      },
      selectConversation(value) {
        vscode.postMessage({ type: 'selectConversation', value: String(value || 'auto') });
      },
      notifyLang(lang) {
        const normalized = lang === 'en' ? 'en' : 'zh';
        window.__AGY_IDE_STATE__.lang = normalized;
        applyIdeToolbarTexts(normalized);
        renderConversationOptions();
        if (window.__agyCapsuleUi) window.__agyCapsuleUi.applyTranslations();
        vscode.postMessage({ type: 'setLanguage', lang: normalized });
      },
      syncToolbar(lang) {
        const normalized = lang === 'en' ? 'en' : 'zh';
        window.__AGY_IDE_STATE__.lang = normalized;
        applyIdeToolbarTexts(normalized);
        renderConversationOptions();
        if (window.__agyCapsuleUi) window.__agyCapsuleUi.applyTranslations();
      }
    };

    window.sidecar = {
      get conversationId() {
        return window.__AGY_IDE_STATE__.resolvedConversationId || '';
      },
      fetch(url, options) {
        return window.__agyIdeBridge.fetch(url, options);
      }
    };

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (
        msg.type === 'apiResponse' ||
        msg.type === 'confirmResult' ||
        msg.type === 'copyTextResult' ||
        msg.type === 'capsuleResult'
      ) {
        const pending = pendingRequests.get(msg.id);
        if (!pending) return;
        pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error && (msg.type === 'apiResponse' || msg.type === 'capsuleResult')) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg);
        }
        return;
      }

      if (msg.type === 'stateSync') {
        const st = window.__AGY_IDE_STATE__;
        const prevConv = st.resolvedConversationId;
        if (typeof msg.selectionMode === 'string') st.selectionMode = msg.selectionMode;
        if (typeof msg.resolvedConversationId === 'string') st.resolvedConversationId = msg.resolvedConversationId;
        if (Array.isArray(msg.conversations)) st.conversations = msg.conversations;
        renderConversationOptions();
        if (msg.forceRefresh || prevConv !== st.resolvedConversationId) {
          if (typeof window.refreshData === 'function') {
            window.refreshData(Boolean(msg.forceRefresh));
          }
          if (window.__agyCapsuleUi) {
            window.__agyCapsuleUi.onConversationChanged();
          }
        }
        return;
      }

      if (msg.type === 'setActiveTab' && (msg.tab === 'capsule' || msg.tab === 'dart')) {
        applyMainTab(msg.tab, false, true);
        return;
      }

      if (msg.type === 'capsuleUiState' && msg.state && typeof msg.state === 'object') {
        if (window.__agyCapsuleUi && typeof window.__agyCapsuleUi.applyUiState === 'function') {
          window.__agyCapsuleUi.applyUiState(msg.state);
        }
        return;
      }

      if (msg.type === 'setLanguage' && (msg.lang === 'zh' || msg.lang === 'en')) {
        if (typeof window.setLanguage === 'function') {
          window.setLanguage(msg.lang, true);
        } else {
          window.__agyIdeBridge.syncToolbar(msg.lang);
        }
        return;
      }

      if (msg.type === 'refresh') {
        if (typeof window.refreshData === 'function') {
          window.refreshData(true);
        }
        if (window.__agyCapsuleUi) {
          void window.__agyCapsuleUi.refreshAll(true);
        }
      }
    });

    document.addEventListener('DOMContentLoaded', () => {
      applyMainTab(window.__AGY_IDE_STATE__.activeTab, false, false);
      window.__agyIdeBridge.syncToolbar(window.__AGY_IDE_STATE__.lang);
      vscode.postMessage({ type: 'webviewReady' });
    });
  })();
  </script>`;
}

function getPostBridgeScript() {
  return `<script>
  (function() {
    const init = window.__AGY_IDE_INIT__ || {};

    if (typeof window.setLanguage === 'function') {
      const origSetLanguage = window.setLanguage;
      window.setLanguage = function(lang, fromHost) {
        origSetLanguage(lang);
        if (fromHost) {
          window.__agyIdeBridge.syncToolbar(lang);
        } else {
          window.__agyIdeBridge.notifyLang(lang);
        }
      };
      const targetLang = init.lang === 'en' ? 'en' : 'zh';
      window.setLanguage(targetLang, true);
    } else {
      window.__agyIdeBridge.syncToolbar(init.lang);
    }

    if (typeof window.setScope === 'function' && init.defaultScope && init.defaultScope !== 'conversation') {
      window.setScope(init.defaultScope);
    }

    if (typeof window.refreshData === 'function') {
      const origRefreshData = window.refreshData;
      window.refreshData = function(manual) {
        const p = origRefreshData(manual);
        if (manual && window.__agyCapsuleUi) {
          void window.__agyCapsuleUi.refreshAll(true);
        }
        return p;
      };
    }

    if (typeof window.updateActiveBadge === 'function') {
      const origUpdateActiveBadge = window.updateActiveBadge;
      window.updateActiveBadge = function(isPaused) {
        origUpdateActiveBadge(isPaused);
        const dartDot = document.getElementById('ide-tab-dot-dart');
        if (dartDot) {
          dartDot.className = isPaused ? 'tab-dot is-warn' : 'tab-dot';
        }
      };
      if (typeof isProtectionPaused !== 'undefined') {
        const dartDot = document.getElementById('ide-tab-dot-dart');
        if (dartDot) dartDot.className = isProtectionPaused ? 'tab-dot is-warn' : 'tab-dot';
      }
    }

    if (typeof window.copyHandoffBrief === 'function') {
      window.copyHandoffBrief = async function() {
        const btn = document.getElementById('kv-handoff-copy-btn');
        const text = (typeof lastHandoffMarkdown === 'string' && lastHandoffMarkdown) ? lastHandoffMarkdown : '';
        if (!text) return;
        const copied = await window.__agyIdeBridge.copyText(text);
        if (btn && typeof t === 'function') {
          btn.textContent = copied ? t('copiedBtn') : t('copyFailedBtn');
          if (typeof handoffCopyResetTimer !== 'undefined' && handoffCopyResetTimer !== null) {
            clearTimeout(handoffCopyResetTimer);
          }
          handoffCopyResetTimer = setTimeout(() => {
            btn.textContent = t('copyBriefBtn');
            handoffCopyResetTimer = null;
          }, 2000);
        }
      };
    }
  })();
  </script>`;
}

/**
 * 构建仅在 agy-dart 未安装时的降级双页签外壳（Tab 1 Capsule 仍可完全正常工作，Tab 2 提示未安装）。
 */
function buildFallbackFusionShell({ mode, initialState, dartUnavailableReason }) {
  const activeTab = initialState.activeTab === "dart" ? "dart" : "capsule";
  const reason = escapeHtml(dartUnavailableReason || "未检测到已安装的 agy-dart 插件。");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">
  <title>agy-dart 融合控制台</title>
  <style>
    :root {
      --bg-canvas: #f7f8fa; --bg-panel: #ffffff; --bg-subtle: #f1f3f6; --bg-hover: #e8ecf2; --bg-inset: #f8f9fb;
      --border: #e3e8ee; --border-strong: #cbd2dc; --border-subtle: #eef1f5;
      --text-primary: #111827; --text-secondary: #4b5563; --text-muted: #5b6472;
      --accent: #4a6e96; --accent-hover: #3d5d82; --accent-border: rgba(74, 110, 150, 0.28); --accent-soft: rgba(74, 110, 150, 0.08); --accent-text: #3c5b7d;
      --ok: #4d7c5f; --ok-text: #3e664d; --ok-soft: rgba(77, 124, 95, 0.08); --ok-border: rgba(77, 124, 95, 0.24);
      --warn: #9a7438; --warn-text: #7d5d2b; --warn-soft: rgba(154, 116, 56, 0.09); --warn-border: rgba(154, 116, 56, 0.24);
      --danger: #a35252; --danger-text: #864040; --danger-soft: rgba(163, 82, 82, 0.08); --danger-border: rgba(163, 82, 82, 0.24);
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
      --radius-sm: 4px; --radius-md: 6px;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg-canvas); color: var(--text-primary); font-family: var(--font-sans); font-size: 13px; line-height: 1.5; }
    button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
    .hidden { display: none !important; }
    .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shell { max-width: 820px; margin: 0 auto; background: var(--bg-panel); border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; display: flex; flex-direction: column; }
    .topbar { position: sticky; top: 0; z-index: 20; background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .topbar-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .app-title { margin: 0; font-size: 14px; font-weight: 600; }
    .band { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
    .band-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .band-title-group { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .band-title { font-size: 13px; font-weight: 600; }
    .band-sub, .muted-note { font-size: 12px; color: var(--text-muted); }
    .band-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .segmented { display: inline-flex; align-items: center; background: var(--bg-inset); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 3px; gap: 3px; }
    .seg-btn { padding: 4px 8px; border-radius: 4px; font-size: 12px; color: var(--text-secondary); }
    .seg-btn.is-active { background: var(--bg-panel); color: var(--text-primary); }
    .btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; border: 1px solid var(--border); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-ghost:hover { background: var(--bg-subtle); }
    .meta-tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 11px; background: var(--bg-subtle); border: 1px solid var(--border); color: var(--text-secondary); }
    .meta-tag.is-ok { background: var(--ok-soft); border-color: var(--ok-border); color: var(--ok-text); }
    .meta-tag.is-warn { background: var(--warn-soft); border-color: var(--warn-border); color: var(--warn-text); }
    .meta-tag.is-danger { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger-text); }
    .meta-tag.is-info { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }
    .kpi-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    @media (min-width: 560px) { .kpi-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .kpi-cell { background: var(--bg-panel); padding: 9px 11px; display: flex; flex-direction: column; gap: 2px; }
    .kpi-label { font-size: 11px; color: var(--text-muted); }
    .kpi-value { font-family: var(--font-mono); font-size: 14px; font-weight: 600; }
    .sub-block { padding-top: 10px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; }
    details.accordion-band { border-bottom: 1px solid var(--border); }
    details.accordion-band > summary.accordion-summary { list-style: none; cursor: pointer; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
    details.accordion-band > summary::-webkit-details-marker { display: none; }
    .accordion-left { display: flex; align-items: center; gap: 8px; }
    .accordion-chevron { width: 14px; height: 14px; color: var(--text-muted); transition: transform 150ms ease; }
    details.accordion-band[open] .accordion-chevron { transform: rotate(90deg); }
    .accordion-body { padding: 2px 16px 14px; display: flex; flex-direction: column; gap: 10px; }
    ${getIdeOverlayCss()}
  </style>
</head>
<body class="custom-scrollbar" data-ide-mode="${escapeHtml(mode)}" data-active-tab="${escapeHtml(activeTab)}">
  <div class="shell">
    <header class="topbar">
      ${getMainTabsHtml(activeTab)}
      ${getGlobalToolbarHtml(
        mode,
        `<div class="band-actions">
            <div class="segmented">
              <button type="button" onclick="window.__agyIdeBridge.notifyLang('zh')" class="seg-btn">中文</button>
              <button type="button" onclick="window.__agyIdeBridge.notifyLang('en')" class="seg-btn">EN</button>
            </div>
            <button type="button" onclick="window.__agyCapsuleUi.refreshAll(true)" class="btn btn-ghost">刷新</button>
          </div>`
      )}
    </header>
    ${getCapsulePaneHtml(initialState?.capsuleUiState)}
    <div id="ide-dart-pane" class="dart-only-section">
      <section class="band">
        <div class="band-head">
          <span class="band-title">agy-dart 护栏服务暂未就绪</span>
          ${getDartActionsHtml()}
        </div>
        <div class="muted-note">${reason}</div>
        <div class="band-actions">
          <button type="button" onclick="window.__agyIdeBridge.runCommand('restartBackend')" class="btn btn-primary">重新检测并启动</button>
          <button type="button" onclick="window.__agyIdeBridge.runCommand('runDoctor')" class="btn btn-ghost">运行体检</button>
        </div>
      </section>
    </div>
  </div>
  ${getPreBridgeScript(initialState)}
  ${getCapsuleClientScript()}
  ${getPostBridgeScript()}
</body>
</html>`;
}

/**
 * 将 agy-dart 原版仪表盘 HTML 与 Capsule 遥测模块融合为双页签原生 IDE Webview 页面。
 * @param {{
 *   rawHtml?: string,
 *   dartUnavailableReason?: string,
 *   mode: "sidebar" | "editor",
 *   initialState: {
 *     lang: "zh" | "en",
 *     activeTab?: "capsule" | "dart",
 *     defaultScope: "conversation" | "app" | "lifetime",
 *     selectionMode: string,
 *     resolvedConversationId: string,
 *     conversations: Array<{ id: string, title: string, updatedLabel: string }>,
 *     capsulePrefs?: { cacheWarnMin: number, cacheColdMin: number, queueWarnSec: number }
 *   }
 * }} params
 * @returns {string}
 */
function buildDashboardHtml({ rawHtml = "", dartUnavailableReason = "", mode = "sidebar", initialState }) {
  const safeInitialState = {
    ...initialState,
    activeTab: initialState?.activeTab === "dart" ? "dart" : "capsule"
  };

  if (!rawHtml || dartUnavailableReason) {
    return buildFallbackFusionShell({
      mode,
      initialState: safeInitialState,
      dartUnavailableReason
    });
  }

  let html = String(rawHtml);

  // 1. 移除 /preload.js
  html = html.replace(/<script\s+src="\/preload\.js"><\/script>\s*/gi, "");

  // 2. 注入严格 CSP
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">`;
  if (html.includes("</head>")) {
    html = html.replace("</head>", () => `  ${cspTag}\n</head>`);
  }

  // 3. 注入 IDE 主题样式、窄屏适配与 Capsule 模块样式
  if (html.includes("</style>")) {
    html = html.replace("</style>", () => `${getIdeOverlayCss()}\n  </style>`);
  }

  // 4. 在 <body> 标记视图模式与默认活跃页签
  html = html.replace(
    /<body\b([^>]*)>/i,
    (_, attrs) => `<body${attrs} data-ide-mode="${escapeHtml(mode)}" data-active-tab="${escapeHtml(safeInitialState.activeTab)}">`
  );

  // 5-6. 重排 header.topbar：主页签置最顶 -> 全局工具栏（对话/全宽/双语/刷新）-> 护栏专属头部与 Scope/Telemetry（均归入 dart-only-section）
  const headerOpenMatch = /<header\s+class="topbar">/i.exec(html);
  const headerCloseIdx = headerOpenMatch ? html.indexOf("</header>", headerOpenMatch.index) : -1;
  if (headerOpenMatch && headerCloseIdx !== -1) {
    const innerStart = headerOpenMatch.index + headerOpenMatch[0].length;
    let headerInner = html.slice(innerStart, headerCloseIdx);
    const firstTopbarRow = extractDivBlock(headerInner, /<div\s+class="topbar-row">/i);
    if (firstTopbarRow) {
      const brandBlock = extractDivBlock(firstTopbarRow.html, /<div\s+class="brand-group">/i);
      const actionsBlock = extractDivBlock(firstTopbarRow.html, /<div\s+class="header-actions">/i);
      const rebuiltHead = [
        getMainTabsHtml(safeInitialState.activeTab),
        getGlobalToolbarHtml(mode, actionsBlock ? actionsBlock.html : ""),
        getDartHeaderRowHtml(brandBlock ? brandBlock.html : "")
      ].join("\n");
      headerInner = headerInner.slice(0, firstTopbarRow.start) + rebuiltHead + headerInner.slice(firstTopbarRow.end);
    } else {
      headerInner = `${getMainTabsHtml(safeInitialState.activeTab)}\n${getGlobalToolbarHtml(mode, "")}\n${getDartHeaderRowHtml("")}\n${headerInner}`;
    }

    const scopeRowRegex = /<div\s+class="topbar-row">\s*<div\s+class="segmented">\s*<button\s+id="scope-conv-btn"/i;
    if (scopeRowRegex.test(headerInner)) {
      headerInner = headerInner.replace(
        scopeRowRegex,
        () => `<div class="topbar-row dart-only-section">\n        <div class="segmented">\n          <button id="scope-conv-btn"`
      );
    }

    headerInner = headerInner.replace(
      /<div\s+id="telemetry-banner"\s+class="telemetry-bar">/i,
      () => `<div id="telemetry-banner" class="telemetry-bar dart-only-section">`
    );

    html = html.slice(0, innerStart) + headerInner + html.slice(headerCloseIdx);
  }

  // 7. 在 </header> 后注入 Capsule 面板并将原 DART 主体包裹进 #ide-dart-pane
  html = html.replace(
    /<\/header>/i,
    () => `</header>\n${getCapsulePaneHtml(safeInitialState.capsuleUiState)}\n    <div id="ide-dart-pane" class="dart-only-section">`
  );

  // 8. 对原版主 <script> 块重写同步弹窗，并在其前方闭合 #ide-dart-pane 兼注入前置桥接脚本
  let mainScriptInjected = false;
  const preBridge = getPreBridgeScript(safeInitialState);
  html = html.replace(/<script>([\s\S]*?)<\/script>/i, (fullMatch, innerCode, offset) => {
    const transformed = rewriteSyncDialogsInScript(innerCode);
    mainScriptInjected = true;
    // 在 <script> 之前必须正好闭合上面打开的 #ide-dart-pane（位于 .shell 闭合 div 前）
    return `${preBridge}\n  <script>${transformed}</script>`;
  });

  if (!mainScriptInjected) {
    throw new Error("仪表盘 HTML 未包含内联脚本块，无法完成融合转换");
  }

  // 在主 <script> 之前的最后一个 </div>（即关闭 .shell）前插入 </div> 关闭 #ide-dart-pane
  const preScriptIdx = html.indexOf("window.__AGY_IDE_INIT__");
  const scriptStartAnchor = preScriptIdx !== -1 ? html.lastIndexOf("<script>", preScriptIdx) : html.indexOf("<script>");
  if (scriptStartAnchor !== -1) {
    const lastDivClose = html.lastIndexOf("</div>", scriptStartAnchor);
    if (lastDivClose !== -1) {
      html = `${html.slice(0, lastDivClose)}  </div>\n${html.slice(lastDivClose)}`;
    }
  }

  // 9. 在 </body> 前注入 Capsule 前端引擎及后置联动脚本
  const postScripts = `${getCapsuleClientScript()}\n  ${getPostBridgeScript()}`;
  if (html.includes("</body>")) {
    html = html.replace("</body>", () => `${postScripts}\n</body>`);
  } else {
    html += postScripts;
  }

  return html;
}

/**
 * 构建完整不可用兜底页（当 Node.js 都不满足时使用）。
 */
function buildUnavailableHtml({ title, reason, details = "" }) {
  const safeTitle = escapeHtml(title || "agy-dart 面板暂不可用");
  const safeReason = escapeHtml(reason || "未检测到可用的 Node.js (>= 22)。");
  const safeDetails = details ? `<pre class="err-box">${escapeHtml(details)}</pre>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; padding: 16px; font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 13px; color: var(--vscode-foreground, #cccccc); background: var(--vscode-sideBar-background, transparent); line-height: 1.55; }
    .card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.28)); background: var(--vscode-editor-background, rgba(128,128,128,0.08)); border-radius: 6px; padding: 14px; }
    h2 { margin: 0 0 8px; font-size: 14px; }
    p { margin: 0 0 10px; color: var(--vscode-descriptionForeground, inherit); }
    .err-box { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.32); border-radius: 4px; padding: 8px 10px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0 0 12px; }
    .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
    button { cursor: pointer; border-radius: 4px; padding: 5px 11px; font-size: 12px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background, #2563eb); color: var(--vscode-button-foreground, #ffffff); }
    button.secondary { background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2)); color: var(--vscode-button-secondaryForeground, inherit); }
  </style>
</head>
<body>
  <div class="card">
    <h2>${safeTitle}</h2>
    <p>${safeReason}</p>
    ${safeDetails}
    <div class="btn-row">
      <button onclick="send('restartBackend')">重新检测并启动</button>
      <button class="secondary" onclick="send('showLogs')">查看日志</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function send(command) { vscode.postMessage({ type: 'runCommand', command }); }
  </script>
</body>
</html>`;
}

module.exports = {
  rewriteSyncDialogsInScript,
  buildDashboardHtml,
  buildUnavailableHtml
};
