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

### 집중된 Windows 데스크톱 앱에서 로컬 R.E.P.O. 세이브를 확인하고 편집 — BepInEx 불필요

RepoDitor는 로컬 R.E.P.O. `.es3` 데이터를 위한 비공식 독립 실행형 Electron 세이브 에디터입니다.

데스크톱 인터페이스는 범위가 제한된 타입 기반 작업만 제공하며, 번들된 Python 백엔드가 세이브 파싱, 검증, 백업, 게임 의미 규칙, 암호화 쓰기를 담당합니다.

RepoDitor는 게임과 별도로 실행되며 BepInEx, mod loader 또는 R.E.P.O. 게임 디렉터리에 설치할 필요가 없습니다.

<sub>개요 · 플레이어 · 업그레이드 · 런 · 아이템 · 코스메틱 · 맵</sub>

[최신 릴리스 다운로드](https://github.com/Yoruxyv/RepoDitor/releases/latest)

데스크톱 앱을 설치하고 싶지 않다면 [🌐 웹 버전](https://repoditor.vercel.app/)을 대신 사용할 수 있습니다.

</div>

---

> [!IMPORTANT]
> 세이브를 열거나 편집하기 전에 R.E.P.O.를 종료하세요. RepoDitor는 비공식 커뮤니티 도구이며
> semiwork와 제휴되어 있지 않습니다. 중요한 데이터는 백업하세요. 게임 업데이트로 세이브 형식이나
> 동작이 변경될 수 있습니다.

## 📥 공식 다운로드

RepoDitor Desktop은 다음 공식 배포 경로를 통해 제공됩니다.

- **GitHub Releases (canonical):** https://github.com/Yoruxyv/RepoDitor/releases
- **Nexus Mods:** https://www.nexusmods.com/repo/mods/319
- **Thunderstore:** https://thunderstore.io/c/repo/p/RepoDitor/RepoDitor/

브라우저에서 사용하려면 로컬 파일을 수동으로 가져오고 내보내는 [RepoDitor Web](https://repoditor.vercel.app/)을 이용할 수 있습니다. Web은 별도의 브라우저 제품이며 Desktop 전용 기능을 모두 포함하지는 않습니다.

GitHub Releases는 RepoDitor Desktop의 canonical 릴리스 소스입니다. Nexus Mods와 Thunderstore는
공식 배포 채널입니다. RepoDitor Desktop은 현재 코드 서명이 되어 있지 않으므로 Windows SmartScreen에서
**Unknown Publisher** 또는 인식되지 않은 앱 경고가 표시될 수 있습니다. 위 공식 배포 경로에서만 RepoDitor를
받고, 해당되는 경우 GitHub 릴리스에 게시된 SHA-256 정보를 확인하세요.

RepoDitor v0.2.1 패키지는 Nexus Mods와 Thunderstore에서 각각 수동 검토를 거쳐 배포 승인을 받았습니다.
이 배포 승인은 어느 플랫폼의 인증, 보증, 추천 또는 안전성 보장을 의미하지 않습니다.

## ✨ 기능

### Run 세이브

| 작업 영역 | 현재 지원 |
|---|---|
| **개요** | 선택한 Run, 요약, 보류 중인 변경 사항 확인 |
| **플레이어** | 현재 체력 편집, Python이 계산한 최대치까지 회복, 선택적 Steam 아바타 표시 |
| **업그레이드** | 세이브에서 동적으로 발견된 업그레이드 편집. 가능한 경우 설치된 메타데이터와 이미지 정보 보강 |
| **Run** | 타입이 지정되고 검증된 필드로 지원되는 Run 값 편집 |
| **아이템** | 발견된 인스턴스 검색/필터/정렬. 설치된 메타데이터가 해당 아이템 타입의 충전 가능 여부를 확인하고 그 정확한 인스턴스에 저장된 충전량이 있을 때만 **완전 충전** 작업을 스테이징 |
| **맵** | 코드를 주입하거나 맵 선택을 강제하지 않고 로컬에 설치된 맵 목록 표시 |

### 코스메틱 / MetaSave

코스메틱은 선택된 Run 세이브와 독립된 자체 작업 영역 및 안전한 쓰기 수명주기를 가집니다.
호환되는 설치 메타데이터가 있는 경우 게임 소유 표시 이름, 타입, 희귀도, 선택적 로컬 아이콘,
보유 수량 및 저장된 프리셋 수를 표시합니다. 카탈로그는 검색, 보유/타입 필터, 정렬을 지원하지만
표시용 메타데이터를 변경 권한의 근거로 사용하지 않습니다.

현재 지원되는 작업:

- 조건을 충족하는 잠긴 코스메틱 1개 해제 또는 **모든 코스메틱 해제**;
- **모든 코스메틱 잠금**. 알려진 보유 코스메틱이 장착 중이거나 프리셋에서 참조되거나 그 밖에 안전하게 제거할 수 없는 경우에는 실행하지 않음;
- **모든 프리셋 지우기**. 연결된 코스메틱/색상 프리셋 슬롯을 비움.

변경 가능 범위는 독립적으로 검증된 명시적 ID 목록에 포함된 설치된 ID로 제한됩니다.
알 수 없거나 미래에 추가되는 코스메틱 ID는 읽기 전용으로 보존됩니다. 토큰 편집, 임의 장비/색상 편집,
임의 프리셋 생성/편집은 게임 의미가 충분히 안전하게 확립되지 않았기 때문에 지원하지 않습니다.

## 🖼️ 미리보기

| Run 개요 | 코스메틱 카탈로그 |
|---|---|
| ![선택된 세이브 요약과 에디터 탐색을 보여 주는 RepoDitor Run 개요](docs/screenshots/repoditor-overview.png) | ![설치된 메타데이터, 로컬 아이콘, 필터 및 일괄 작업을 보여 주는 RepoDitor 코스메틱 카탈로그](docs/screenshots/cosmetic-unlocker.png) |

| 플레이어 에디터 | 플레이어 업그레이드 |
|---|---|
| ![선택한 플레이어의 체력을 보여 주는 RepoDitor 플레이어 에디터](docs/screenshots/repoditor-player-editor.png) | ![사용 가능한 업그레이드를 보여 주는 RepoDitor 플레이어 업그레이드](docs/screenshots/repoditor-upgrades-editor.png) |

| Run 에디터 | 트럭 아이템 충전 |
|---|---|
| ![타입이 지정된 레벨, 통화, 목숨, haul, 재개 위치 필드를 보여 주는 RepoDitor Run 에디터](docs/screenshots/repoditor-run-editor.png) | ![저장 전에 여러 지원 아이템 충전을 스테이징하는 RepoDitor](docs/screenshots/recharge-truck-items.png) |

### 게임 내 수동 호환성 확인

![편집된 레벨, 업그레이드, 체력, 에너지 및 아이템 충전량을 불러온 R.E.P.O.](docs/screenshots/repoditor-absurd-level.png)
이미지는 매우 높은 레벨 값과 편집된 업그레이드, 체력, 에너지 및 아이템 충전량이 적용된 R.E.P.O. Run을 보여 줍니다.
RepoDitor의 변경 사항은 로컬 세이브 파일에 적용되며 게임은 다음 로드 시 이를 읽습니다.

## 🚀 빠른 시작

### 요구 사항

- Windows x64
- 로컬 R.E.P.O. 설치 및 세이브

### 설치

1. [공식 GitHub Releases 페이지](https://github.com/Yoruxyv/RepoDitor/releases/latest)를 엽니다.
2. `RepoDitor-Setup-<version>-x64.exe`와 해당 `.sha256` 파일을 다운로드합니다.
3. 아래 설명대로 체크섬을 확인한 뒤 마법사형 설치 프로그램을 실행합니다.

설치된 앱에는 Python 백엔드가 포함되어 있습니다. 일반 사용에는 Python, Node.js, npm, `uv`가 필요하지 않습니다.

RepoDitor는 현재 Windows 계정의 R.E.P.O. 세이브 디렉터리 아래에서 `REPO_SAVE_*.es3` 파일을 검색합니다.
파일 이름에 `BACKUP`이 포함된 파일은 자동 검색에서 제외됩니다.

업데이트는 수동입니다. RepoDitor는 업데이터나 백그라운드 서비스를 설치하지 않습니다.
**Windows Settings → Apps → Installed apps → RepoDitor**에서 제거할 수 있습니다.
RepoDitor를 제거해도 R.E.P.O. 세이브나 RepoDitor가 만든 `.bak-*` 백업은 삭제되지 않습니다.

## 🛡️ 세이브 안전성

R.E.P.O.는 세이브 상태를 메모리에 유지했다가 나중에 디스크에 쓸 수 있습니다. 따라서 게임 실행 중에 편집하면
RepoDitor가 오래된 영구 데이터를 사용하거나 이후 게임 저장으로 변경 사항이 덮어써질 수 있습니다.
시작 시와 창 포커스 시 확인으로 인터페이스 상태를 최신으로 유지하며, Python 쓰기 경계는 소스를 불러오기 전과
실제 저장 직전에 게임이 종료되었음을 각각 독립적으로 확인합니다. 프로세스 상태를 알 수 없으면 fail closed로 처리합니다.

쓰기 파이프라인:

1. **변경 사항 저장**이 확인될 때까지 편집은 메모리에만 유지됩니다.
2. Python이 현재 소스를 불러오고 검증한 다음, 세이브를 열 때 기록한 fingerprint와 SHA-256을 비교합니다.
3. 타입이 지정된 변경 사항을 검증해 메모리에 적용한 뒤 두 번째 게임 프로세스 확인을 수행합니다.
4. repository가 소스를 다시 읽고 정확한 바이트 일치를 요구한 후, 원본 옆에 타임스탬프가 포함된 바이트 단위 백업을 생성합니다.
5. 암호화된 출력을 staging에 쓰고 다시 열어 복호화/검증한 뒤 의도한 데이터와 비교합니다.
6. staging 파일이 원본을 원자적으로 대체하기 직전에 소스를 한 번 더 확인합니다.

이 보호 장치는 위험을 줄이지만 향후 게임 형식 변경이나 모든 형태의 데이터 손실을 막는다는 보장은 아닙니다.

## ✅ Windows 다운로드 검증

RepoDitor Desktop은 현재 코드 서명이 되어 있지 않습니다. 따라서 Windows SmartScreen에서 **Unknown Publisher** 또는
인식되지 않은 앱 경고가 표시될 수 있습니다. 위에 나열된 공식 배포 경로에서만 RepoDitor를 받으세요.
GitHub Releases가 Desktop의 canonical 소스입니다. 소스와 빌드 워크플로는 공개되어 있으며, 해당되는 GitHub 릴리스에는
SHA-256 검증 정보가 게시됩니다.

PowerShell에서 두 파일을 같은 디렉터리에 놓고 다음을 실행합니다.

```powershell
Get-FileHash .\RepoDitor-Setup-<version>-x64.exe -Algorithm SHA256
Get-Content .\RepoDitor-Setup-<version>-x64.exe.sha256
```

16진수 해시는 대소문자를 제외하고 정확히 일치해야 합니다. 일치하는 체크섬은 다운로드한 파일이 게시된 artifact와 일치함을 확인하지만,
그 자체로 게시자 신원이나 코드 안전성을 증명하지는 않습니다. RepoDitor Desktop은 현재 서명되지 않았으며 과거 v0.1.0 설치 프로그램도 서명되지 않았습니다.
리포지토리에는 서명된 태그 릴리스를 위한 Microsoft cloud-signing 워크플로도 있지만, 그 워크플로의 존재만으로 현재 설치 프로그램이 서명되었다고 볼 수는 없습니다.

## 🔐 보안 모델

renderer는 `contextIsolation: true`와 `nodeIntegration: false`로 sandbox 처리됩니다.
임의 파일 읽기, 프로세스 실행, 세이브 복호화, 임의 IPC 호출 또는 원시 복호화 세이브 JSON 수신을 할 수 없습니다.

Steam 아바타 보강은 선택 기능이며 fail-soft로 동작합니다. 타당한 Steam ID만 조회하며 반환된 이미지 URL은 제한된 HTTPS 호스트에 대해 검증되고,
프로필 데이터는 세이브에 기록되지 않습니다. GitHub Stars는 타입이 지정된 Electron IPC를 통해 하나의 고정된 메타데이터 endpoint만 사용하며,
성공 결과는 세션 동안 캐시됩니다. renderer에는 임의 network-fetch API가 제공되지 않습니다.

현재 선택적 백그라운드 네트워크 요청은 이것뿐입니다. 프로젝트 링크는 사용자 작업 후에만 외부에서 열리고,
현재 소스에는 analytics 또는 telemetry 통합이 없습니다.

취약점을 비공개로 신고하려면 [SECURITY.md](SECURITY.md)를 참조하세요.

## 🔎 오픈 소스 및 로컬 데이터

RepoDitor는 오픈 소스입니다. Electron 데스크톱 앱, Python 세이브 백엔드, 패키징 구성, CI/release 워크플로를 이 리포지토리에서 확인할 수 있으며,
문서화된 개발 및 패키징 명령으로 소스에서 직접 빌드할 수 있습니다. 공개 소스만으로 다운로드한 바이너리가 그 소스와 동일함을 증명할 수는 없습니다.
게시된 체크섬은 artifact 무결성을 검증하며 코드 안전성이나 게시자 신원을 증명하지 않습니다.

세이브 파싱, 검증 및 편집은 번들된 Python 백엔드에서 로컬로 수행됩니다. 원시 복호화 세이브 JSON은 Python Desktop 경계 안에 남으며
React에 노출되거나 원격 세이브 처리 서비스로 업로드되지 않습니다. 앱은 고정된 R.E.P.O. 세이브/MetaSave 위치, Steam 설치 메타데이터,
지원되는 설치 게임 데이터 파일, R.E.P.O.가 생성한 아이콘 캐시를 읽습니다. 명시적인 지원 저장 작업 후에만 세이브를 쓰고,
원본 옆에 백업과 임시 staging 파일을 만들며 renderer 설정과 파생 표시/카탈로그 캐시는 RepoDitor 소유 애플리케이션 데이터에 저장합니다.

두 개의 선택 기능만 제한된 네트워크 요청을 사용합니다. GitHub 프로젝트 메타데이터는 고정된 RepoDitor repository endpoint에서 읽고,
Steam 아바타 보강은 세이브에서 파생된 타당한 Steam ID를 해당 공개 Steam profile endpoint로 보낸 뒤 allowlist의 HTTPS 아바타 호스트만 허용합니다.
어느 요청도 세이브 파일이나 원시 복호화 세이브 데이터를 받지 않습니다. 현재 앱 소스와 종속성에는 analytics, 광고 SDK, 사용 telemetry,
충돌 보고 업로드 또는 remote logging 통합이 없습니다.

## 💾 세이브 최신성 및 표시 캐시

세이브 권한과 표시 캐시는 의도적으로 분리되어 있습니다.

| 데이터 | 현재 동작 |
|---|---|
| **세이브 상태** | 명시적으로 열 때마다 Python이 현재 `.es3`를 읽고 복호화/검증한 후 타입이 지정된 projection과 소스 fingerprint만 반환합니다. 복호화된 원시 세이브 JSON은 영구 저장하지 않습니다. renderer는 같은 fingerprint가 다시 확인된 경우에만 현재 앱 세션에서 타입이 지정된 editor-entry 데이터를 재사용할 수 있으며, 쓰기에 성공하면 해당 항목을 무효화합니다. |
| **게임 생성 아이템/코스메틱 아이콘** | PNG는 R.E.P.O.의 LocalLow 아이콘 캐시에 남습니다. Electron은 검증된 파일을 불투명한 메모리 토큰을 통해 제공하며 캐시 경로나 파일 이름은 React로 전달되지 않습니다. |
| **파생 업그레이드 이미지** | Python이 설치된 게임에서 지원되는 texture를 찾아 디코딩합니다. Electron은 검증된 파생 PNG를 `%APPDATA%\repoditor-desktop\presentation`에 저장하고 감시 중인 소스 identity가 변경되지 않은 동안만 재사용합니다. 참조되지 않는 PNG를 정리하고 항목이 없거나 변경되었거나 잘못되었거나 읽을 수 없으면 재생성하거나 Phosphor로 fallback합니다. |
| **설치된 코스메틱 메타데이터** | `%LOCALAPPDATA%\RepoDitor\cache\cosmetics`의 파생 카탈로그 캐시는 schema, Steam build, game root 및 관련 설치 파일 identity가 계속 일치할 때만 허용됩니다. 표시용 데이터를 제공할 뿐 보유 증거나 mutation authority로 사용되지 않습니다. |

테마와 언어 설정은 renderer storage를 사용합니다. RepoDitor는 명시적인 지원 저장 작업 후에만 R.E.P.O. 데이터를 쓰며,
백업은 표시 캐시 안이 아니라 원본 옆에 생성됩니다.

RepoDitor를 다시 시작한 뒤 파생 표시 캐시를 점검하려면 다음을 실행합니다.

```powershell
.\desktop\scripts\check-presentation-cache.ps1
```

이 읽기 전용 스크립트는 `manifest.json`과 저장된 hash 이름 PNG를 비교해 참조되지 않거나 누락된 artifact를 보고합니다.

## 🌐 언어 및 외형

RepoDitor는 **Dark**, **Light**, **System** 테마를 지원합니다. 테마와 언어 설정은 renderer에 로컬로 저장되며 System은 Windows 외형 설정을 따릅니다.

RepoDitor 소유 인터페이스는 다음 언어로 제공됩니다.

- English
- Japanese (日本語)
- Korean (한국어)
- Simplified Chinese (中文)
- Indonesian (Bahasa Indonesia)

일본어와 한국어 번역은 처음에 AI의 도움을 받아 작성되었으며 아직 네이티브/유창한 화자의 완전한 검토를 받지 않았습니다.
유창한 화자와 네이티브 화자의 수정 제안을 환영합니다.

플레이어 이름, 아이템 이름, 맵 이름, 세이브에서 읽은 값 등 게임이 소유하는 문자열은 변경되지 않습니다.
인터페이스는 reduced-motion 설정도 존중하며 로컬 상호작용 소리는 장식용이므로 애플리케이션 상태를 이해하는 데 필요하지 않습니다.

## 🧠 RepoDitor Desktop 작동 방식

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

Run 세이브와 MetaSave는 동일한 검증된 암호화 repository를 재사용하면서 각자 독립적인 fingerprint, 보류 변경 사항, 백업, 저장 세션을 가집니다.
RepoDitor Desktop에서는 게임 및 세이브 의미 규칙에 대해 Python이 authoritative합니다.

세이브 및 설치 콘텐츠 검색은 검증된 구조가 지원하는 범위에서 동적으로 수행됩니다. build별 설치 게임 reader는 명시적인 compatibility gate를 사용하며,
불확실한 경우 표시나 capability를 unavailable/unknown으로 낮추고 mutation authority를 넓히지 않습니다. 더 자세한 경계는
[architecture](docs/architecture/architecture.md) 및 [reverse-engineering notes](docs/research/reverse-engineering.md)를 참조하세요.

## 🧪 품질 및 테스트

자동 테스트는 생성되었거나 정리된 fixture와 임시 복사본을 사용하며 실제 사용자 세이브는 사용하지 않습니다.
리포지토리는 Python formatting/tests, renderer import 경계, lint, TypeScript build, component/contract tests, Windows Electron E2E,
package 내용, Vite 없는 packaged E2E 및 installer 구조를 확인합니다.

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

## 🛠️ 개발

개발에는 `uv`, Python 3.11 이상, Node.js 24가 필요합니다.

```powershell
git clone https://github.com/Yoruxyv/RepoDitor.git
Set-Location RepoDitor
uv sync --locked

Set-Location desktop
npm ci
npm run dev
```

아키텍처, 근거, 개인정보 보호 및 Pull Request 요구 사항은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

## 📦 패키징 및 릴리스

`desktop/`에서 `npm run package`를 실행하면 locked Python 3.13 PyInstaller **onedir** sidecar, production Electron app,
unpacked packaged smoke test, 마법사형 NSIS installer 및 `desktop/release/`의 로컬 artifact 검증을 빌드합니다.
Electron Builder는 sidecar directory를 `resources/backend/` 아래에 설치하면서 고정 진입점 `resources/backend/repoditor-backend.exe`를 유지합니다.
이 로컬 경로는 의도적으로 서명되지 않습니다.

공식 태그 GitHub release는 별도의 fail-closed signing command를 사용하고 SHA-256 파일 생성 전에 Authenticode signature를 검증하며,
기존 package check가 끝난 뒤에만 게시합니다. 서명 승인 또는 credential을 사용할 수 없는 동안에는 별도의 임시 manual workflow로
명확히 표시된 unsigned release를 게시할 수 있습니다. 이 workflow는 quality, package, packaged-E2E, installer 및 checksum gate를 유지하지만
signature verification은 생략합니다. 현재 요구 사항과 보존된 과거 v0.1.0 baseline은 [release checklist](docs/release-checklist.md)를 참조하세요.

## ⚠️ 제한 사항

- RepoDitor는 관찰된 R.E.P.O. 암호화 세이브 구조를 대상으로 하며 게임 업데이트로 호환되지 않는 데이터가 추가될 수 있습니다.
- 아이템은 설치된 아이템 타입 capability와 저장된 charge 근거가 모두 일치하는 exact-instance에 대해 **완전 충전**만 지원합니다. 숫자 charge 편집, battery-upgrade 쓰기, purchase mutation, 아이템 추가/삭제/복제는 비활성화되어 있습니다.
- 코스메틱은 조건을 충족하는 개별 해제, 일괄 해제, 보호된 일괄 잠금, 연결된 프리셋 지우기를 지원합니다. 장비, token, 임의 color, 임의 preset 생성/편집은 지원하지 않으며 검증된 mutation boundary 밖의 ID는 읽기 전용으로 보존됩니다.
- 맵은 검색/목록 표시 전용입니다. RepoDitor는 코드를 주입하거나 맵 선택을 강제하지 않습니다.
- Steam 아바타 보강은 잘못되었거나 비공개이거나 형식이 이상하거나 연결할 수 없거나 지원되지 않는 프로필에서는 사용할 수 없을 수 있지만 Players 기능을 차단하지 않습니다.
- 아이템 충전 capability와 decoded upgrade artwork는 검증된 설치 게임 레이아웃용 compatibility gate를 사용합니다. 게임 업데이트로 해당 capability가 unknown이 되거나 artwork를 사용할 수 없게 되어도 일반적인 지원 세이브 읽기는 계속 사용할 수 있습니다.
- RepoDitor는 현재 Windows x64만 대상으로 하며 자동 업데이터가 없습니다.

## 📚 문서

| 문서 | 목적 |
|---|---|
| [문서 인덱스](docs/README.md) | 기술 및 릴리스 문서의 정리된 진입점 |
| [아키텍처](docs/architecture/architecture.md) | Desktop 경계, 소유권, 데이터 흐름 |
| [Electron UI](docs/architecture/electron-ui.md) | renderer 역할, 반응형 동작, 외형, 접근성 |
| [세이브 형식](docs/research/save-format.md) | 확인된 암호화 세이브 구조 |
| [리버스 엔지니어링](docs/research/reverse-engineering.md) | 과거 근거, 현재 지원, 미해결 의미 규칙 |
| [릴리스 체크리스트](docs/release-checklist.md) | 현재 릴리스 gate와 과거 v0.1.0 baseline |
| [에셋 연구](docs/research/asset-research.md) | 로컬 asset 검색 근거와 재배포 경계 |
| [서드파티 고지](THIRD_PARTY_NOTICES.md) | 번들 asset 및 종속성 attribution |

## 🤝 기여

범위를 좁힌 버그 보고, 기능 제안, 문서 개선 및 Pull Request를 환영합니다.
리포지토리 template를 사용하고 실제 세이브 파일, 백업, Steam identifier, 사용자 이름 또는 로컬 filesystem path를 공개하지 마세요.

기여하기 전에 [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [Code of Conduct](CODE_OF_CONDUCT.md)를 읽어 주세요.

## 👤 메인테이너

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

## 📄 라이선스

RepoDitor는 [MIT License](LICENSE)로 배포됩니다. R.E.P.O. 및 관련 명칭은 각 권리자의 상표 또는 재산입니다.
RepoDitor는 비공식 세이브 관리 유틸리티이며 R.E.P.O. 게임 asset을 재배포하지 않습니다.
