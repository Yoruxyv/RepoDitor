<p align="center">
  <img src="https://img.shields.io/badge/Electron-43.3.0-47848F?style=flat-square&labelColor=1a1a2e&logo=electron&logoColor=white" alt="Electron 43.3.0">
  <img src="https://img.shields.io/badge/React-19.2.8-61DAFB?style=flat-square&labelColor=1a1a2e&logo=react&logoColor=white" alt="React 19.2.8">
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&labelColor=1a1a2e&logo=python&logoColor=white" alt="Python 3.11 or newer">
  <img src="https://img.shields.io/github/v/release/Yoruxyv/RepoDitor?style=flat-square&label=release&labelColor=1a1a2e" alt="Latest release">
  <img src="https://img.shields.io/github/actions/workflow/status/Yoruxyv/RepoDitor/quality.yml?branch=main&style=flat-square&label=Quality&labelColor=1a1a2e" alt="Quality workflow">
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4?style=flat-square&labelColor=1a1a2e&logo=windows11&logoColor=white" alt="Windows x64">
  <img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square&labelColor=1a1a2e" alt="MIT License">
</p>

<p align="center">
  <a href="https://www.nexusmods.com/repo/mods/319">
    <img src="https://img.shields.io/badge/Nexus%20Mods-Official-E6832B?style=flat-square&labelColor=1a1a2e" alt="Nexus Mods">
  </a>
  <a href="https://thunderstore.io/c/repo/p/RepoDitor/RepoDitor/">
    <img src="https://img.shields.io/badge/Thunderstore-Official-23FFB0?style=flat-square&labelColor=1a1a2e&logo=thunderstore&logoColor=white" alt="Thunderstore">
  </a>
</p>

<p align="center">
  <a href="README.md">
    <img src="https://img.shields.io/badge/🇺🇸%20English-1a0a2e?style=for-the-badge" alt="English">
  </a>
  <a href="README.ja.md">
    <img src="https://img.shields.io/badge/🇯🇵%20日本語-1a0a2e?style=for-the-badge" alt="日本語">
  </a>
  <a href="README.ko.md">
    <img src="https://img.shields.io/badge/🇰🇷%20한국어-1a0a2e?style=for-the-badge" alt="한국어">
  </a>
  <a href="README.zh-CN.md">
    <img src="https://img.shields.io/badge/🇨🇳%20简体中文-1a0a2e?style=for-the-badge" alt="简体中文">
  </a>
  <a href="README.id.md">
    <img src="https://img.shields.io/badge/🇮🇩%20Bahasa%20Indonesia-1a0a2e?style=for-the-badge" alt="Bahasa Indonesia">
  </a>
</p>

<div align="center">

# RepoDitor

### 専用の Windows デスクトップアプリでローカルの R.E.P.O. セーブを確認・編集 — BepInEx 不要

RepoDitor は、ローカルの R.E.P.O. `.es3` データを扱う非公式のスタンドアロン Electron セーブエディターです。

デスクトップ UI は範囲を限定した型付き操作だけを提供し、同梱の Python バックエンドがセーブ解析、検証、バックアップ、ゲーム固有の意味付け、暗号化書き込みを担当します。

RepoDitor はゲームとは別に動作し、BepInEx、mod loader、R.E.P.O. のゲームディレクトリへのインストールを必要としません。

<sub>概要 · プレイヤー · アップグレード · ラン · アイテム · コスメティック · マップ</sub>

