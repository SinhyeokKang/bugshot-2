# 미지원 URL에서 사이드 패널 열기 + 미지원 안내 — 구현 태스크

> 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준. 줄번호가 어긋나면 심볼명으로 대조할 것.
> Phase 1(Task 1~6)과 Phase 2(Task 7~9)는 **별도 커밋**으로 나눈다. 분리 이유는 design.md 위험 요소 6 참조.

## 선행 조건

- 새 권한 **없음**. `manifest.config.ts` 변경 없음.
- 새 env·의존성 **없음**.
- 새 i18n 키 **없음** — `app.unsupported.title`/`app.unsupported.body`가 ko/en 양쪽에 이미 존재(`src/i18n/namespaces/app.ts:6-7` ko, `:64-65` en). `Globe` 아이콘도 `App.tsx:485`에서 이미 lucide-react로 사용 중.
- `chrome.storage` 스키마 변경 없음 → **마이그레이션 불필요**.
- 착수 전 `docs/POSTMORTEM.md`에서 `activeTab`·`service worker`·`sidePanel`을 grep해 과거 함정 소환(CLAUDE.md 원칙). 특히 `:400-405`(사이드패널은 activeTab 재취득 불가, `<all_urls>`가 `tabCapture`를 커버하지 못함, 캡처 3종의 권한 요구가 각각 다름)과 `:304-306`(Playwright가 module SW 컨텍스트를 못 잡음).

---

## Phase 1 — 정방향 (미지원 페이지에서 패널 열림)

### Task 1: `activateTab` 단위 테스트 선행 작성 (TDD red)

- **변경 대상**: `src/background/__tests__/tab-bindings.test.ts`
- **작업 내용**: `activateTab`의 테스트를 **먼저** 작성한다. 현재 이 함수의 단위 테스트는 **0개**이고 e2e 그물도 없다(design.md 위험 요소 2) — 이 테스트가 유일한 안전망이 된다. `chrome.sidePanel.setOptions`/`open`, `chrome.storage.session.set`을 스텁으로 두고:
  - 미지원 URL(`https://chromewebstore.google.com/detail/x`, `chrome://version`)에서 `setOptions({enabled:true})`와 `open({tabId})`가 **둘 다 호출**된다
  - 두 호출이 **동기적으로**(즉 `activateTab` 반환 시점에 이미) 이뤄진다 — user gesture 보존 단언. `activateTab`은 `void` 반환이므로 함수 호출 직후 스텁 호출 여부를 확인하면 된다
  - `setOptions`가 `open`보다 먼저 호출된다(호출 순서)
  - `tab.id == null`이면 아무것도 호출되지 않는다
  - 지원 URL에서도 동일하게 호출된다(회귀 방지)
- **검증**:
  - [ ] `pnpm test` 실행 시 미지원 URL 케이스가 **실패**한다(아직 가드가 살아 있으므로 — red 확인)
  - [ ] `tab.id == null` 케이스와 지원 URL 케이스는 통과한다

### Task 2: `activateTab`의 미지원 가드 삭제 (green)

- **변경 대상**: `src/background/tab-bindings.ts:210`
- **작업 내용**: `if (!isSupportedUrl(tab.url)) return;` 한 줄을 **삭제**한다. 주석 처리가 아니라 삭제(CLAUDE.md 코드 컨벤션). 아래 `setOptions`→`open`의 **동기 호출 순서를 절대 바꾸지 않는다** — `await`를 하나라도 넣으면 gesture가 소실되어 조용히 실패한다(`docs/ARCHITECTURE.md:15-32`).
  - `isSupportedUrl` import는 유지 — `apply:38`과 `isBroadCoveredUrl:138`이 계속 쓴다.
- **검증**:
  - [ ] Task 1의 테스트가 전부 통과(green)
  - [ ] `pnpm typecheck` 통과 (`isSupportedUrl` 미사용 오류가 나지 않음)
  - [ ] `git diff`가 정확히 1줄 삭제

### Task 3: `useTabSupport` 훅 신규 작성

