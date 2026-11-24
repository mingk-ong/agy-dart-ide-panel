"use strict";

/**
 * 构建 Tab 2（多账号管理与一键切换）的样式、DOM 结构与前端脚本。
 * 纯本地「在线实时 + 退出余额快照 + 实时满额倒计时」方案，零云端/OAuth/预热依赖。
 */

function getAccountCss() {
  return `
    /* === Tab 2：多账号一键切换视图 === */
    .acc-pane {
      display: flex;
      flex-direction: column;
    }

    .acc-hero-card {
      padding: 10px 12px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .acc-hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .acc-hero-id {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1 1 160px;
    }

    .acc-hero-email-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .acc-hero-email {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .acc-hero-sub {
      font-size: 11px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .acc-hero-badges {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .acc-toolbar-btns {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }

    .acc-recommend-banner {
      padding: 8px 10px;
      border-radius: var(--radius-md);
      border: 1px solid var(--warn-border);
      background: var(--warn-soft);
      color: var(--warn-text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 12px;
    }

    .acc-filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: nowrap;
    }

    .acc-search-input {
      flex: 1 1 auto;
      min-width: 0;
      height: 28px;
      padding: 0 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-primary);
      font-size: 12px;
      font-family: inherit;
    }

    .acc-search-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .acc-sort-select {
      flex: 0 0 auto;
      height: 28px;
      padding: 0 6px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-primary);
      font-size: 11px;
      cursor: pointer;
    }

    .acc-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .acc-card {
      padding: 9px 11px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 7px;
      transition: border-color 140ms ease, background-color 140ms ease;
    }

    .acc-card.is-current {
      border-color: var(--accent-border);
      box-shadow: inset 2px 0 0 var(--accent);
    }

    .acc-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .acc-card-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1 1 150px;
    }

    .acc-card-title-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .acc-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
    }

    .acc-dot.is-active { background: var(--ok); }
    .acc-dot.is-warn { background: var(--warn); }
    .acc-dot.is-danger { background: var(--danger); }

    .acc-card-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .acc-card-email {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .acc-card-subline {
      font-size: 10.5px;
      color: var(--text-muted);
    }

    .acc-card-tags {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .acc-mini-quotas {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .acc-mini-qrow {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }

    .acc-mini-qname {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .acc-mini-qtrack {
      height: 5px;
      border-radius: 3px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .acc-mini-qfill {
      height: 100%;
      border-radius: 3px;
      transition: width 220ms ease;
    }

    .acc-mini-qval {
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--text-primary);
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .acc-mini-qval.is-recovered {
      color: var(--ok);
      font-weight: 600;
    }

    .acc-countdown-chip {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      color: var(--info-text);
      font-family: var(--font-mono);
      font-size: 10px;
      line-height: 1.3;
    }

    .acc-card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      padding-top: 4px;
      border-top: 1px solid var(--border-subtle);
    }

    .acc-card-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .acc-btn-danger {
      color: var(--danger-text);
    }

    .acc-btn-danger:hover {
      background: var(--danger-soft);
      border-color: var(--danger-border);
    }

    .acc-prefs-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .acc-pref-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: var(--text-primary);
      flex-wrap: wrap;
    }

    .acc-pref-label {
      display: flex;
      flex-direction: column;
      gap: 1px;
      flex: 1 1 180px;
    }

    .acc-pref-desc {
      font-size: 11px;
      color: var(--text-muted);
    }

    .acc-pref-select {
      height: 28px;
      padding: 0 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-primary);
      font-size: 11.5px;
      cursor: pointer;
    }

    .acc-switch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .acc-empty {
      padding: 14px 12px;
      border-radius: var(--radius-md);
      border: 1px dashed var(--border);
      background: var(--bg-inset);
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* 5 维认证健康体检卡片 */
    .acc-health-card {
      padding: 9px 11px;
      border-radius: var(--radius-md);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .acc-health-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px;
    }

    @media (min-width: 520px) {
      .acc-health-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
    }

    .acc-health-chip {
      padding: 5px 7px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .acc-health-chip.is-warn {
      border-color: var(--warn-border);
      background: var(--warn-soft);
    }

    .acc-health-chip.is-error {
      border-color: var(--danger-border);
      background: var(--danger-soft);
    }

    .acc-health-chip-lbl {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .acc-health-chip-val {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .acc-health-issues {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .acc-health-issue {
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-panel);
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .acc-health-issue.is-warn {
      border-color: var(--warn-border);
      color: var(--warn-text);
    }

    .acc-health-issue.is-error {
      border-color: var(--danger-border);
      color: var(--danger-text);
    }

    .acc-sync-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-inset);
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-secondary);
    }
  `;
}