[最新リリースをダウンロード](https://github.com/Yoruxyv/RepoDitor/releases/latest)

デスクトップアプリをインストールしたくない場合は、代わりに [🌐 Web版](https://repoditor.vercel.app/) を利用できます。

</div>

---

> [!IMPORTANT]
> セーブを開いたり編集したりする前に R.E.P.O. を終了してください。RepoDitor は
> 非公式のコミュニティツールであり、semiwork とは提携していません。重要なデータは
> バックアップしてください。ゲーム更新によってセーブ形式や挙動が変わる可能性があります。

## 📥 公式ダウンロード

RepoDitor Desktop は次の公式配布元から提供されています。

- **GitHub Releases (canonical):** https://github.com/Yoruxyv/RepoDitor/releases
- **Nexus Mods:** https://www.nexusmods.com/repo/mods/319
- **Thunderstore:** https://thunderstore.io/c/repo/p/RepoDitor/RepoDitor/

ブラウザーで使いたい場合は、ローカルファイルを手動でインポート/エクスポートする [RepoDitor Web](https://repoditor.vercel.app/) を利用できます。Web版は独立したブラウザー製品で、Desktop版専用の機能すべてを備えているわけではありません。

GitHub Releases が RepoDitor Desktop の canonical なリリース元です。Nexus Mods と
Thunderstore は公式の配布チャネルです。RepoDitor Desktop は現在コード署名されていないため、
Windows SmartScreen が **Unknown Publisher** または認識されていないアプリの警告を表示する場合があります。
上記の公式配布元からのみ入手し、該当する場合は GitHub Releases で公開されている SHA-256 情報を確認してください。

RepoDitor v0.2.1 パッケージは Nexus Mods と Thunderstore の双方で手動審査を受け、配布を承認されました。
この配布承認は、いずれのプラットフォームによる認証、推奨、または安全性の保証を意味するものではありません。

## ✨ 機能

### Run セーブ

| ワークスペース | 現在の対応内容 |
|---|---|
| **概要** | 選択した Run、概要、保留中の変更を確認 |
| **プレイヤー** | 現在の体力を編集し、Python が計算した最大値まで回復。Steam アバターの表示にも対応 |
| **アップグレード** | セーブから動的に検出したアップグレードを編集。利用可能な場合はインストール済みメタデータと画像情報を補完 |
| **Run** | 型付き・検証済みフィールドから対応済みの Run 値を編集 |
| **アイテム** | 検出したインスタンスを検索・絞り込み・並べ替え。インストール済みメタデータが充電可能なアイテム種別であることを確認し、その個体に保存済み電力がある場合に限り **満充電** をステージング |
| **マップ** | コードを注入したりマップ選択を強制したりせず、ローカルにインストールされたマップを一覧表示 |

### コスメティック / MetaSave

コスメティックには、選択中の Run セーブとは独立した専用ワークスペースと安全な書き込みライフサイクルがあります。
互換性のあるインストール済みメタデータが利用できる場合、ゲーム由来の表示名、種類、レアリティ、任意のローカルアイコン、
所持数、保存済みプリセット数を表示します。カタログは検索、所持/種類フィルター、並べ替えに対応しますが、
表示用メタデータを変更可否の根拠には使用しません。

現在対応している操作:

- 条件を満たすロック中のコスメティックを 1 つ解除、または **すべてのコスメティックを解除**;
- **すべてのコスメティックをロック**。既知の所持コスメティックが装備中、プリセット参照中、その他安全に削除できない状態では実行不可;
- **すべてのプリセットをクリア**。対応するコスメティック/カラーのプリセットスロットを消去。

変更可能範囲は、独立して確認済みの明示的な ID リストに含まれるインストール済み ID に限定されます。
未知または将来追加されるコスメティック ID は読み取り専用のまま保持されます。トークン編集、任意の装備/カラー編集、
任意のプリセット作成/編集は、ゲーム上の意味が安全に確立されていないため対応していません。

## 🖼️ プレビュー

| Run 概要 | コスメティックカタログ |
|---|---|
| ![選択したセーブの概要とエディターナビゲーションを表示する RepoDitor Run 概要](docs/screenshots/repoditor-overview.png) | ![インストール済みメタデータ、ローカルアイコン、フィルター、一括操作を表示する RepoDitor コスメティックカタログ](docs/screenshots/cosmetic-unlocker.png) |

| プレイヤーエディター | プレイヤーアップグレード |
|---|---|
| ![選択したプレイヤーの体力を表示する RepoDitor プレイヤーエディター](docs/screenshots/repoditor-player-editor.png) | ![利用可能なアップグレードを表示する RepoDitor プレイヤーアップグレード](docs/screenshots/repoditor-upgrades-editor.png) |

| Run エディター | トラック内アイテムの充電 |
|---|---|
| ![型付きのレベル、通貨、残機、haul、再開位置フィールドを表示する RepoDitor Run エディター](docs/screenshots/repoditor-run-editor.png) | ![保存前に複数の対応済みアイテム充電をステージングする RepoDitor](docs/screenshots/recharge-truck-items.png) |

### ゲーム内での手動互換性確認

![編集済みのレベル、アップグレード、体力、エネルギー、アイテム電力を読み込む R.E.P.O.](docs/screenshots/repoditor-absurd-level.png)
画像は、極端なレベル値と編集済みのアップグレード、体力、エネルギー、アイテム電力を含む R.E.P.O. Run を示しています。
RepoDitor の変更はローカルのセーブファイルに適用され、ゲームは次回読み込み時にその内容を読み取ります。

## 🚀 クイックスタート

### 必要環境

- Windows x64
- ローカルにインストールされた R.E.P.O. とセーブデータ

### インストール

1. [公式 GitHub Releases ページ](https://github.com/Yoruxyv/RepoDitor/releases/latest)を開きます。
2. `RepoDitor-Setup-<version>-x64.exe` と対応する `.sha256` ファイルをダウンロードします。
3. 下記の手順でチェックサムを確認してから、ウィザード形式のインストーラーを実行します。

インストール済みアプリには Python バックエンドが含まれています。通常利用では Python、Node.js、npm、`uv` は不要です。

RepoDitor は現在の Windows アカウントの R.E.P.O. セーブディレクトリ配下から `REPO_SAVE_*.es3` を検出します。
ファイル名に `BACKUP` を含むものは自動検出から除外されます。

更新は手動です。RepoDitor はアップデーターやバックグラウンドサービスをインストールしません。
アンインストールは **Windows Settings → Apps → Installed apps → RepoDitor** から行えます。
RepoDitor をアンインストールしても R.E.P.O. のセーブや RepoDitor が作成した `.bak-*` バックアップは削除されません。

## 🛡️ セーブの安全性

R.E.P.O. はセーブ状態をメモリ内に保持し、後からディスクへ書き込むことがあります。そのためゲーム実行中に編集すると、
RepoDitor が古い永続データを使用したり、その後のゲーム保存で変更が上書きされたりする可能性があります。
起動時およびウィンドウフォーカス時のチェックで UI の状態を最新に保ちます。さらに Python の書き込み境界では、
ソース読み込み前と永続化直前の両方でゲームが終了済みであることを独立して確認します。プロセス状態が不明な場合は fail closed で処理します。

書き込みパイプライン:

1. **変更を保存** が確認されるまで編集内容はメモリ内に保持されます。
2. Python が現在のソースを読み込み・検証し、セーブを開いた時点で記録した fingerprint と SHA-256 を比較します。
3. 型付き変更を検証してメモリ上で適用し、その後 2 回目のゲームプロセス確認を行います。
4. リポジトリがソースを再読込し、バイト単位で完全一致することを要求して、同じ場所にタイムスタンプ付きの完全バックアップを作成します。
5. 暗号化した出力を staging に書き込み、再度開いて復号・検証し、意図したデータと比較します。
6. staging ファイルでソースを原子的に置き換える直前に、ソースをもう一度確認します。

これらの保護策はリスクを軽減しますが、将来のゲーム形式変更やあらゆるデータ損失を防ぐ保証ではありません。

## ✅ Windows ダウンロードの検証

RepoDitor Desktop は現在コード署名されていません。そのため Windows SmartScreen が **Unknown Publisher** または
認識されていないアプリの警告を表示する場合があります。RepoDitor は上記の公式配布元からのみ入手してください。
GitHub Releases が Desktop の canonical な配布元です。ソースとビルドワークフローは公開されており、該当する GitHub リリースには
SHA-256 検証情報が公開されています。

PowerShell で両方のファイルを同じディレクトリに置き、次を実行します。

```powershell
Get-FileHash .\RepoDitor-Setup-<version>-x64.exe -Algorithm SHA256
Get-Content .\RepoDitor-Setup-<version>-x64.exe.sha256
```

16 進数のハッシュは、大文字小文字を無視して完全に一致する必要があります。チェックサムの一致はダウンロードしたファイルが
公開済み artifact と一致することを確認しますが、それだけで発行者の身元やコードの安全性を証明するものではありません。
RepoDitor Desktop は現在コード署名されておらず、過去の v0.1.0 インストーラーも未署名でした。
リポジトリには署名済みタグ付きリリース向けの Microsoft cloud-signing ワークフローもありますが、その存在は現在のインストーラーが署名済みである証拠ではありません。

## 🔐 セキュリティモデル

renderer は `contextIsolation: true` と `nodeIntegration: false` を使用して sandbox 化されています。
任意ファイルの読み取り、プロセス起動、セーブ復号、任意 IPC 呼び出し、生の復号済みセーブ JSON の受け取りはできません。

Steam アバター補完は任意機能で、fail-soft に動作します。妥当な Steam ID のみ問い合わせ、返された画像 URL は限定された HTTPS ホストに対して検証され、
プロフィールデータがセーブへ書き込まれることはありません。GitHub Stars は型付き Electron IPC を通じて固定のメタデータ endpoint だけを使用し、
成功結果はセッション内でキャッシュされます。renderer に任意の network-fetch API は公開されません。

現在の任意バックグラウンドネットワークリクエストはこれらだけです。プロジェクトリンクはユーザー操作後にのみ外部で開き、
現在のソースには analytics や telemetry の統合はありません。

脆弱性を非公開で報告する場合は [SECURITY.md](SECURITY.md) を参照してください。

## 🔎 オープンソースとローカルデータ

RepoDitor はオープンソースです。Electron デスクトップアプリ、Python セーブバックエンド、パッケージ設定、CI/release ワークフローを
このリポジトリで確認でき、文書化された開発・パッケージコマンドを使ってソースからビルドできます。
公開ソースだけでは、ダウンロードしたバイナリがそのソースと同一であることは証明できません。公開チェックサムが検証するのは artifact の完全性であり、
コードの安全性や発行者の身元ではありません。

セーブの解析、検証、編集は同梱の Python バックエンド内でローカルに実行されます。生の復号済みセーブ JSON は Python の Desktop 境界内に留まり、
React へ公開されたりリモートのセーブ処理サービスへアップロードされたりしません。アプリは固定された R.E.P.O. セーブ/MetaSave の場所、Steam インストールメタデータ、
対応済みのインストールゲームデータファイル、R.E.P.O. が生成したアイコンキャッシュを読み取ります。明示的な対応済み保存操作の後にのみセーブを書き込み、
ソースの隣にバックアップと一時 staging ファイルを作成し、renderer 設定と派生表示/カタログキャッシュは RepoDitor 所有のアプリデータへ保存します。

2 つの任意機能だけが限定されたネットワークリクエストを使用します。GitHub プロジェクトメタデータは固定の RepoDitor repository endpoint から読み取り、
Steam アバター補完はセーブ由来の妥当な Steam ID を対応する公開 Steam profile endpoint へ送信した後、allowlist に含まれる HTTPS アバターホストのみ受け入れます。
どちらのリクエストもセーブファイルや生の復号済みセーブデータを受け取りません。現在のアプリソースと依存関係には analytics、広告 SDK、使用 telemetry、
クラッシュレポートのアップロード、remote logging の統合はありません。

## 💾 セーブの鮮度と表示キャッシュ

セーブの権限と表示キャッシュは意図的に分離されています。

| データ | 現在の動作 |
|---|---|
| **セーブ状態** | 明示的に開くたびに Python が現在の `.es3` を読み込み、復号・検証し、型付き projection とソース fingerprint だけを返します。復号済みの生セーブ JSON は永続化されません。renderer は同じ fingerprint が再確認された場合に限り、現在のアプリセッション中に型付き editor-entry データを再利用できます。書き込み成功時はそのエントリを無効化します。 |
| **ゲーム生成のアイテム/コスメティックアイコン** | PNG は R.E.P.O. の LocalLow アイコンキャッシュに残ります。Electron は検証済みファイルを不透明なメモリ内トークン経由で提供し、キャッシュパスやファイル名は React に渡しません。 |
| **派生アップグレード画像** | Python がインストール済みゲームから対応 texture を解決・デコードします。Electron は検証済み派生 PNG を `%APPDATA%\repoditor-desktop\presentation` に保存し、監視対象ソースの identity が変わらない間だけ再利用します。参照されなくなった PNG を削除し、エントリが欠落・変更・不正・読取不能な場合は再生成または Phosphor へ fallback します。 |
| **インストール済みコスメティックメタデータ** | `%LOCALAPPDATA%\RepoDitor\cache\cosmetics` の派生カタログキャッシュは、schema、Steam build、game root、関連するインストール済みファイル identity が一致する場合にのみ受け入れます。表示データを提供するだけで、所持証拠や mutation authority にはなりません。 |

テーマと言語設定は renderer storage を使用します。RepoDitor が R.E.P.O. データを書き込むのは明示的な対応済み保存操作の後だけで、
バックアップは表示キャッシュ内ではなくソースの隣に作成されます。

RepoDitor を再起動した後に派生表示キャッシュを監査するには次を実行します。

```powershell
.\desktop\scripts\check-presentation-cache.ps1
```

この読み取り専用スクリプトは `manifest.json` と保存済みの hash 名 PNG を比較し、参照されていない artifact や不足している artifact を報告します。

## 🌐 言語と外観

RepoDitor は **Dark**、**Light**、**System** テーマに対応しています。テーマと言語設定は renderer にローカル保存され、System は Windows の外観設定に従います。

RepoDitor 固有の UI は次の言語で利用できます。

- English
- Japanese (日本語)
- Korean (한국어)
- Simplified Chinese (中文)
- Indonesian (Bahasa Indonesia)

日本語と韓国語の翻訳は当初 AI の支援を受けて作成されており、現時点ではネイティブ/流暢な話者による完全なレビューを受けていません。
流暢な話者やネイティブ話者からの修正を歓迎します。

プレイヤー名、アイテム名、マップ名、セーブから読み取った値など、ゲーム側が所有する文字列は変更されません。
UI は reduced-motion 設定も尊重し、ローカルの操作音は装飾的なもので、アプリ状態を理解するために必須ではありません。

## 🧠 RepoDitor Desktop の仕組み

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

Run セーブと MetaSave は、同じ検証済み暗号化 repository を再利用しつつ、それぞれ独立した fingerprint、保留中の変更、バックアップ、保存セッションを持ちます。
RepoDitor Desktop では、ゲームとセーブの意味付けについて Python が authoritative です。

セーブとインストール済みコンテンツの検出は、検証済み構造が対応する範囲で動的に行われます。build 固有のインストールゲーム reader は明示的な compatibility gate を使用し、
不確実な場合は表示や機能を unavailable/unknown に落とし、mutation authority を広げません。より詳しい境界は
[architecture](docs/architecture/architecture.md) と [reverse-engineering notes](docs/research/reverse-engineering.md) を参照してください。

## 🧪 品質とテスト

自動テストでは生成済みまたはサニタイズ済み fixture と一時コピーを使用し、実ユーザーのセーブは使用しません。
リポジトリでは Python formatting/tests、renderer import 境界、lint、TypeScript build、component/contract tests、Windows Electron E2E、
package 内容、Vite を使わない packaged E2E、installer 構造を確認します。

```powershell
uv run ruff check .
uv run ruff format --check .
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

## 🛠️ 開発

開発には `uv`、Python 3.11 以降、Node.js 24 が必要です。

```powershell
git clone https://github.com/Yoruxyv/RepoDitor.git
Set-Location RepoDitor
uv sync --locked

Set-Location desktop
npm ci
npm run dev
```

アーキテクチャ、根拠、プライバシー、Pull Request の要件については [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 📦 パッケージングとリリース

`desktop/` で `npm run package` を実行すると、locked Python 3.13 PyInstaller **onedir** sidecar、production Electron app、
unpacked packaged smoke test、wizard 形式の NSIS installer、`desktop/release/` 配下のローカル artifact 検証をビルドします。
Electron Builder は sidecar directory を `resources/backend/` に配置しつつ、固定エントリーポイント `resources/backend/repoditor-backend.exe` を維持します。
このローカルパスは意図的に未署名です。

公式のタグ付き GitHub release は別個の fail-closed signing command を使用し、SHA-256 ファイル生成前に Authenticode signature を検証し、
既存 package check が完了した後にのみ公開します。署名承認または credential が利用できない間は、別の一時的な manual workflow で
未署名 release を明確に表示して公開できます。この workflow は quality、package、packaged-E2E、installer、checksum gate を維持しますが、
signature verification は省略します。現在の要件と保存済みの過去 v0.1.0 baseline は [release checklist](docs/release-checklist.md) を参照してください。

## ⚠️ 制限事項

- RepoDitor は観測済みの R.E.P.O. 暗号化セーブ構造を対象としており、ゲーム更新で互換性のないデータが導入される可能性があります。
- アイテムは、インストール済みのアイテム種別 capability と保存済み charge の根拠が一致した exact-instance に対する **満充電** のみ対応します。数値 charge 編集、battery upgrade 書き込み、purchase mutation、アイテム追加/削除/複製は無効です。
- コスメティックは、対象となる個別解除、一括解除、条件付き一括ロック、ペアのプリセットクリアに対応します。装備、token、任意 color、任意 preset 作成/編集は未対応で、確認済み mutation boundary 外の ID は読み取り専用で保持されます。
- マップは検出/一覧表示のみです。RepoDitor はコードを注入したりマップ選択を強制したりしません。
- Steam アバター補完は、無効、非公開、不正、到達不能、未対応のプロフィールでは利用できない場合がありますが、Players 機能を妨げません。
- アイテム充電 capability と decoded upgrade artwork は、検証済みのインストールゲームレイアウト向け compatibility gate を使用します。ゲーム更新により、それらの capability が unknown になったり artwork が unavailable になったりしても、通常の対応済みセーブ読み取りは利用できます。
- RepoDitor は現在 Windows x64 を対象としており、自動アップデーターはありません。

## 📚 ドキュメント

| ドキュメント | 目的 |
|---|---|
| [ドキュメント索引](docs/README.md) | 技術・リリース文書への整理された入口 |
| [アーキテクチャ](docs/architecture/architecture.md) | Desktop の境界、所有権、データフロー |
| [Electron UI](docs/architecture/electron-ui.md) | renderer の役割、レスポンシブ動作、外観、アクセシビリティ |
| [セーブ形式](docs/research/save-format.md) | 確認済み暗号化セーブ構造 |
| [リバースエンジニアリング](docs/research/reverse-engineering.md) | 過去の根拠、現在の対応、未解決の意味付け |
| [リリースチェックリスト](docs/release-checklist.md) | 現在のリリース gate と過去 v0.1.0 baseline |
| [アセット調査](docs/research/asset-research.md) | ローカル asset 検出の根拠と再配布境界 |
| [サードパーティ通知](THIRD_PARTY_NOTICES.md) | 同梱 asset と依存関係の attribution |

## 🤝 コントリビュート

対象を絞ったバグ報告、機能提案、ドキュメント改善、Pull Request を歓迎します。
リポジトリの template を使用し、実際のセーブファイル、バックアップ、Steam identifier、ユーザー名、ローカル filesystem path は公開しないでください。

コントリビュート前に [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[Code of Conduct](CODE_OF_CONDUCT.md) を確認してください。

## 👤 メンテナー

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

## 📄 ライセンス

RepoDitor は [MIT License](LICENSE) のもとで公開されています。R.E.P.O. および関連名称は、それぞれの権利者の商標または財産です。
RepoDitor は非公式のセーブ管理ユーティリティであり、R.E.P.O. のゲームアセットを再配布しません。