- **변경 대상**: `src/sidepanel/hooks/useTabSupport.ts` (신규), `src/sidepanel/hooks/__tests__/useTabSupport.test.ts` (신규)
- **작업 내용**: `classifyTabSupport`(`src/lib/url-support.ts:42`) 기반으로 바인딩 탭의 미지원 여부를 boolean으로 반환. 테스트를 먼저 작성한다.
  - 마운트 시 `chrome.tabs.get(tabId)` → `classifyTabSupport({ url: tab.url, contentUrl: undefined })`
  - `chrome.tabs.onUpdated` 구독 → `tabId`가 일치하고 `info.url`이 있으면 그 URL로 재판정. **추가 `tabs.get` 호출 없음**
  - 기존 패턴을 따른다: `hooks/useBackgroundRecorder.ts:108`·`hooks/useEditorSessionSync.ts:282`의 `tabIdRef` + `onUpdated` 조합
  - **반환 규약**: `"unsupported"`일 때만 `true`. `"permission-expired"`와 판정 진행 중은 `false`(= 기존 UI 유지). 오검출 방향을 안전한 쪽으로 두는 결정 — 근거는 design.md "지원 여부 판정의 단일 출처"
  - cleanup에서 `removeListener`
- **검증**:
  - [ ] `chrome://version`으로 마운트 → `true`
  - [ ] `https://example.com`으로 마운트 → `false`
  - [ ] 미지원으로 마운트 후 `onUpdated`에 `info.url = "https://example.com"` → `false`로 전이
  - [ ] 지원으로 마운트 후 `onUpdated`에 `info.url = "chrome://version"` → `true`로 전이
  - [ ] 다른 `tabId`의 `onUpdated`는 무시
  - [ ] `tabId`가 `null`/`undefined`면 `false`이고 `chrome.tabs.get`을 호출하지 않음
  - [ ] `tab.url`이 빈 문자열/`undefined`(activeTab 만료)면 `false` — 정상 페이지에 오검출 안내가 뜨지 않음
  - [ ] 언마운트 시 `removeListener` 호출

### Task 4: `EmptyState` 미지원 분기 (제자리 교체)

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  1. `EmptyState` 시그니처에 `unsupported: boolean` 추가(`:277`)
  2. `:288`의 래퍼 div(아이콘+제목+버튼 4개, `:288-327`)를 `unsupported`일 때 `EmptyShell`로 교체하는 삼항. **새 컴포넌트 트리를 만들지 않는다.** `EmptyShell`(`:682`) 구성:
     - `icon={<Globe className="h-6 w-6 text-muted-foreground" />}`
     - `title={t("app.unsupported.title")}`
     - children: `<p className="text-sm text-muted-foreground">{t("app.unsupported.body")}</p>`
     - **`action` 슬롯 미사용** (자동 감지되므로 새로고침 불필요 — design.md 대안 H)
  3. `:328-330`의 `IntegrationsCta`와 `:331-345`의 `PageFooter`는 **분기 밖에 그대로 둔다**
  4. `PageFooter`의 `[이슈 작성]`(`:340`, `data-testid="mode-freeform"`)에 `aria-disabled={unsupported}` + `onClick` early-return 가드 + `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`. **`disabled` 속성을 쓰지 않는다**(DESIGN.md §14). `[가이드]`(`:333-339`)는 건드리지 않는다 — 페이지 무관하게 동작한다
  5. `EmptyState` 호출부(`:241-252`)에서 `useTabSupport(tabId)` 결과를 `unsupported`로 전달
