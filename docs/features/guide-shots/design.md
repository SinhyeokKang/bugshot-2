# guide-shots (가이드 에셋 자동 캡처)

`guide/{ko,en}/assets`의 스크린샷 146장(로케일당 73장, `readme-1` 제외)을 손으로 찍던 것을 Aside 세션으로 자동화한다. **코드를 만들지 않는 기능이다** — 실행체는 Aside 세션의 REPL(Playwright `page` + 저수준 CDP `page._sendToTarget`)이고 `manual-smoke`와 같은 배관이다. 새 의존성·새 권한·새 스크립트 0개.

> 왜 e2e 하네스가 아닌가: `dist-e2e`를 로드한 별도 Playwright 인스턴스는 **연동이 비어 있어** 전부 목킹해야 한다. Aside 브라우저에는 이미 BugShot이 UNPACKED(`/Users/.../bugshot-2/dist`)로 설치돼 있고 실제 연동이 살아 있어 "실제 사용 중인 화면"이 그대로 나온다. 또한 이 세션의 Bash 샌드박스는 Chrome 프로세스 기동 자체가 막혀 있어(crashpad mach bootstrap 거부 → SIGABRT) 별도 인스턴스는 애초에 못 띄운다.

---

## 1. 상수

```
확장 ID     : dhmffogmoohdjficicjjfolcheklngfm   (manifest.config.ts DEV_KEY 기준 고정)
패널 경로   : chrome-extension://<id>/src/sidepanel/index.html?tabId=<n>
백드롭 탭   : github.com (로그 밀도 + 실사이트)
합성 캔버스 : 1600 x 1000 jpg q92
```

`tabId`는 REPL의 `chrome.tabs.query({url})`로 얻는다.

## 2. 촬영

### viewport 고정 (필수 검증)

Aside `page`에는 `setViewportSize`가 없다. 저수준 CDP로 건다.

```js
page._sendToTarget("Emulation.setDeviceMetricsOverride",
                   { width: 520, height: h, deviceScaleFactor: 2, mobile: false })
```

**이 오버라이드는 탭 전환·네비게이션 때 조용히 풀린다.** 풀린 채로 찍으면 1440폭 레이아웃의 왼쪽 520px만 잘려 나와 완전히 깨진 이미지가 나오는데, 에러가 아니라 "그럴듯하게 이상한" 결과라 눈으로만 걸린다. **촬영 직전 `innerWidth`를 검증하고 불일치면 `clearDeviceMetricsOverride` 후 재적용**한다(최대 4회).

### 패널 높이

폭은 520 고정, 높이는 화면마다 다르다. **에셋별로 높이를 바꿔 구도를 잡지 않는다** — 높이는 그 화면의 자연 높이이고, 구도는 오프셋으로 잡는다.

```
자연 높이 = 스크롤 컨테이너 top + scrollHeight + (innerHeight - 컨테이너 bottom)
최종 높이 = max(자연 높이, 760)
```

스크롤 컨테이너는 `scrollHeight - clientHeight`가 최대이고 `clientHeight > 100`인 요소로 찾는다. 실측값:

| 화면 | 높이 |
|---|---|
| 설정 > 이슈 설정 | 1263 |
| 설정 > 일반 | 760 (자연 480 → MIN 적용) |
| 연동 > 내 연동 4개 | 1768 |
| 스타일 편집 패널 | 2891 |
| 캡처 진입 화면 | **600** (중앙 정렬 화면이라 자연 높이가 안 잡힌다 — 고정) |
| 푸터가 주제인 컷 | 자연 높이(≈379) — MIN 적용하면 콘텐츠와 푸터 사이가 텅 빈다 |

## 3. 합성 스펙

```
배경   : linear-gradient(66deg, rgba(175,211,255,.40) 0%, rgba(216,215,250,.40) 100%), #FFF
테두리 : 없음
캔버스 : border-radius 24px
카드   : width 1040 (= 520 CSS x 2), 가로 중앙(left 280)
그림자 : 0 18px 60px rgba(15,23,42,.10), 0 2px 12px rgba(15,23,42,.06)
```

> 배경은 과거 플랫 `#F5F6F8` + `2px #E4E8EB` 테두리에서 위 그라데이션·무테두리로 교체됐다. **옛 값은 stale이니 쓰지 않는다.**
> 그림자 세기는 참조와 동일하다(원거리 배경 대비 카드 직전 휘도 낙차 15). 카드에 `border`는 없다 — 경계에 보이는 건 그림자 낙차뿐이다.

