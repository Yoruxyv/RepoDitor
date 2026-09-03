<p align="center">
  <img src="https://img.shields.io/badge/Electron-43.3.0-47848F?logo=electron&logoColor=white" alt="Electron 43.3.0">
  <img src="https://img.shields.io/badge/React-19.2.8-61DAFB?logo=react&logoColor=white" alt="React 19.2.8">
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white" alt="Python 3.11 or newer">
  <img src="https://img.shields.io/github/v/release/Yoruxyv/RepoDitor?label=release" alt="Latest release">
  <img src="https://img.shields.io/github/actions/workflow/status/Yoruxyv/RepoDitor/quality.yml?branch=main&label=Quality" alt="Quality workflow">
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4?logo=windows11&logoColor=white" alt="Windows x64">
  <img src="https://img.shields.io/badge/license-MIT-22C55E" alt="MIT License">
</p>

<div align="center">

# RepoDitor

### 用一个专注的 Windows 桌面应用查看和编辑本地 R.E.P.O. 存档 — 无需 BepInEx

RepoDitor 是一个非官方、独立运行的 Electron 存档编辑器，用于处理本地 R.E.P.O. `.es3` 数据。

桌面界面只提供范围明确、带类型约束的操作；随应用打包的 Python backend 负责存档解析、验证、备份、游戏语义和加密写入。

RepoDitor 独立于游戏运行，不需要 BepInEx、mod loader，也无需安装到 R.E.P.O. 游戏目录。

<sub>概览 · 玩家 · 升级 · 游戏进度 · 物品 · 外观 · 地图</sub>