- **검증** (`IssueTab.test.tsx` — jsdom 트랙):
  - [ ] `unsupported=false`: `mode-element`·`mode-element-shot`·`mode-screenshot`·`mode-record`가 보이고 `app.unsupported.title`은 없음
  - [ ] `unsupported=true`: 위 캡처 버튼 4개가 모두 없고 `app.unsupported.title`·`app.unsupported.body` 텍스트가 보임
  - [ ] `unsupported=true`에서도 `[가이드]` 버튼이 보이고 클릭 가능
  - [ ] `unsupported=true`에서 `mode-freeform`이 `aria-disabled="true"`이고 클릭해도 `onStartFreeform`이 호출되지 않음
  - [ ] `unsupported=false`에서 `mode-freeform` 클릭 시 `onStartFreeform`이 호출됨
  - [ ] 연동 0개 + `unsupported=true`에서 `IntegrationsCta`가 보임
  - [ ] 연동 1개 이상 + `unsupported=true`에서 `IntegrationsCta`가 없음

### Task 5: `DebugTab` 서브탭 잠금 + sync 폴링 스킵

- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`
- **작업 내용**:
  1. 미지원 판정을 얻어(`useTabSupport(tabId)` — `DebugTab:19`에 이미 `useBoundTabId()`가 있다) `logTabsLocked`(`:32`)에 OR로 합친다: 녹화 중 **또는** 미지원이면 console/network `TabsTrigger`(`:70,77`)가 `disabled`. Radix 트리거이므로 기존 `disabled` 패턴 유지(shadcn Button의 `aria-disabled` 규칙은 여기 적용되지 않음)
  2. 레코더 sync 폴링 effect(`:37-49`)에 미지원이면 조기 반환을 추가한다. 현재 `.catch(() => {})`라 미지원 페이지에서 1.5초마다 조용히 영구 실패한다
  - **주의**: sync 경로가 두 개다. 이 인라인 effect(issue 서브탭에서 3종 동기화)와 `hooks/useRecorderSyncInterval.ts`(`ConsoleSubTab.tsx:17`·`NetworkSubTab.tsx:17`). 후자는 서브탭이 잠기면 도달하지 않으므로 **전자만 고친다**
- **검증**:
  - [ ] `unsupported=true`에서 `subtab-console`·`subtab-network`가 disabled (jsdom)
  - [ ] `unsupported=true`에서 `syncNetworkRecorder`/`syncConsoleRecorder`/`syncActionRecorder`가 호출되지 않음 (스텁 + fake timer)
  - [ ] `unsupported=false` + `phase !== "recording"`에서는 두 트리거가 활성이고 sync가 호출됨(회귀 방지)
  - [ ] `phase === "recording"`에서 기존 잠금이 그대로 동작(회귀 방지)

### Task 6: `e2e/unsupported-url.spec.ts` 재작성

- **변경 대상**: `e2e/unsupported-url.spec.ts`
- **작업 내용**: 현재 시나리오(`:31` `mode-element` 클릭 → 다이얼로그 → `:37` `mode-element` 다시 보임)는 캡처 버튼이 사라지므로 성립하지 않는다. 새 시나리오로 전면 재작성:
  - `chrome://version` 탭에서 패널을 열면 미지원 안내가 보이고 캡처 버튼이 없다
  - console/network 서브탭이 비활성이다
  - `[이슈 작성]`이 `aria-disabled`다
  - `[가이드]` 버튼은 존재한다
  - 같은 탭을 fixture 페이지(`ext.fixtureUrl("basic.html")`)로 이동시키면 **조작 없이** `mode-element`가 나타난다 ← 자동 감지 검증, 이 spec의 핵심
  - 기존 픽스처 활용: `ext.openPanel(tabId)`, `enterDebug(panel)`, 신규 탭 id를 `chrome.tabs.query` diff로 찾는 기존 방식(`:11-26`) 유지
  - **주의**: `ext.openPanel`은 `activateTab`을 우회한다. 즉 이 spec은 패널 내부 UI만 검증하며 `activateTab`의 가드 삭제는 커버하지 않는다(Task 1이 담당)
  - 안내 텍스트·`EmptyShell`에 `data-testid`가 필요하면 추가한다 — **e2e를 위한 `src` 수정은 `data-testid` 추가만 허용**
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e -- unsupported-url` green
  - [ ] 재실행 1회 더 green (flaky 아님 확인)

---

## Phase 2 — 역방향 (지원 → 미지원 이동 시 패널 유지) / 별도 커밋

### Task 7: `resolveNavigationAction` 테이블 테스트 확장 (TDD red)

- **변경 대상**: `src/background/__tests__/tab-bindings.test.ts:77-166`
- **작업 내용**: 기존 테이블 드리븐 케이스(`:79` `Case` 타입)에 `newUrlSupported`를 추가하고 행을 보강한다.
  - 기존 `:139` 케이스("광역 보유 + 비보존 + cross-origin + 비커버 URL(file:) → deactivate (현행)")는 `newUrlSupported: true`로 명시하고 **`deactivate` 유지**
  - 신규 행: `newUrlSupported: false`(= `chrome://`·웹스토어) + 비보존 + cross-origin → **`clearSession`**
  - 신규 행: `newUrlSupported: false` + **보존** → `notifyDeferredExpiry` (기존 동작 유지)
  - 기존 모든 행에 `newUrlSupported`를 채운다(타입 필수 필드)
  - `:6` 주석("미보유 닫힘·deferred 분기는 프로덕션 도달 불가 — 순수함수 회귀 자산")을 존중해 도달 가능/불가 구분을 유지
