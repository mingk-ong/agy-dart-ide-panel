# Antigravity 融合面板 (`agy-fusion-panel`)

面向 **Antigravity IDE**（VS Code 架构）的一站式侧边栏与全宽融合控制面板扩展，**零外部运行期依赖**，由原 `agy-dart-ide-panel` 升级整合而来，在一处统一提供 **实时 API 遥测与多模型配额监控**、**多账号加密保险库与一键无弹窗切换**，以及 **`agy-dart` 上下文护栏与 KV-Cache 诊断**。

## 核心能力

### 1. 页签一：实时遥测与用量（Capsule 引擎）
- **精确 API 上下文拆解**：只读解码本地 `conversations/<uuid>.db` Protobuf 数据，展示首轮基线 / 读取增量 / 思考累计 / 回复写入 4 项真实数值与占比、模型上限及过载预警。
- **生成速度、TTFT 与本轮统计**：实时计算最近一次请求生成速度（`tok/s`）、状态指示点、`TTFT–总耗时` 范围及本轮累计请求统计。
- **8 类请求报错归因与首字等待预警**：自动识别 `429 限流`、`额度耗尽`、`上下文超限`、`请求超时`、`断连`、`认证异常`、`服务繁忙` 等故障。
- **多模型配额池与历史用量看板**：自动探测本机 `daemon/hub_*.json` 查询 5 小时 / 每周配额余量，并提供 53 周热力图与按模型系列统计柱状图。

### 2. 页签二：多账号一键切换（纯本地退出快照 + 实时倒计时）
- **底层 OS 凭据直写 + 冷重启彻底免引导弹窗**：直接读写 Antigravity IDE 真实主凭据（Windows 凭据管理器 `gemini:antigravity` / macOS Keychain / Linux Secret Service），切号前自动备份当前号且写入失败自动回滚；默认切号后通过脱离助手进程先优雅退出 IDE 主进程释放缓存，再原子同步 `state.vscdb` 全部引导完成键（含 `lastLoginUsername` 与 `lastLoginIsGcpTos`）并自动拉起恢复工作区，彻底根治重复弹出「One last thing...」。
- **纯本地「在线实时 + 退出快照 + 满额倒计时」余额追踪**：
  - 当前活跃账号直连本地 Antigravity Hub 展示实时余量；
  - 切走/登出前自动采集并保存退出瞬间余额快照与 `resetTime`；
  - 后台休眠账号零网络请求，纯本地秒级倒计时恢复满额时间，跨过重置点自动翻转为 `100% · 已回满`，并支持「可用余量降序 + 同余量最快回满优先」智能排序与低配额推荐。
- **多来源便捷入库**：支持一键捕获当前账号、官方浏览器 OAuth 登录新增、一次性只读导入 `~/.antigravity_tools` / `~/.gemini`，以及加密或脱敏 JSON 备份导入导出。
- **安全治理与防掉线护盾**：敏感令牌全程加密存放在 VS Code `SecretStorage`；内置 **凭据持续保鲜备份**、**5 维认证健康体检**（OS 主凭据 / 双端同步 / `auth.log` TLS 与 `loginError` 监测 / 多窗口实例 / Keyring 异常标记）与 **一键免重登自愈**。

### 3. 页签三：护栏与缓存诊断（agy-dart 引擎）
- 完整托管并代理本机已安装的 `agy-dart` 仪表盘与 `/api/*` 接口（上下文节省率、KV-Cache 命中率 / TTL 倒计时、Handoff 交接简报、FTS5 本地索引与保护模式一键切换）。

### 4. 底部状态栏 5 枚微胶囊
- **账号胶囊**：显示当前账号别名/邮箱，单击直达左侧账号页；悬停展示套餐简称与仅 Gemini 相关池的 5h / 周额度及恢复倒计时，按可用余量与最快回满排序并可一键秒切。
- **主护栏胶囊**：上下文占比 + `agy-dart` 节省率 / 暂停提醒。
- **缓存与速度 / 报错 / 等待胶囊**：实时提示 Prompt 缓存冷热状态与生成速度。
- **配额胶囊**：展示当前选中模型所属配额池的 5 小时 / 每周余量及悬停详情。

## 安装与从旧版迁移

### 从旧版 `agy-dart-ide-panel` 升级
- 首次激活会自动将旧版全局配置 `agyDartPanel.*` 一次性迁移至 `agyFusion.*`，并保留你的面板视图偏好与语言设置。
- 为避免侧边栏与状态栏重复显示，建议卸载旧扩展：
  ```powershell
  antigravity-ide --uninstall-extension local.agy-dart-ide-panel
  ```

### 安装新版 VSIX
```powershell
antigravity-ide --install-extension .\agy-fusion-panel-4.0.2.vsix --force
```

### 从源码构建与测试
需要本机已安装 **Node.js >= 22**（零 `npm install` 外部依赖）：

```powershell
npm test
npm run package
```

## 常用配置项

- `agyFusion.defaultTab`：默认展示主页签（`capsule` | `accounts` | `dart`）。
- `agyFusion.statusBar.enabled` / `.showAccount` / `.showCache` / `.showSpeed` / `.showQuota`：控制底部状态栏各微胶囊显隐。
- `agyFusion.account.reloadAfterSwitch`：切号后生效策略（`coldRestart` 冷重启免弹窗·推荐 | `ask` 弹窗选择 | `auto` 快速重载 | `none` 仅写凭据）。
- `agyFusion.account.syncGeminiCli`：切号时是否同步更新 `~/.gemini` 兼容凭据文件。
- `agyFusion.account.syncOnboardingState`：冷重启时是否自动原子同步本地 `state.vscdb` 引导完成记录。
- `agyFusion.account.privacyMask`：是否在面板与状态栏对邮箱进行脱敏打码。
- `agyFusion.account.autoHealMode`：检测到凭据丢失或 `loginError` 时的自愈策略（`ask` | `auto` | `notify`）。
- `agyFusion.account.keepFreshBackup`：是否静默持续保鲜同步系统新刷新的 OAuth 令牌。
- `agyFusion.refreshIntervalSec` / `defaultScope` / `pluginPath` / `nodePath`：轮询与运行时配置。

## 许可协议

- 本项目基于 [MIT License](LICENSE) 开源。
- 第三方协议声明详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