function getAccountPaneHtml() {
  return `
    <div id="ide-pane-accounts" class="acc-pane">
      <!-- 1. 当前登录账号与快捷入口 -->
      <section class="band">
        <div class="band-head">
          <div class="band-title-group">
            <span class="band-title" data-acc-i18n="activeTitle">当前活跃账号</span>
            <span id="acc-hub-badge" class="meta-tag hidden">--</span>
          </div>
          <div class="band-actions">
            <button id="acc-privacy-btn" type="button" onclick="window.__agyAccountUi.togglePrivacy()" class="btn btn-ghost btn-sm" data-acc-i18n="privacyBtn">隐藏邮箱</button>
            <button id="acc-refresh-btn" type="button" onclick="window.__agyAccountUi.refresh(true)" class="btn btn-ghost btn-sm" data-acc-i18n="refreshBtn">刷新</button>
          </div>
        </div>

        <div class="acc-hero-card">
          <div class="acc-hero-top">
            <div class="acc-hero-id">
              <div class="acc-hero-email-row">
                <span id="acc-active-email" class="acc-hero-email">--</span>
              </div>
              <div id="acc-active-sub" class="acc-hero-sub">--</div>
            </div>
            <div id="acc-active-badges" class="acc-hero-badges"></div>
          </div>

          <div class="acc-toolbar-btns">
            <button type="button" onclick="window.__agyAccountUi.captureCurrent()" class="btn btn-primary btn-sm" data-acc-i18n="captureBtn">捕获当前账号</button>
            <button type="button" onclick="window.__agyAccountUi.oauthLogin()" class="btn btn-ghost btn-sm" data-acc-i18n="oauthBtn">官方登录新增</button>
            <button type="button" onclick="window.__agyAccountUi.importTools()" class="btn btn-ghost btn-sm" data-acc-i18n="importToolsBtn">导入 Tools</button>
            <button type="button" onclick="window.__agyAccountUi.importJson()" class="btn btn-ghost btn-sm" data-acc-i18n="importJsonBtn">导入 JSON</button>
            <button type="button" onclick="window.__agyAccountUi.exportJson()" class="btn btn-ghost btn-sm" data-acc-i18n="exportJsonBtn">导出备份</button>
          </div>
        </div>

        <div id="acc-recommend-banner" class="acc-recommend-banner hidden">
          <span id="acc-recommend-text">--</span>
          <button id="acc-recommend-btn" type="button" class="btn btn-primary btn-sm" data-acc-i18n="switchNow">立即切换</button>
        </div>

        <!-- 认证防掉线护盾 · 5 维健康体检 -->
        <div class="acc-health-card">
          <div class="band-head">
            <div class="band-title-group">
              <span class="band-title" data-acc-i18n="healthTitle">认证防掉线护盾 · 5 维体检</span>
              <span id="acc-health-badge" class="meta-tag">--</span>
            </div>
            <div class="band-actions">
              <button id="acc-heal-btn" type="button" onclick="window.__agyAccountUi.healAccount()" class="btn btn-ghost btn-sm" data-acc-i18n="healBtn">一键修复</button>
              <button id="acc-recheck-btn" type="button" onclick="window.__agyAccountUi.recheckHealth()" class="btn btn-ghost btn-sm" data-acc-i18n="recheckBtn">复检</button>
            </div>
          </div>
          <div id="acc-health-grid" class="acc-health-grid"></div>
          <div id="acc-health-issues" class="acc-health-issues hidden"></div>
        </div>
      </section>

      <!-- 2. 加密账号保险库列表 -->
      <section class="band">
        <div class="band-head">
          <div class="band-title-group">
            <span class="band-title" data-acc-i18n="vaultTitle">本地账号保险库</span>
            <span id="acc-count-badge" class="meta-tag">0</span>
          </div>
        </div>

        <div id="acc-sync-status-bar" class="acc-sync-bar">
          <span id="acc-sync-status-text" data-acc-i18n="localTrackDesc">当前号在线实时 · 后台号追踪退出余额与满额倒计时</span>
          <span id="acc-full-count-badge" class="meta-tag">--</span>
        </div>

        <div class="acc-filter-row">
          <input id="acc-search-input" type="search" class="acc-search-input" placeholder="搜索邮箱或备注..." oninput="window.__agyAccountUi.onFilterChange()" />
          <select id="acc-sort-select" class="acc-sort-select" onchange="window.__agyAccountUi.onFilterChange()">
            <option value="quota" data-acc-i18n="sortQuota">可用余量 / 最快回满</option>
            <option value="recent" data-acc-i18n="sortRecent">最近使用</option>
            <option value="email" data-acc-i18n="sortEmail">按邮箱</option>
          </select>
        </div>

        <div id="acc-list" class="acc-list">
          <div class="muted-note" data-acc-i18n="loading">正在加载账号列表...</div>
        </div>
      </section>

      <!-- 3. 切号行为与安全偏好 -->
      <details id="acc-prefs-accordion" class="accordion-band">
        <summary class="accordion-summary">
          <span class="accordion-left">
            <svg class="accordion-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span class="band-title" data-acc-i18n="prefsTitle">切号与安全设置</span>
          </span>
        </summary>
        <div class="accordion-body">
          <div class="acc-prefs-list">
            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="reloadModeLabel">切号后生效方式</span>
                <span class="acc-pref-desc" data-acc-i18n="reloadModeDesc">推荐冷重启以彻底清空主进程旧账号缓存，避免每次切号弹出引导页</span>
              </div>
              <select id="acc-pref-reload" class="acc-pref-select" onchange="window.__agyAccountUi.savePrefs()">
                <option value="coldRestart" data-acc-i18n="reloadColdRestart">自动冷重启 IDE（彻底免引导弹窗 · 推荐）</option>
                <option value="ask" data-acc-i18n="reloadAsk">弹窗确认（冷重启 / 快速重载）</option>
                <option value="auto" data-acc-i18n="reloadAuto">快速重载窗口（快但新号会弹提示）</option>
                <option value="none" data-acc-i18n="reloadNone">仅写凭据不重启</option>
              </select>
            </div>

            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="syncCliLabel">同步 ~/.gemini 兼容凭据</span>
                <span class="acc-pref-desc" data-acc-i18n="syncCliDesc">切换时一并更新 oauth_creds.json 与 google_accounts.json</span>
              </div>
              <label class="acc-switch">
                <input id="acc-pref-sync-cli" type="checkbox" onchange="window.__agyAccountUi.savePrefs()" />
                <span data-acc-i18n="enabledLbl">启用</span>
              </label>
            </div>

            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="syncOnboardingLabel">切号同步引导状态</span>
                <span class="acc-pref-desc" data-acc-i18n="syncOnboardingDesc">冷重启退出主进程后原子更新 state.vscdb 引导完成记录</span>
              </div>
              <label class="acc-switch">
                <input id="acc-pref-sync-onboarding" type="checkbox" onchange="window.__agyAccountUi.savePrefs()" />
                <span data-acc-i18n="enabledLbl">启用</span>
              </label>
            </div>

            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="privacyLabel">隐私打码模式</span>
                <span class="acc-pref-desc" data-acc-i18n="privacyDesc">对所有展示邮箱进行脱敏打码，防止录屏/截屏泄露</span>
              </div>
              <label class="acc-switch">
                <input id="acc-pref-privacy" type="checkbox" onchange="window.__agyAccountUi.savePrefs()" />
                <span data-acc-i18n="enabledLbl">启用</span>
              </label>
            </div>

            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="healModeLabel">掉线自愈守护策略</span>
                <span class="acc-pref-desc" data-acc-i18n="healModeDesc">检测到凭据丢失或 loginError 时的处理方式</span>
              </div>
              <select id="acc-pref-heal-mode" class="acc-pref-select" onchange="window.__agyAccountUi.savePrefs()">
                <option value="ask" data-acc-i18n="healAsk">弹窗提示一键恢复</option>
                <option value="auto" data-acc-i18n="healAuto">静默自动回填凭据</option>
                <option value="notify" data-acc-i18n="healNotify">仅状态栏/面板提醒</option>
              </select>
            </div>

            <div class="acc-pref-row">
              <div class="acc-pref-label">
                <span data-acc-i18n="keepFreshLabel">凭据自动保鲜备份</span>
                <span class="acc-pref-desc" data-acc-i18n="keepFreshDesc">定时将系统续期出的新 OAuth 令牌静默同步回保险库</span>
              </div>
              <label class="acc-switch">
                <input id="acc-pref-keep-fresh" type="checkbox" onchange="window.__agyAccountUi.savePrefs()" />
                <span data-acc-i18n="enabledLbl">启用</span>
              </label>
            </div>
          </div>
        </div>
      </details>
    </div>`;
}