- **검증**:
  - [ ] 신규 `clearSession` 행이 **실패**한다(아직 구현 전 — red)
  - [ ] `file:` 행은 여전히 통과

### Task 8: `resolveNavigationAction` + 호출부 + `apply` 변경 (green)

- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**:
  1. `resolveNavigationAction`(`:116-122`) 입력에 `newUrlSupported: boolean` 추가
  2. 마지막 라우팅(`:129`)을 변경. 새 `NavigationAction` variant는 만들지 않는다(`:107-111` 그대로):
     ```ts
     return input.preserved
       ? "notifyDeferredExpiry"
       : input.newUrlSupported
         ? "deactivate"      // file: 등 지원 스킴이지만 캡처 불가 → 기존 동작
         : "clearSession";   // chrome://·웹스토어 → 패널 유지, 패널이 안내를 그린다
     ```
  3. 호출부(`deactivatePanelIfCrossOrigin:176-182`)에 `newUrlSupported: isSupportedUrl(newUrl)` 전달
  4. `apply()`(`:44`, `:61`)의 enable/disable 조건에서 `supported`를 제거해 `activated`만 보게 한다. 안 고치면 `onUpdated`의 `info.url`·`status==="complete"` 경로가 패널을 다시 닫아 Phase 2가 무효화된다. 불변식: **패널 표시 여부는 activation을 따르고, 지원 여부는 패널이 무엇을 그리는지만 결정한다**
     - `supported` 지역 변수가 미사용이 되면 함께 제거
- **검증**:
  - [ ] Task 7 테이블 전부 green
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 전체 통과 (`apply` 관련 기존 테스트가 있으면 함께 확인)

### Task 9: `e2e/activetab-broad-permission.spec.ts` 단언 반전

