# manual-smoke — 기술 설계

## 개요

**코드를 만들지 않는 기능이다.** 산출물은 절차를 규정하는 스킬 1개와 데이터·이력을 담는 문서 1개이고, 실행체는 Aside 세션의 REPL(Playwright `page` + 저수준 CDP `page._sendToTarget`)이다. 새 의존성·새 권한·새 env·새 스크립트 0개.

구조는 기존 리포트 전용 스킬(`/audit`·`/code-review`·`/e2e-run`)과 같다: 절차와 금지 사항을 스킬이 갖고, 대상 데이터와 커버리지 맵을 별도 문서가 갖는다. 갈라 두는 이유는 **대상 사이트가 스킬 절차보다 훨씬 자주 바뀌기 때문**이다. 사이트를 스킬 본문에 박으면 사이트 하나 바꿀 때마다 `pnpm sync:agents`로 미러를 재생성해야 한다.

## 변경 범위

### 신규

| 파일 | 역할 |
|---|---|
| `.claude/commands/manual-smoke.md` | 스킬 정의. frontmatter `description` + 절차·전제·금지. `pnpm sync:agents`가 `.agents/skills/source-command-manual-smoke/SKILL.md`를 자동 생성한다(EXCLUDE 대상 아님) |
| `e2e/MANUAL-SMOKE.md` | 시나리오 정의(S1~S6) · 대상 사이트 표 · 판정 기준 · COVERAGE 매핑 · 최근 실행 이력 |

### 갱신

| 파일 | 변경 |
|---|---|
| `docs/DIRECTORY.md` | `e2e/` 트리에 `MANUAL-SMOKE.md` 한 줄, `.claude/commands/` 스킬 수 21로 |
| `e2e/COVERAGE.md` | "수동 잔여" 도입부에 한 줄 — 일부 항목은 `MANUAL-SMOKE.md`가 Aside로 스윕한다는 포인터. **항목 자체는 옮기지 않는다**(여전히 e2e 미커버라는 사실이 바뀌지 않았다) |
| `e2e/README.md` | "문서 구성" 목록에 `MANUAL-SMOKE.md` 한 줄 |
| `CLAUDE.md` | 워크플로우 절의 스킬 개수·권장 흐름에 `/manual-smoke` 편입(`/merge` 전 권고). 편집 시 PostToolUse 훅이 `sync:agents`를 자동 실행 |

### 건드리지 않는 것

`src/`·`manifest.config.ts`·`package.json`·`playwright.config.ts`·`scripts/`. 특히 `package.json`에 스크립트를 추가하지 않는다 — 실행체가 셸이 아니라 Aside 세션이라 npm 스크립트로 감쌀 대상이 없다.

## 데이터 흐름

```
사용자: /manual-smoke [S1 S3 ...]
  │
  ├─ 0. 런타임 확인 ─ 브라우저 제어 없음(Claude Code·Codex) → 즉시 중단
  │
  ├─ 1. 전제 확인
  │     openTab("chrome://extensions/")
  │     └ evaluate: developerPrivate.getExtensionsInfo({includeDisabled:true})
  │         ├ id 미존재            → 중단 + 수동 로드 안내
  │         ├ state !== "ENABLED"  → 중단
  │         └ manifestErrors/runtimeErrors > 0 → 리포트에 선기재
  │     fs: dist/manifest.json mtime vs git log -1 --format=%ct
  │         └ stale → 중단 + /build 안내
  │
  ├─ 2. 확장 리로드
  │     evaluate: developerPrivate.reload("dhmffogmoohdjficicjjfolcheklngfm")
  │     → deleteExtensionErrors로 이전 오류 클리어 후 재조회
  │
  ├─ 3. 시나리오 루프 (S1..S6)
  │     ├ openTab(site)                       ← 대상 탭
  │     ├ tabId = panel.evaluate(chrome.tabs.query)
  │     ├ openTab(`chrome-extension://<id>/src/sidepanel/index.html?tabId=${tabId}`)
  │     ├ [S6만] Emulation.setDeviceMetricsOverride / 테마 seed
  │     ├ 조작 ─ 포커스 규칙(아래 위험 1)을 지켜 패널·대상 탭 전환
  │     ├ snapshot() 구조 판정 + screenshot() 육안 판정
  │     └ closeTab 정리 (누수 금지 — 위험 5)
  │
  ├─ 4. 리포트 (대화 응답) ─ 실패·skip을 성공보다 먼저
  └─ 5. e2e/MANUAL-SMOKE.md "최근 실행" 표에 1행 append
