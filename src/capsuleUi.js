"use strict";

/**
 * 构建 Tab 1（实时遥测、多模型配额与历史用量看板）的样式、DOM 标记与前端脚本。
 * 所有配色继承自融合页面的 CSS 变量，天然支持 VS Code 深浅色及中英文切换。
 */

function getCapsuleCss() {
  return `
    /* === 主页签切换栏与 Capsule 遥测视图 === */
    .ide-main-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
    }

    .ide-main-tab {
      flex: 1 1 0;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 5px 4px;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 500;
      color: var(--text-secondary);
      transition: background-color 150ms ease, color 150ms ease;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ide-main-tab:hover {
      color: var(--text-primary);
    }

    .ide-main-tab.is-active {
      background: var(--bg-panel);
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08), inset 0 0 0 1px var(--border-strong);
    }

    body.vscode-dark .ide-main-tab.is-active,
    body.vscode-high-contrast .ide-main-tab.is-active {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), inset 0 0 0 1px var(--border-strong);
    }

    .tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--ok);
    }

    .tab-dot.is-warn { background: var(--warn); }
    .tab-dot.is-danger { background: var(--danger); }
    .tab-dot.is-muted { background: var(--text-muted); }

    body[data-active-tab="capsule"] .dart-only-section,
    body[data-active-tab="capsule"] #ide-pane-accounts {
      display: none !important;
    }

    body[data-active-tab="accounts"] .dart-only-section,
    body[data-active-tab="accounts"] #ide-pane-capsule {
      display: none !important;
    }

    body[data-active-tab="dart"] #ide-pane-capsule,
    body[data-active-tab="dart"] #ide-pane-accounts {
      display: none !important;
    }

    .cap-pane {
      display: flex;
      flex-direction: column;
    }

    .cap-alert-banner {
      margin: 12px 18px 0;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }

    .cap-alert-banner.is-error {
      background: var(--danger-soft);
      border-color: var(--danger-border);
      color: var(--danger-text);
    }

    .cap-alert-banner.is-warn {
      background: var(--warn-soft);
      border-color: var(--warn-border);
      color: var(--warn-text);
    }

    .cap-alert-title {
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .cap-alert-diag {
      margin: 4px 0 0;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.08);
      font-family: var(--font-mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-primary);
    }

    .cap-ctx-hero {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cap-ctx-pct {
      font-family: var(--font-mono);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .cap-ctx-pct.is-warn { color: var(--warn-text); }
    .cap-ctx-pct.is-danger { color: var(--danger-text); }

    .cap-ctx-frac {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .cap-stack-bar {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      background: var(--bg-inset);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
      display: flex;
    }

    .cap-seg {
      height: 100%;
      transition: width 220ms ease;
    }

    .cap-seg-turn0 { background: #9f8858; }
    .cap-seg-read { background: #5f82a8; }
    .cap-seg-think { background: #558f7c; }
    .cap-seg-write { background: #a87158; }

    .cap-dot-turn0 { background: #9f8858; }
    .cap-dot-read { background: #5f82a8; }
    .cap-dot-think { background: #558f7c; }
    .cap-dot-write { background: #a87158; }

    .cap-breakdown-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    @media (min-width: 560px) {
      .cap-breakdown-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    .cap-bd-cell {
      padding: 8px 10px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .cap-bd-head {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .cap-bd-dot {
      width: 7px;
      height: 7px;
      border-radius: 2px;
      flex-shrink: 0;
    }

    .cap-bd-val {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .cap-bd-pct {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
    }

    /* 速度指示点温和呼吸动效 */
    @keyframes capPulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.18); opacity: 0.45; }
    }

    .cap-speed-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
      transition: background-color 200ms ease;
    }

    .cap-speed-dot.is-fast { background: var(--ok); }
    .cap-speed-dot.is-mid { background: var(--warn); }
    .cap-speed-dot.is-slow { background: var(--danger); }
    .cap-speed-dot.is-running {
      background: var(--accent);
      animation: capPulse 1.8s ease-in-out infinite;
    }

    .cap-req-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      flex-wrap: wrap;
    }

    .cap-req-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .cap-req-right {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* 配额池 */
    .cap-quota-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cap-quota-group {
      padding: 9px 11px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .cap-quota-group.is-current {
      border-color: var(--border-strong);
      background: var(--bg-inset);
    }

    .cap-quota-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .cap-quota-active-tag {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      border: 1px solid var(--border-strong);
    }

    .cap-bucket-row {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .cap-bucket-label {
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .cap-bucket-track {
      height: 6px;
      border-radius: 3px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .cap-bucket-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 250ms ease;
    }

    .cap-bucket-meta {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-primary);
      white-space: nowrap;
      text-align: right;
    }

    /* 历史用量热力图与模型柱状图 */
    .cap-usage-totals {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      background: var(--border-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    @media (min-width: 520px) {
      .cap-usage-totals {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    .cap-usage-total-cell {
      background: var(--bg-panel);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: background 120ms ease, box-shadow 120ms ease;
    }

    .cap-usage-total-cell.is-clickable {
      cursor: pointer;
    }

    .cap-usage-total-cell.is-clickable:hover {
      background: var(--bg-hover);
    }

    .cap-usage-total-cell.is-active-kpi {
      background: var(--bg-subtle);
      box-shadow: inset 0 2px 0 var(--accent-text);
    }

    .cap-empty-box {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      border: 1px dashed var(--border);
      background: var(--bg-inset);
    }

    .cap-empty-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .cap-heat-scroll {
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .cap-heat-grid {
      display: inline-flex;
      gap: 3px;
      padding-top: 16px;
      position: relative;
      min-width: max-content;
    }

    .cap-heat-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
      position: relative;
    }

    .cap-heat-month {
      position: absolute;
      top: -16px;
      left: 0;
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .cap-heat-cell {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
    }

    .cap-heat-cell[data-future="1"] {
      opacity: 0.2;
    }

    .cap-heat-cell.is-clickable {
      cursor: pointer;
      transition: transform 100ms ease, border-color 100ms ease;
    }

    .cap-heat-cell.is-clickable:hover {
      border-color: var(--text-secondary);
      transform: scale(1.18);
    }

    .cap-heat-cell[data-level="1"] { background: rgba(95, 130, 168, 0.22); border-color: transparent; }
    .cap-heat-cell[data-level="2"] { background: rgba(95, 130, 168, 0.40); border-color: transparent; }
    .cap-heat-cell[data-level="3"] { background: rgba(95, 130, 168, 0.60); border-color: transparent; }
    .cap-heat-cell[data-level="4"] { background: rgba(95, 130, 168, 0.82); border-color: transparent; }

    .cap-heat-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .cap-heat-legend {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .cap-usage-controls {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cap-usage-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: nowrap;
    }

    .cap-scope-row {
      width: 100%;
    }

    .cap-scope-dd {
      position: relative;
      width: 100%;
    }

    .cap-scope-trigger {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      border-radius: var(--radius-md);
      border: 1.5px solid rgba(114, 154, 198, 0.62);
      background: var(--bg-panel);
      color: var(--text-primary);
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
      cursor: pointer;
      transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
    }

    .cap-scope-trigger:hover,
    .cap-scope-trigger:focus-visible,
    .cap-scope-dd.is-open .cap-scope-trigger {
      border-color: rgba(114, 154, 198, 0.95);
      background: var(--bg-subtle);
      box-shadow: 0 0 0 2px rgba(114, 154, 198, 0.18);
      outline: none;
    }

    .cap-scope-trigger-text {
      min-width: 0;
      flex: 1 1 auto;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cap-scope-caret {
      flex-shrink: 0;
      font-size: 11px;
      color: rgba(132, 174, 218, 0.92);
      transition: transform 140ms ease;
    }

    .cap-scope-dd.is-open .cap-scope-caret {
      transform: rotate(180deg);
    }

    .cap-scope-menu {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 4px);
      z-index: 80;
      display: flex;
      flex-direction: column;
      border-radius: var(--radius-md);
      border: 1.5px solid rgba(114, 154, 198, 0.72);
      background: var(--bg-panel);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.34);
      overflow: hidden;
    }

    .cap-scope-menu.hidden {
      display: none;
    }

    /* 向上展开时自动反转主轴，让「当前对话 / 全部对话」固定区依然最贴近选择框 */
    .cap-scope-dd.is-dropup .cap-scope-menu {
      top: auto;
      bottom: calc(100% + 4px);
      flex-direction: column-reverse;
    }

    .cap-scope-pinned {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border-strong);
    }

    .cap-scope-dd.is-dropup .cap-scope-pinned {
      border-bottom: none;
      border-top: 1px solid var(--border-strong);
    }

    .cap-scope-scroll {
      flex: 1 1 auto;
      max-height: 196px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
    }

    .cap-scope-group-lbl {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      padding: 3px 8px 2px;
      letter-spacing: 0.02em;
      user-select: none;
    }

    .cap-scope-opt {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-primary);
      font-size: 11.5px;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 100ms ease, border-color 100ms ease;
    }

    .cap-scope-opt:hover {
      background: var(--bg-hover);
    }

    .cap-scope-opt.is-selected {
      background: rgba(114, 154, 198, 0.16);
      border-color: rgba(114, 154, 198, 0.45);
      font-weight: 600;
    }

    .cap-scope-opt-title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cap-scope-opt-meta {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .cap-scope-opt-check {
      flex-shrink: 0;
      font-size: 11px;
      color: rgba(132, 174, 218, 0.95);
    }

    .cap-bars-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      height: 24px;
      min-height: 24px;
      max-height: 24px;
      font-size: 11px;
      color: var(--text-secondary);
      flex-wrap: nowrap;
      overflow: hidden;
    }

    .cap-bars-nav .band-actions {
      flex-wrap: nowrap;
      min-width: 0;
    }

    .cap-bar-detail-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: 28px;
      min-height: 28px;
      max-height: 28px;
      padding: 0 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      transition: border-color 120ms ease, color 120ms ease;
    }

    .cap-bar-detail-bar.is-active {
      border-color: var(--border-strong);
      color: var(--text-primary);
    }

    .cap-bar-detail-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cap-bar-detail-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .cap-link-btn {
      font-size: 11px;
      color: var(--accent-text);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-panel);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .cap-link-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }

    .cap-bars-chart {
      height: 98px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 6px 6px 22px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      position: relative;
    }

    .cap-bar-col {
      flex: 1 1 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      position: relative;
      min-width: 12px;
      border-radius: 3px;
      padding: 0 2px;
      transition: opacity 150ms ease, background-color 150ms ease;
    }

    .cap-bar-col.is-clickable {
      cursor: pointer;
    }

    .cap-bar-col.is-clickable:hover {
      background: var(--bg-hover);
    }

    .cap-bar-col.is-selected {
      background: var(--bg-subtle);
      box-shadow: inset 0 0 0 1px var(--border-strong);
    }

    .cap-bar-col.is-dimmed {
      opacity: 0.35;
    }

    .cap-bar-stack {
      width: 100%;
      max-width: 24px;
      border-radius: 2px 2px 0 0;
      overflow: hidden;
      display: flex;
      flex-direction: column-reverse;
      min-height: 2px;
    }

    .cap-bar-seg {
      transition: opacity 150ms ease;
    }

    .cap-bar-seg.is-dimmed {
      opacity: 0.16;
    }

    .cap-bar-x {
      position: absolute;
      bottom: -17px;
      font-family: var(--font-mono);
      font-size: 9.5px;
      color: var(--text-muted);
      white-space: nowrap;
      pointer-events: none;
    }

    .cap-bar-col.is-selected .cap-bar-x {
      color: var(--text-primary);
      font-weight: 600;
    }

    .cap-model-rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cap-pool-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .cap-pool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      padding: 2px 2px 1px;
    }

    .cap-model-item {
      display: flex;
      flex-direction: column;
    }

    .cap-model-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      padding: 5px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-inset);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: border-color 150ms ease, background-color 150ms ease, opacity 150ms ease;
    }

    .cap-model-row:hover {
      background: var(--bg-hover);
      border-color: var(--border);
    }

    .cap-model-row.is-focused {
      border-color: var(--border-strong);
      background: var(--bg-subtle);
    }

    .cap-model-row.is-dimmed {
      opacity: 0.5;
    }

    .cap-model-left {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1 1 auto;
    }

    .cap-model-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .cap-model-sub {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cap-model-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .cap-model-right {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .cap-model-expand-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 10px;
    }

    .cap-model-expand-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .cap-model-detail {
      margin-top: 2px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-panel);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .cap-detail-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
    }

    .cap-conv-row {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-inset);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease;
    }

    .cap-conv-row:hover {
      background: var(--bg-hover);
      border-color: var(--border);
    }

    .cap-conv-row.is-selected {
      border-color: var(--border-strong);
      background: var(--bg-subtle);
    }

    .cap-conv-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }

    .cap-conv-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .cap-mini-tag {
      font-size: 10px;
      padding: 0 5px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-strong);
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    details.cap-sub-accordion {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-inset);
    }

    details.cap-sub-accordion > summary.cap-sub-summary {
      list-style: none;
      cursor: pointer;
      padding: 7px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    details.cap-sub-accordion > summary::-webkit-details-marker {
      display: none;
    }

    details.cap-sub-accordion[open] .accordion-chevron {
      transform: rotate(90deg);
    }

    .cap-sub-body {
      padding: 4px 10px 10px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cap-prefs-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    @media (max-width: 480px) {
      .cap-alert-banner {
        margin: 10px 12px 0;
      }
      .cap-prefs-grid {
        grid-template-columns: 1fr;
      }
    }

    .cap-pref-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .cap-pref-input {
      width: 100%;
      padding: 4px 7px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-strong);
      background: var(--bg-panel);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12px;
    }
  `;
}