- **변경 대상**: `e2e/activetab-broad-permission.spec.ts:94-101`
- **작업 내용**: `"광역 권한 보유라도 비커버 URL(chrome://) 이동 → 패널 종료(deactivate)"` 테스트를 반전한다. 새 기대치: **activated set 보존 + 패널 유지 + 세션만 정리**.
  - 이 spec은 e2e 패널이 실제 side panel이 아니라 일반 Page라 `setOptions(enabled:false)`로 닫히지 않는다는 점을 이미 알고 있고, 그래서 **activated set / 세션 키를 SW storage로 읽어** 판정한다(`:8-13` 주석). 그 관찰 방식을 그대로 쓴다(`isActivated(ext, tabId)` 헬퍼가 이미 있다 — `:89`가 사용)
  - 테스트 제목과 주석(`:100` "chrome://는 지원 스킴 밖이라 newUrlBroadCovered=false → 현행 deactivate 분기")도 새 동작에 맞게 갱신한다
  - 같은 파일의 다른 두 테스트(커버 URL 이동 시 패널 유지 `:74-92`, cross-origin 후 `captureVisibleTab` 성공 `:108-`)는 **건드리지 않는다**
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e -- activetab-broad-permission` green (3개 테스트 전부)
  - [ ] `file:`로 이동하는 케이스가 있으면 여전히 deactivate임을 확인 (없으면 Task 7 단위 테이블로 충분)

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `activateTab` (신규 커버리지) | `src/background/__tests__/tab-bindings.test.ts` | 미지원 URL에서 `setOptions`+`open` **동기** 호출 / 호출 순서 / `tab.id == null` no-op / 지원 URL 회귀 |
| `resolveNavigationAction` | 동일 파일 `:77-166` 테이블 확장 | `newUrlSupported` 축 추가. `file:`(지원+비커버) → `deactivate` 유지, `chrome://`(미지원) → `clearSession`, 보존 시 `notifyDeferredExpiry` |
| `useTabSupport` | `src/sidepanel/hooks/__tests__/useTabSupport.test.ts` (신규) | 초기 판정 / `onUpdated` 양방향 전이 / 타 tabId 무시 / `tabId` null / `tab.url` 빈 값(오검출 방지) / cleanup |
| `EmptyState` 렌더 분기 | `src/sidepanel/tabs/__tests__/IssueTab.test.tsx` | `unsupported` true/false로 버튼·안내·footer·CTA 노출 |
| `DebugTab` 잠금 | `src/sidepanel/tabs/__tests__/DebugTab.test.tsx` | 서브탭 disabled / sync 미호출 / `recording` 기존 잠금 회귀 |

`*.test.ts`는 node 환경, `*.test.tsx`는 jsdom + @testing-library/react(`vitest.config.ts`의 `environmentMatchGlobs`가 확장자로 자동 분기).

### e2e 시나리오

`/e2e-write`의 입력이 되는 판정 가능한 문장:

1. `chrome://version` 탭에서 패널을 열면 미지원 안내(`app.unsupported.title`)가 보이고 `mode-element`가 존재하지 않는다.
2. 같은 상태에서 `subtab-console`과 `subtab-network`가 disabled다.
3. 같은 상태에서 `mode-freeform`이 `aria-disabled="true"`다.
4. 같은 상태에서 `[가이드]` 버튼이 존재한다.
5. 같은 탭을 fixture 페이지로 이동시키면, 추가 조작 없이 `mode-element`가 나타난다. **(자동 감지 — 이번 작업의 핵심 단언)**
6. (Phase 2) 지원 페이지에서 패널을 연 뒤 `chrome://version`으로 이동하면 activated set이 보존된다.
7. (Phase 2) 그 상태에서 다시 지원 페이지로 돌아오면 `mode-element`가 나타난다.

기존 spec 조치: `unsupported-url.spec.ts` 전면 재작성(Task 6), `activetab-broad-permission.spec.ts:94-101` 단언 반전(Task 9).

### 수동 테스트 (자동화 불가)

`activateTab`은 e2e 그물이 없고(Playwright가 확장 액션 아이콘을 클릭할 수 없음) 서비스워커도 Playwright로 구동할 수 없다(`docs/POSTMORTEM.md:304-306`). **아래는 반드시 실물 Chrome에서 확인한다. `pnpm build` 선행 필수 — dist가 stale이면 헛테스트다.**