```

## 인터페이스 설계

코드가 없으므로 TypeScript 시그니처 대신 **실행 계약**을 고정한다. 아래 값은 전부 실측으로 확인된 것이다.

### 상수

```
확장 ID     : dhmffogmoohdjficicjjfolcheklngfm
              (manifest.config.ts의 DEV_KEY SHA256 → 앞 16바이트 → a-p 매핑.
               store 빌드는 key를 지우므로 이 ID는 dev·e2e 빌드 전용이고,
               dist를 수동 로드하는 한 머신·프로필이 달라도 항상 같다)
패널 경로   : src/sidepanel/index.html      (manifest.side_panel.default_path)
바인딩      : ?tabId=<number>                (src/sidepanel/hooks/useBoundTabId.ts:readQuery)
picker host : __bugshot_picker_host          (대상 페이지 DOM, open shadow host)
테마 영속키 : bugshot-app-settings           (chrome.storage.local, settings-ui-store persist name)
```

### 확장 제어 (chrome://extensions 페이지 컨텍스트에서 `page.evaluate`)

`chrome.developerPrivate`가 그 페이지에만 노출된다. 실측으로 34개 메서드를 확인했고 이 스킬이 쓰는 것은 넷이다.

```
getExtensionsInfo({includeDisabled, includeTerminated}, cb)
  → [{ id, name, version, location, state, manifestErrors[], runtimeErrors[] }]
reload(id)                       확장 재로드 (빌드 후 갱신)
deleteExtensionErrors({extensionId})  이전 실행의 오류 클리어
getProfileConfiguration(cb)      → { inDeveloperMode, canLoadUnpacked }
```

### 폭·테마 제어 (S6 전용)

Aside `page`에는 **`setViewportSize`가 없다**(실측: `TypeError: setViewportSize is not a function`). 저수준 CDP로 대체한다.

```
page._sendToTarget("Emulation.setDeviceMetricsOverride",
                   { width, height, deviceScaleFactor: 0, mobile: false })