function getMainTabsHtml(defaultTab) {
  const active = defaultTab === "dart" || defaultTab === "accounts" ? defaultTab : "capsule";
  const isCap = active === "capsule";
  const isAcc = active === "accounts";
  const isDart = active === "dart";
  return `
      <div class="ide-main-tabs" role="tablist">
        <button id="ide-tab-btn-capsule" type="button" role="tab" aria-selected="${isCap}" onclick="window.__agyIdeBridge.switchMainTab('capsule')" class="ide-main-tab ${isCap ? "is-active" : ""}">
          <span id="ide-tab-dot-capsule" class="tab-dot"></span>
          <span data-cap-i18n="tabTelemetry">实时遥测</span>
        </button>
        <button id="ide-tab-btn-accounts" type="button" role="tab" aria-selected="${isAcc}" onclick="window.__agyIdeBridge.switchMainTab('accounts')" class="ide-main-tab ${isAcc ? "is-active" : ""}">
          <span id="ide-tab-dot-accounts" class="tab-dot"></span>
          <span data-cap-i18n="tabAccounts">账号切换</span>
        </button>
        <button id="ide-tab-btn-dart" type="button" role="tab" aria-selected="${isDart}" onclick="window.__agyIdeBridge.switchMainTab('dart')" class="ide-main-tab ${isDart ? "is-active" : ""}">
          <span id="ide-tab-dot-dart" class="tab-dot"></span>
          <span data-cap-i18n="tabDart">护栏诊断</span>
        </button>
      </div>`;
}

function getCapsulePaneHtml(uiState = {}) {
  const usageOpenAttr = uiState && uiState.usageOpen ? " open" : "";
  const heatOpenAttr = uiState && uiState.heatOpen ? " open" : "";
  return `
    <div id="ide-pane-capsule" class="cap-pane">
      <!-- 异常与首字等待警示 -->
      <div id="cap-alert-banner" class="cap-alert-banner hidden">
        <div class="cap-alert-title">
          <span id="cap-alert-heading">--</span>
          <span id="cap-alert-badge" class="mono"></span>
        </div>
        <div id="cap-alert-detail"></div>
        <pre id="cap-alert-diag" class="cap-alert-diag hidden"></pre>
      </div>

      <!-- 1. 实时上下文与缓存 -->
      <section class="band">
        <div class="band-head">
          <div class="band-title-group">
            <span class="band-title" data-cap-i18n="ctxTitle">实时上下文明细</span>
            <span id="cap-model-chip" class="meta-tag hidden">--</span>
          </div>
          <div class="band-actions">
            <span id="cap-cache-badge" class="meta-tag">--</span>
          </div>
        </div>

        <div class="cap-ctx-hero">
          <span id="cap-ctx-pct" class="cap-ctx-pct">--%</span>
          <span id="cap-ctx-frac" class="cap-ctx-frac">-- / --</span>
        </div>

        <div class="cap-stack-bar" id="cap-ctx-stack-bar">
          <div id="cap-seg-turn0" class="cap-seg cap-seg-turn0" style="width:0%"></div>
          <div id="cap-seg-read" class="cap-seg cap-seg-read" style="width:0%"></div>
          <div id="cap-seg-think" class="cap-seg cap-seg-think" style="width:0%"></div>
          <div id="cap-seg-write" class="cap-seg cap-seg-write" style="width:0%"></div>
        </div>

        <div class="cap-breakdown-grid">
          <div class="cap-bd-cell" id="cap-tip-turn0">
            <div class="cap-bd-head"><span class="cap-bd-dot cap-dot-turn0"></span><span data-cap-i18n="turn0">首轮基线</span></div>
            <div class="cap-bd-val" id="cap-val-turn0">--</div>
            <div class="cap-bd-pct" id="cap-pct-turn0">--%</div>
          </div>
          <div class="cap-bd-cell" id="cap-tip-read">
            <div class="cap-bd-head"><span class="cap-bd-dot cap-dot-read"></span><span data-cap-i18n="read">读取增量</span></div>
            <div class="cap-bd-val" id="cap-val-read">--</div>
            <div class="cap-bd-pct" id="cap-pct-read">--%</div>
          </div>
          <div class="cap-bd-cell" id="cap-tip-think">
            <div class="cap-bd-head"><span class="cap-bd-dot cap-dot-think"></span><span data-cap-i18n="think">思考累计</span></div>
            <div class="cap-bd-val" id="cap-val-think">--</div>
            <div class="cap-bd-pct" id="cap-pct-think">--%</div>
          </div>
          <div class="cap-bd-cell" id="cap-tip-write">
            <div class="cap-bd-head"><span class="cap-bd-dot cap-dot-write"></span><span data-cap-i18n="write">回复/调用</span></div>
            <div class="cap-bd-val" id="cap-val-write">--</div>
            <div class="cap-bd-pct" id="cap-pct-write">--%</div>
          </div>
        </div>
      </section>

      <!-- 2. 生成速度与本轮统计 -->
      <section class="band">
        <div class="band-head">
          <span class="band-title" data-cap-i18n="speedTurnTitle">生成速度与本轮统计</span>
          <span id="cap-turn-state-tag" class="meta-tag">--</span>
        </div>

        <div class="cap-req-strip">
          <div class="cap-req-left">
            <span id="cap-speed-dot" class="cap-speed-dot"></span>
            <span id="cap-speed-val">-- tok/s</span>
          </div>
          <div class="cap-req-right">
            <span id="cap-req-timing">TTFT --</span>
            <span id="cap-req-output">-- tok</span>
          </div>
        </div>

        <div class="kpi-strip">
          <div class="kpi-cell">
            <span class="kpi-label" data-cap-i18n="turnElapsed">本轮耗时</span>
            <span class="kpi-value kpi-value-sm" id="cap-turn-elapsed">--</span>
          </div>
          <div class="kpi-cell">
            <span class="kpi-label" data-cap-i18n="turnReqs">请求次数</span>
            <span class="kpi-value kpi-value-sm" id="cap-turn-reqs">--</span>
          </div>
          <div class="kpi-cell">
            <span class="kpi-label" data-cap-i18n="turnThink">本轮思考</span>
            <span class="kpi-value kpi-value-sm" id="cap-turn-think">--</span>
          </div>
          <div class="kpi-cell">
            <span class="kpi-label" data-cap-i18n="turnWrite">本轮写入</span>
            <span class="kpi-value kpi-value-sm" id="cap-turn-write">--</span>
          </div>
        </div>
      </section>

      <!-- 3. 多模型配额池 -->
      <section class="band">
        <div class="band-head">
          <div class="band-title-group">
            <span class="band-title" data-cap-i18n="quotaTitle">多模型配额池</span>
            <span id="cap-tier-badge" class="meta-tag hidden">--</span>
          </div>
          <button type="button" onclick="window.__agyCapsuleUi.refreshQuota(true)" class="btn btn-ghost btn-sm" data-cap-i18n="refreshQuota">刷新配额</button>
        </div>
        <div id="cap-quota-list" class="cap-quota-list">
          <div class="muted-note" data-cap-i18n="quotaLoading">正在读取模型配额...</div>
        </div>
      </section>

      <!-- 4. Token 用量与按模型系列统计（展开按需加载并记忆展开状态） -->
      <details id="cap-usage-accordion" class="accordion-band"${usageOpenAttr}>
        <summary class="accordion-summary">
          <span class="accordion-left">
            <svg class="accordion-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span class="band-title" data-cap-i18n="usageTitle">Token 用量与模型统计</span>
          </span>
          <span class="accordion-right">
            <span id="cap-usage-badge" class="mono muted-note" data-cap-i18n="usageCollapsedHint">展开按需扫描</span>
          </span>
        </summary>
        <div class="accordion-body">
          <div class="cap-usage-controls">
            <div class="cap-scope-row">
              <div id="cap-scope-select-top" class="cap-scope-dd" data-scope-slot="top" data-value="__active__">
                <button id="cap-scope-btn-top" type="button" class="cap-scope-trigger" onclick="window.__agyCapsuleUi.toggleScopeDropdown('top', event)" aria-haspopup="listbox" aria-expanded="false">
                  <span id="cap-scope-label-top" class="cap-scope-trigger-text">● 当前对话</span>
                  <span class="cap-scope-caret">▾</span>
                </button>
                <div id="cap-scope-menu-top" class="cap-scope-menu hidden" role="listbox" onclick="event.stopPropagation()"></div>
              </div>
            </div>
            <div class="cap-usage-controls-row">
              <div class="segmented" role="group">
                <button id="cap-metric-net" type="button" onclick="window.__agyCapsuleUi.setUsageMetric('net')" class="seg-btn is-active" data-cap-i18n="metricNet">净耗</button>
                <button id="cap-metric-total" type="button" onclick="window.__agyCapsuleUi.setUsageMetric('total')" class="seg-btn" data-cap-i18n="metricTotal">总量</button>
                <button id="cap-metric-reqs" type="button" onclick="window.__agyCapsuleUi.setUsageMetric('requests')" class="seg-btn" data-cap-i18n="metricReqs">次数</button>
              </div>
              <button id="cap-usage-rescan" type="button" onclick="window.__agyCapsuleUi.loadUsage(true)" class="btn btn-ghost btn-sm" data-cap-i18n="scanNowShort" title="重新扫描本地库">↻</button>
            </div>
          </div>

          <div id="cap-usage-totals" class="cap-usage-totals"></div>

          <div class="sub-block">
            <div class="band-head">
              <span class="band-title" data-cap-i18n="byModelTitle">按模型系列统计</span>
              <div class="segmented">
                <button id="cap-period-5h" type="button" onclick="window.__agyCapsuleUi.setModelPeriod('5h')" class="seg-btn" data-cap-i18n="unit5h">5h</button>
                <button id="cap-period-day" type="button" onclick="window.__agyCapsuleUi.setModelPeriod('day')" class="seg-btn is-active" data-cap-i18n="unitDay">日</button>
                <button id="cap-period-3d" type="button" onclick="window.__agyCapsuleUi.setModelPeriod('3d')" class="seg-btn" data-cap-i18n="unit3d">3日</button>
                <button id="cap-period-week" type="button" onclick="window.__agyCapsuleUi.setModelPeriod('week')" class="seg-btn" data-cap-i18n="unitWeek">周</button>
                <button id="cap-period-month" type="button" onclick="window.__agyCapsuleUi.setModelPeriod('month')" class="seg-btn" data-cap-i18n="unitMonth">月</button>
              </div>
            </div>
            <div class="cap-scope-row">
              <div id="cap-scope-select-model" class="cap-scope-dd" data-scope-slot="model" data-value="__active__">
                <button id="cap-scope-btn-model" type="button" class="cap-scope-trigger" onclick="window.__agyCapsuleUi.toggleScopeDropdown('model', event)" aria-haspopup="listbox" aria-expanded="false">
                  <span id="cap-scope-label-model" class="cap-scope-trigger-text">● 当前对话</span>
                  <span class="cap-scope-caret">▾</span>
                </button>
                <div id="cap-scope-menu-model" class="cap-scope-menu hidden" role="listbox" onclick="event.stopPropagation()"></div>
              </div>
            </div>
            <div class="cap-bars-nav">
              <div class="band-actions">
                <button id="cap-shift-prev" type="button" onclick="window.__agyCapsuleUi.shiftModelPage(-1)" class="btn btn-ghost btn-sm">‹</button>
                <span id="cap-bars-range" class="mono truncate">--</span>
                <button id="cap-shift-next" type="button" onclick="window.__agyCapsuleUi.shiftModelPage(1)" class="btn btn-ghost btn-sm">›</button>
                <button id="cap-shift-today" type="button" onclick="window.__agyCapsuleUi.resetToNow()" class="btn btn-ghost btn-sm hidden" data-cap-i18n="backToday">今</button>
              </div>
              <span id="cap-bars-total" class="mono muted-note">--</span>
            </div>
            <div id="cap-bar-detail-bar" class="cap-bar-detail-bar">
              <span class="cap-bar-detail-text" data-cap-i18n="barDetailIdle">单击柱子查看该时段明细</span>
              <span class="cap-bar-detail-actions"></span>
            </div>
            <div id="cap-bars-chart" class="cap-bars-chart"></div>
            <div id="cap-model-rows" class="cap-model-rows"></div>
          </div>

          <details id="cap-heat-accordion" class="cap-sub-accordion"${heatOpenAttr}>
            <summary class="cap-sub-summary">
              <span class="accordion-left">
                <svg class="accordion-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span class="band-sub" data-cap-i18n="heatTitle">53 周活跃热力图</span>
              </span>
              <span id="cap-heat-summary-right" class="mono muted-note"></span>
            </summary>
            <div class="cap-sub-body">
              <div class="band-head">
                <span id="cap-heat-hint" class="band-sub" data-cap-i18n="heatHint">点击格子可直接跳转到该日用量</span>
                <div class="segmented">
                  <button id="cap-heat-day-btn" type="button" onclick="window.__agyCapsuleUi.setHeatScale('day')" class="seg-btn is-active" data-cap-i18n="daily">每日</button>
                  <button id="cap-heat-week-btn" type="button" onclick="window.__agyCapsuleUi.setHeatScale('week')" class="seg-btn" data-cap-i18n="weekly">每周</button>
                </div>
              </div>
              <div id="cap-heat-wrap" class="cap-heat-scroll custom-scrollbar"></div>
              <div id="cap-heat-foot" class="cap-heat-foot"></div>
            </div>
          </details>
        </div>
      </details>

      <!-- 5. 遥测提醒阈值设置 -->
      <details id="cap-prefs-accordion" class="accordion-band">
        <summary class="accordion-summary">
          <span class="accordion-left">
            <svg class="accordion-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span class="band-title" data-cap-i18n="prefsTitle">提醒阈值设置</span>
          </span>
        </summary>
        <div class="accordion-body">
          <div class="cap-prefs-grid">
            <label class="cap-pref-field">
              <span data-cap-i18n="cacheWarnMin">缓存变黄 (分钟)</span>
              <input id="cap-pref-warn-min" type="number" min="1" max="998" class="cap-pref-input" onchange="window.__agyCapsuleUi.savePrefs()" />
            </label>
            <label class="cap-pref-field">
              <span data-cap-i18n="cacheColdMin">缓存变红 (分钟)</span>
              <input id="cap-pref-cold-min" type="number" min="2" max="999" class="cap-pref-input" onchange="window.__agyCapsuleUi.savePrefs()" />
            </label>
            <label class="cap-pref-field">
              <span data-cap-i18n="queueWarnSec">首字等待 (秒)</span>
              <input id="cap-pref-queue-sec" type="number" min="1" max="999" class="cap-pref-input" onchange="window.__agyCapsuleUi.savePrefs()" />
            </label>
          </div>
        </div>
      </details>
    </div>`;
}