### 오프셋 규칙 (핵심)

패널 전체를 한 장으로 찍고 **이미지 위치만 움직여** 밴드를 고른다. 잘려나가는 변에는 곡률을 주지 않는다.

| 촬영 위치 | 카드 offset | 곡률 |
|---|---|---|
| 패널 **상단** | top = 60 | 상단 2개만 |
| 패널 **중간** | 위아래 모두 캔버스 밖으로 (top ≤ 0 이고 top+imgH ≥ 1000) | 없음 |
| 패널 **하단** | bottom = 60 (top = 940 - imgH) | 하단 2개만 |

중간 밴드는 기준 요소의 CSS y를 재서 `top = desiredY - cssY * 2`로 잡고 위 조건으로 클램프한다.

### 페이지 스크린샷 계열

`element-picker-1`처럼 **웹 페이지**가 주인공인 컷은 위 규칙 대신 페이지를 확대해 네 변 모두 블리드시킨다(곡률 0). 초점을 캔버스 중앙에 두고 zoom 1.5~1.6.

`logs-viewer-*`(넓은 standalone 페이지, 참조 실측 `L=4 W=1468 T=128`)와 `quick-start-1`(웹스토어)도 패널 규칙 밖이다 — 참조 이미지를 보고 개별로 잡는다.

### 캡처가 걸린 컷은 패널을 별도 창으로 뺀다 (필수)

`captureVisibleTab`은 **활성 탭만** 찍는다. 패널을 대상 페이지와 **같은 윈도우의 탭**으로 열어 두면 둘 중 하나만 활성일 수 있어, 패널을 조작하는 순간 대상 탭이 비활성이 되고 before/after 스냅샷·영역 캡처가 조용히 실패한다(에러가 아니라 `스냅샷 없음`으로 렌더돼 눈으로만 걸린다). 실제 제품에서는 사이드패널이 탭이 아니라 이 충돌이 없다 — **자동화가 만든 부작용**이다.

```js
chrome.windows.create({ tabId: panelTabId, type: "popup", width: 620, height: 900 })
```

패널을 팝업 창으로 분리한 뒤에는 조작 사이사이에 `chrome.tabs.update(targetTabId, { active: true })`로 대상 탭을 활성으로 유지하고, 패널 클릭은 **`click({ force: true })`** 로 보낸다(포커스 이동으로 대상 탭이 비활성화되는 것을 막는다). `e2e/fixtures/extension.ts`의 `keepFixtureActive` 옵션이 같은 함정을 다룬다.

### 브라우저 오버레이 주의

`setDeviceMetricsOverride` 직후 화면 상단 중앙에 `1440 × 900` 크기 뱃지가 뜨는데 **DOM이 아니라 브라우저 오버레이라 지울 수 없고 스크린샷에 찍힌다.** 페이지 컷에서는 확대 크롭으로 프레임 밖으로 빼거나, 오버라이드를 해제하고 자연 크기로 찍는다.

## 4. 마스킹 (공개 문서 전제)

가이드는 `bug-shot.com/{ko,en}/docs`로 **공개 서빙**된다. 연동·제출 계열에 회사 정보가 그대로 박히므로 **촬영 직전 DOM 텍스트 노드만 치환**하고 찍는다(연동 자체는 건드리지 않는다).

| 원본 | 치환 |
|---|---|
| `fastcampus.atlassian.net` | `acme.atlassian.net` |
| `sinhyeok.kang@day1company.co.kr` · `ox501501@gmail.com` | `you@acme.com` |
| `SinhyeokKang` · `ox501501` | `acme-dev` |
| `강신혁` | `Alex Kim` |
| `SIN — Sinhyeok-kang` | `ACME — Product` |
| `FCLXP` · `Skillflo` | `WEB` · `Acme` |
| `bugshot-2/bugshot-test` | `acme/web-app` |

BugShot 자신의 공개 저장소명(`bugshot-web` 등)은 치환하지 않는다.

## 5. 연동 / 더미 데이터

촬영용 연동 4개는 Aside 브라우저 프로필에 실제로 붙여 둔다(전부 OAuth, 토큰 입력 없음).