[下载最新版本](https://github.com/Yoruxyv/RepoDitor/releases/latest)

</div>

<p align="center">
  <a href="README.md">
    <img src="https://img.shields.io/badge/EN-English-555?style=flat-square" alt="English">
  </a>
  <a href="README.zh-CN.md">
    <img src="https://img.shields.io/badge/ZH-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-555?style=flat-square" alt="简体中文">
  </a>
  <a href="README.id.md">
    <img src="https://img.shields.io/badge/ID-Bahasa%20Indonesia-555?style=flat-square" alt="Bahasa Indonesia">
  </a>
</p>

---

> [!IMPORTANT]
> 打开或编辑存档前，请先关闭 R.E.P.O.。RepoDitor 是非官方社区工具，
> 与 semiwork 没有关联。重要数据建议自行备份；游戏更新可能改变存档格式或行为。

## ✨ 功能

### 游戏存档

| 工作区 | 当前支持 |
|---|---|
| **概览** | 查看选中的游戏存档、摘要和待处理更改 |
| **玩家** | 编辑当前生命值、恢复至 Python 计算出的最大生命值，并可显示 Steam 头像 |
| **升级** | 编辑从存档中动态发现的升级；可用时补充本地安装的元数据和图像 |
| **游戏进度** | 通过带类型约束且经过验证的字段编辑受支持的游戏进度数值 |
| **物品** | 搜索、筛选和排序已发现的物品实例；只有在已安装元数据确认物品类型可充电，并且该具体实例确实保存了电量时，才可暂存 **充电**（充满）操作 |
| **地图** | 列出本地已安装地图，不注入代码，也不会强制选择地图 |

### 外观 / MetaSave

外观有独立的工作区和安全写入生命周期，不依赖当前选中的 Run 存档。
如果兼容的已安装元数据可用，RepoDitor 会显示游戏提供的显示名称、类型、
稀有度、可选的本地图标、拥有数量以及已保存预设数量。目录支持搜索、
按所有权/类型筛选以及排序，但展示用元数据不会被当作允许修改存档的依据。

当前支持的操作：

- 解锁一个符合条件的未解锁外观，或 **解锁全部外观**；
- **锁定全部外观**，但仅限没有任何已知已拥有外观正在装备、被预设引用，
  或存在其他不安全移除情况时；
- **清除全部预设**，清空成对保存的外观/颜色预设槽位。

可修改范围仍仅限于独立验证过的 `0..546` 边界内、且已安装的 ID。
未知或未来新增的外观 ID 会以只读方式保留。RepoDitor 不支持编辑 token、
任意装备/颜色，也不支持任意创建或编辑预设，因为这些游戏语义目前还没有
建立足够安全的依据。

## 🖼️ 预览

| 游戏存档概览 | 外观目录 |
|---|---|
| ![RepoDitor 概览，显示选中存档的摘要和编辑器导航](docs/screenshots/repoditor-overview.png) | ![RepoDitor 外观目录，显示已安装元数据、本地图标、筛选和批量操作](docs/screenshots/cosmetic-unlocker.png) |

| 玩家编辑 | 玩家升级 |
|---|---|
| ![RepoDitor 玩家编辑器，显示选中玩家的生命值](docs/screenshots/repoditor-player-editor.png) | ![RepoDitor 玩家升级界面，显示可用的升级选项](docs/screenshots/repoditor-upgrades-editor.png) |

| 游戏进度编辑 | 卡车物品充电 |
|---|---|
| ![RepoDitor 游戏进度编辑器，包含带类型约束的关卡、货币、生命数、收获和继续位置字段](docs/screenshots/repoditor-run-editor.png) | ![RepoDitor 在保存前暂存多个受支持的物品充电操作](docs/screenshots/recharge-truck-items.png) |

### 手动游戏内兼容性检查

![R.E.P.O. 加载修改后的关卡、升级、生命值、能量和物品电量](docs/screenshots/repoditor-absurd-level.png)

图中是一个修改了夸张关卡数值、升级、生命值、能量和物品电量的 R.E.P.O. 游戏存档。
RepoDitor 的修改会写入本地存档文件，游戏会在下次加载时读取这些数据。

## 🚀 快速开始

### 要求

- Windows x64
- 本地已安装 R.E.P.O.，并且已有存档

### 安装

1. 打开[官方 GitHub Releases 页面](https://github.com/Yoruxyv/RepoDitor/releases/latest)。
2. 下载 `RepoDitor-Setup-<version>-x64.exe` 以及对应的 `.sha256` 文件。
3. 按下面的说明验证校验和，然后运行带安装向导的安装程序。

安装后的应用已经包含 Python backend。正常使用不需要另外安装 Python、
Node.js、npm 或 `uv`。

RepoDitor 会在当前 Windows 账户的 R.E.P.O. 存档目录下查找
`REPO_SAVE_*.es3`。文件名中包含 `BACKUP` 的文件不会进入自动发现结果。

更新需要手动完成；RepoDitor 不会安装自动更新器或后台服务。
可以通过 **Windows 设置 → 应用 → 已安装的应用 → RepoDitor** 卸载。
卸载 RepoDitor 不会删除 R.E.P.O. 存档，也不会删除 RepoDitor 创建的
`.bak-*` 备份。

## 🛡️ 存档安全

R.E.P.O. 可能会把存档状态留在内存里，之后再写回磁盘。因此，如果在游戏运行时
编辑存档，RepoDitor 可能读到已经过期的磁盘数据，或者修改结果之后又被游戏写回的
存档覆盖。启动和窗口重新获得焦点时的检查会让界面状态保持最新；与此同时，
Python 的写入边界会独立要求：加载源存档前必须确认游戏已关闭，并且真正持久化前
还要再次确认。只要进程状态无法确定，就会按安全失败处理并拒绝继续写入。

写入流程如下：

1. 在确认 **保存更改** 之前，所有编辑只保留在内存中。
2. Python 加载并验证当前源文件，然后把它的 SHA-256 与打开存档时记录的
   fingerprint 进行比较。
3. 带类型约束的修改会先经过验证并应用到内存中，随后再次检查游戏进程。
4. repository 会重新读取源文件，要求内容逐字节完全一致，并在源文件旁创建
   带时间戳的逐字节完整备份。
5. 加密输出先写入 staging 文件，再重新打开、解密、验证，并与预期数据比较。
6. 在 staging 文件以原子方式替换源文件之前，还会最后再检查一次源文件。

这些措施可以降低风险，但不能保证抵御未来所有游戏格式变化，也不能杜绝所有形式的数据丢失。

## ✅ 验证 Windows 下载文件

对于未签名或信誉较低的 build，Windows SmartScreen 可能会显示
**Unknown Publisher** 或“无法识别的应用”之类的警告。请只从 RepoDitor
官方 GitHub Releases 页面下载。源码和 build workflow 都是公开的，
发布的安装程序也会附带 SHA-256 校验和文件。

把两个文件放在同一个目录，然后在 PowerShell 中运行：

```powershell
Get-FileHash .\RepoDitor-Setup-<version>-x64.exe -Algorithm SHA256
Get-Content .\RepoDitor-Setup-<version>-x64.exe.sha256
```

两个十六进制 hash 必须完全一致，字母大小写可以忽略。校验和一致能确认下载的文件
与发布的 artifact 一致，但仅凭这一点不能确认发布者身份。历史上的 v0.1.0 安装程序
没有签名。当前 release workflow 已经准备为官方 tagged build 强制使用
Microsoft cloud signing，但仅从 repository 本身无法证明维护者自己的签名凭据
是否已经配置完成。

## 🔐 安全模型

renderer 在 sandbox 中运行，并启用了 `contextIsolation: true` 和
`nodeIntegration: false`。它不能读取任意文件、启动进程、解密存档、
调用任意 IPC，也不会接收到原始的已解密存档 JSON。

Steam 头像补充是可选功能，而且采用 fail-soft 方式：只会查询格式合理的 Steam ID；
返回的图片 URL 必须通过严格的 HTTPS host 验证；profile 数据也永远不会写入存档。
GitHub stars 只通过带类型约束的 Electron IPC 请求一个固定的元数据 endpoint，
成功结果会在当前 session 中缓存；renderer 不会获得可用于任意网络请求的 fetch API。

这些就是当前会在后台发起网络请求的可选功能。项目链接只有在用户主动操作后才会
在外部打开；当前源码中没有 analytics 或 telemetry 集成。

如需私下报告安全漏洞，请查看 [SECURITY.md](SECURITY.md)。

## 🔎 开源与本地数据

RepoDitor 是开源项目。Electron 桌面应用、Python 存档 backend、打包配置以及
CI/release workflow 都可以在这个 repository 中查看，也可以按照文档里的开发和
打包命令自行从源码构建。公开源码本身并不能证明你下载的 binary 与源码完全一致；
发布的 checksum 验证的是 artifact 完整性，而不是代码安全性或发布者身份。

存档解析、验证和编辑都在随应用打包的本地 Python backend 中完成。原始的已解密存档
JSON 会始终留在 Python 桌面边界后面，不会暴露给 React，也不会上传到远程存档处理服务。
应用会读取固定的 R.E.P.O. 存档与 MetaSave 位置、Steam 安装元数据、受支持的已安装游戏
数据文件，以及 R.E.P.O. 由游戏生成的图标 cache。只有用户明确执行受支持的保存操作时，
RepoDitor 才会写入存档；备份和临时 staging 文件会创建在源文件旁边。renderer 偏好设置
以及派生的展示/目录 cache 则保存在 RepoDitor 自己的应用数据目录中。

有两个可选功能会发起范围严格受限的网络请求：GitHub 项目元数据只从固定的 RepoDitor
repository endpoint 读取；Steam 头像补充则会把从存档中得到、格式合理的 Steam ID
发送到对应的公开 Steam profile endpoint，然后只接受 allowlist 中 HTTPS host 返回的头像。
这两类请求都不会收到存档文件或原始已解密存档数据。当前应用源码和依赖中没有 analytics、
广告 SDK、使用 telemetry、崩溃报告上传或远程日志集成。

## 💾 存档新鲜度与展示缓存

存档的权威数据来源与展示缓存是刻意分开的：

| 数据 | 当前行为 |
|---|---|
| **存档状态** | 每次明确打开存档时，都会让 Python 读取、解密并验证当前 `.es3`，然后只返回带类型约束的投影数据和源文件 fingerprint。已解密的存档 JSON 不会持久化。只有在另一次打开操作确认 fingerprint 仍然相同时，renderer 才能在当前应用 session 内复用已经准备好的编辑器数据；成功写入后，该缓存条目会失效。 |
| **游戏生成的物品/外观图标** | PNG 仍保存在 R.E.P.O. 的 LocalLow 图标 cache 中。Electron 通过不透明的内存 token 提供验证过的文件；cache 路径和文件名不会传入 React。 |
| **派生的升级图像** | Python 从已安装游戏中解析并解码受支持的 texture。Electron 把验证后的派生 PNG 保存在 `%APPDATA%\repoditor-desktop\presentation`，只有受监控的源文件 identity 没有变化时才会复用；未被引用的派生 PNG 会被清理。如果条目缺失、变化、格式异常或无法读取，则重新生成，或者回退到 Phosphor 图标。 |
| **已安装外观元数据** | `%LOCALAPPDATA%\RepoDitor\cache\cosmetics` 下的派生目录 cache 只有在 schema、Steam build、游戏根目录以及相关已安装文件 identity 都仍然匹配时才会被接受。它只提供展示数据，绝不会作为所有权证据或允许修改存档的依据。 |

主题和语言偏好使用 renderer storage。RepoDitor 只有在用户明确执行受支持的保存操作后
才会写入 R.E.P.O. 数据；备份创建在源文件旁边，而不是展示 cache 中。

重启 RepoDitor 后，如果要检查派生展示 cache，可以运行：

```powershell
.\desktop\scripts\check-presentation-cache.ps1
```

这个只读脚本会把 `manifest.json` 与保存的 hash 命名 PNG 进行比较，并报告未被引用或缺失的 artifact。

## 🌐 语言与外观

RepoDitor 支持 **深色**、**浅色** 和 **跟随系统** 三种主题。主题和语言偏好
保存在 renderer 的本地 storage 中；选择跟随系统时，会使用 Windows 当前的外观设置。

RepoDitor 自己的界面目前提供：

- English
- Japanese (日本語)
- Korean (한국어)
- Simplified Chinese (中文)
- Indonesian (Bahasa Indonesia)

日语和韩语翻译最初借助 AI 完成，目前还没有经过完整的母语/流利使用者审核。
欢迎熟悉这些语言的用户帮忙校对和改进。

游戏本身提供的字符串——例如玩家名称、物品名称、地图名称以及从存档中读取的数值——
会保持原样，不会经过 RepoDitor 的 UI 本地化层翻译。界面也会遵循 reduced-motion
偏好；本地交互音效只是装饰性反馈，不依赖它也能理解应用当前状态。

## 🧠 工作原理

```text
React renderer
  ↓ typed feature calls
Sandboxed Electron preload
  ↓ narrow IPC contracts
Electron main process
  ↓ structured requests
Bundled Python desktop API
  ↓
Services → core/storage → encrypted .es3 data
```

Run 存档和 MetaSave 各自使用独立的 fingerprint、待处理更改、备份和保存 session，
同时复用同一个经过验证的加密 repository。游戏语义和存档语义仍以 Python 为权威。

在已经验证过的结构允许时，存档和已安装内容会动态发现。针对特定 build 的本地游戏
reader 使用明确的兼容性 gate；如果存在不确定性，展示或功能会退化为不可用/未知，
而不是扩大允许修改存档的范围。更详细的边界说明请查看
[架构文档](docs/architecture/architecture.md) 和
[逆向工程记录](docs/research/reverse-engineering.md)。

## 🧪 质量与测试

自动化测试只使用生成或经过脱敏处理的 fixture 和临时副本，绝不会使用真实用户存档。
repository 会检查 Python 格式和测试、renderer import 边界、lint、TypeScript build、
组件/contract 测试、Windows Electron E2E、package 内容、无需 Vite 的 packaged E2E
以及安装程序结构。

```powershell
uv run ruff check python tests
uv run ruff format --check python tests
uv run mypy
uv run --locked --no-dev --group test pytest

Set-Location desktop
npm run imports:check
npm run format:check
npm run lint
npm run release:check
npm run build
npm run bundle:check
npm test
npm run test:e2e
```

## 🛠️ 开发

开发需要 `uv`、Python 3.11 或更新版本，以及 Node.js 24。

```powershell
git clone https://github.com/Yoruxyv/RepoDitor.git
Set-Location RepoDitor
uv sync --locked

Set-Location desktop
npm ci
npm run dev
```

架构、证据、隐私和 pull request 要求请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📦 打包与发布

在 `desktop/` 下运行 `npm run package`，会构建一个锁定依赖的 Python 3.13
PyInstaller **onedir** sidecar、生产版 Electron 应用、未打包的 packaged smoke test、
带安装向导的 NSIS 安装程序，并在 `desktop/release/` 下执行本地 artifact 验证。
Electron Builder 会把 sidecar 目录安装到 `resources/backend/`，同时保留固定入口
`resources/backend/repoditor-backend.exe`。这条本地构建路径有意不做签名。

官方 tagged GitHub release 使用独立的 fail-closed 签名命令，在生成 SHA-256 文件之前
验证 Authenticode 签名，并且只有现有 package 检查全部通过后才会发布。
如果签名审批或凭据暂时不可用，另一个临时的手动 workflow 可以发布明确标注为未签名的
release；它仍然保留质量、package、packaged-E2E、安装程序和 checksum gate，
只是跳过签名验证。当前要求以及保留的历史 v0.1.0 baseline 请查看
[release checklist](docs/release-checklist.md)。

## ⚠️ 限制

- RepoDitor 针对目前观察到的 R.E.P.O. 加密存档结构开发；游戏更新可能引入不兼容数据。
- 物品功能只支持对具体实例执行 **充电**（充满），并且要求已安装内容确认该物品类型
  可充电，同时存档中也有该实例的电量证据。数值型电量编辑、电池升级写入、购买相关修改，
  以及新增/删除/复制物品仍然禁用。
- 外观支持符合条件的单个解锁、批量解锁、带保护条件的批量锁定，以及清空成对的预设。
  装备、token、任意颜色和任意预设创建/编辑仍不支持；超出已验证修改边界的 ID
  会以只读方式保留。
- 地图仅用于发现；RepoDitor 不会注入代码，也不会强制选择地图。
- Steam 头像补充对于无效、私密、格式异常、无法访问或不受支持的 profile 可能不可用，
  但这不会阻止玩家功能。
- 物品充电能力和解码后的升级图像都针对已经验证的本地游戏布局使用兼容性 gate。
  游戏更新可能让这些能力变为未知，或让图像不可用，但普通的受支持存档读取仍可继续使用。
- RepoDitor 目前只面向 Windows x64，并且没有自动更新器。

## 📚 文档

| 文档 | 用途 |
|---|---|
| [文档索引](docs/README.md) | 技术文档和 release 文档的整理入口 |
| [架构](docs/architecture/architecture.md) | 桌面端边界、职责和数据流 |
| [Electron UI](docs/architecture/electron-ui.md) | renderer identity、响应式布局、外观与无障碍设计 |
| [存档格式](docs/research/save-format.md) | 已确认的加密存档结构 |
| [逆向工程](docs/research/reverse-engineering.md) | 历史证据、当前支持范围以及尚未解决的语义 |
| [Release checklist](docs/release-checklist.md) | 当前 release gate 和历史 v0.1.0 baseline |
| [资源研究](docs/research/asset-research.md) | 本地资源发现证据和再分发边界 |
| [第三方声明](THIRD_PARTY_NOTICES.md) | 打包资源和依赖的 attribution |

## 🤝 参与贡献

欢迎提交范围明确的 bug 报告、功能建议、文档改进和 pull request。
请使用 repository 提供的模板，并且不要公开真实存档、备份、Steam ID、
用户名或本地文件系统路径。

参与贡献前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、
[SECURITY.md](SECURITY.md) 和 [Code of Conduct](CODE_OF_CONDUCT.md)。

## 👤 维护者

<table>
  <tr>
    <td align="center" width="180">
      <a href="https://github.com/Yoruxyv">
        <img src="https://github.com/Yoruxyv.png?size=96" width="96" alt="Hans avatar"><br>
        <b>Hans</b>
      </a>
    </td>
  </tr>
</table>

## 📄 许可证

RepoDitor 使用 [MIT License](LICENSE) 发布。R.E.P.O. 及相关名称的商标或权利
归各自所有者所有。RepoDitor 是非官方存档管理工具，不会再分发 R.E.P.O. 游戏资源。