function getCapsuleClientScript() {
  return String.raw`<script>
  (function() {
    const CAP_I18N = {
      zh: {
        tabTelemetry: '实时遥测',
        tabAccounts: '账号切换',
        tabDart: '护栏诊断',
        ctxTitle: '实时上下文明细',
        turn0: '首轮基线',
        read: '读取增量',
        think: '思考累计',
        write: '回复/调用',
        speedTurnTitle: '生成速度与本轮统计',
        turnElapsed: '本轮耗时',
        turnReqs: '请求次数',
        turnThink: '本轮思考',
        turnWrite: '本轮写入',
        quotaTitle: '多模型配额池',
        refreshQuota: '刷新配额',
        quotaLoading: '正在读取模型配额...',
        quotaEmpty: '暂未检测到活跃配额接口（请确认 Antigravity 后台语言服务已就绪）。',
        quotaPaygo: '当前为 Google Cloud 按量计费（Pay-as-you-go），无固定周期配额限制。',
        activePool: '当前',
        fiveHours: '5 小时',
        weekly: '每周',
        soon: '即将重置',
        usageTitle: 'Token 用量与模型统计',
        usageCollapsedHint: '展开按需扫描',
        usageScanning: '扫描本地库中...',
        usageScopeNote: '只读统计本机留存对话，不落盘且不写入 WAL',
        scopeConv: '当前对话',
        scopeAll: '全部对话（全量统计）',
        scopeHistoryGroup: '指定具体对话',
        metricNet: '净耗',
        metricTotal: '总量',
        metricReqs: '次数',
        scanNowShort: '↻',
        daily: '每日',
        weeklyUnit: '每周',
        scanNow: '重新扫描',
        today: '今日',
        thisWeek: '本周',
        thisMonth: '本月',
        allTime: '累计',
        uncached: '非缓存',
        cacheRead: '缓存读',
        cacheWrite: '缓存写',
        output: '输出',
        netTok: '净耗',
        totalTok: '总量',
        hitPctLabel: '命中率',
        less: '少',
        more: '多',
        requests: '{n} 次请求',
        since: '始于 {date}',
        usageEmpty: '当前范围暂无用量记录。',
        usageUnread: '注：有 {n} 个正在写入的库本轮跳过。',
        byModelTitle: '按模型系列统计',
        unit5h: '5h',
        unitDay: '日',
        unit3d: '3日',
        unitWeek: '周',
        unitMonth: '月',
        backToday: '今',
        viewPools: '按配额池',
        viewConvs: '按对话',
        heatTitle: '53 周活跃热力图',
        heatHint: '点击格子可直接跳转到该日用量',
        heatHintWeek: '点击格子可直接跳转到该周用量',
        drillTo5h: '进入 5h →',
        drillToDay: '进入日 →',
        drillToWeek: '进入周 →',
        barDetailIdle: '单击柱子查看该时段明细',
        jumpLatestActive: '跳到最近活跃日 ({date}) →',
        switchToAllChats: '查看全部对话',
        poolGroupFmt: '{name} 池',
        poolOther: '其他',
        convUsageCount: '对话总请求',
        tiersLabel: '档位',
        otherModels: '其他模型',
        unknownModel: '未知模型',
        noneInRange: '该时段暂无用量记录。',
        prefsTitle: '提醒阈值设置',
        cacheWarnMin: '缓存变黄 (分钟)',
        cacheColdMin: '缓存变红 (分钟)',
        queueWarnSec: '首字等待 (秒)',
        cachedLabel: '缓存',
        cacheFresh: '新鲜',
        cacheWarn: '临近失效',
        cacheCold: '可能已冷',
        stateRunning: '生成中',
        stateQueued: '排队中',
        stateCompleted: '已完成',
        stateInterrupted: '已中断',
        stateFailed: '失败',
        stateUnknown: '待机',
        waitHeading: '首字等待超时',
        waitDetail: '本轮已有 {c} 段等待达 {s}s',
        waitLive: '当前已等 {s}s',
        errTitle: '请求失败',
        err_quota_exhausted: '额度耗尽',
        err_rate_limited: '429 限流',
        err_request_timeout: '请求超时',
        err_network_error: '连接断开',
        err_context_overflow: '上下文超限',
        err_auth_error: '认证异常',
        err_service_unavailable: '服务繁忙',
        err_canceled: '已取消',
        err_unknown: '请求异常',
        detail_quota_exhausted: '模型返回配额耗尽，请切换可用模型或等待配额重置。',
        detail_rate_limited: '触发请求频率限制，请稍候重试。',
        detail_request_timeout: '本次模型请求超时，后续重试或本轮可能继续。',
        detail_network_error: '与模型服务连接断开，请检查网络或代理设置。',
        detail_context_overflow: '输入上下文超出模型最大窗口上限，建议开启新对话或压缩。',
        detail_auth_error: '账号认证或权限检查失败，请核实登录状态。',
        detail_service_unavailable: '模型后端暂不可用或负载过高，请稍后重试。',
        detail_unknown: '模型请求失败，未匹配到已知错误分类。',
        retryAfter: '服务端建议等待 {s}s'
      },
      en: {
        tabTelemetry: 'Telemetry',
        tabAccounts: 'Accounts',
        tabDart: 'Guard',
        ctxTitle: 'Live Context Breakdown',
        turn0: 'Turn0',
        read: 'Read',
        think: 'Think',
        write: 'Write',
        speedTurnTitle: 'Generation Speed & Current Turn',
        turnElapsed: 'Elapsed',
        turnReqs: 'Requests',
        turnThink: 'Think',
        turnWrite: 'Write',
        quotaTitle: 'Model Quotas',
        refreshQuota: 'Refresh',
        quotaLoading: 'Loading quotas...',
        quotaEmpty: 'No active Language Server quota endpoint detected.',
        quotaPaygo: 'Google Cloud Pay-as-you-go billing active (no fixed quota windows).',
        activePool: 'Active',
        fiveHours: '5 Hours',
        weekly: 'Weekly',
        soon: 'soon',
        usageTitle: 'Token Usage & Model Analytics',
        usageCollapsedHint: 'Expand to scan',
        usageScanning: 'Scanning DBs...',
        usageScopeNote: 'Read-only scan of local conversations; zero disk writes',
        scopeConv: 'Current Chat',
        scopeAll: 'All Chats (Total)',
        scopeHistoryGroup: 'Specific Conversations',
        metricNet: 'Net',
        metricTotal: 'Total',
        metricReqs: 'Reqs',
        scanNowShort: '↻',
        daily: 'Daily',
        weeklyUnit: 'Weekly',
        scanNow: 'Rescan',
        today: 'Today',
        thisWeek: 'This week',
        thisMonth: 'This month',
        allTime: 'All time',
        uncached: 'Uncached',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        output: 'Output',
        netTok: 'Net',
        totalTok: 'Total',
        hitPctLabel: 'Hit Rate',
        less: 'Less',
        more: 'More',
        requests: '{n} reqs',
        since: 'Since {date}',
        usageEmpty: 'No usage records in current scope yet.',
        usageUnread: '{n} busy file(s) skipped this pass.',
        byModelTitle: 'Usage by Model Family',
        unit5h: '5h',
        unitDay: '1D',
        unit3d: '3D',
        unitWeek: '1W',
        unitMonth: '1M',
        backToday: 'Now',
        viewPools: 'By Pool',
        viewConvs: 'By Chat',
        heatTitle: '53-Week Activity Heatmap',
        heatHint: 'Click a cell to jump to that day',
        heatHintWeek: 'Click a cell to jump to that week',
        drillTo5h: 'View 5h →',
        drillToDay: 'View day →',
        drillToWeek: 'View week →',
        barDetailIdle: 'Click a bar to view details',
        jumpLatestActive: 'Jump to latest active ({date}) →',
        switchToAllChats: 'View all chats',
        poolGroupFmt: '{name} Pool',
        poolOther: 'Other',
        convUsageCount: 'Chat Reqs',
        tiersLabel: 'Tiers',
        otherModels: 'Other models',
        unknownModel: 'Unknown model',
        noneInRange: 'No usage in this period.',
        prefsTitle: 'Alert Thresholds',
        cacheWarnMin: 'Cache yellow (min)',
        cacheColdMin: 'Cache red (min)',
        queueWarnSec: 'First-token wait (s)',
        cachedLabel: 'Cached',
        cacheFresh: 'Fresh',
        cacheWarn: 'Expiring',
        cacheCold: 'Cold',
        stateRunning: 'Running',
        stateQueued: 'Queued',
        stateCompleted: 'Done',
        stateInterrupted: 'Stopped',
        stateFailed: 'Failed',
        stateUnknown: 'Idle',
        waitHeading: 'Slow First-Token Wait',
        waitDetail: '{c} wait(s) reached {s}s this turn',
        waitLive: 'waiting {s}s',
        errTitle: 'Request Failure',
        err_quota_exhausted: 'Quota exhausted',
        err_rate_limited: 'Rate limited (429)',
        err_request_timeout: 'Timed out',
        err_network_error: 'Disconnected',
        err_context_overflow: 'Context overflow',
        err_auth_error: 'Auth error',
        err_service_unavailable: 'Service busy',
        err_canceled: 'Canceled',
        err_unknown: 'Request error',
        detail_quota_exhausted: 'Quota exhausted for this model. Switch model or wait for reset.',
        detail_rate_limited: 'Rate limited by upstream API. Retry shortly.',
        detail_request_timeout: 'Model request timed out.',
        detail_network_error: 'Connection dropped during model request.',
        detail_context_overflow: 'Prompt exceeded the model context limit.',
        detail_auth_error: 'Authentication or permission check failed.',
        detail_service_unavailable: 'Model backend temporarily unavailable.',
        detail_unknown: 'Model request failed with unclassified error.',
        retryAfter: 'Retry in {s}s'
      }
    };

    const PALETTE = ['#5f82a8', '#a87158', '#558f7c', '#9f8858', '#8672a3', '#a66b74'];
    const VALID_PERIODS = new Set(['5h', 'day', '3d', 'week', 'month']);
    const PAREN_TIER_RE = /^(.*?)\s*\((?:thinking[\s,/-]+)?(off|minimal|low|medium|high|xhigh|extra|max)(?:\s+thinking)?\)$/i;
    const PAREN_THINK_RE = /^(.*?)\s*\((thinking)\)$/i;
    const SLUG_TIER_RE = /^([^\s()]+?)(?:-thinking)?-(off|minimal|low|medium|high|xhigh|extra|max)(?:-thinking)?$/i;
    const SLUG_THINK_RE = /^([^\s()]+)-(thinking)$/i;
    const SLUG_VARIANT_RE = /^([^\s()]+?)-(n|tiered)$/i;

    const initUi = (window.__AGY_IDE_INIT__ && window.__AGY_IDE_INIT__.capsuleUiState) || {};
    let syncingUiState = false;
    let usageQuerySeq = 0;
    const state = {
      snapshot: null,
      quota: null,
      usage: null,
      usageOpen: Boolean(initUi.usageOpen),
      usageScope: initUi.usageScope === 'all' ? 'all' : 'conversation',
      pinnedConvId: '',
      usageMetric: ['net', 'total', 'requests'].includes(initUi.usageMetric) ? initUi.usageMetric : 'net',
      modelPeriod: VALID_PERIODS.has(initUi.modelPeriod) ? initUi.modelPeriod : 'day',
      modelShift: 0,
      anchorDate: '',
      anchorEndMs: 0,
      pendingSelectDay: '',
      selectedBarIdx: null,
      focusedFamilyKey: '',
      expandedFamilies: new Set(),
      heatOpen: Boolean(initUi.heatOpen),
      heatScale: initUi.heatScale === 'week' ? 'week' : 'day',
      prefs: (window.__AGY_IDE_INIT__ && window.__AGY_IDE_INIT__.capsulePrefs) || {
        cacheWarnMin: 3,
        cacheColdMin: 4,
        queueWarnSec: 30
      }
    };

    function currentScopeSelectValue() {
      if (state.usageScope === 'all') return '__all__';
      if (state.pinnedConvId) return 'conv:' + state.pinnedConvId;
      return '__active__';
    }

    function persistUiState() {
      if (window.__agyIdeBridge && typeof window.__agyIdeBridge.saveCapsuleUiState === 'function') {
        window.__agyIdeBridge.saveCapsuleUiState({
          usageOpen: state.usageOpen,
          usageScope: state.usageScope,
          usageMetric: state.usageMetric,
          modelPeriod: state.modelPeriod,
          heatOpen: state.heatOpen,
          heatScale: state.heatScale
        });
      }
    }

    let openScopeSlot = '';

    function closeAllScopeDropdowns() {
      openScopeSlot = '';
      for (const slot of ['top', 'model']) {
        const dd = document.getElementById('cap-scope-select-' + slot);
        const btn = document.getElementById('cap-scope-btn-' + slot);
        const menu = document.getElementById('cap-scope-menu-' + slot);
        if (dd) {
          dd.classList.remove('is-open');
          dd.classList.remove('is-dropup');
        }
        if (btn && typeof btn.setAttribute === 'function') btn.setAttribute('aria-expanded', 'false');
        if (menu) menu.classList.add('hidden');
      }
    }

    function syncScopeSelectOptions(data) {
      const slots = ['top', 'model'];
      const activeTitle = (data && data.activeConversationTitle) || (data && data.scope === 'conversation' && !state.pinnedConvId ? data.conversationTitle : '') || '';
      const activeLabel = '● ' + tc('scopeConv') + (activeTitle ? ' · ' + activeTitle : '');
      const allLabel = '◎ ' + tc('scopeAll');
      const opts = Array.isArray(data && data.conversationOptions) ? data.conversationOptions : [];
      const today = localDay();
      const desiredVal = currentScopeSelectValue();

      let triggerText = activeLabel;
      if (desiredVal === '__all__') {
        triggerText = allLabel;
      } else if (desiredVal.startsWith('conv:')) {
        const cid = desiredVal.slice(5);
        const found = opts.find((c) => c.conversationId === cid);
        const title = (found && found.title) || (data && data.conversationTitle) || cid.slice(0, 8);
        triggerText = '◆ ' + title;
      }

      const renderOpt = (val, title, meta) => {
        const isSel = val === desiredVal;
        return '<button type="button" role="option" aria-selected="' + (isSel ? 'true' : 'false') + '" class="cap-scope-opt' + (isSel ? ' is-selected' : '') + '" data-value="' + esc(val) + '" onclick="window.__agyCapsuleUi.pickScopeOption(\'' + safeJsArg(val) + '\', event)">' +
          '<span class="cap-scope-opt-title" title="' + esc(title) + '">' + esc(title) + '</span>' +
          (meta ? '<span class="cap-scope-opt-meta">' + esc(meta) + '</span>' : '') +
          (isSel ? '<span class="cap-scope-opt-check">✓</span>' : '') +
        '</button>';
      };

      const pinnedHtml = '<div class="cap-scope-pinned">' +
        renderOpt('__active__', activeLabel, '') +
        renderOpt('__all__', allLabel, '') +
      '</div>';

      let scrollItemsHtml = '';
      if (opts.length > 0) {
        scrollItemsHtml = opts.map((c) => {
          const val = 'conv:' + c.conversationId;
          const dateTag = c.latestDay === today ? tc('today') : (c.latestDay ? c.latestDay.slice(5) : '');
          const meta = [fmtTok(c.net), dateTag].filter(Boolean).join(' · ');
          return renderOpt(val, c.title || c.conversationId.slice(0, 8), meta);
        }).join('');
      } else if (state.pinnedConvId) {
        const pinnedTitle = (data && data.conversationTitle) || state.pinnedConvId.slice(0, 8);
        scrollItemsHtml = renderOpt('conv:' + state.pinnedConvId, pinnedTitle, '');
      }

      const scrollHtml = scrollItemsHtml
        ? '<div class="cap-scope-scroll custom-scrollbar"><div class="cap-scope-group-lbl">' + esc(tc('scopeHistoryGroup')) + '</div>' + scrollItemsHtml + '</div>'
        : '';

      const menuHtml = pinnedHtml + scrollHtml;

      for (const slot of slots) {
        const dd = document.getElementById('cap-scope-select-' + slot);
        const lbl = document.getElementById('cap-scope-label-' + slot);
        const menu = document.getElementById('cap-scope-menu-' + slot);
        if (dd) {
          dd.value = desiredVal;
          if (typeof dd.setAttribute === 'function') dd.setAttribute('data-value', desiredVal);
        }
        if (lbl) lbl.textContent = triggerText;
        if (menu) menu.innerHTML = menuHtml;
      }
    }

    function syncUiStateControls() {
      syncingUiState = true;
      try {
        const usageAcc = document.getElementById('cap-usage-accordion');
        if (usageAcc && Boolean(usageAcc.open) !== Boolean(state.usageOpen)) {
          usageAcc.open = Boolean(state.usageOpen);
        }
        const heatAcc = document.getElementById('cap-heat-accordion');
        if (heatAcc && Boolean(heatAcc.open) !== Boolean(state.heatOpen)) {
          heatAcc.open = Boolean(state.heatOpen);
        }

        syncScopeSelectOptions(state.usage);

        const mMap = { net: 'cap-metric-net', total: 'cap-metric-total', requests: 'cap-metric-reqs' };
        for (const [m, id] of Object.entries(mMap)) {
          const btn = document.getElementById(id);
          if (btn) btn.className = state.usageMetric === m ? 'seg-btn is-active' : 'seg-btn';
        }

        for (const p of ['5h', 'day', '3d', 'week', 'month']) {
          const btn = document.getElementById('cap-period-' + p);
          if (btn) btn.className = state.modelPeriod === p ? 'seg-btn is-active' : 'seg-btn';
        }

        const dayBtn = document.getElementById('cap-heat-day-btn');
        const weekBtn = document.getElementById('cap-heat-week-btn');
        if (dayBtn) dayBtn.className = state.heatScale === 'day' ? 'seg-btn is-active' : 'seg-btn';
        if (weekBtn) weekBtn.className = state.heatScale === 'week' ? 'seg-btn is-active' : 'seg-btn';
      } finally {
        syncingUiState = false;
      }
    }

    function tc(key, vars) {
      const lang = window.__AGY_IDE_STATE__?.lang === 'en' ? 'en' : 'zh';
      let s = CAP_I18N[lang][key] || CAP_I18N.en[key] || key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll('{' + k + '}', String(v ?? ''));
        }
      }
      return s;
    }

    function esc(v) {
      return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function fmtTok(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
      const n = Math.max(0, Number(value));
      if (n < 1000) return String(Math.round(n));
      const k = Math.round(n / 100) / 10;
      if (k < 100) return k.toFixed(1) + 'K';
      const kInt = Math.round(n / 1000);
      if (kInt < 1000) return kInt + 'K';
      const m = Math.round(n / 100000) / 10;
      return m >= 100 ? Math.round(n / 1000000) + 'M' : m.toFixed(1) + 'M';
    }

    function fmtDur(value) {
      if (!Number.isFinite(value) || value < 0) return '—';
      const sec = Math.floor(value);
      if (sec < 60) return sec + 's';
      const m = Math.floor(sec / 60);
      if (m < 10) return sec % 60 ? m + 'm' + (sec % 60) + 's' : m + 'm';
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return h < 10 && rm ? h + 'h' + rm + 'm' : h + 'h';
    }

    function fmtReset(iso) {
      if (!iso) return '';
      const diff = new Date(iso).getTime() - Date.now();
      if (!Number.isFinite(diff)) return '';
      if (diff <= 0) return tc('soon');
      const totalMin = Math.floor(diff / 60000);
      const d = Math.floor(totalMin / 1440);
      const h = Math.floor((totalMin % 1440) / 60);
      const m = totalMin % 60;
      if (d > 0) return d + 'd ' + String(h).padStart(2, '0') + 'h';
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
      return Math.max(1, m) + 'm';
    }

    function applyTranslations() {
      document.querySelectorAll('[data-cap-i18n]').forEach((el) => {
        const k = el.getAttribute('data-cap-i18n');
        if (k) el.textContent = tc(k);
      });
      const wkBtn = document.getElementById('cap-heat-week-btn');
      if (wkBtn) wkBtn.textContent = tc('weeklyUnit');
      renderSnapshot();
      renderQuota();
      if (state.usage) renderUsage();
    }

    function syncPrefsInputs() {
      const w = document.getElementById('cap-pref-warn-min');
      const c = document.getElementById('cap-pref-cold-min');
      const q = document.getElementById('cap-pref-queue-sec');
      if (w) w.value = String(state.prefs.cacheWarnMin || 3);
      if (c) c.value = String(state.prefs.cacheColdMin || 4);
      if (q) q.value = String(state.prefs.queueWarnSec || 30);
    }

    function renderLiveTick() {
      const snap = state.snapshot;
      if (!snap) return;
      const nowMs = Date.now();

      // 1. 缓存时钟实时计算
      const cacheBadge = document.getElementById('cap-cache-badge');
      if (cacheBadge) {
        const ctx = Number(snap.contextTokens || 0);
        const cached = Number(snap.cachedIn || 0);
        const hitPct = ctx > 0 ? Math.round((cached / ctx) * 100) : 0;
        const warnSec = (Number(state.prefs.cacheWarnMin) || 3) * 60;
        const coldSec = Math.max(warnSec + 60, (Number(state.prefs.cacheColdMin) || 4) * 60);
        const ts = Number(snap.lastStepEpochMs || 0);
        const ageSec = ctx > 0 && ts > 0 ? Math.max(0, Math.floor((nowMs - ts) / 1000)) : null;

        if (ctx <= 0) {
          cacheBadge.className = 'meta-tag';
          cacheBadge.textContent = tc('cachedLabel') + ': --';
        } else if (ageSec !== null && ageSec >= coldSec) {
          cacheBadge.className = 'meta-tag is-danger';
          cacheBadge.textContent = '○ ' + tc('cachedLabel') + ' ' + hitPct + '% · ' + tc('cacheCold') + ' (' + fmtDur(ageSec) + ')';
        } else if (ageSec !== null && ageSec >= warnSec) {
          cacheBadge.className = 'meta-tag is-warn';
          cacheBadge.textContent = '◐ ' + tc('cachedLabel') + ' ' + hitPct + '% · ' + tc('cacheWarn') + ' (' + fmtDur(ageSec) + ')';
        } else {
          cacheBadge.className = 'meta-tag is-ok';
          cacheBadge.textContent = '● ' + tc('cachedLabel') + ' ' + hitPct + '% · ' + (ageSec !== null ? fmtDur(ageSec) : tc('cacheFresh'));
        }
      }

      // 2. 运行中本轮耗时实时跳秒 & 首字等待倒计时
      const tm = snap.turnMetrics;
      const elapsedEl = document.getElementById('cap-turn-elapsed');
      if (elapsedEl && tm) {
        let rawDur = tm.duration;
        if ((tm.state === 'running' || tm.state === 'queued' || tm.state === 'unknown') && tm.startedAtMs > 0 && !tm.endedAtMs) {
          rawDur = nowMs >= tm.startedAtMs ? (nowMs - tm.startedAtMs) / 1000 : null;
        }
        elapsedEl.textContent = fmtDur(rawDur);
      }

      // 3. 速度圆点 15s 冷却
      const dotEl = document.getElementById('cap-speed-dot');
      if (dotEl) {
        const running = Boolean(snap.turnSpeed?.hasActiveStep);
        const gen = snap.turnSpeed?.generation || snap.generation;
        const tps = gen?.tps;
        const completedAt = Number(snap.turnSpeed?.completedAtMs || 0);
        if (running) {
          dotEl.className = 'cap-speed-dot is-running';
        } else if (tps !== null && tps !== undefined && (completedAt === 0 || nowMs - completedAt <= 15000)) {
          dotEl.className = tps >= 25 ? 'cap-speed-dot is-fast' : tps >= 10 ? 'cap-speed-dot is-mid' : 'cap-speed-dot is-slow';
        } else {
          dotEl.className = 'cap-speed-dot';
        }
      }

      renderAlerts();
    }

    function renderAlerts() {
      const snap = state.snapshot;
      const banner = document.getElementById('cap-alert-banner');
      const tabDot = document.getElementById('ide-tab-dot-capsule');
      if (!banner) return;

      if (!snap) {
        banner.classList.add('hidden');
        if (tabDot) tabDot.className = 'tab-dot is-muted';
        return;
      }

      const headingEl = document.getElementById('cap-alert-heading');
      const badgeEl = document.getElementById('cap-alert-badge');
      const detailEl = document.getElementById('cap-alert-detail');
      const diagEl = document.getElementById('cap-alert-diag');

      const kind = snap.requestError?.kind || 'none';
      const hasErr = ['quota_exhausted', 'rate_limited', 'request_timeout', 'network_error', 'context_overflow', 'auth_error', 'service_unavailable', 'unknown'].includes(kind);

      if (hasErr) {
        banner.className = 'cap-alert-banner is-error';
        if (headingEl) headingEl.textContent = tc('errTitle') + ' · ' + tc('err_' + kind);
        const waitSec = snap.requestError?.retryAfterSec;
        if (badgeEl) badgeEl.textContent = typeof waitSec === 'number' ? tc('retryAfter', { s: waitSec }) : '';
        if (detailEl) detailEl.textContent = tc('detail_' + kind);
        const diag = snap.requestError?.diagnostic || '';
        if (diagEl) {
          if (diag) {
            diagEl.textContent = diag;
            diagEl.classList.remove('hidden');
          } else {
            diagEl.classList.add('hidden');
          }
        }
        if (tabDot) tabDot.className = 'tab-dot is-danger';
        return;
      }

      const thresholdSec = Math.max(1, Number(state.prefs.queueWarnSec) || 30);
      const tq = snap.turnQueue;
      const slowWaits = Array.isArray(tq?.waits) ? tq.waits.filter((v) => Number.isFinite(v) && v >= thresholdSec) : [];
      const running = Boolean(snap.turnSpeed?.hasActiveStep);
      const canLiveWait = Boolean(tq && !tq.turnTerminal && Number.isFinite(tq.waitingSinceMs) && tq.waitingSinceMs > 0 && (running || tq.hasPendingPlanner));
      const liveWaitSec = canLiveWait ? Math.max(0, (Date.now() - tq.waitingSinceMs) / 1000) : 0;
      const liveExceeded = canLiveWait && liveWaitSec >= thresholdSec;
      const queueCount = slowWaits.length + (liveExceeded ? 1 : 0);

      if (queueCount > 0) {
        banner.className = 'cap-alert-banner is-warn';
        if (headingEl) headingEl.textContent = tc('waitHeading') + (queueCount > 1 ? ' ×' + queueCount : '');
        if (badgeEl) badgeEl.textContent = liveExceeded ? tc('waitLive', { s: Math.floor(liveWaitSec) }) : '';
        if (detailEl) detailEl.textContent = tc('waitDetail', { c: queueCount, s: thresholdSec });
        if (diagEl) diagEl.classList.add('hidden');
        if (tabDot) tabDot.className = 'tab-dot is-warn';
        return;
      }

      banner.classList.add('hidden');
      if (tabDot) {
        const ratio = snap.maxContextTokens > 0 ? snap.contextTokens / snap.maxContextTokens : 0;
        tabDot.className = ratio >= 0.9 ? 'tab-dot is-danger' : ratio >= 0.75 ? 'tab-dot is-warn' : 'tab-dot';
      }
    }

    function renderSnapshot() {
      const snap = state.snapshot;
      const pctEl = document.getElementById('cap-ctx-pct');
      const fracEl = document.getElementById('cap-ctx-frac');
      const modelChip = document.getElementById('cap-model-chip');
      if (!snap) return;

      const ctx = Number(snap.contextTokens || 0);
      const maxCtx = Number(snap.maxContextTokens || 0);
      const hasMax = maxCtx > 0;
      const ratio = hasMax ? ctx / maxCtx : 0;
      const usedPct = hasMax ? Math.round(ratio * 100) + '%' : (ctx === 0 ? '0%' : '--%');

      if (pctEl) {
        pctEl.textContent = usedPct;
        pctEl.className = 'cap-ctx-pct' + (ratio >= 0.9 ? ' is-danger' : ratio >= 0.75 ? ' is-warn' : '');
      }
      if (fracEl) {
        fracEl.textContent = fmtTok(ctx) + ' / ' + (hasMax ? fmtTok(maxCtx) : '--');
      }
      if (modelChip) {
        if (snap.activeModel) {
          modelChip.textContent = snap.activeModel;
          modelChip.classList.remove('hidden');
        } else {
          modelChip.classList.add('hidden');
        }
      }

      const turn0 = Number(snap.turn0Tokens || 0);
      const out = Number(snap.totalOutputTokens || 0);
      const think = Number(snap.totalThinkingTokens || 0);
      const read = Math.max(0, ctx - turn0 - out - think);
      const usedExact = hasMax ? Math.min(100, ratio * 100) : 100;
      const compSum = turn0 + read + think + out;
      const scale = compSum > 0 ? usedExact / compSum : 0;
      const fmtSegPct = (val) => (hasMax ? Math.round((val / maxCtx) * 100) + '%' : (compSum > 0 ? Math.round((val / compSum) * 100) + '%' : '--%'));

      document.getElementById('cap-seg-turn0').style.width = (turn0 * scale).toFixed(2) + '%';
      document.getElementById('cap-seg-read').style.width = (read * scale).toFixed(2) + '%';
      document.getElementById('cap-seg-think').style.width = (think * scale).toFixed(2) + '%';
      document.getElementById('cap-seg-write').style.width = (out * scale).toFixed(2) + '%';

      document.getElementById('cap-val-turn0').textContent = fmtTok(turn0);
      document.getElementById('cap-pct-turn0').textContent = fmtSegPct(turn0);
      document.getElementById('cap-val-read').textContent = fmtTok(read);
      document.getElementById('cap-pct-read').textContent = fmtSegPct(read);
      document.getElementById('cap-val-think').textContent = fmtTok(think);
      document.getElementById('cap-pct-think').textContent = fmtSegPct(think);
      document.getElementById('cap-val-write').textContent = fmtTok(out);
      document.getElementById('cap-pct-write').textContent = fmtSegPct(out);

      // 最近请求速度
      const gen = snap.turnSpeed?.generation || snap.generation;
      const speedValEl = document.getElementById('cap-speed-val');
      const timingEl = document.getElementById('cap-req-timing');
      const outEl = document.getElementById('cap-req-output');
      if (speedValEl) {
        speedValEl.textContent = gen?.tps != null ? gen.tps.toFixed(1) + ' tok/s' : '-- tok/s';
      }
      if (timingEl) {
        const ttft = gen?.ttft != null ? gen.ttft.toFixed(1) + 's' : '--';
        const dur = gen?.duration != null ? gen.duration.toFixed(1) + 's' : '--';
        timingEl.textContent = ttft + '–' + dur;
      }
      if (outEl) {
        outEl.textContent = fmtTok(gen?.output) + ' tok';
      }

      // 本轮统计
      const tm = snap.turnMetrics;
      const stateTag = document.getElementById('cap-turn-state-tag');
      if (stateTag) {
        const st = tm?.state || 'unknown';
        const keyMap = { running: 'stateRunning', queued: 'stateQueued', completed: 'stateCompleted', interrupted: 'stateInterrupted', failed: 'stateFailed' };
        stateTag.textContent = tc(keyMap[st] || 'stateUnknown');
        stateTag.className = 'meta-tag' + (st === 'failed' ? ' is-danger' : st === 'running' ? ' is-info' : st === 'completed' ? ' is-ok' : '');
      }
      document.getElementById('cap-turn-reqs').textContent = tm?.requestCount != null ? String(tm.requestCount) : (tm?.knownRequestCount != null ? String(tm.knownRequestCount) : '--');
      document.getElementById('cap-turn-think').textContent = fmtTok(tm?.thinking);
      document.getElementById('cap-turn-write').textContent = fmtTok(tm?.write);

      renderLiveTick();
    }

    function quotaColor(frac) {
      const pct = Math.round(Math.max(0, Math.min(1, Number(frac || 0))) * 100);
      return pct <= 10 ? 'var(--danger)' : pct <= 25 ? 'var(--warn)' : 'var(--ok)';
    }

    const QUOTA_STOP_WORDS = new Set(['gemini', 'model', 'models', 'and', 'the', 'for', 'pro', 'plan', 'plans', 'quota', 'limit']);
    const QUOTA_KEYWORDS = ['carbon', 'argon', 'neon', 'hydrogen', 'flash', 'claude', 'sonnet', 'opus', 'haiku', 'gpt'];

    function stripQuotaThinkingTier(modelName) {
      return String(modelName || '')
        .trim()
        .replace(/\s*\((?:thinking[\s,/-]+)?(?:off|minimal|low|medium|high|xhigh|extra(?:\s+high)?|max)(?:\s+thinking)?\)\s*$/i, '')
        .replace(/\s*\(thinking\)\s*$/i, '')
        .trim();
    }

    function extractQuotaModels(description) {
      const m = String(description || '').match(/models within this group:\s*([^\n]+?)(?:\.(?:\s|$)|$)/im);
      if (!m) return { list: [], text: '' };
      const list = m[1].split(/\s*,\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      return { list, text: list.join(', ') };
    }

    function normalizeQuotaToken(val) {
      return String(val || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    }

    function matchQuotaGroupClient(groups, activeModel, fallbackModel) {
      if (!Array.isArray(groups) || groups.length === 0) return null;
      const modelText = String(activeModel || fallbackModel || '').trim();
      const mt = modelText.toLowerCase();
      const baseMt = stripQuotaThinkingTier(modelText).toLowerCase();
      const mtNorm = normalizeQuotaToken(modelText);
      const baseMtNorm = normalizeQuotaToken(baseMt);

      const meta = groups.map((group) => {
        const rawName = String(group?.displayName || '').trim().toLowerCase();
        const isGenericGemini = rawName === 'gemini models' || rawName === 'gemini';
        const parsed = extractQuotaModels(group?.description || '');
        const bucketIds = (Array.isArray(group?.buckets) ? group.buckets : [])
          .map((b) => String(b?.bucketId || '').toLowerCase())
          .join(' ');
        return { group, rawName, isGenericGemini, modelsList: parsed.list, modelsText: parsed.text, bucketIds };
      });

      if (mt) {
        let bestEntryGroup = null;
        let bestEntryLen = -1;
        for (const item of meta) {
          for (const entry of item.modelsList) {
            if (entry.length < 3) continue;
            const entryNorm = normalizeQuotaToken(entry);
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

        const isThirdParty = /claude|sonnet|opus|haiku|gpt|openai/.test(mt);
        for (const item of meta) {
          if (item.isGenericGemini) continue;
          if ((item.rawName.includes('claude') || item.rawName.includes('gpt') || item.bucketIds.includes('3p')) && isThirdParty) {
            return item.group;
          }
          const tokens = item.rawName.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !QUOTA_STOP_WORDS.has(t));
          if (tokens.some((t) => mt.includes(t) || mtNorm.includes(t))) {
            return item.group;
          }
        }

        const activeKeys = QUOTA_KEYWORDS.filter((k) => mt.includes(k));
        if (activeKeys.length > 0) {
          const descMatched = meta.find((item) => activeKeys.some((k) => item.modelsText && item.modelsText.includes(k)));
          if (descMatched) return descMatched.group;
        }

        if (isThirdParty) {
          const pool3p = meta.find((item) => item.rawName.includes('claude') || item.rawName.includes('gpt') || item.bucketIds.includes('3p'));
          if (pool3p) return pool3p.group;
        }
        if (/gemini|neon|hydrogen|flash/.test(mt)) {
          const gemPool = meta.find(
            (item) => item.isGenericGemini || (item.rawName.includes('gemini') && !item.rawName.includes('argon') && !item.rawName.includes('carbon'))
          );
          if (gemPool) return gemPool.group;
        }
      }

      return meta.find((item) => item.isGenericGemini)?.group || groups[0];
    }

    function renderQuota() {
      const listEl = document.getElementById('cap-quota-list');
      const tierEl = document.getElementById('cap-tier-badge');
      if (!listEl) return;
      const q = state.quota;
      if (!q) return;

      if (tierEl) {
        if (q.userTierName) {
          tierEl.textContent = q.userTierName;
          tierEl.classList.remove('hidden');
        } else {
          tierEl.classList.add('hidden');
        }
      }

      const groups = Array.isArray(q.quotaGroups) ? q.quotaGroups : [];
      if (groups.length === 0) {
        listEl.innerHTML = '<div class="muted-note">' + esc(q.cloudPaygo ? tc('quotaPaygo') : tc('quotaEmpty')) + '</div>';
        return;
      }

      const selectedModel = String(q.selectedModelLabel || '').trim();
      const activeModel = String(state.snapshot?.activeModel || '').trim();
      const primaryModel = selectedModel || activeModel;
      const fallbackModel = String(q.defaultModelLabel || '').trim();
      const matchedGroup = (primaryModel || fallbackModel)
        ? matchQuotaGroupClient(groups, primaryModel, fallbackModel)
        : null;
      listEl.innerHTML = groups.map((g) => {
        const title = String(g.displayName || '').trim();
        const isCurrent = Boolean(matchedGroup && g === matchedGroup);
        const buckets = Array.isArray(g.buckets) ? g.buckets : [];
        const rowsHtml = buckets.map((b) => {
          const label = b.window === '5h' ? tc('fiveHours') : b.window === 'weekly' ? tc('weekly') : (b.displayName || b.window || '');
          const frac = Math.max(0, Math.min(1, Number(b.remainingFraction ?? 0)));
          const pct = Math.round(frac * 100);
          const color = quotaColor(frac);
          const reset = fmtReset(b.resetTime);
          const fullTip = b.resetTime ? new Date(b.resetTime).toLocaleString() : '';
          return '<div class="cap-bucket-row" title="' + esc(fullTip) + '">' +
            '<span class="cap-bucket-label">' + esc(label) + '</span>' +
            '<div class="cap-bucket-track"><div class="cap-bucket-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
            '<span class="cap-bucket-meta">' + pct + '%' + (reset ? ' · ' + esc(reset) : '') + '</span>' +
          '</div>';
        }).join('');
        return '<div class="cap-quota-group ' + (isCurrent ? 'is-current' : '') + '">' +
          '<div class="cap-quota-head"><span>' + esc(title) + '</span>' + (isCurrent ? '<span class="cap-quota-active-tag">● ' + esc(tc('activePool')) + '</span>' : '') + '</div>' +
          rowsHtml +
        '</div>';
      }).join('');
    }

    // 用量日期工具
    const pad2 = (n) => String(n).padStart(2, '0');
    const toDate = (day) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
    const toDay = (d) => d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    const addDays = (day, c) => { const d = toDate(day); d.setUTCDate(d.getUTCDate() + c); return toDay(d); };
    const weekStart = (day) => addDays(day, -((toDate(day).getUTCDay() + 6) % 7));
    const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    const tokensOf = (b) => (b?.uncached || 0) + (b?.cacheRead || 0) + (b?.cacheWrite || 0) + (b?.output || 0);

    function splitModelName(raw) {
      const trimmed = String(raw || '').trim().replace(/^models\//i, '').trim();
      if (!trimmed) return { key: '', family: '', tier: '', isDisplay: false };
      let family = trimmed;
      let tier = '';
      let match = PAREN_TIER_RE.exec(trimmed) || PAREN_THINK_RE.exec(trimmed);
      if (match && match[1].trim()) {
        family = match[1].trim();
        tier = match[2];
      } else if (!/\s/.test(trimmed)) {
        match = SLUG_TIER_RE.exec(trimmed) || SLUG_THINK_RE.exec(trimmed) || SLUG_VARIANT_RE.exec(trimmed);
        if (match && match[1].length >= 2) {
          family = match[1];
          tier = match[2];
        }
      }
      return {
        key: family.toLowerCase().replace(/[\s._-]+/g, '-'),
        family,
        tier,
        isDisplay: /\s|[A-Z]/.test(family)
      };
    }

    function safeJsArg(val) {
      return esc(String(val ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
    }

    function formatPoolShortClient(groupOrName) {
      const raw = String(typeof groupOrName === 'string' ? groupOrName : groupOrName?.displayName || '').trim();
      if (!raw) return tc('poolOther');
      const low = raw.toLowerCase();
      if (low === 'gemini models' || low === 'gemini') return 'Gemini';
      if (low.includes('claude') && low.includes('gpt')) return 'Claude/GPT';
      if (low.includes('claude')) return 'Claude';
      if (low.includes('gpt')) return 'GPT';
      const subMatch = raw.match(/^gemini\s+\d+(?:\.\d+)?\s+([a-z0-9][a-z0-9_-]*)$/i);
      if (subMatch && subMatch[1]) return subMatch[1];
      return raw.replace(/\s+(?:models?|quota|limit)s?$/i, '').trim() || raw;
    }

    function resolveModelPoolName(modelName) {
      const raw = String(modelName || '').trim();
      const groups = Array.isArray(state.quota?.quotaGroups) ? state.quota.quotaGroups : [];
      if (groups.length > 0 && raw) {
        const matched = matchQuotaGroupClient(groups, raw, '');
        if (matched) return formatPoolShortClient(matched);
      }
      const low = raw.toLowerCase();
      if (!low) return tc('poolOther');
      if (low.includes('argon')) return 'Argon';
      if (low.includes('carbon')) return 'Carbon';
      if (/claude|sonnet|opus|haiku|gpt|openai/.test(low)) return 'Claude/GPT';
      if (/gemini|neon|hydrogen|flash|orchestrator/.test(low)) return 'Gemini';
      return tc('poolOther');
    }

    function metricValOf(b, metric = state.usageMetric) {
      if (!b) return 0;
      if (metric === 'requests') return Number(b.requests || 0);
      if (metric === 'total') {
        if (b.total !== undefined && b.total !== null) return Number(b.total || 0);
        return Number(b.uncached || 0) + Number(b.cacheRead || 0) + Number(b.cacheWrite || 0) + Number(b.output || 0);
      }
      if (b.net !== undefined && b.net !== null) return Number(b.net || 0);
      return Number(b.uncached || 0) + Number(b.cacheWrite || 0) + Number(b.output || 0);
    }

    function fmtMetric(val, metric = state.usageMetric) {
      const n = Number(val || 0);
      if (metric === 'requests') {
        return tc('requests', { n: Math.round(n) });
      }
      return fmtTok(n);
    }

    function normalizeLegacyDaysToAnalytics(data) {
      const today = localDay();
      const wk = weekStart(today);
      const mo = today.slice(0, 7);
      const emptyB = () => ({ requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, net: 0, total: 0 });
      const addB = (dst, src) => {
        if (!src) return;
        dst.requests += src.requests || 0;
        dst.uncached += src.uncached || 0;
        dst.cacheRead += src.cacheRead || 0;
        dst.cacheWrite += src.cacheWrite || 0;
        dst.output += src.output || 0;
        dst.net = dst.uncached + dst.cacheWrite + dst.output;
        dst.total = dst.net + dst.cacheRead;
      };
      const kToday = emptyB(), kWeek = emptyB(), kMonth = emptyB(), kAll = emptyB();
      addB(kAll, data.undated);
      const validDays = (data.days || []).filter((d) => !(d.date > today));
      for (const d of validDays) {
        addB(kAll, d);
        if (d.date === today) addB(kToday, d);
        if (d.date >= wk) addB(kWeek, d);
        if (d.date.slice(0, 7) === mo) addB(kMonth, d);
      }
      const byDate = new Map(validDays.map((d) => [d.date, d]));
      const bars = [];
      for (let i = -6; i <= 0; i++) {
        const dt = addDays(today, i);
        const row = byDate.get(dt);
        const b = emptyB();
        addB(b, row);
        bars.push({
          label: Number(dt.slice(5, 7)) + '/' + Number(dt.slice(8)),
          name: dt,
          dayStr: dt,
          drillable: false,
          ...b,
          models: (row?.models || []).map((m) => ({
            ...m,
            net: (m.uncached || 0) + (m.cacheWrite || 0) + (m.output || 0),
            total: (m.uncached || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0) + (m.output || 0)
          }))
        });
      }
      return {
        scope: 'all',
        period: state.modelPeriod,
        rangeLabel: bars[0].dayStr + ' – ' + bars[bars.length - 1].dayStr.slice(5),
        canPrev: false,
        canNext: false,
        isLatest: true,
        kpis: { mode: 'all', today: kToday, week: kWeek, month: kMonth, all: kAll },
        bars,
        conversations: [],
        heatmapDays: validDays.map((d) => ({
          date: d.date,
          requests: d.requests || 0,
          net: (d.uncached || 0) + (d.cacheWrite || 0) + (d.output || 0),
          total: tokensOf(d)
        })),
        sinceDate: validDays[0]?.date || '',
        unread: data.unread || 0,
        scannedFiles: data.scannedFiles || 0
      };
    }

    function renderUsage() {
      const rawData = state.usage;
      const totalsEl = document.getElementById('cap-usage-totals');
      const heatEl = document.getElementById('cap-heat-wrap');
      const footEl = document.getElementById('cap-heat-foot');
      const heatSummaryEl = document.getElementById('cap-heat-summary-right');
      const barsEl = document.getElementById('cap-bars-chart');
      const rowsEl = document.getElementById('cap-model-rows');
      const rangeEl = document.getElementById('cap-bars-range');
      const totalBarEl = document.getElementById('cap-bars-total');
      const badgeEl = document.getElementById('cap-usage-badge');
      const detailBarEl = document.getElementById('cap-bar-detail-bar');

      if (!rawData) return;
      const data = Array.isArray(rawData.bars) ? rawData : normalizeLegacyDaysToAnalytics(rawData);

      if (badgeEl) badgeEl.textContent = (data.scannedFiles || 0) + ' DB';
      syncScopeSelectOptions(data);

      const today = localDay();
      const wk = weekStart(today);
      const metric = state.usageMetric;

      // 1. 4 格 KPI 概览
      if (totalsEl) {
        const makeTip = (b) => {
          const net = metricValOf(b, 'net');
          const tot = metricValOf(b, 'total');
          return tc('netTok') + ' ' + net.toLocaleString() + ' · ' + tc('totalTok') + ' ' + tot.toLocaleString() +
            ' (' + tc('requests', { n: b.requests || 0 }) + ')\n' +
            tc('uncached') + ' ' + (b.uncached || 0).toLocaleString() + ' · ' +
            tc('cacheRead') + ' ' + (b.cacheRead || 0).toLocaleString() + ' · ' +
            tc('cacheWrite') + ' ' + (b.cacheWrite || 0).toLocaleString() + ' · ' +
            tc('output') + ' ' + (b.output || 0).toLocaleString();
        };
        const cell = (lbl, val, tip, extraCls, onClickAttr) =>
          '<div class="cap-usage-total-cell' + (extraCls ? ' ' + extraCls : '') + '" title="' + esc(tip || '') + '"' +
          (onClickAttr ? ' onclick="' + onClickAttr + '"' : '') +
          '><span class="kpi-label">' + esc(lbl) +
          '</span><span class="kpi-value kpi-value-sm">' + esc(val) + '</span></div>';

        const kpis = data.kpis || {};
        if (kpis.mode === 'conversation') {
          const tip = makeTip(kpis);
          totalsEl.innerHTML =
            cell(tc('metricNet'), fmtTok(metricValOf(kpis, 'net')), tip, 'is-clickable' + (metric === 'net' ? ' is-active-kpi' : ''), "window.__agyCapsuleUi.setUsageMetric('net')") +
            cell(tc('metricTotal'), fmtTok(metricValOf(kpis, 'total')), tip, 'is-clickable' + (metric === 'total' ? ' is-active-kpi' : ''), "window.__agyCapsuleUi.setUsageMetric('total')") +
            cell(tc('convUsageCount'), String(kpis.requests || 0), tip, 'is-clickable' + (metric === 'requests' ? ' is-active-kpi' : ''), "window.__agyCapsuleUi.setUsageMetric('requests')") +
            cell(tc('hitPctLabel'), (kpis.cacheHitPct || 0) + '%', tip, '', '');
        } else {
          const td = kpis.today || {};
          const wv = kpis.week || {};
          const mv = kpis.month || {};
          const av = kpis.all || {};
          totalsEl.innerHTML =
            cell(tc('today'), fmtMetric(metricValOf(td, metric), metric), makeTip(td), '', '') +
            cell(tc('thisWeek'), fmtMetric(metricValOf(wv, metric), metric), makeTip(wv), '', '') +
            cell(tc('thisMonth'), fmtMetric(metricValOf(mv, metric), metric), makeTip(mv), '', '') +
            cell(tc('allTime'), fmtMetric(metricValOf(av, metric), metric), makeTip(av), '', '');
        }
      }

      // 2. 收集本窗口内模型系列并分配调色板颜色
      const bars = Array.isArray(data.bars) ? data.bars : [];
      if (state.selectedBarIdx !== null && (state.selectedBarIdx < 0 || state.selectedBarIdx >= bars.length)) {
        state.selectedBarIdx = null;
      }
      const selBar = state.selectedBarIdx !== null ? bars[state.selectedBarIdx] : null;

      const famAggWin = new Map();
      const famLabels = new Map();
      for (const b of bars) {
        for (const m of b.models || []) {
          const p = splitModelName(m.name);
          const v = metricValOf(m, metric);
          famAggWin.set(p.key, (famAggWin.get(p.key) || 0) + v);
          const cur = famLabels.get(p.key);
          if (!cur || (p.isDisplay && !cur.isDisplay) || (p.isDisplay === cur.isDisplay && p.family < cur.family)) {
            famLabels.set(p.key, { name: p.family, isDisplay: p.isDisplay });
          }
        }
      }
      const ranked = [...famAggWin].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([k]) => k);
      const slotOf = new Map(ranked.map((k, i) => [k, Math.min(i, PALETTE.length)]));
      const series = [...PALETTE, 'rgba(142, 142, 147, 0.55)'].map((color, idx) => {
        const key = idx < PALETTE.length ? ranked[idx] : null;
        return { key, color, name: key ? (famLabels.get(key)?.name || key) : tc('otherModels') };
      });
      if (state.focusedFamilyKey && !famAggWin.has(state.focusedFamilyKey)) {
        state.focusedFamilyKey = '';
      }

      // 3. 计算柱图全窗汇总与导航条（始终保持全窗总计稳定不跳动）
      const pageVal = bars.reduce((s, b) => s + metricValOf(b, metric), 0);
      const pageReqs = bars.reduce((s, b) => s + (b.requests || 0), 0);
      const maxBar = Math.max(0, ...bars.map((b) => metricValOf(b, metric)));

      if (rangeEl) {
        rangeEl.textContent = data.rangeLabel || '--';
      }
      if (totalBarEl) {
        totalBarEl.textContent = metric === 'requests'
          ? tc('requests', { n: pageReqs })
          : fmtTok(pageVal) + ' · ' + tc('requests', { n: pageReqs });
      }
      const prevBtn = document.getElementById('cap-shift-prev');
      const nextBtn = document.getElementById('cap-shift-next');
      const todayBtn = document.getElementById('cap-shift-today');
      if (prevBtn) prevBtn.disabled = !data.canPrev;
      if (nextBtn) nextBtn.disabled = !data.canNext;
      if (todayBtn) {
        if (data.isLatest && !state.anchorDate && !state.anchorEndMs) todayBtn.classList.add('hidden');
        else todayBtn.classList.remove('hidden');
      }

      // 4. 渲染柱图正上方常驻固定高度「选中柱详情标题栏」（零上下抖动，无多余取消聚焦提示）
      if (detailBarEl) {
        if (selBar) {
          const sv = metricValOf(selBar, metric);
          const sr = selBar.requests || 0;
          const valText = metric === 'requests'
            ? tc('requests', { n: sr })
            : fmtTok(sv) + ' · ' + tc('requests', { n: sr });
          const fullDesc = '● ' + selBar.name + ' · ' + valText;
          let actionHtml = '';
          if (selBar.drillable) {
            const dKey = selBar.drillTarget === '5h'
              ? 'drillTo5h'
              : (selBar.drillTarget === 'week' ? 'drillToWeek' : 'drillToDay');
            actionHtml = '<button type="button" class="cap-link-btn" onclick="window.__agyCapsuleUi.drillBar(' + state.selectedBarIdx + ')">' + esc(tc(dKey)) + '</button>';
          }
          detailBarEl.className = 'cap-bar-detail-bar is-active';
          detailBarEl.innerHTML =
            '<span class="cap-bar-detail-text" title="' + esc(fullDesc) + '">' + esc(fullDesc) + '</span>' +
            '<span class="cap-bar-detail-actions">' + actionHtml + '</span>';
        } else {
          detailBarEl.className = 'cap-bar-detail-bar';
          detailBarEl.innerHTML =
            '<span class="cap-bar-detail-text">' + esc(tc('barDetailIdle')) + '</span>' +
            '<span class="cap-bar-detail-actions"></span>';
        }
      }

      // 5. 绘制互动柱状图（全量显示每柱下方时间简写，取消双击与悬停预览）
      if (barsEl) {
        const period = data.period || state.modelPeriod;
        const lang = window.__AGY_IDE_STATE__?.lang === 'en' ? 'en' : 'zh';
        const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const curYear = new Date().getFullYear();
        const hasBarSel = state.selectedBarIdx !== null;
        const focusKey = state.focusedFamilyKey;
        const focusIsOverflow = Boolean(focusKey && slotOf.get(focusKey) === PALETTE.length);

        barsEl.innerHTML = bars.map((b, i) => {
          const val = metricValOf(b, metric);
          const hPct = maxBar > 0 ? Math.max(val > 0 ? 4 : 0, Math.round((val / maxBar) * 100)) : 0;
          const parts = series.map(() => 0);
          let focusedVal = 0;
          for (const m of b.models || []) {
            const p = splitModelName(m.name);
            const slot = slotOf.get(p.key);
            const mv = metricValOf(m, metric);
            parts[slot] += mv;
            if (focusKey && p.key === focusKey) focusedVal += mv;
          }

          const isSelected = state.selectedBarIdx === i;
          const isBarDimmed = (hasBarSel && !isSelected) || (!hasBarSel && focusKey && val > 0 && focusedVal <= 0);
          const colCls = 'cap-bar-col is-clickable' + (isSelected ? ' is-selected' : '') + (isBarDimmed ? ' is-dimmed' : '');

          const tipHead = b.name + (val > 0 ? ' · ' + fmtMetric(val, metric) : '');
          const tipLines = val > 0
            ? [tipHead, ...parts.map((pv, slot) => (pv > 0 ? series[slot].name + ': ' + fmtMetric(pv, metric) : '')).filter(Boolean)]
            : [tipHead];

          const stack = val > 0
            ? '<div class="cap-bar-stack" style="height:' + hPct + '%">' +
                parts.map((pv, slot) => {
                  if (pv <= 0) return '';
                  if (focusIsOverflow && slot === PALETTE.length && focusedVal > 0) {
                    const otherOverflow = Math.max(0, pv - focusedVal);
                    const focusSeg = '<i class="cap-bar-seg" style="flex:' + Math.max(1, Math.round((focusedVal / val) * 1000)) + ' 0 0;background:' + series[slot].color + '"></i>';
                    const restSeg = otherOverflow > 0
                      ? '<i class="cap-bar-seg is-dimmed" style="flex:' + Math.max(1, Math.round((otherOverflow / val) * 1000)) + ' 0 0;background:' + series[slot].color + '"></i>'
                      : '';
                    return focusSeg + restSeg;
                  }
                  const segKey = series[slot].key;
                  const segDim = Boolean(focusKey && (segKey !== focusKey));
                  return '<i class="cap-bar-seg' + (segDim ? ' is-dimmed' : '') + '" style="flex:' + Math.max(1, Math.round((pv / val) * 1000)) + ' 0 0;background:' + series[slot].color + '"></i>';
                }).join('') +
              '</div>'
            : '';

          let rawLbl = b.label || '';
          if (period === 'month' && lang === 'en' && b.monthNum >= 1 && b.monthNum <= 12) {
            rawLbl = b.yearNum && b.yearNum !== curYear
              ? String(b.yearNum).slice(2) + '/' + pad2(b.monthNum)
              : enMonths[b.monthNum - 1];
          }
          const xLbl = '<span class="cap-bar-x">' + esc(rawLbl) + '</span>';

          return '<div class="' + colCls + '" title="' + esc(tipLines.join('\n')) + '" onclick="window.__agyCapsuleUi.toggleBarSelect(' + i + ')">' + stack + xLbl + '</div>';
        }).join('');
      }

      // 构造智能空态提示（单柱无记录保持安静；全窗无记录提供跳最近活跃日/切全部对话）
      const buildEmptyUsageHtml = () => {
        if (selBar) {
          return '<div class="muted-note">' + esc(tc('noneInRange')) + '</div>';
        }
        const btns = [];
        const latestDay = typeof data.latestActiveDay === 'string' ? data.latestActiveDay : '';
        if (latestDay) {
          const inCurrentBars = bars.some((b) => b.dayStr === latestDay);
          if (!inCurrentBars) {
            btns.push('<button type="button" class="cap-link-btn" onclick="window.__agyCapsuleUi.jumpToDate(\'' + safeJsArg(latestDay) + '\')">' + esc(tc('jumpLatestActive', { date: latestDay })) + '</button>');
          }
        }
        if (state.usageScope === 'conversation') {
          btns.push('<button type="button" class="cap-link-btn" onclick="window.__agyCapsuleUi.setUsageScope(\'all\')">' + esc(tc('switchToAllChats')) + '</button>');
        }
        if (btns.length === 0) {
          return '<div class="muted-note">' + esc(tc('noneInRange')) + '</div>';
        }
        return '<div class="cap-empty-box"><div class="muted-note">' + esc(tc('noneInRange')) + '</div><div class="cap-empty-actions">' + btns.join('') + '</div></div>';
      };

      // 6. 渲染下方按配额池分组的模型系列明细
      if (rowsEl) {
        const sourceBars = selBar ? [selBar] : bars;
        const famMap = new Map();
        let scopeSumVal = 0;

        for (const b of sourceBars) {
          for (const m of b.models || []) {
            const p = splitModelName(m.name);
            const mv = metricValOf(m, metric);
            scopeSumVal += mv;
            let fam = famMap.get(p.key);
            if (!fam) {
              const slot = slotOf.get(p.key);
              fam = {
                key: p.key,
                displayName: famLabels.get(p.key)?.name || p.family || tc('unknownModel'),
                color: slot !== undefined ? series[slot].color : series[series.length - 1].color,
                requests: 0,
                uncached: 0,
                cacheRead: 0,
                cacheWrite: 0,
                output: 0,
                net: 0,
                total: 0,
                tiers: new Map()
              };
              famMap.set(p.key, fam);
            }
            fam.requests += m.requests || 0;
            fam.uncached += m.uncached || 0;
            fam.cacheRead += m.cacheRead || 0;
            fam.cacheWrite += m.cacheWrite || 0;
            fam.output += m.output || 0;
            fam.net = fam.uncached + fam.cacheWrite + fam.output;
            fam.total = fam.net + fam.cacheRead;

            const tierKey = p.tier || m.name || '-';
            let tb = fam.tiers.get(tierKey);
            if (!tb) {
              tb = { label: p.tier || m.name || '-', requests: 0, net: 0, total: 0 };
              fam.tiers.set(tierKey, tb);
            }
            tb.requests += m.requests || 0;
            tb.net += metricValOf(m, 'net');
            tb.total += metricValOf(m, 'total');
          }
        }

        const activeFams = [...famMap.values()].filter((f) => metricValOf(f, metric) > 0);
        if (activeFams.length === 0) {
          rowsEl.innerHTML = buildEmptyUsageHtml();
        } else {
          const poolMap = new Map();
          for (const f of activeFams) {
            const poolName = resolveModelPoolName(f.displayName);
            let pg = poolMap.get(poolName);
            if (!pg) {
              pg = { name: poolName, val: 0, items: [] };
              poolMap.set(poolName, pg);
            }
            pg.val += metricValOf(f, metric);
            pg.items.push(f);
          }

          const orderedPools = [...poolMap.values()].sort((a, b) => b.val - a.val || (a.name < b.name ? -1 : 1));
          rowsEl.innerHTML = orderedPools.map((pg) => {
            pg.items.sort((a, b) => metricValOf(b, metric) - metricValOf(a, metric));
            const poolPct = scopeSumVal > 0 ? Math.round((pg.val / scopeSumVal) * 100) : 0;
            const itemsHtml = pg.items.map((f) => {
              const fv = metricValOf(f, metric);
              const pct = scopeSumVal > 0 ? Math.round((fv / scopeSumVal) * 100) : 0;
              const inTok = f.uncached + f.cacheRead + f.cacheWrite;
              const hitPct = inTok > 0 ? Math.round((f.cacheRead / inTok) * 100) : 0;
              const isFocused = state.focusedFamilyKey === f.key;
              const isDimmed = Boolean(state.focusedFamilyKey && !isFocused);
              const isExpanded = state.expandedFamilies.has(f.key);

              let detailHtml = '';
              if (isExpanded) {
                const tierParts = [...f.tiers.values()]
                  .sort((a, b) => metricValOf(b, metric) - metricValOf(a, metric))
                  .map((tItem) => {
                    const tv = metricValOf(tItem, metric);
                    const tp = fv > 0 ? Math.round((tv / fv) * 100) : 0;
                    return esc(tItem.label) + ' ' + tp + '% (' + esc(fmtMetric(tv, metric)) + ')';
                  });
                detailHtml = '<div class="cap-model-detail">' +
                  '<div class="cap-detail-line"><span>' + esc(tc('uncached')) + ': ' + esc(fmtTok(f.uncached)) + '</span><span>' + esc(tc('cacheRead')) + ': ' + esc(fmtTok(f.cacheRead)) + '</span><span>' + esc(tc('cacheWrite')) + ': ' + esc(fmtTok(f.cacheWrite)) + '</span><span>' + esc(tc('output')) + ': ' + esc(fmtTok(f.output)) + '</span></div>' +
                  (tierParts.length > 0 ? '<div class="cap-detail-line"><span>' + esc(tc('tiersLabel')) + ': ' + tierParts.join(' · ') + '</span></div>' : '') +
                '</div>';
              }

              return '<div class="cap-model-item">' +
                '<div class="cap-model-row' + (isFocused ? ' is-focused' : '') + (isDimmed ? ' is-dimmed' : '') + '" onclick="window.__agyCapsuleUi.toggleFocusModel(\'' + safeJsArg(f.key) + '\')">' +
                  '<div class="cap-model-left"><span class="cap-model-dot" style="background:' + f.color + '"></span>' +
                    '<div class="cap-model-info"><span class="truncate">' + esc(f.displayName) + '</span>' +
                      '<span class="cap-model-sub">' + esc(tc('requests', { n: f.requests }) + ' · ' + tc('hitPctLabel') + ' ' + hitPct + '%') + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cap-model-right"><span>' + pct + '%</span><span>' + esc(fmtMetric(fv, metric)) + '</span>' +
                    '<button type="button" class="cap-model-expand-btn" onclick="event.stopPropagation(); window.__agyCapsuleUi.toggleExpandModel(\'' + safeJsArg(f.key) + '\')">' + (isExpanded ? '▾' : '▸') + '</button>' +
                  '</div>' +
                '</div>' +
                detailHtml +
              '</div>';
            }).join('');

            return '<div class="cap-pool-section">' +
              '<div class="cap-pool-header"><span>' + esc(tc('poolGroupFmt', { name: pg.name })) + '</span><span class="mono">' + poolPct + '% · ' + esc(fmtMetric(pg.val, metric)) + '</span></div>' +
              itemsHtml +
            '</div>';
          }).join('');
        }
      }

      // 7. 次级折叠 · 53 周活跃热力图
      const heatHintEl = document.getElementById('cap-heat-hint');
      if (heatHintEl) {
        heatHintEl.textContent = tc(state.heatScale === 'week' ? 'heatHintWeek' : 'heatHint');
      }
      const heatList = Array.isArray(data.heatmapDays) ? data.heatmapDays : [];
      const byDate = new Map(heatList.map((d) => [d.date, d]));
      const weeksCount = 53;
      const firstMonday = addDays(wk, -7 * (weeksCount - 1));
      const columns = [];
      let maxVal = 0;
      let totalHeatReqs = 0;
      for (let w = 0; w < weeksCount; w++) {
        const from = addDays(firstMonday, w * 7);
        const days = [];
        for (let off = 0; off < 7; off++) {
          const dt = addDays(from, off);
          const row = byDate.get(dt);
          const hv = metricValOf(row, metric);
          totalHeatReqs += row?.requests || 0;
          days.push({ from: dt, to: dt, val: hv, requests: row?.requests || 0, future: dt > today });
        }
        const cells = state.heatScale === 'week'
          ? [{
              from,
              to: addDays(from, 6),
              val: days.reduce((s, x) => s + x.val, 0),
              requests: days.reduce((s, x) => s + x.requests, 0),
              future: false
            }]
          : days;
        for (const c of cells) maxVal = Math.max(maxVal, c.val);
        const monthLbl = w > 0 && from.slice(0, 7) !== addDays(from, -7).slice(0, 7) ? from.slice(5, 7) + '月' : '';
        columns.push({ monthLbl, cells });
      }

      if (heatSummaryEl) {
        heatSummaryEl.textContent = data.sinceDate ? data.sinceDate + ' · ' + tc('requests', { n: totalHeatReqs }) : tc('requests', { n: totalHeatReqs });
      }

      if (heatEl) {
        if (heatList.length === 0) {
          heatEl.innerHTML = '<div class="muted-note">' + esc(tc('usageEmpty')) + '</div>';
        } else {
          const levelOf = (v) => (v > 0 && maxVal > 0 ? Math.max(1, Math.ceil(Math.sqrt(v / maxVal) * 4)) : 0);
          const jumpFn = state.heatScale === 'week' ? 'jumpToWeek' : 'jumpToDate';
          heatEl.innerHTML = '<div class="cap-heat-grid">' + columns.map((col) =>
            '<div class="cap-heat-col">' +
              (col.monthLbl ? '<span class="cap-heat-month">' + esc(col.monthLbl) + '</span>' : '') +
              col.cells.map((c) => {
                const spanTxt = c.from === c.to ? c.from : c.from + ' – ' + c.to;
                const tip = c.val > 0 ? spanTxt + ' · ' + fmtMetric(c.val, metric) + ' (' + tc('requests', { n: c.requests }) + ')' : spanTxt;
                if (c.future) return '<i class="cap-heat-cell" data-future="1"></i>';
                return '<i class="cap-heat-cell is-clickable" data-level="' + levelOf(c.val) + '" title="' + esc(tip) + '" onclick="window.__agyCapsuleUi.' + jumpFn + '(\'' + safeJsArg(c.from) + '\')"></i>';
              }).join('') +
            '</div>'
          ).join('') + '</div>';
          heatEl.scrollLeft = heatEl.scrollWidth;
        }
      }

      if (footEl) {
        const leftNote = [data.sinceDate ? tc('since', { date: data.sinceDate }) : '', data.unread > 0 ? tc('usageUnread', { n: data.unread }) : ''].filter(Boolean).join(' · ');
        footEl.innerHTML = '<span>' + esc(leftNote) + '</span><span class="cap-heat-legend"><span>' + esc(tc('less')) + '</span>' +
          [0, 1, 2, 3, 4].map((lv) => '<i class="cap-heat-cell" data-level="' + lv + '"></i>').join('') +
          '<span>' + esc(tc('more')) + '</span></span>';
      }
    }

    async function refreshTelemetry() {
      try {
        const res = await window.__agyIdeBridge.capsuleCall('capsuleInspect', {});
        if (res && res.ok) {
          state.snapshot = res.data;
          renderSnapshot();
        }
      } catch {}
    }

    async function refreshQuota(force = false) {
      try {
        const res = await window.__agyIdeBridge.capsuleCall('capsuleQuota', { force: Boolean(force) });
        if (res && res.ok) {
          state.quota = res.data;
          renderQuota();
        }
      } catch {}
    }

    async function loadUsage(force = false) {
      const badgeEl = document.getElementById('cap-usage-badge');
      if (state.usage && !force) {
        renderUsage();
        return;
      }
      const reqSeq = ++usageQuerySeq;
      if (badgeEl) badgeEl.textContent = tc('usageScanning');
      try {
        const res = await window.__agyIdeBridge.capsuleCall('capsuleUsageQuery', {
          scope: state.usageScope,
          conversationId: state.usageScope === 'conversation' ? (state.pinnedConvId || '') : '',
          period: state.modelPeriod,
          shift: state.modelShift,
          anchorDate: state.anchorDate,
          anchorEndMs: state.anchorEndMs
        });
        if (reqSeq !== usageQuerySeq) return;
        if (!res || !res.ok) {
          throw new Error(res?.error || 'capsuleUsageQuery failed');
        }
        state.usage = res.data;
        if (res.data && res.data.isLatest) {
          state.modelShift = 0;
          state.anchorDate = '';
          state.anchorEndMs = 0;
        }
        state.selectedBarIdx = null;
        if (state.pendingSelectDay && res.data && Array.isArray(res.data.bars)) {
          const targetDay = state.pendingSelectDay;
          const idx = res.data.bars.findIndex((b) => b.dayStr === targetDay || b.weekStartStr === targetDay);
          if (idx >= 0) state.selectedBarIdx = idx;
          state.pendingSelectDay = '';
        }
        renderUsage();
      } catch (err) {
        if (reqSeq !== usageQuerySeq) return;
        console.error('[agy-capsule] usage load/render failed:', err);
        if (badgeEl) badgeEl.textContent = 'ERR';
        const rowsEl = document.getElementById('cap-model-rows');
        if (rowsEl && !rowsEl.innerHTML.trim()) {
          rowsEl.innerHTML = '<div class="muted-note">' + esc(err?.message || String(err)) + '</div>';
        }
      }
    }

    window.__agyCapsuleUi = {
      applyTranslations,
      refreshQuota,
      loadUsage,
      async refreshAll(forceQuota = false) {
        await Promise.all([refreshTelemetry(), refreshQuota(forceQuota)]);
        const acc = document.getElementById('cap-usage-accordion');
        if (acc && acc.open) {
          void loadUsage(forceQuota);
        }
      },
      onConversationChanged() {
        void refreshTelemetry();
        const acc = document.getElementById('cap-usage-accordion');
        if (acc && acc.open && state.usageScope === 'conversation' && !state.pinnedConvId) {
          void loadUsage(true);
        }
      },
      toggleScopeDropdown(slot, ev) {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        const targetSlot = slot === 'model' ? 'model' : 'top';
        const wasOpen = openScopeSlot === targetSlot;
        closeAllScopeDropdowns();
        if (wasOpen) return;
        const dd = document.getElementById('cap-scope-select-' + targetSlot);
        const btn = document.getElementById('cap-scope-btn-' + targetSlot);
        const menu = document.getElementById('cap-scope-menu-' + targetSlot);
        if (!dd || !menu) return;
        // 确保菜单有最新渲染内容
        syncScopeSelectOptions(state.usage);
        // 根据视口下方剩余高度自动决定向下或向上展开，向上时 .is-dropup 将固定项翻转紧贴选择框
        let dropUp = false;
        if (btn && typeof btn.getBoundingClientRect === 'function') {
          const rect = btn.getBoundingClientRect();
          const vh = Number(window.innerHeight) || 720;
          const spaceBelow = vh - rect.bottom;
          const spaceAbove = rect.top;
          if (spaceBelow < 240 && spaceAbove > spaceBelow) {
            dropUp = true;
          }
        }
        if (dropUp) dd.classList.add('is-dropup');
        dd.classList.add('is-open');
        if (btn && typeof btn.setAttribute === 'function') btn.setAttribute('aria-expanded', 'true');
        menu.classList.remove('hidden');
        openScopeSlot = targetSlot;
      },
      closeScopeDropdowns() {
        closeAllScopeDropdowns();
      },
      pickScopeOption(val, ev) {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        closeAllScopeDropdowns();
        return this.onUsageScopeSelect(val);
      },
      onUsageScopeSelect(val) {
        closeAllScopeDropdowns();
        const v = String(val || '__active__');
        if (v === '__all__') {
          state.usageScope = 'all';
          state.pinnedConvId = '';
        } else if (v.startsWith('conv:') && v.length > 5) {
          state.usageScope = 'conversation';
          state.pinnedConvId = v.slice(5);
        } else {
          state.usageScope = 'conversation';
          state.pinnedConvId = '';
        }
        state.selectedBarIdx = null;
        state.focusedFamilyKey = '';
        syncUiStateControls();
        persistUiState();
        return loadUsage(true);
      },
      setUsageScope(scope) {
        return this.onUsageScopeSelect(scope === 'all' ? '__all__' : '__active__');
      },
      inspectUsageConversation(convId) {
        if (!convId) return Promise.resolve();
        return this.onUsageScopeSelect('conv:' + convId);
      },
      setUsageMetric(metric) {
        state.usageMetric = ['net', 'total', 'requests'].includes(metric) ? metric : 'net';
        syncUiStateControls();
        persistUiState();
        renderUsage();
      },
      setHeatScale(scale) {
        state.heatScale = scale === 'week' ? 'week' : 'day';
        syncUiStateControls();
        persistUiState();
        renderUsage();
      },
      setModelPeriod(period) {
        state.modelPeriod = VALID_PERIODS.has(period) ? period : 'day';
        state.modelShift = 0;
        state.anchorDate = '';
        state.anchorEndMs = 0;
        state.pendingSelectDay = '';
        state.selectedBarIdx = null;
        syncUiStateControls();
        persistUiState();
        return loadUsage(true);
      },
      shiftModelPage(delta) {
        const d = Number(delta || 0);
        if (!d) return Promise.resolve();
        if (state.usage) {
          if (d < 0 && !state.usage.canPrev) return Promise.resolve();
          if (d > 0 && !state.usage.canNext) return Promise.resolve();
        }
        state.modelShift = state.modelShift + d;
        if (!state.anchorDate && !state.anchorEndMs && state.modelShift > 0) {
          state.modelShift = 0;
        }
        state.pendingSelectDay = '';
        state.selectedBarIdx = null;
        return loadUsage(true);
      },
      resetToNow() {
        state.modelShift = 0;
        state.anchorDate = '';
        state.anchorEndMs = 0;
        state.pendingSelectDay = '';
        state.selectedBarIdx = null;
        return loadUsage(true);
      },
      toggleBarSelect(idx) {
        const i = Number(idx);
        if (!Number.isInteger(i)) return;
        state.selectedBarIdx = state.selectedBarIdx === i ? null : i;
        renderUsage();
      },
      clearBarSelect() {
        state.selectedBarIdx = null;
        renderUsage();
      },
      drillBar(idx) {
        const bars = state.usage && Array.isArray(state.usage.bars) ? state.usage.bars : [];
        const b = bars[Number(idx)];
        if (!b || !b.drillable) return Promise.resolve();
        state.selectedBarIdx = null;
        state.pendingSelectDay = '';
        state.modelShift = 0;
        if (b.drillTarget === '5h' && b.drillAnchorMs) {
          state.modelPeriod = '5h';
          state.anchorDate = '';
          state.anchorEndMs = b.drillAnchorMs;
        } else if (b.drillTarget === 'week' && b.dayStr) {
          state.modelPeriod = 'week';
          state.anchorDate = b.dayStr;
          state.anchorEndMs = 0;
        } else if (b.dayStr) {
          state.modelPeriod = 'day';
          state.anchorDate = b.dayStr;
          state.anchorEndMs = 0;
        }
        syncUiStateControls();
        persistUiState();
        return loadUsage(true);
      },
      jumpToDate(dayStr) {
        if (!dayStr || typeof dayStr !== 'string') return Promise.resolve();
        state.modelPeriod = 'day';
        state.modelShift = 0;
        state.anchorDate = dayStr;
        state.anchorEndMs = 0;
        state.pendingSelectDay = dayStr;
        state.selectedBarIdx = null;
        syncUiStateControls();
        persistUiState();
        return loadUsage(true);
      },
      jumpToWeek(mondayDayStr) {
        if (!mondayDayStr || typeof mondayDayStr !== 'string') return Promise.resolve();
        state.modelPeriod = 'week';
        state.modelShift = 0;
        state.anchorDate = mondayDayStr;
        state.anchorEndMs = 0;
        state.pendingSelectDay = mondayDayStr;
        state.selectedBarIdx = null;
        syncUiStateControls();
        persistUiState();
        return loadUsage(true);
      },
      toggleFocusModel(key) {
        if (!key) return;
        if (state.focusedFamilyKey === key) {
          // 再次点击同一模型：取消柱状图聚焦并同步收起详情
          state.focusedFamilyKey = '';
          state.expandedFamilies.delete(key);
        } else {
          if (state.focusedFamilyKey) {
            state.expandedFamilies.delete(state.focusedFamilyKey);
          }
          state.focusedFamilyKey = key;
          state.expandedFamilies.add(key);
        }
        renderUsage();
      },
      clearFocusModel() {
        if (state.focusedFamilyKey) {
          state.expandedFamilies.delete(state.focusedFamilyKey);
        }
        state.focusedFamilyKey = '';
        renderUsage();
      },
      toggleExpandModel(key) {
        if (!key) return;
        if (state.expandedFamilies.has(key)) state.expandedFamilies.delete(key);
        else state.expandedFamilies.add(key);
        renderUsage();
      },
      applyUiState(next) {
        if (!next || typeof next !== 'object') return;
        const wasOpen = state.usageOpen;
        const prevQueryKey = [state.usageScope, state.modelPeriod].join('|');
        if (typeof next.usageOpen === 'boolean') state.usageOpen = next.usageOpen;
        if (next.usageScope === 'conversation' || next.usageScope === 'all') {
          state.usageScope = next.usageScope;
          if (next.usageScope === 'all') state.pinnedConvId = '';
        }
        if (['net', 'total', 'requests'].includes(next.usageMetric)) state.usageMetric = next.usageMetric;
        if (VALID_PERIODS.has(next.modelPeriod)) {
          if (state.modelPeriod !== next.modelPeriod) {
            state.modelShift = 0;
            state.anchorDate = '';
            state.anchorEndMs = 0;
          }
          state.modelPeriod = next.modelPeriod;
        }
        if (typeof next.heatOpen === 'boolean') state.heatOpen = next.heatOpen;
        if (next.heatScale === 'day' || next.heatScale === 'week') state.heatScale = next.heatScale;
        syncUiStateControls();
        const nextQueryKey = [state.usageScope, state.modelPeriod].join('|');
        if (state.usageOpen && (!wasOpen || prevQueryKey !== nextQueryKey)) {
          void loadUsage(true);
        } else if (state.usage) {
          renderUsage();
        }
      },
      savePrefs() {
        const warn = Math.max(1, Math.min(998, parseInt(document.getElementById('cap-pref-warn-min').value, 10) || 3));
        let cold = Math.max(2, Math.min(999, parseInt(document.getElementById('cap-pref-cold-min').value, 10) || 4));
        if (cold <= warn) cold = Math.min(999, warn + 1);
        const queue = Math.max(1, Math.min(999, parseInt(document.getElementById('cap-pref-queue-sec').value, 10) || 30));
        state.prefs = { cacheWarnMin: warn, cacheColdMin: cold, queueWarnSec: queue };
        syncPrefsInputs();
        renderLiveTick();
        window.__agyIdeBridge.saveCapsulePrefs(state.prefs);
      }
    };

    document.addEventListener('DOMContentLoaded', () => {
      syncPrefsInputs();
      syncUiStateControls();
      applyTranslations();
      const usageAcc = document.getElementById('cap-usage-accordion');
      if (usageAcc) {
        usageAcc.addEventListener('toggle', () => {
          if (syncingUiState) return;
          const isOpen = Boolean(usageAcc.open);
          state.usageOpen = isOpen;
          persistUiState();
          if (isOpen) {
            void loadUsage(false);
          }
        });
      }
      const heatAcc = document.getElementById('cap-heat-accordion');
      if (heatAcc) {
        heatAcc.addEventListener('toggle', () => {
          if (syncingUiState) return;
          state.heatOpen = Boolean(heatAcc.open);
          persistUiState();
        });
      }
      void window.__agyCapsuleUi.refreshAll(false);
    });

    const onDocClickCloseScope = () => {
      if (openScopeSlot) closeAllScopeDropdowns();
    };
    const onDocKeyCloseScope = (ev) => {
      if (ev && ev.key === 'Escape' && openScopeSlot) closeAllScopeDropdowns();
    };
    document.addEventListener('click', onDocClickCloseScope);
    document.addEventListener('keydown', onDocKeyCloseScope);

    const tickTimer = setInterval(renderLiveTick, 1000);
    const pollTimerCap = setInterval(() => {
      void refreshTelemetry();
    }, 3000);
    const quotaTimerCap = setInterval(() => {
      void refreshQuota(false);
    }, 15000);

    window.addEventListener('beforeunload', () => {
      clearInterval(tickTimer);
      clearInterval(pollTimerCap);
      clearInterval(quotaTimerCap);
      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onDocClickCloseScope);
        document.removeEventListener('keydown', onDocKeyCloseScope);
      }
    });
  })();
  </script>`;
}

module.exports = {
  getCapsuleCss,
  getMainTabsHtml,
  getCapsulePaneHtml,
  getCapsuleClientScript
};