| 플랫폼 | 대상 | 비고 |
|---|---|---|
| Jira | `FCLXP` | 기본 이슈 타입 = 버그 |
| GitHub | `SinhyeokKang/bugshot-web` | **제출 흐름 컷의 기준** |
| Linear | `SIN — Sinhyeok-kang` | 더미 이슈용 |
| GitLab | `bugshot-2/bugshot-test` | 더미 이슈용 |

**이슈 목록 컷은 시드가 아니라 실제 제출로 채운다.** 상태 배지(`GithubSubmittedBadge` 등)가 `sendBg` → SW fetch로 트래커를 실시간 조회하므로, `bugshot-issues`에 가짜 레코드를 심으면 배지가 조회 실패로 뜬다. 썸네일도 IndexedDB blob이라 실제 캡처를 거쳐야 한다. 목록에 필요한 행은 4~6개뿐이라 실제 제출이 더 싸다. **더미 이슈는 GitLab·Linear에만 넣는다**(Jira·GitHub는 실사용 트래커).

**ko/en 로케일별로 제출 이슈의 제목 언어를 맞춘다** — en 세트를 찍기 전 로컬 이슈 목록을 비우고 영문 제목으로 다시 제출한다.

## 6. 알려진 벽

- **녹화 계열 전체가 막힌다.** `getDisplayMedia` 네이티브 피커뿐 아니라 **탭 녹화(`tabCapture`)와 30초 리플레이도 합성 클릭으로는 시작되지 않는다** — 둘 다 실제 user gesture를 요구하고 `click({force:true})`·일반 `click()` 모두 통과하지 못했다(실측). `manual-smoke` prd.md가 적은 것과 같은 벽이다. 따라서 `video-record-2~5`·`video-replay-3`·`video-issue-1~6`은 **수동 촬영 대상**이다. 리플레이 버퍼가 차오르며 버튼 라벨이 `30초 → 25초 → 9초 리플레이`로 바뀌는 상태는 촬영 가능하다(`video-replay-2`).
- **녹화 시도 후 패널이 이상 상태에 빠질 수 있다.** 실패한 `tabCapture` 시도 뒤 `이슈 작성`(freeform) 버튼이 무반응이 됐다. 패널 URL을 다시 `goto`해 리로드하면 복구된다.
- **커서 화살표** — 기존 참조 일부(`settings-issue-2/3`, `element-picker-1`, `quick-start-1`)에는 인터랙션 지점을 가리키는 커서 그래픽이 얹혀 있다. 합성 단계에서 SVG로 덧그릴 수 있다(미구현).
- **드롭다운은 열어서 찍는다** — 참조 `settings-general-1`은 언어 콤보박스가 열린 상태다. 인터랙션이 주제인 컷은 해당 컨트롤을 열어 둔다.

## 7. 재개 방법

Aside 세션에서:

1. `chrome://extensions`를 열어 `chrome.developerPrivate.getExtensionsInfo`로 BugShot이 ENABLED·UNPACKED인지, `path`가 이 저장소 `dist`인지 확인한다.
2. github.com 탭을 열고 `chrome.tabs.query`로 `tabId`를 얻는다.
3. `?tabId=`를 붙여 패널을 탭으로 연다.
4. §2~§3 규칙대로 촬영·합성한다.

`dist`가 마지막 커밋보다 오래됐으면 먼저 `pnpm build`가 필요하다(Aside 브라우저는 `dist`를 직접 로드한다).

---

## 8. 진행 상태 / 핸드오프 (2026-08-09 기준)

### ko: 60 / 72 — 자동 촬영분 완료

커밋 6개로 반영됨: `42f36e8b`(49장) → `39d6223b`(log viewer 5) → `8fe17834`(이슈 목록·플랫폼 3) → `9af6d7c3`(웹스토어·플랫폼 그리드 2) → `c15d597a`(핸드오프) → `fc8c1516`(페이지 캡처 진행 1).

**남은 12장 — 전부 이 세션에서 촬영 불가였던 것들이다:**