- [ ] `pnpm build` → `chrome://extensions`에서 확장 리로드
- [ ] `https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig`에서 툴바 아이콘 클릭 → **패널이 열리고 미지원 안내가 보인다**
- [ ] `chrome://settings`에서 아이콘 클릭 → 동일하게 열린다
- [ ] 서비스워커 콘솔(`chrome://extensions` → "Service worker")에 `[bugshot] sidePanel.open` 에러가 없다
- [ ] 미지원 페이지에서 Integrations 탭으로 이동 → **트래커 1개를 실제로 연결 완주**한다 (OAuth 창이 뜨고 콜백까지)
- [ ] 미지원 페이지에서 Settings → LLM 연동 다이얼로그를 열어 **BYOK 키 저장·연결 테스트가 동작**한다
- [ ] 미지원 페이지에서 Issue list 탭이 정상 렌더된다
- [ ] 미지원 페이지에서 `[가이드]` 클릭 → 가이드 탭이 열린다
- [ ] 주소창으로 임의 `https://` 사이트 이동 → **조작 없이** 캡처 진입 화면으로 바뀐다
- [ ] 그 상태에서 요소 스타일 편집이 정상 동작한다(정방향 회귀)
- [ ] 라이트/다크 양쪽에서 안내 화면의 아이콘·텍스트 대비가 기존 빈 상태와 일관된다 (시각 정합 — jsdom으로 못 잡음)
- [ ] 좁은 패널 폭에서 안내 텍스트가 잘리지 않는다
- [ ] (Phase 2) 지원 페이지에서 패널을 연 뒤 `chrome://settings`로 이동 → **패널이 닫히지 않고** 안내로 바뀐다
- [ ] (Phase 2) 작성 중 세션(요소 편집 후 drafting)이 있는 상태로 `chrome://settings`로 이동 → 기존 `notifyDeferredExpiry` 동작 유지(세션 보존)

## 구현 순서 권장

```
Phase 1 (커밋 1)
  Task 1 (red)  →  Task 2 (green)          ... background, 독립
  Task 3 (훅)                               ... Task 1·2와 병렬 가능
  Task 4 (EmptyState)  ←  Task 3 필요
  Task 5 (DebugTab)    ←  Task 3 필요       ... Task 4와 병렬 가능
  Task 6 (e2e 재작성)  ←  Task 4·5 필요
  → 수동 테스트 → 커밋

Phase 2 (커밋 2)
  Task 7 (red)  →  Task 8 (green)  →  Task 9 (e2e)
  → 수동 테스트 → 커밋
```

- Task 1·2는 background 단독이라 UI 작업과 완전히 독립적이다.
- Task 3이 Task 4·5의 선행 조건이다.
- Task 4와 Task 5는 서로 독립(다른 파일).
- **Phase 2는 Phase 1이 green으로 커밋된 뒤 시작한다.** 한 커밋에 묶으면 회귀 시 이등분이 불가능하다(design.md 위험 요소 6).

## 가이드 영향

**있음.** 미지원 페이지에서의 동작이 사용자 노출 UX로 바뀐다(기존: 아무 일도 안 일어남 → 변경: 패널이 열리고 안내). 작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙대로 한다. 구현 후 `/guide`로 처리.

- `guide/ko/faq.md` · `guide/en/faq.md` — "아이콘을 눌렀는데 아무 일도 없어요" 류 항목이 있으면 갱신, 없으면 "어떤 페이지에서 사용할 수 있나요" 항목에 미지원 페이지에서 보이는 안내를 반영
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` — 첫 실행 단계 설명이 "지원되는 웹 페이지에서 아이콘을 누르라"는 전제를 담고 있는지 확인. 설치 직후 스토어 페이지에 서 있는 상태를 언급할 가치가 있다

> `guide/ko`·`guide/en`은 **항상 같은 내용**을 담아야 하므로 양쪽을 같은 커밋에서 함께 갱신한다.

## 문서 영향 (참고)

- `CLAUDE.md` "게이트웨이" 섹션의 지원 URL 설명("그 외 페이지에서는 side panel을 enable하지 않고…")이 **사실과 어긋나게 된다** → `docs(CLAUDE)` 갱신 필요.
- `docs/ARCHITECTURE.md`에 Side Panel 탭 스코프 관련 서술이 있으면 대조.
- `docs/privacy.{ko,en}.md`: 새 권한·새 수집·새 전송이 없으므로 **갱신 불필요**. (다만 `/push` 신선도 검사에서 판단 근거를 물으면 위 근거를 댈 것.)
- 구현 완료 후 회귀·함정이 드러나면 `/postmortem`으로 `docs/POSTMORTEM.md`에 항목 추가.
