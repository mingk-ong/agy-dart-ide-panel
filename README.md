# agy-dart 融合控制台扩展 (`agy-dart-ide-panel`)

面向 **Antigravity IDE**（VS Code 架构）的独立侧边栏与全宽融合控制面板扩展，**零外部运行期依赖**，无需开启 `--remote-debugging-port` 调试端口即可在一处统一使用 **`agy-dart` 上下文护栏与缓存诊断** 及 **`agy-capsule` 实时 API 遥测、多模型配额与用量看板**。

## 核心能力

### 1. 页签一：实时遥测与用量（Capsule 引擎）
- **精确 API 上下文拆解**：直接只读解码本地 `conversations/<uuid>.db` Protobuf 数据，展示首轮基线 / 读取增量 / 思考累计 / 回复写入 4 项真实数值与占比、模型精确上限、压缩断点识别与 75% / 90% 过载变色预警。
- **生成速度、TTFT 与本轮统计**：实时计算最近一次请求生成速度（`tok/s`）、含 15 秒保色状态指示点（绿 ≥25 / 黄 10–25 / 红 <10）、`TTFT–总耗时` 范围及本轮累计耗时 / 请求数 / 思考 / 写入。
- **8 类请求报错归因与首字等待预警**：自动识别 `429 限流`、`额度耗尽`、`上下文超限`、`请求超时`、`断连`、`认证异常`、`服务繁忙` 等故障，并支持慢首字等待超时计时提醒。
- **多模型配额池**：自动发现本机 `daemon/hub_*.json` 并查询 5 小时 / 每周配额余量、重置倒计时与订阅层级。
- **历史 Token 用量看板（按需增量扫描）**：今日 / 本周 / 本月 / 累计汇总、53 周 GitHub 风格每日 / 每周活动热力图，以及按模型系列归并的日 / 周 / 月堆叠柱状图。

### 2. 页签二：护栏与缓存诊断（agy-dart 引擎）
- 完整托管并代理本机已安装的 `agy-dart` 仪表盘与 15 个 `/api/*` 接口（上下文节省率、KV-Cache 命中率 / 水位 / TTL 倒计时、Handoff 交接简报、FTS5 本地索引检索、豁免文件类型与存储压缩）。

### 3. 底部状态栏 3 枚微胶囊 & 快捷命令
- **主胶囊**：上下文占比 + `agy-dart` 节省率 / 暂停提醒。
- **缓存与速度 / 报错 / 等待胶囊**：实时展示 Prompt 缓存冷热状态与 `tok/s`，遇到请求失败或首字慢等待自动变色提醒。
- **配额胶囊**：展示当前活跃模型池的 5 小时 / 每周余量及完整悬停详情。

## 安装方式

### 方式一：从 GitHub Releases 下载安装（推荐）
1. 前往本仓库 [Releases](https://github.com/mingk-ong/agy-dart-ide-panel/releases) 页面下载最新版本的 `.vsix` 安装包（例如 `agy-dart-ide-panel-2.2.2.vsix`）。
2. 在 Antigravity IDE 中按 `Ctrl+Shift+P` 执行 **`Extensions: Install from VSIX...`**，或在终端运行：
   ```powershell
   antigravity-ide --install-extension .\agy-dart-ide-panel-2.2.2.vsix --force
   ```

### 方式二：从源码本地打包安装
需要本机已安装 **Node.js >= 22**（零 `npm install` 外部依赖）：

```powershell
git clone https://github.com/mingk-ong/agy-dart-ide-panel.git
cd agy-dart-ide-panel
npm test
npm run package
antigravity-ide --install-extension .\agy-dart-ide-panel-2.2.2.vsix --force
```

## 常用配置项

- `agyDartPanel.defaultTab`：默认展示主页签（`capsule` 实时遥测 | `dart` 护栏诊断）。
- `agyDartPanel.statusBar.enabled` / `.showCache` / `.showSpeed` / `.showQuota`：控制底部状态栏各微胶囊显隐。
- `agyDartPanel.refreshIntervalSec`：轮询刷新间隔（3–60 秒，默认 8 秒）。
- `agyDartPanel.capsule.cacheWarnMin` / `cacheColdMin` / `queueWarnSec`：缓存变黄 / 变红分钟数与首字等待阈值秒数。
- `agyDartPanel.pluginPath` / `agyDartPanel.nodePath`：可选自定义 `agy-dart` 插件目录或 Node.js (>=22) 路径（留空则自动探测）。

## 致谢与许可

- 本项目基于 [MIT License](LICENSE) 开源。
- 第三方协议声明与致谢详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（参考并适配了 MIT 许可的 `agy-dart` 与 `agy-capsule`）。