page.screenshot({ type: "webp", clip: { x: 0, y: 0, width, height } })
```

테마는 media 에뮬레이션으로 못 바꾼다(위험 2). `chrome.storage.local`의 `bugshot-app-settings`에 `theme` seed 후 패널을 열거나, 설정 탭 Select를 조작한다.

### 판정 2축

| 축 | 수단 | 쓰는 곳 |
|---|---|---|
| **구조 판정** | `snapshot(page)` 접근성 트리에서 값·존재·상태 확인 | S1~S5 — "값이 뜨는가", "범위가 의미 단위인가" |
| **육안 판정** | `screenshot()` → 이미지 직접 검사 | S6 + S1~S5의 시각 부수 확인 |

**구조 판정을 먼저 쓰고, 육안은 구조로 못 가르는 축에만 쓴다.** 육안은 재현 기술이 어려워 리포트 품질이 떨어진다.

## 시나리오 정의 (S1~S6)

각 항목은 `e2e/COVERAGE.md` 수동 잔여의 특정 줄에 매핑된다. 상세 절차·판정 문장은 `e2e/MANUAL-SMOKE.md`가 단일 출처이고, 여기서는 설계 근거만 남긴다.

| # | 시나리오 | 대상 사이트 | COVERAGE 매핑 | 판정 축 |
|---|---|---|---|---|
| **S1** | cross-origin 스타일 보강 양성 경로 | `naver.com` · `github.com` · `ui.shadcn.com` | *"cross-origin 스타일 보강(양성 경로) — e2e fixture 서버는 loopback 전용이라 SSRF 가드가 차단"* | 구조 |
| **S2** | 페이지 전체(스크롤) 캡처 실사이트 | `ko.wikipedia.org` 긴 문서 · `news.naver.com` 기사 | *"afterImage·캡처 썸네일 시각 정합"* + 캡(20타일/32000px/4M px) 실경로 | 구조+육안 |
| **S3** | element 캡처 컨텍스트 확장 — 과확장·인접 개인정보 | `github.com` 이슈 목록 · `bug-shot.com/ko` | *"확장 이미지에 인접 개인정보가 불필요하게 포함되지 않는지와 buildSelector 동기 블로킹 체감도 수동 전용"* | 구조+육안 |
| **S4** | picker 실사이트 정합 (광고 iframe 다수) | `news.naver.com` | *"iframe hover 하이라이트 시각 정합·blocker 핸드오프 경계 깜빡임·다수 iframe(광고) 성능 체감"* | 육안+체감 |
| **S5** | 미지원 URL — webstore 차단 호스트 | `chromewebstore.google.com/detail/bugshot/...` | *"picker unsupported URL 중 webstore 차단 호스트 — 실제 webstore 접근이 필요해 fixture 서버로 재현 불가"* | 구조 |
| **S6** | 시각 회귀 스윕 (light/dark × 320·376·480px) | S1~S4 중 1개 고정 | *"integrations-cta 배너의 시각 접합·트렁케이션"* 5항목 + *"action 로그 필터 탭 376px 가로 오버플로"* | 육안 |

**S1이 최우선인 이유**: 이 항목만 현재 자동 그물이 **0**이다. 나머지는 순수 함수 단위 테스트가 부분적으로라도 받치고 있는데(`ssrf-guard.test.ts`·`css-resolve.test.ts`·`capture-basis.test.ts`), S1의 양성 경로는 단위도 e2e도 못 본다.

**S5가 가장 싸다**: 사이트 하나 열고 패널 스냅샷 한 번이면 끝난다. 스킬 배선을 검증하는 스모크의 스모크로도 쓴다.

## 기존 패턴 준수

- **리포트 전용 스킬 3원칙** — `/audit`·`/code-review`·`/e2e-run`과 동일하게 (1) 코드 수정 금지 (2) 커밋·푸시 안 함 (3) 후속 스킬 자동 제안 금지. 다만 이 스킬은 예외로 `e2e/MANUAL-SMOKE.md`의 이력 표 1행만 갱신한다(측정 결과를 안 남기면 "돌렸는데 뭐가 나왔는지 모르는" 상태가 되고, `/coverage`가 베이스라인을 래칫하는 것과 같은 회로다).
- **런타임 분기** — `ship.md`의 "push 권한 / 런타임별 종착점"과 같은 방식으로 본문에 분기를 박는다. 미러는 치환 없이 복제되므로 Codex도 같은 문장을 읽고 스스로 중단한다.
- **빌드 금지** — `CLAUDE.md`의 "빌드는 자동 실행하지 않는다"를 그대로 따른다. `dist` 신선도 확인까지가 스킬의 책임이고 빌드는 사용자가 `/build`.
- **`dist-e2e` 금지** — `e2e/README.md`가 못 박은 대로 `dist-e2e`는 테스트 전용이라 수동 로드하지 않는다. 이 스킬은 **`dist`만** 쓴다.
- **회고 소환 회로** — 시나리오 실패 시 `docs/POSTMORTEM.md`를 해당 영역으로 grep해 과거 함정과 대조한 뒤 리포트한다. `/implement`·`/refactor`가 착수 전에 하는 것과 같다.
- **문서 톤** — `e2e/COVERAGE.md`·`GOTCHAS.md`와 같은 한국어 밀도. 각 문장이 판정에 필요한 정보여야 한다.

## 대안 검토

### A. Playwright e2e 스위트에 편입 (기각)

가장 자연스러워 보이지만 셋 다 막힌다. (1) 실사이트 접근은 CI에서 네트워크·flaky·요금 문제를 만들고 fork PR에서 secret 없이 도는 현재 구조를 깬다. (2) `captureVisibleTab` quota flaky 때문에 캡처 진입 spec은 이미 5개가 삭제된 전례가 있다(`GOTCHAS.md`). (3) 시각 판정은 Playwright가 원리적으로 못 한다. **e2e는 결정론 게이트, manual-smoke는 비결정론 탐색**이라 같은 스위트에 둘 수 없다.

### B. Aside 계정 스킬(`~/.aside/u/0/skills/`)로 분리 (기각)

저장소 밖이라 git 이력을 공유하지 않는다. 시나리오는 `e2e/COVERAGE.md`와 함께 움직여야 하는데 한쪽만 버전 관리되면 반드시 드리프트한다. 또 다른 개발자·다른 머신에서 재현할 수 없다.

### C. 최상위 `smoke/` 디렉터리 (보류 — 승격 기준으로 전환)

지금 산출물이 `.md` 1개라 최상위 디렉터리는 과설계다. 대신 `e2e/` 안에 두되 **승격 기준을 문서에 박는다**: 파일이 3개를 넘거나 실행 스크립트(`.mjs`)가 생기면 `git mv`로 `smoke/`로 옮기고 `DIRECTORY.md`·`CLAUDE.md`를 함께 갱신한다. `e2e/`가 `DIRECTORY.md`에 "Playwright e2e 스위트"로 정의돼 있어 비-Playwright 자산이 늘면 정의와 충돌하기 시작한다.

`e2e/`에 둬도 안전한 근거: `playwright.config.ts`의 `testDir: "."`에 기본 `testMatch`(`**/*.spec.ts`)라 `.md`는 물론 나중에 사이트 목록을 `.ts`로 빼도 스위트에 안 걸린다.

### D. 사이트 목록을 스킬 본문에 인라인 (기각)

사이트가 절차보다 훨씬 자주 바뀌는데, `.claude/commands/*.md`를 고치면 `pnpm sync:agents`로 미러를 재생성해야 한다. 데이터 변경이 미러 재생성을 유발하는 구조는 드리프트 위험만 늘린다.

## 위험 요소

### 1. 포커스 순서가 판정을 뒤집는다 (실측)

패널이 백그라운드일 때 **cmdk 팝오버가 안 열린다.** 실측에서 `ValueCombobox` 트리거 클릭이 조용히 no-op이었고 `bringToFront()` 후에야 열렸다. 그런데 캡처는 반대로 **대상 탭이 활성이어야** background 캡처 관문(`captureOwnedTab`)의 `tab.active` 재확인을 통과한다(`GOTCHAS.md`).

→ 스킬에 규칙을 명시한다: **값 편집·다이얼로그 조작은 패널 포커스 / 캡처 발행은 대상 탭 포커스.** 전환 순서를 틀리면 증상이 "제품이 안 됨"으로 나와 회귀와 구별되지 않는다. e2e가 `fixture.bringToFront()` 후 패널 버튼을 DOM 클릭으로 누르는 것과 같은 함정의 Aside판이다.

### 2. `prefers-color-scheme` 에뮬레이션으로는 다크가 안 걸린다 (실측)

`Emulation.setEmulatedMedia`는 정상 적용된다(`matchMedia(...).matches === true` 확인). 그런데 `document.documentElement`에 `.dark`가 안 붙었다. 원인은 `settings-ui-store`의 **기본 `theme`가 `"system"`이 아니라 `"light"`** 이기 때문이다(`settings-ui-store.ts:186`). `useThemeEffect`는 `theme !== "system"`이면 media 변화를 아예 구독하지 않는다.

→ S6의 다크는 **앱 테마를 직접 바꿔서** 만든다(`bugshot-app-settings` seed 또는 설정 탭 Select). media 에뮬레이션은 `theme: "system"` 경로를 볼 때만 의미가 있고, 그건 별도 항목이다.

### 3. `setDeviceMetricsOverride`는 reload에 날아가고, 스크린샷이 어긋난다 (실측)

패널을 reload하면 `window.innerWidth`가 override 값(320)에서 실제 창 폭(1440)으로 돌아갔다. 또 override 상태에서 `clip` 없이 스크린샷을 찍으면 좁은 렌더가 창 폭만큼 **가로로 반복돼** 찍힌다.

→ 규칙 둘: **네비게이션·reload 후에는 override를 다시 건다.** **스크린샷은 항상 override와 같은 `clip`을 준다.**

### 4. 실사이트가 판정을 조용히 무력화한다

`GOTCHAS.md`의 "픽스처가 무너져도 spec은 '확장이 안 걸렸다'만 보고 그게 구현 회귀인지 픽스처 붕괴인지 구별하지 못한다"가 실사이트에서 훨씬 자주 일어난다. 사이트 개편 한 번이면 S3의 조상 컨테이너 게이트(G1/G2/G3)가 통째로 안 걸릴 수 있다.

→ 각 시나리오에 **전제 단언을 먼저** 둔다. S3라면 "대상 요소에 의미 단위 조상이 실제로 있고 게이트 3개를 만족하는가"를 먼저 확인하고, 불만족이면 `skip(사이트 변경)`으로 기록한다. `assertGatesSatisfied`의 Aside판이다.

### 5. 탭 누수가 다음 시나리오를 오염시킨다

`tabId` 조회를 URL 패턴으로 하므로 앞 시나리오의 잔여 탭이 있으면 엉뚱한 탭을 잡는다(`fixtureTabId` 모호성과 동일). Aside 세션은 e2e worker fixture보다 수명이 길어 더 잘 샌다.

→ 시나리오마다 **열고 닫는 것을 짝으로** 두고, 루프 진입 전에 잔여 탭을 정리한다. 실측 중 열린 탭이 5개를 넘자 경고가 떴다.

### 6. `captureVisibleTab` quota·cold-start

30s Replay spec 5개를 통째로 삭제하게 만든 그 함정이다. Aside는 게이트가 아니라 재시도해도 되지만, **실패를 제품 회귀로 오판하면 리포트가 거짓말**을 한다.

→ 캡처 실패는 1회 재시도 후 `skip(환경)`. 연속 실패 시에만 fail로 승격하고 근거(quota 에러 문자열)를 리포트에 남긴다.

### 7. 확장 ID가 store 빌드에서 달라진다

`BUGSHOT_STORE_BUILD=1`은 `key`를 지우므로 ID가 바뀐다. 스킬이 상수 ID를 박고 있으니 store 빌드를 로드하면 못 찾는다.

→ 전제 확인 단계에서 `location === "UNPACKED"`와 `version`을 함께 검증하고, 못 찾으면 "store 빌드를 로드한 것 아닌가"를 안내에 포함한다.