| 에셋 | 사유 |
|---|---|
| `video-record-2~5`, `video-replay-3`, `video-issue-1~6` (11장) | §6대로 **수동 촬영 전용**. `tabCapture`·30초 리플레이 모두 실제 user gesture를 요구해 합성 클릭(`click()`·`click({force:true})` 모두)으로 시작되지 않는다 |
| `element-issue-4`, `screenshot-issue-4`, `settings-ai-2` (3장, `video-issue-4` 중복) | AI 배너가 떠야 하는 컷. Chrome 내장 AI가 계속 `downloading`이고 `downloadprogress`가 0%에서 안 움직였다(다운로드를 시작한 페이지가 닫히면 진행 이벤트를 못 받는다). **BYOK 키를 하나 꽂으면 즉시 배너가 떠 바로 촬영 가능**하다 — 단 배지에 프로바이더명이 노출된다 |

`video-record-5`만 아직 `dummy.jpg` placeholder다. 나머지 71자리는 실제 이미지.

### en: 0 / 73 — 미착수

ko와 같은 파이프라인을 그대로 돌린다. 추가로 신경 쓸 것은 둘뿐:

1. **로케일** — 설정 > 일반 > 언어를 `English`로 바꾼다(`settings-ui-store`에 영속되므로 패널을 다시 열어도 유지된다). 이 세션은 **ko로 되돌려 놓고 끝났다.**
2. **이슈 목록의 제목 언어** — `integrations-issue-tracking-1`은 실제 제출 이슈를 그대로 렌더한다. 현재 쌓인 7건(GitHub `#21`·`#22`, GitLab `#11`·`#12`, Linear `SIN-108`·`SIN-109`, Slack 1건)은 전부 한국어 제목이라 en 컷에 못 쓴다. 로컬 이슈 목록(`bugshot-issues`)만 비우고 영문 제목으로 다시 제출할 것. Slack 카드의 `자세히`/`트래커로 등록` 버튼(`integrations-platforms-2`)은 **Slack 제출 이슈 + Slack 제외 트래커 연결**이 동시에 있어야 뜬다.

### 촬영 환경 재구성 절차

세션이 바뀌면 패널·백드롭 탭이 모두 사라진다. §7 재개 절차에 더해:

```js
// 1. 백드롭 + 패널
const gh = await openTab("https://github.com/SinhyeokKang/bugshot-web");
const ghId = (await chrome.tabs.query({ url: "https://github.com/*" }))[0].id;
const pnl = await openTab(`chrome-extension://<EXT_ID>/src/sidepanel/index.html?tabId=${ghId}`);
// 2. 패널을 별도 창으로 (캡처가 걸린 컷의 필수 조건)
const pt = (await chrome.tabs.query({})).find(t => t.url?.includes("/src/sidepanel/index.html"));
await chrome.windows.create({ tabId: pt.id, type: "popup", width: 620, height: 900 });
// 3. 합성용 탭에도 viewport를 걸어야 한다 — 안 걸면 스크린샷이 타일링된다
await comp._sendToTarget("Emulation.setDeviceMetricsOverride",
                         { width: 1600, height: 1000, deviceScaleFactor: 1 });
```

### 남은 잔여 이슈

- **로그 뷰어 영상 잔여 노출** — `logs-viewer-*`의 영상 프레임 안 GitHub 헤더에 저장소 소유자 핸들이 작게 남는다. 리포트 텍스트는 전부 치환했지만 영상 픽셀은 손댈 수 없다. 문제가 되면 다른 영상으로 리포트를 다시 만들어야 한다.
- **웹스토어 컷** — 촬영 브라우저가 Chrome 포크라 설치 버튼이 `Aside에 추가`로 렌더된다. 촬영 직전 DOM에서 브랜드 문자열을 `Chrome`으로 되돌린다. 상단 "Chrome으로 전환하여…" 배너를 `visibility:hidden`으로 숨기려 하면 **콘텐츠 컨테이너째 사라지니** 텍스트 치환만 할 것.
- **`screenshot-capture-3` 류 순간 상태** — 짧은 페이지에서는 캡처가 즉시 끝나 진행 화면을 못 잡는다. 긴 문서(README blob 등)로 이동한 뒤 `페이지 캡처`를 누르고 sleep 없이 250ms 간격으로 폴링해 해당 프레임을 집는다.
- **중앙 정렬 화면** — 캡처 진입 화면·제출 완료 화면은 콘텐츠가 세로 중앙 정렬이라 패널이 크면 가운데가 빈다. 이 두 화면만 패널 높이 **600** 고정으로 찍는다.