function getAccountClientScript() {
  return String.raw`<script>
  (function() {
    const ACC_I18N = {
      zh: {
        activeTitle: '当前活跃账号',
        privacyBtn: '隐藏邮箱',
        privacyBtnOn: '显示邮箱',
        refreshBtn: '刷新',
        captureBtn: '捕获当前账号',
        oauthBtn: '官方登录新增',
        importToolsBtn: '导入 Tools',
        importJsonBtn: '导入 JSON',
        exportJsonBtn: '导出备份',
        switchNow: '立即切换',
        vaultTitle: '本地账号保险库',
        localTrackDesc: '当前号在线实时 · 后台号追踪退出余额与满额倒计时',
        fullReadyFmt: '满额可用 {full}/{total}',
        sortRecent: '最近使用',
        sortQuota: '可用余量 / 最快回满',
        sortEmail: '按邮箱',
        searchPlaceholder: '搜索邮箱或备注...',
        loading: '正在加载账号列表...',
        prefsTitle: '切号与安全设置',
        reloadModeLabel: '切号后生效方式',
        reloadModeDesc: '推荐冷重启以彻底清空主进程旧账号缓存，避免每次切号弹出引导页',
        reloadColdRestart: '自动冷重启 IDE（彻底免引导弹窗 · 推荐）',
        reloadAsk: '弹窗确认（冷重启 / 快速重载）',
        reloadAuto: '快速重载窗口（快但新号会弹提示）',
        reloadNone: '仅写凭据不重启',
        syncCliLabel: '同步 ~/.gemini 兼容凭据',
        syncCliDesc: '切换时一并更新 oauth_creds.json 与 google_accounts.json',
        syncOnboardingLabel: '切号同步引导状态',
        syncOnboardingDesc: '冷重启退出主进程后原子更新 state.vscdb 引导完成记录',
        privacyLabel: '隐私打码模式',
        privacyDesc: '对所有展示邮箱进行脱敏打码，防止录屏/截屏泄露',
        enabledLbl: '启用',
        noActiveEmail: '未检测到活跃登录账号',
        capturedTag: '已入库',
        uncapturedTag: '未入库',
        sysCredOk: 'OS 凭据就绪',
        sysCredMissing: '无 OS 凭据',
        hubCountFmt: '{n} 个活跃窗口',
        multiHubWarn: '{n} 个活跃窗口（切号请关闭或一并重启）',
        recommendFmt: '当前账号余量低至 {active}%，推荐切换至 {target}（可用 {cand}%）',
        emptyHint: '保险库暂无账号。你可以点击上方「捕获当前账号」、一次性导入本机 ~/.antigravity_tools，或发起一次官方 OAuth 登录。',
        noSearchMatch: '没有匹配筛选条件的账号。',
        currentTag: '当前使用',
        liveRealtimeTag: '在线实时',
        recoveredTag: '已回满',
        recoveringTag: '恢复倒计时',
        refreshTokenTag: '可续期',
        accessOnlyTag: '无刷新令牌',
        switchBtn: '一键切换',
        switchingBtn: '切换中...',
        renameBtn: '备注',
        deleteBtn: '删除',
        quotaUnknown: '未记录（切入后自动记录退出余额与倒计时）',
        exitedAtFmt: '退出于 {time}（{ago}）',
        justNow: '刚刚',
        minsAgoFmt: '{m}分钟前',
        hoursAgoFmt: '{h}小时前',
        daysAgoFmt: '{d}天前',
        resetInFmt: '{cd} 后重置',
        fullInFmt: '满额 {cd}',
        recoveredLabel: '100% · 已回满',
        exitRecordedTip: '退出时余量 {pct}%，已越过重置点自动回满',
        confirmSwitch: '确定将当前系统登录凭据切换为 {target} 吗？（切换前会自动备份并保存当前号退出余额）',
        confirmSwitchCold: '确定切换为 {target} 吗？\n\n切换前会自动备份并保存当前号退出余额，随后将自动冷重启 IDE 生效（约 3-5 秒，自动恢复工作区且不再弹出引导页）。',
        confirmDelete: '确定从本地加密保险库中删除账号 {target} 吗？此操作仅清理插件存档，不影响远程 Google 账号。',
        src_captured: '本机捕获',
        src_official_login: '官方登录',
        src_antigravity_tools: 'Tools 导入',
        src_gemini_cli: 'Gemini CLI',
        src_json_import: 'JSON 导入',
        src_auto_backup: '自动备份',
        src_manual: '手动',
        healthTitle: '认证防掉线护盾 · 5 维体检',
        healBtn: '一键修复',
        recheckBtn: '复检',
        healthHealthy: '状态健康',
        healthWarn: '发现提醒',
        healthCritical: '掉线风险',
        healModeLabel: '掉线自愈守护策略',
        healModeDesc: '检测到凭据丢失或 loginError 时的处理方式',
        healAsk: '弹窗提示一键恢复',
        healAuto: '静默自动回填凭据',
        healNotify: '仅状态栏/面板提醒',
        keepFreshLabel: '凭据自动保鲜备份',
        keepFreshDesc: '定时将系统续期出的新 OAuth 令牌静默同步回保险库',
        externalClientTag: '外部 Client',
        externalClientTip: '从第三方工具导入（非原生登录凭据），建议切入重登或捕获原生凭据'
      },
      en: {
        activeTitle: 'Active Account',
        privacyBtn: 'Mask Email',
        privacyBtnOn: 'Show Email',
        refreshBtn: 'Refresh',
        captureBtn: 'Capture Current',
        oauthBtn: 'Add via OAuth',
        importToolsBtn: 'Import Tools',
        importJsonBtn: 'Import JSON',
        exportJsonBtn: 'Export Backup',
        switchNow: 'Switch Now',
        vaultTitle: 'Encrypted Account Vault',
        localTrackDesc: 'Live Hub for active account · Exit balance & full-reset countdown for background',
        fullReadyFmt: 'Full Ready {full}/{total}',
        sortRecent: 'Recent',
        sortQuota: 'Quota / Fastest Full',
        sortEmail: 'Email',
        searchPlaceholder: 'Search email or alias...',
        loading: 'Loading accounts...',
        prefsTitle: 'Switching & Safety Settings',
        reloadModeLabel: 'After Switch Action',
        reloadModeDesc: 'Cold Restart clears main-process cache so Antigravity never re-prompts onboarding',
        reloadColdRestart: 'Auto Cold Restart IDE (No Onboarding Prompt · Recommended)',
        reloadAsk: 'Prompt (Cold Restart / Quick Reload)',
        reloadAuto: 'Quick Window Reload (May re-prompt onboarding)',
        reloadNone: 'Write credentials only',
        syncCliLabel: 'Sync ~/.gemini compat files',
        syncCliDesc: 'Also update oauth_creds.json and google_accounts.json',
        syncOnboardingLabel: 'Sync Onboarding State',
        syncOnboardingDesc: 'Atomically update state.vscdb onboarding keys during cold restart',
        privacyLabel: 'Privacy Email Masking',
        privacyDesc: 'Mask displayed email addresses for screen sharing',
        enabledLbl: 'Enabled',
        noActiveEmail: 'No active account detected',
        capturedTag: 'Saved',
        uncapturedTag: 'Not Saved',
        sysCredOk: 'OS Cred Ready',
        sysCredMissing: 'No OS Cred',
        hubCountFmt: '{n} active window(s)',
        multiHubWarn: '{n} active windows (close/restart all on switch)',
        recommendFmt: 'Active quota down to {active}%. Recommended: {target} ({cand}% ready)',
        emptyHint: 'Vault is empty. Capture current login, import from ~/.antigravity_tools, or sign in via official OAuth.',
        noSearchMatch: 'No accounts match your search.',
        currentTag: 'Active',
        liveRealtimeTag: 'Live Hub',
        recoveredTag: 'Full Ready',
        recoveringTag: 'Countdown',
        refreshTokenTag: 'Refreshable',
        accessOnlyTag: 'No Refresh Token',
        switchBtn: 'Switch',
        switchingBtn: 'Switching...',
        renameBtn: 'Alias',
        deleteBtn: 'Delete',
        quotaUnknown: 'Unrecorded (switch in to record exit balance & countdown)',
        exitedAtFmt: 'Exited {time} ({ago})',
        justNow: 'just now',
        minsAgoFmt: '{m}m ago',
        hoursAgoFmt: '{h}h ago',
        daysAgoFmt: '{d}d ago',
        resetInFmt: 'Resets in {cd}',
        fullInFmt: 'Full in {cd}',
        recoveredLabel: '100% · Full',
        exitRecordedTip: 'Exit balance {pct}%, reset point passed',
        confirmSwitch: 'Switch system Antigravity credential to {target}? (Current account exit balance will be saved)',
        confirmSwitchCold: 'Switch to {target}?\n\nCurrent exit balance will be saved, then the IDE will cold-restart (~3-5s, auto-restoring workspace) to prevent onboarding prompts.',
        confirmDelete: 'Remove {target} from local encrypted vault? This only deletes local saved tokens.',
        src_captured: 'Captured',
        src_official_login: 'Official Login',
        src_antigravity_tools: 'Tools Import',
        src_gemini_cli: 'Gemini CLI',
        src_json_import: 'JSON Import',
        src_auto_backup: 'Auto Backup',
        src_manual: 'Manual',
        healthTitle: 'Auth Anti-Drop Shield · 5-Point Check',
        healBtn: 'Auto-Heal',
        recheckBtn: 'Recheck',
        healthHealthy: 'Healthy',
        healthWarn: 'Warning',
        healthCritical: 'Drop Risk',
        healModeLabel: 'Drop Guard Policy',
        healModeDesc: 'Action when credential loss or loginError is detected',
        healAsk: 'Prompt one-click heal',
        healAuto: 'Silent credential restore',
        healNotify: 'Badge / alert only',
        keepFreshLabel: 'Keep-Fresh Token Backup',
        keepFreshDesc: 'Silently sync refreshed OS OAuth tokens back to vault',
        externalClientTag: 'External Client',
        externalClientTip: 'Imported from external tool; capturing native OAuth login reduces invalid_grant risk'
      }
    };

    const state = {
      data: null,
      loading: false,
      switchingId: '',
      search: '',
      sort: 'quota',
      cdTimer: null,
      liveSyncCooldownAtMs: 0
    };

    function lang() {
      return window.__AGY_IDE_STATE__ && window.__AGY_IDE_STATE__.lang === 'en' ? 'en' : 'zh';
    }

    function t(key, vars) {
      const dict = ACC_I18N[lang()] || ACC_I18N.zh;
      let str = dict[key] || ACC_I18N.zh[key] || key;
      if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v ?? ''));
        }
      }
      return str;
    }

    function esc(val) {
      return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function maskEmail(email) {
      const clean = String(email || '').trim();
      if (!clean) return '';
      const at = clean.indexOf('@');
      if (at <= 0) return clean.length <= 2 ? (clean[0] || '*') + '***' : clean.slice(0, 2) + '***';
      const local = clean.slice(0, at);
      const dom = clean.slice(at);
      if (local.length <= 1) return '*' + dom;
      if (local.length === 2) return local[0] + '*' + dom;
      return local.slice(0, 2) + '***' + dom;
    }

    function fmtEmail(email) {
      if (!email) return '';
      return state.data && state.data.prefs && state.data.prefs.privacyMask ? maskEmail(email) : email;
    }

    function formatCountdownClient(remainingMs, showSeconds) {
      const ms = Number(remainingMs);
      if (!Number.isFinite(ms) || ms <= 0) return lang() === 'en' ? 'Full' : '已回满';
      const totalSec = Math.max(1, Math.floor(ms / 1000));
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const pad2 = (n) => (n < 10 ? '0' + n : String(n));
      if (d > 0) return d + 'd ' + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm' : '');
      if (h > 0) return showSeconds ? h + 'h ' + pad2(m) + 'm ' + pad2(s) + 's' : h + 'h ' + m + 'm';
      if (m > 0) return showSeconds ? m + 'm ' + pad2(s) + 's' : m + 'm';
      return totalSec + 's';
    }

    function formatExitedTimeLine(exitedAtMs, nowMs) {
      const ts = Number(exitedAtMs || 0);
      if (!ts || ts <= 0) return '';
      const d = new Date(ts);
      const pad2 = (n) => (n < 10 ? '0' + n : String(n));
      const timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
      let ago = t('justNow');
      if (diffSec >= 86400) {
        ago = t('daysAgoFmt', { d: Math.floor(diffSec / 86400) });
      } else if (diffSec >= 3600) {
        ago = t('hoursAgoFmt', { h: Math.floor(diffSec / 3600) });
      } else if (diffSec >= 60) {
        ago = t('minsAgoFmt', { m: Math.floor(diffSec / 60) });
      }
      return t('exitedAtFmt', { time: timeStr, ago });
    }

    function evaluateBucketClient(b, nowMs) {
      const rawFrac = Number(
        b && b.originalFraction !== undefined ? b.originalFraction : (b && b.remainingFraction)
      );
      const recordedFraction = Number.isFinite(rawFrac) ? Math.max(0, Math.min(1, rawFrac)) : 0;
      const recordedPct = Math.round(recordedFraction * 100);
      const rstStr = String((b && (b.resetTime || b.reset_time)) || '').trim();
      const parsedMs = rstStr ? Date.parse(rstStr) : NaN;
      const resetAtMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0;
      const remainingMs = resetAtMs > nowMs ? resetAtMs - nowMs : 0;
      const isFull = recordedFraction >= 0.999;
      const recovered = !isFull && resetAtMs > 0 && resetAtMs <= nowMs;
      const effectiveFraction = recovered ? 1 : recordedFraction;
      const effectivePct = Math.round(effectiveFraction * 100);
      let stateTag = 'frozen';
      if (isFull) stateTag = 'full';
      else if (recovered) stateTag = 'recovered';
      else if (resetAtMs > nowMs) stateTag = 'recovering';

      return {
        window: (b && (b.window || b.bucketWindow || b.displayName)) || 'quota',
        recordedPct,
        effectiveFraction,
        effectivePct,
        resetAtMs,
        remainingMs,
        isFull,
        recovered,
        state: stateTag
      };
    }

    function evaluateSnapshotClient(acc, activeAccountId, nowMs) {
      const rawSnap = (acc && (acc.effectiveQuotaSnapshot || acc.quotaSnapshot)) || null;
      if (!rawSnap || !Array.isArray(rawSnap.groups) || rawSnap.groups.length === 0) return null;
      const isActive = Boolean(activeAccountId && acc.id === activeAccountId);
      let minEff = Infinity;
      let sumEff = 0;
      let count = 0;
      let earliestRecMs = 0;
      let hasRecovered = false;
      let hasRecovering = false;

      const groups = rawSnap.groups.map((g) => {
        const buckets = (g.buckets || []).map((b) => {
          const ev = evaluateBucketClient(b, nowMs);
          if (ev.recovered) hasRecovered = true;
          if (ev.state === 'recovering' && ev.resetAtMs > 0) {
            hasRecovering = true;
            if (earliestRecMs === 0 || ev.resetAtMs < earliestRecMs) earliestRecMs = ev.resetAtMs;
          }
          if (ev.effectiveFraction < minEff) minEff = ev.effectiveFraction;
          sumEff += ev.effectiveFraction;
          count++;
          return ev;
        });
        return { displayName: g.displayName || '', buckets };
      });

      return {
        isActive,
        exitedAtMs: Number(rawSnap.exitedAtMs || acc.lastExitedAtMs || 0),
        groups,
        hasRecovered,
        hasRecovering,
        earliestRecoveryAtMs: earliestRecMs,
        minEffectivePct: count > 0 ? Math.round(minEff * 100) : -1,
        score: count > 0 ? Math.round((minEff * 0.6 + (sumEff / count) * 0.4) * 10000) / 100 : -1
      };
    }

    function shortPoolName(displayName) {
      const raw = String(displayName || '').trim();
      const low = raw.toLowerCase();
      if (low === 'gemini models' || low === 'gemini') return 'Gemini';
      if (low.includes('claude') && low.includes('gpt')) return 'Claude/GPT';
      if (low.includes('claude')) return 'Claude';
      if (low.includes('gpt')) return 'GPT';
      return raw.replace(/^gemini\s+\d+(?:\.\d+)?\s+/i, '').replace(/\s+(?:models?|quota|limit)s?$/i, '').slice(0, 14) || raw;
    }

    function sourceLabel(src) {
      const key = 'src_' + String(src || 'manual').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      return ACC_I18N[lang()][key] ? t(key) : String(src || '');
    }

    function applyTranslations() {
      document.querySelectorAll('[data-acc-i18n]').forEach((el) => {
        const key = el.getAttribute('data-acc-i18n');
        if (key) el.textContent = t(key);
      });
      const searchEl = document.getElementById('acc-search-input');
      if (searchEl) searchEl.placeholder = t('searchPlaceholder');
      render();
    }

    function renderHealth(health) {
      const badgeEl = document.getElementById('acc-health-badge');
      const gridEl = document.getElementById('acc-health-grid');
      const issuesEl = document.getElementById('acc-health-issues');
      const healBtn = document.getElementById('acc-heal-btn');
      if (!badgeEl || !gridEl || !issuesEl) return;

      if (!health || !health.checks) {
        badgeEl.className = 'meta-tag';
        badgeEl.textContent = '--';
        gridEl.innerHTML = '';
        issuesEl.classList.add('hidden');
        return;
      }

      const ov = health.overall || 'healthy';
      badgeEl.className = ov === 'critical' ? 'meta-tag is-danger' : ov === 'warn' ? 'meta-tag is-warn' : 'meta-tag is-ok';
      badgeEl.textContent = t(ov === 'critical' ? 'healthCritical' : ov === 'warn' ? 'healthWarn' : 'healthHealthy');

      if (healBtn) {
        healBtn.className = health.canAutoHeal ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      }

      const order = ['osCredential', 'hubSync', 'authLog', 'multiHub', 'keyringMarker'];
      gridEl.innerHTML = order.map((key) => {
        const item = health.checks[key];
        if (!item) return '';
        const cls = item.status === 'error' ? 'is-error' : item.status === 'warn' ? 'is-warn' : '';
        return (
          '<div class="acc-health-chip ' + cls + '">' +
            '<span class="acc-health-chip-lbl">' + esc(item.label) + '</span>' +
            '<span class="acc-health-chip-val" title="' + esc(item.detail) + '">' + esc(item.detail) + '</span>' +
          '</div>'
        );
      }).join('');

      const issues = Array.isArray(health.issues) ? health.issues : [];
      if (issues.length === 0) {
        issuesEl.innerHTML = '';
        issuesEl.classList.add('hidden');
      } else {
        issuesEl.classList.remove('hidden');
        issuesEl.innerHTML = issues.map((iss) => {
          const cls = iss.severity === 'error' ? 'is-error' : 'is-warn';
          return (
            '<div class="acc-health-issue ' + cls + '">' +
              '<strong>' + esc(iss.title) + '</strong>' +
              '<span>' + esc(iss.detail) + '</span>' +
            '</div>'
          );
        }).join('');
      }
    }

    function ensureCountdownTimer() {
      const chips = document.querySelectorAll('.acc-countdown-chip[data-reset-ms]');
      if (chips.length === 0) {
        if (state.cdTimer) {
          clearInterval(state.cdTimer);
          state.cdTimer = null;
        }
        return;
      }
      if (state.cdTimer) return;
      state.cdTimer = setInterval(() => {
        if (document.hidden) return;
        const list = document.querySelectorAll('.acc-countdown-chip[data-reset-ms]');
        if (list.length === 0) {
          clearInterval(state.cdTimer);
          state.cdTimer = null;
          return;
        }
        const now = Date.now();
        let rolledOver = false;
        let liveRolledOver = false;
        list.forEach((chip) => {
          const rstMs = Number(chip.getAttribute('data-reset-ms') || 0);
          if (!rstMs || rstMs <= now) {
            rolledOver = true;
            if (chip.getAttribute('data-is-live') === '1') {
              liveRolledOver = true;
            }
            return;
          }
          const txtEl = chip.querySelector('.acc-cd-text');
          if (txtEl) {
            const fmtKey = chip.getAttribute('data-cd-fmt') || 'fullInFmt';
            txtEl.textContent = t(fmtKey, { cd: formatCountdownClient(rstMs - now, true) });
          }
        });
        if (liveRolledOver && now - state.liveSyncCooldownAtMs >= 5000) {
          state.liveSyncCooldownAtMs = now;
          void refresh(true);
        } else if (rolledOver) {
          render();
        }
      }, 1000);
    }

    function render() {
      const d = state.data;
      const emailEl = document.getElementById('acc-active-email');
      const subEl = document.getElementById('acc-active-sub');
      const badgesEl = document.getElementById('acc-active-badges');
      const hubBadgeEl = document.getElementById('acc-hub-badge');
      const recBanner = document.getElementById('acc-recommend-banner');
      const recText = document.getElementById('acc-recommend-text');
      const recBtn = document.getElementById('acc-recommend-btn');
      const countEl = document.getElementById('acc-count-badge');
      const fullBadgeEl = document.getElementById('acc-full-count-badge');
      const listEl = document.getElementById('acc-list');
      const privBtn = document.getElementById('acc-privacy-btn');
      const tabDot = document.getElementById('ide-tab-dot-accounts');

      if (!d) return;
      const nowMs = Date.now();

      const isMasked = Boolean(d.prefs && d.prefs.privacyMask);
      if (privBtn) {
        privBtn.textContent = t(isMasked ? 'privacyBtnOn' : 'privacyBtn');
      }

      const reloadSel = document.getElementById('acc-pref-reload');
      if (reloadSel && d.prefs) reloadSel.value = d.prefs.reloadAfterSwitch || 'coldRestart';
      const syncChk = document.getElementById('acc-pref-sync-cli');
      if (syncChk && d.prefs) syncChk.checked = d.prefs.syncGeminiCli !== false;
      const syncOnboardChk = document.getElementById('acc-pref-sync-onboarding');
      if (syncOnboardChk && d.prefs) syncOnboardChk.checked = d.prefs.syncOnboardingState !== false;
      const privChk = document.getElementById('acc-pref-privacy');
      if (privChk && d.prefs) privChk.checked = Boolean(d.prefs.privacyMask);
      const healSel = document.getElementById('acc-pref-heal-mode');
      if (healSel && d.prefs) healSel.value = d.prefs.autoHealMode || 'ask';
      const keepFreshChk = document.getElementById('acc-pref-keep-fresh');
      if (keepFreshChk && d.prefs) keepFreshChk.checked = d.prefs.keepFreshBackup !== false;

      renderHealth(d.health);

      if (emailEl) {
        emailEl.textContent = d.activeEmail ? fmtEmail(d.activeEmail) : t('noActiveEmail');
      }
      if (subEl) {
        const parts = [];
        if (d.activeName) parts.push(d.activeName);
        if (d.activeTierName) parts.push(d.activeTierName);
        subEl.textContent = parts.join(' · ') || (d.systemCredentialPresent ? t('sysCredOk') : t('sysCredMissing'));
      }
      if (badgesEl) {
        const badges = [];
        if (d.activeEmail) {
          badges.push(
            '<span class="meta-tag ' + (d.isCaptured ? 'is-ok' : 'is-warn') + '">' +
              esc(t(d.isCaptured ? 'capturedTag' : 'uncapturedTag')) +
            '</span>'
          );
        }
        badges.push(
          '<span class="meta-tag ' + (d.systemCredentialPresent ? 'is-info' : 'is-warn') + '">' +
            esc(t(d.systemCredentialPresent ? 'sysCredOk' : 'sysCredMissing')) +
          '</span>'
        );
        badgesEl.innerHTML = badges.join('');
      }
      if (hubBadgeEl) {
        if (d.activeHubCount > 0) {
          hubBadgeEl.classList.remove('hidden');
          hubBadgeEl.className = d.activeHubCount > 1 ? 'meta-tag is-warn' : 'meta-tag';
          hubBadgeEl.textContent = d.activeHubCount > 1
            ? t('multiHubWarn', { n: d.activeHubCount })
            : t('hubCountFmt', { n: d.activeHubCount });
        } else {
          hubBadgeEl.classList.add('hidden');
        }
      }

      if (recBanner && recText && recBtn) {
        if (d.recommendation && d.recommendation.accountId) {
          const targetLbl = d.recommendation.alias
            ? d.recommendation.alias + ' (' + fmtEmail(d.recommendation.email) + ')'
            : fmtEmail(d.recommendation.email);
          recText.textContent = t('recommendFmt', {
            active: d.recommendation.activeMinPct,
            target: targetLbl,
            cand: d.recommendation.candidateMinPct
          });
          recBtn.setAttribute('data-rec-id', d.recommendation.accountId);
          recBanner.classList.remove('hidden');
        } else {
          recBanner.classList.add('hidden');
        }
      }

      if (tabDot) {
        if (d.health && d.health.overall === 'critical') tabDot.className = 'tab-dot is-danger';
        else if (!d.systemCredentialPresent || (d.health && d.health.overall === 'warn') || d.recommendation) tabDot.className = 'tab-dot is-warn';
        else tabDot.className = 'tab-dot';
      }

      const allAccounts = Array.isArray(d.accounts) ? d.accounts : [];
      if (countEl) countEl.textContent = String(allAccounts.length);

      const evaluatedMap = new Map();
      let fullReadyCount = 0;
      for (const acc of allAccounts) {
        const ev = evaluateSnapshotClient(acc, d.activeAccountId, nowMs);
        evaluatedMap.set(acc.id, ev);
        if (ev && ev.minEffectivePct >= 99) fullReadyCount++;
      }
      if (fullBadgeEl) {
        fullBadgeEl.className = fullReadyCount > 0 ? 'meta-tag is-ok' : 'meta-tag';
        fullBadgeEl.textContent = t('fullReadyFmt', { full: fullReadyCount, total: allAccounts.length });
      }

      if (!listEl) return;
      if (allAccounts.length === 0) {
        listEl.innerHTML = '<div class="acc-empty"><div>' + esc(t('emptyHint')) + '</div></div>';
        ensureCountdownTimer();
        return;
      }

      const q = state.search.trim().toLowerCase();
      let filtered = allAccounts.filter((acc) => {
        if (!q) return true;
        return (
          String(acc.email || '').toLowerCase().includes(q) ||
          String(acc.alias || '').toLowerCase().includes(q) ||
          String(acc.name || '').toLowerCase().includes(q) ||
          String(acc.tierName || '').toLowerCase().includes(q)
        );
      });

      filtered = filtered.slice().sort((a, b) => {
        if (state.sort === 'quota') {
          const ea = evaluatedMap.get(a.id);
          const eb = evaluatedMap.get(b.id);
          const sa = ea ? ea.score : -1;
          const sb = eb ? eb.score : -1;
          if (sb !== sa) return sb - sa;
          const ra = ea ? ea.earliestRecoveryAtMs : 0;
          const rb = eb ? eb.earliestRecoveryAtMs : 0;
          if (ra > 0 && rb > 0 && ra !== rb) return ra - rb;
          if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1;
        }
        const aAct = a.id === d.activeAccountId ? 1 : 0;
        const bAct = b.id === d.activeAccountId ? 1 : 0;
        if (aAct !== bAct) return bAct - aAct;
        if (state.sort === 'email') {
          return String(a.email || '').localeCompare(String(b.email || ''));
        }
        return (b.lastSwitchedAtMs || b.updatedAtMs || 0) - (a.lastSwitchedAtMs || a.updatedAtMs || 0);
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="acc-empty"><div>' + esc(t('noSearchMatch')) + '</div></div>';
        ensureCountdownTimer();
        return;
      }

      const cardsHtml = filtered.map((acc) => {
        const isCurrent = acc.id === d.activeAccountId;
        const ev = evaluatedMap.get(acc.id);
        const minPct = ev ? ev.minEffectivePct : -1;
        const dotCls = isCurrent
          ? 'is-active'
          : minPct >= 0 && minPct <= 10
            ? 'is-danger'
            : minPct >= 0 && minPct <= 25
              ? 'is-warn'
              : '';
        const shownEmail = fmtEmail(acc.email);
        const titleText = acc.alias ? acc.alias : shownEmail;

        let sublineHtml = '';
        if (acc.alias) {
          sublineHtml += '<div class="acc-card-email">' + esc(shownEmail) + '</div>';
        }
        if (!isCurrent && ev && ev.exitedAtMs > 0) {
          sublineHtml += '<div class="acc-card-subline">' + esc(formatExitedTimeLine(ev.exitedAtMs, nowMs)) + '</div>';
        }

        let quotaHtml = '<div class="muted-note">' + esc(t('quotaUnknown')) + '</div>';
        if (ev && ev.groups.length > 0) {
          quotaHtml = '<div class="acc-mini-quotas">' + ev.groups.map((g) => {
            const buckets = g.buckets || [];
            const b5 = buckets.find((b) => b.window === '5h') || buckets[0];
            if (!b5) return '';

            const barPct = isCurrent ? b5.recordedPct : (b5.recovered ? 100 : b5.recordedPct);
            const fillColor = barPct <= 10 ? 'var(--danger)' : barPct <= 25 ? 'var(--warn)' : 'var(--ok)';

            let rightHtml = '';
            let valCls = '';
            let tipAttr = '';

            if (isCurrent) {
              if (b5.remainingMs > 0) {
                rightHtml =
                  '<span>' + b5.recordedPct + '%</span>' +
                  '<span class="acc-countdown-chip" data-is-live="1" data-reset-ms="' + b5.resetAtMs + '" data-cd-fmt="resetInFmt">' +
                    '<span class="acc-cd-text">' + esc(t('resetInFmt', { cd: formatCountdownClient(b5.remainingMs, true) })) + '</span>' +
                  '</span>';
              } else {
                rightHtml = '<span>' + b5.recordedPct + '%</span>';
              }
            } else if (b5.state === 'recovered') {
              valCls = 'is-recovered';
              tipAttr = ' title="' + esc(t('exitRecordedTip', { pct: b5.recordedPct })) + '"';
              rightHtml = '<span>' + esc(t('recoveredLabel')) + '</span>';
            } else if (b5.state === 'recovering') {
              rightHtml =
                '<span>' + b5.recordedPct + '%</span>' +
                '<span class="acc-countdown-chip" data-reset-ms="' + b5.resetAtMs + '" data-cd-fmt="fullInFmt">' +
                  '<span class="acc-cd-text">' + esc(t('fullInFmt', { cd: formatCountdownClient(b5.remainingMs, true) })) + '</span>' +
                '</span>';
            } else {
              rightHtml = '<span>' + b5.effectivePct + '%</span>';
            }

            return (
              '<div class="acc-mini-qrow">' +
                '<span class="acc-mini-qname" title="' + esc(g.displayName) + '">' + esc(shortPoolName(g.displayName)) + '</span>' +
                '<div class="acc-mini-qtrack"><div class="acc-mini-qfill" style="width:' + barPct + '%;background:' + fillColor + '"></div></div>' +
                '<span class="acc-mini-qval ' + valCls + '"' + tipAttr + '>' + rightHtml + '</span>' +
              '</div>'
            );
          }).join('') + '</div>';
        }

        const stateTagHtml = isCurrent
          ? '<span class="meta-tag is-info">' + esc(t('liveRealtimeTag')) + '</span>'
          : ev && ev.hasRecovered && !ev.hasRecovering
            ? '<span class="meta-tag is-ok">' + esc(t('recoveredTag')) + '</span>'
            : ev && ev.hasRecovering
              ? '<span class="meta-tag is-info">' + esc(t('recoveringTag')) + '</span>'
              : '';

        const isSwitchingThis = state.switchingId === acc.id;
        return (
          '<article class="acc-card ' + (isCurrent ? 'is-current' : '') + '">' +
            '<div class="acc-card-head">' +
              '<div class="acc-card-title-wrap">' +
                '<div class="acc-card-title-line">' +
                  '<span class="acc-dot ' + dotCls + '"></span>' +
                  '<span class="acc-card-title" title="' + esc(titleText) + '">' + esc(titleText) + '</span>' +
                '</div>' +
                sublineHtml +
              '</div>' +
              '<div class="acc-card-tags">' +
                (isCurrent ? '<span class="meta-tag is-ok">' + esc(t('currentTag')) + '</span>' : '') +
                (acc.tierName ? '<span class="meta-tag is-info">' + esc(acc.tierName) + '</span>' : '') +
                (acc.oauthClientKey === 'antigravity_enterprise'
                  ? '<span class="meta-tag is-warn" title="' + esc(t('externalClientTip')) + '">' + esc(t('externalClientTag')) + '</span>'
                  : '') +
                stateTagHtml +
                '<span class="meta-tag">' + esc(sourceLabel(acc.source)) + '</span>' +
              '</div>' +
            '</div>' +
            quotaHtml +
            '<div class="acc-card-foot">' +
              '<span class="meta-tag ' + (acc.hasRefreshToken ? '' : 'is-warn') + '">' +
                esc(t(acc.hasRefreshToken ? 'refreshTokenTag' : 'accessOnlyTag')) +
              '</span>' +
              '<div class="acc-card-actions">' +
                (isCurrent
                  ? ''
                  : '<button type="button" class="btn btn-primary btn-sm" data-acc-action="switch" data-acc-id="' + esc(acc.id) + '"' + (isSwitchingThis ? ' disabled' : '') + '>' +
                      esc(t(isSwitchingThis ? 'switchingBtn' : 'switchBtn')) +
                    '</button>') +
                '<button type="button" class="btn btn-ghost btn-sm" data-acc-action="rename" data-acc-id="' + esc(acc.id) + '">' + esc(t('renameBtn')) + '</button>' +
                '<button type="button" class="btn btn-ghost btn-sm acc-btn-danger" data-acc-action="delete" data-acc-id="' + esc(acc.id) + '">' + esc(t('deleteBtn')) + '</button>' +
              '</div>' +
            '</div>' +
          '</article>'
        );
      });

      listEl.innerHTML = cardsHtml.join('');
      ensureCountdownTimer();
    }

    async function callHost(type, payload) {
      return window.__agyIdeBridge.accountCall(type, payload);
    }

    async function refresh(forceQuota) {
      if (state.loading && !forceQuota) return;
      state.loading = true;
      try {
        const res = await callHost('accountState', { forceQuota: Boolean(forceQuota) });
        state.data = res && res.data ? res.data : res;
        render();
      } catch (err) {
        const listEl = document.getElementById('acc-list');
        if (listEl && !state.data) {
          listEl.innerHTML = '<div class="muted-note">' + esc(err && err.message ? err.message : String(err)) + '</div>';
        }
      } finally {
        state.loading = false;
      }
    }

    async function switchAccountById(id) {
      if (!id || state.switchingId) return;
      const acc = state.data && Array.isArray(state.data.accounts)
        ? state.data.accounts.find((a) => a.id === id)
        : null;
      const targetLabel = acc ? (acc.alias ? acc.alias + ' (' + fmtEmail(acc.email) + ')' : fmtEmail(acc.email)) : id;
      const reloadMode = (state.data && state.data.prefs && state.data.prefs.reloadAfterSwitch) || 'coldRestart';
      const confirmKey = reloadMode === 'coldRestart' ? 'confirmSwitchCold' : 'confirmSwitch';
      const confirmed = await window.__agyIdeBridge.confirm(t(confirmKey, { target: targetLabel }));
      if (!confirmed) return;

      state.switchingId = id;
      render();
      try {
        const res = await callHost('accountSwitch', { accountId: id });
        if (res && res.data && res.data.ok === false) {
          window.__agyIdeBridge.alert(res.data.error || 'Switch failed');
        }
        await refresh(false);
      } catch (err) {
        window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
      } finally {
        state.switchingId = '';
        render();
      }
    }

    async function handleListClick(ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-acc-action]') : null;
      if (!btn) return;
      const action = btn.getAttribute('data-acc-action');
      const id = btn.getAttribute('data-acc-id');
      if (!action || !id) return;

      if (action === 'switch') {
        await switchAccountById(id);
        return;
      }
      if (action === 'rename') {
        try {
          await callHost('accountRename', { accountId: id });
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
        return;
      }
      if (action === 'delete') {
        const acc = state.data && Array.isArray(state.data.accounts)
          ? state.data.accounts.find((a) => a.id === id)
          : null;
        const targetLabel = acc ? fmtEmail(acc.email) : id;
        const ok = await window.__agyIdeBridge.confirm(t('confirmDelete', { target: targetLabel }));
        if (!ok) return;
        try {
          await callHost('accountDelete', { accountId: id });
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      }
    }

    window.__agyAccountUi = {
      refresh,
      applyTranslations,
      onFilterChange() {
        const searchEl = document.getElementById('acc-search-input');
        const sortEl = document.getElementById('acc-sort-select');
        state.search = searchEl ? searchEl.value : '';
        state.sort = sortEl ? sortEl.value : 'quota';
        render();
      },
      async captureCurrent() {
        try {
          await callHost('accountCapture', {});
          await refresh(true);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async oauthLogin() {
        try {
          await callHost('accountOAuthLogin', {});
          await refresh(true);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async importTools() {
        try {
          await callHost('accountImportTools', {});
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async importJson() {
        try {
          await callHost('accountImportFile', {});
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async exportJson() {
        try {
          await callHost('accountExport', {});
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async savePrefs() {
        const reloadEl = document.getElementById('acc-pref-reload');
        const syncEl = document.getElementById('acc-pref-sync-cli');
        const syncOnboardEl = document.getElementById('acc-pref-sync-onboarding');
        const privEl = document.getElementById('acc-pref-privacy');
        const healEl = document.getElementById('acc-pref-heal-mode');
        const keepFreshEl = document.getElementById('acc-pref-keep-fresh');
        try {
          await callHost('accountSavePrefs', {
            prefs: {
              reloadAfterSwitch: reloadEl ? reloadEl.value : 'coldRestart',
              syncGeminiCli: syncEl ? Boolean(syncEl.checked) : true,
              syncOnboardingState: syncOnboardEl ? Boolean(syncOnboardEl.checked) : true,
              privacyMask: privEl ? Boolean(privEl.checked) : false,
              autoHealMode: healEl ? healEl.value : 'ask',
              keepFreshBackup: keepFreshEl ? Boolean(keepFreshEl.checked) : true
            }
          });
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async recheckHealth() {
        try {
          const res = await callHost('accountHealth', {});
          const h = res && res.data ? res.data : res;
          if (state.data) {
            state.data.health = h;
            render();
          }
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async healAccount() {
        try {
          const res = await callHost('accountHeal', {});
          const payload = res && res.data ? res.data : res;
          if (payload && payload.ok === false && payload.error) {
            window.__agyIdeBridge.alert(payload.error);
          }
          await refresh(true);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      },
      async togglePrivacy() {
        const cur = Boolean(state.data && state.data.prefs && state.data.prefs.privacyMask);
        try {
          await callHost('accountSavePrefs', { prefs: { privacyMask: !cur } });
          await refresh(false);
        } catch (err) {
          window.__agyIdeBridge.alert(err && err.message ? err.message : String(err));
        }
      }
    };

    document.addEventListener('DOMContentLoaded', () => {
      const listEl = document.getElementById('acc-list');
      if (listEl) {
        listEl.addEventListener('click', (ev) => {
          void handleListClick(ev);
        });
      }
      const recBtn = document.getElementById('acc-recommend-btn');
      if (recBtn) {
        recBtn.addEventListener('click', () => {
          const recId = recBtn.getAttribute('data-rec-id');
          if (recId) void switchAccountById(recId);
        });
      }
      applyTranslations();
      void refresh(false);
    });
  })();
  </script>`;
}

module.exports = {
  getAccountCss,
  getAccountPaneHtml,
  getAccountClientScript
};
