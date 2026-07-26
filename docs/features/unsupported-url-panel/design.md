# 미지원 URL에서 사이드 패널 열기 + 미지원 안내 — 기술 설계

> 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준. 리뷰 시 줄번호가 어긋나면 심볼명으로 대조할 것.

## 개요

핵심 변경은 **불변식 하나를 바꾸는 것**이다.

- **현재**: 패널 표시 여부 = `activation && URL 지원 여부`
- **변경 후**: 패널 표시 여부 = `activation`. **URL 지원 여부는 패널이 무엇을 그리는지만 결정한다.**

이 한 문장이 Phase 1(`activateTab`의 가드 삭제)과 Phase 2(`apply()`·`resolveNavigationAction`)를 같은 원리로 묶는다. 결과적으로 `supported`가 표시 결정에서 빠지고 렌더 결정으로 내려가므로 background 로직은 **단순해진다**.

UI는 신규 컴포넌트를 만들지 않는다. 기존 캡처 진입 화면(`EmptyState`)의 가운데 블록만 기존 `EmptyShell`로 제자리 교체하고, 문구는 이미 존재하는 i18n 키를 재사용한다. **신규 i18n 키 0개, 신규 권한 0개, 신규 파일 1개(판정 훅).**

## 변경 범위

### Phase 1 — 정방향 (미지원 페이지에서 패널 열림)

#### `src/background/tab-bindings.ts`

- **현재 역할**: 탭↔패널 바인딩 전체. 액션 클릭 핸들러(`activateTab:208`), 탭 활성화·네비게이션 시 패널 옵션 재적용(`apply:37`), cross-document 네비게이션 판정(`deactivatePanelIfCrossOrigin:150` + 순수함수 `resolveNavigationAction:116`), 탭 제거 정리.
- **변경**: `activateTab:210`의 `if (!isSupportedUrl(tab.url)) return;` **삭제**. 그 아래 `setOptions`+`open`은 **동기 호출 순서를 반드시 유지**한다.

```ts
export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  const tabId = tab.id;

  void chrome.sidePanel.setOptions({
    tabId,
    path: `${SIDEPANEL_PATH}?tabId=${tabId}`,
    enabled: true,
  });
  void chrome.sidePanel
    .open({ tabId })
    .catch((err) => console.error("[bugshot] sidePanel.open", err));

  void setActivated(tabId, true);
  if (tab.url) {
    void chrome.storage.session.set({ [`${ACTIVATION_URL_PREFIX}${tabId}`]: tab.url });
  }
}
```

`isSupportedUrl` import는 계속 유효하다 — `apply:38`과 `isBroadCoveredUrl:138`이 쓴다.

**부수 효과(의도된 것)**: 미지원 탭도 activated set에 들어가고 `ACTIVATION_URL_PREFIX` 세션 키가 쓰인다. 두 값의 소비처는 모두 이 파일 안(`apply:39`, `deactivatePanelIfCrossOrigin:156,164`, `onRemoved:295-296` 정리)이라 파급이 없다. 오히려 **복구 경로가 공짜로 생긴다** — `apply:44-54`가 `activated && supported`일 때 `path`를 정상 재등록하므로, 미지원 탭이 지원 URL로 이동하면 패널이 정상 경로로 살아난다.

#### `src/sidepanel/hooks/useTabSupport.ts` (신규)

- **역할**: 바인딩된 탭의 지원 여부를 판정하고 네비게이션에 따라 갱신.
- 마운트 시 `chrome.tabs.get(tabId)` → `classifyTabSupport({url, contentUrl})`로 초기 판정.
- `chrome.tabs.onUpdated` 구독으로 재판정. `info.url`이 실려 오면 그것으로 판정하므로 **추가 `tabs.get` 호출이 필요 없다.**
- 선례: 패널 내부 `chrome.tabs.onUpdated` 구독이 이미 2곳 — `hooks/useBackgroundRecorder.ts:108`, `hooks/useEditorSessionSync.ts:282`. 두 훅의 `tabIdRef` 패턴(ref로 최신 tabId를 들고 effect 의존성을 줄이는)을 따른다.

#### `src/sidepanel/tabs/IssueTab.tsx`

- **현재 역할**: Debug > 이슈 서브탭 본체. phase별 화면 분기. 캡처 진입 화면은 `isCaptureEntryScreen(...)` 가드 안에서 `EmptyState`를 렌더(`:241-252`).
- **변경 1**: `useTabSupport(tabId)`로 판정해 `EmptyState`에 `unsupported` prop 전달(`:243-250`).
- **변경 2**: `EmptyState`(`:277-348`) 내부에서 `:288`의 래퍼 div(아이콘+제목+버튼 4개, `:288-327`)를 `unsupported`일 때 `EmptyShell`로 교체. `:328-330`의 `IntegrationsCta`와 `:331-345`의 `PageFooter`는 **분기 밖에 그대로 둔다**.
- **변경 3**: `PageFooter`의 `[이슈 작성]` 버튼(`:340`)에 `aria-disabled` + 핸들러 early-return 가드.

`EmptyShell`(`:682-701`)의 래퍼는 `flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center`이고 교체 대상 `:288`은 `flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-5`다. **같은 레벨의 거의 동일한 래퍼**라 중첩 없이 갈아끼워지며, `gap-4`/`px-6` 차이는 `EmptyShell`이 `mb-3`/`px-4`로 자체 처리해 DESIGN.md §14 빈 상태 관용형에 수렴한다.

#### `src/sidepanel/tabs/DebugTab.tsx`

- **현재 역할**: Debug 탭의 3개 서브탭(`issue`/`console`/`network`) 셸. `hideSubTabs`(작성 플로우에서 바 숨김, `:25-29`), `logTabsLocked`(녹화 중 console/network 잠금, `:32`), 레코더 sync 폴링(`:37-49`).
- **변경 1**: `logTabsLocked` 조건에 미지원 판정을 OR로 추가.
- **변경 2**: 레코더 sync 폴링 effect(`:37-49`)를 미지원이면 스킵. 현재는 `.catch(() => {})`라 미지원 페이지에서 1.5초마다 조용히 영구 실패한다.

> **주의**: sync 폴링 경로가 두 개다. `DebugTab:37-49`의 인라인 effect(issue 서브탭에서 3종 동기화)와 `hooks/useRecorderSyncInterval.ts`(`ConsoleSubTab.tsx:17`·`NetworkSubTab.tsx:17`에서 사용). 후자는 서브탭이 비활성화되면 도달하지 않으므로 **전자만 고치면 된다.**

### Phase 2 — 역방향 (지원 → 미지원 이동 시 패널 유지) / 별도 커밋

#### `src/background/tab-bindings.ts` (2차 변경)

- **`resolveNavigationAction`(`:116-130`)에 입력 `newUrlSupported: boolean` 추가.**

현재 입력만으로는 두 케이스를 구분할 수 없다:

| newUrl | `isSupportedUrl` | `newUrlBroadCovered` (`isBroadCoveredUrl:137`) |
|---|---|---|
| `chrome://version` | ✗ | false |
| `file:///x.html` | **✓** | false |

`file:`은 **지원 스킴이지만 광역 커버 밖**이다 — `<all_urls>`가 `file:`을 포함하더라도 Chrome이 "파일 URL 액세스" 토글을 별도로 요구하므로 `BROAD_COVERED_SCHEMES`가 http/https만 담는다(`:132-136` 주석). 둘 다 `newUrlBroadCovered === false`이므로 새 입력 없이 고치면 `file:` 동작까지 바뀐다.

- **라우팅 변경**: 비보존 + cross-origin일 때, 미지원 URL이면 `deactivate` 대신 **`clearSession`**을 반환한다. 새 `NavigationAction` variant는 만들지 않는다 — 기존 `clearSession`의 실효(패널 유지 + activated 보존 + stale 세션 제거)가 원하는 동작과 정확히 일치한다(`:187-189`).

```ts
  return input.preserved
    ? "notifyDeferredExpiry"
    : input.newUrlSupported
      ? "deactivate"      // file: 등 지원 스킴이지만 캡처 불가 → 기존 동작 유지
      : "clearSession";   // chrome://·웹스토어 → 패널 유지, 패널이 미지원 안내를 그린다
```

- **호출부**(`deactivatePanelIfCrossOrigin:176-182`)에 `newUrlSupported: isSupportedUrl(newUrl)` 전달.
- **`apply()`(`:61-67`) 변경**: `!(activated && supported)` → `setOptions({enabled:false})`를 `!activated`로 좁힌다. 안 고치면 `onUpdated`의 `info.url`·`status==="complete"` 경로에서 패널이 다시 닫혀 Phase 2가 무효화된다. 동시에 `:44`의 enable 조건도 `activated`만으로 좁혀 path 재등록이 미지원 탭에도 적용되게 한다.

## 데이터 흐름

### 패널 오픈 (Phase 1)

```
[사용자] 툴바 아이콘 클릭
   → chrome.action.onClicked
   → activateTab(tab)                       ... URL 지원 여부 무관
       ├─ sidePanel.setOptions({tabId, path:?tabId=N, enabled:true})   [동기]
       ├─ sidePanel.open({tabId})                                      [동기 — gesture 소비]
       └─ setActivated(tabId, true)                                    [fire-and-forget]
   → 패널 문서 부팅 (?tabId=N)
   → useBoundTabId() → N
   → useTabSupport(N) → chrome.tabs.get(N) → classifyTabSupport
       ├─ "supported"          → 기존 캡처 진입 화면
       ├─ "unsupported"        → EmptyShell 안내
       └─ "permission-expired" → 기존 캡처 진입 화면 (아래 결정 참조)
```

### 네비게이션 갱신

```
[사용자] 주소창으로 이동
   → chrome.tabs.onUpdated (패널 내부 구독, info.url 실림)
   → useTabSupport 재판정 → 리렌더
   → (동시에 background) apply(tabId, url) → setOptions로 path·enabled 재적용
```

패널 문서는 `path`가 동일 값으로 재등록되므로 리로드되지 않는다. 그래서 **패널 내부 구독이 갱신의 단일 수단**이며, 이것이 "새로고침 버튼 불필요"의 근거다.

### 지원 여부 판정의 단일 출처

`classifyTabSupport`(`src/lib/url-support.ts:42-56`)를 그대로 쓴다. 이 함수는 `tab.url`이 비었을 때(activeTab 만료로 URL을 못 읽는 상태) content script가 보고한 `location.href`로 판정해 `"permission-expired"`와 `"unsupported"`를 구분한다.

**설계 결정**: `useTabSupport`는 `"permission-expired"`를 **미지원으로 취급하지 않는다.** 그 상태는 "지원 페이지인데 권한만 풀린" 것이고 전용 안내 다이얼로그(`onPickerPermissionExpired` → `App.tsx:191-196`)가 이미 담당한다. 따라서 훅은 `"unsupported"`일 때만 미지원으로 판정한다. 초기 판정에서 `contentUrl`을 얻으려면 content script 왕복이 필요한데(`picker-control.ts:185`의 `getPageUrl`), 미지원 페이지에는 content script가 없어 실패한다 — 이 실패는 `classifyTabSupport`의 `contentUrl: undefined` 경로로 자연스럽게 `"unsupported"`가 된다.

## 인터페이스 설계

```ts
// src/sidepanel/hooks/useTabSupport.ts (신규)

/**
 * 바인딩된 탭의 지원 여부. 네비게이션(chrome.tabs.onUpdated)에 따라 자동 갱신된다.
 * - `false`: 판정 진행 중이거나 지원 페이지 (= 기존 UI를 그린다)
 * - `true`: 미지원 페이지 (= 안내를 그린다)
 * 판정 중을 `false`로 접는 이유: 미지원 안내가 먼저 번쩍이는 것보다
 * 기존 화면이 잠깐 보이는 편이 낫다(오검출 방향을 안전한 쪽으로).
 */
export function useTabSupport(tabId: number | null | undefined): boolean;
```

```ts
// src/sidepanel/tabs/IssueTab.tsx — EmptyState 시그니처에 1개 추가
function EmptyState({
  onStartElement,
  onStartElementShot,
  onStartScreenshot,
  onStartVideo,
  onStartScreenRecord,
  onStartFreeform,
  unsupported,            // ← 신규
}: {
  /* ...기존 6개... */
  unsupported: boolean;
}): JSX.Element;
```

```ts
// src/background/tab-bindings.ts — Phase 2, 입력 1개 추가
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlBroadCovered: boolean;
  newUrlSupported: boolean;   // ← 신규
}): NavigationAction;
```

`NavigationAction` 타입(`:107-111`)은 **변경하지 않는다**(`keep`/`clearSession`/`notifyDeferredExpiry`/`deactivate` 그대로).

새 타입·스토리지·메시지는 없다. `chrome.storage` 스키마 변경 없음 → **마이그레이션 불필요.**

## 기존 패턴 준수

- **user gesture 보존** (`docs/ARCHITECTURE.md:15-32`): `chrome.sidePanel.open()`은 user gesture 안에서만 동작한다. `activateTab`에서 `open()` 앞에 `await`를 넣으면 gesture가 소실되고 **조용히 실패**한다. 가드 삭제 시 동기 호출 순서를 반드시 유지한다. 이 파일의 기존 주석·ARCHITECTURE 문서가 같은 함정을 이미 기록하고 있다.
- **DESIGN.md §14 — 진행 중 잠금**: `disabled` 대신 `aria-disabled` + 핸들러 early-return. shadcn Button base의 `disabled:pointer-events-none`이 툴팁·hover를 죽이기 때문. 스타일은 `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`. 선례: `ReplayButton`, 캡처 방식 툴바, `TooltipIconButton`의 `ariaDisabled`. → `[이슈 작성]`에 적용.
  - 단 **Radix `TabsTrigger`는 예외**다. console/network 서브탭 잠금은 기존 `logTabsLocked`(`DebugTab:70,77`)가 이미 `disabled`를 쓰고 있으므로 그 패턴을 따른다(shadcn Button이 아니라 Radix 트리거).
- **DESIGN.md §14 — 빈 상태 관용형**: `rounded-full bg-muted p-3` + 아이콘 `h-6 w-6 text-muted-foreground` + 제목 `text-lg font-semibold`. `EmptyShell`이 이 관용형의 구현체이므로 직접 마크업하지 않고 그것을 쓴다.
- **i18n**: 신규 키 없음. `app.unsupported.title`/`app.unsupported.body`가 ko/en 양쪽에 이미 존재(`src/i18n/namespaces/app.ts:6-7` ko, `:64-65` en). log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 이 키를 쓰지 않으므로 무관.
- **store는 `sidepanel/tabs`를 import하지 않는다**: 이번 변경은 store를 건드리지 않으므로 무관.
- **테스트 2트랙**: 순수 함수·훅은 `*.test.ts`(node), 렌더 분기는 `*.test.tsx`(jsdom + @testing-library/react).

## 대안 검토

### A. `onInstalled`에서 `chrome.tabs.create`로 퀵스타트 탭 열기 — 기각

`details.reason === "install"`일 때 `bug-shot.com/{ko,en}/docs/quick-start`를 새 탭으로 열어 사용자를 지원되는 URL 위에 놓는 안.

- 장점: 차단된 유일한 URL에서 사용자를 빼내므로 첫 클릭이 성공한다. 랜딩 페이지가 실습장이 되어 데모 영상을 대체한다. 확장 설치 후 탭 하나가 열리는 것은 표준 관례.
- **기각 이유**: 사용자가 개입을 강하게 꺼렸다. 기존 탭을 수정하지는 않지만 `chrome.tabs.create`의 기본값 `active:true`가 **포커스를 가져간다**. `active:false`로는 사용자가 차단 URL에 그대로 남아 목적을 달성하지 못하므로 **중간 지점이 없는 트레이드오프**였다.
- 참고 제약: `onInstalled`은 일회성 디스패치이고 재전달이 문서화되어 있지 않다. 채택했다면 핸들러 안에서 `await` 없이 동기 호출이 필수였다. 또 unpacked "새로고침"은 `reason: "update"`로 오므로(공식 문서) `"install"` 가드가 있으면 개발 중엔 재현되지 않고, 반대로 가드가 없으면 스토어 자동 업데이트마다 전 사용자에게 탭이 열린다.

### B. `chrome.notifications` OS 토스트 — 기각

- **기각 이유 1**: 새 권한 `notifications`가 필요하다. CLAUDE.md 문서 신선도 규칙상 permissions 변경은 `docs/privacy.{ko,en}.md`·`docs/PERMISSION.md` 갱신 트리거다.
- **기각 이유 2**: v1.6.18이 스토어 심사 중이다(2026-07-26 제출). 권한 추가는 심사를 다시 돌리고, oauth-proxy 재배포(2026-08-09 목표, 확장 전파 완료가 선행 조건)의 전파 시계를 리셋시킨다.
- **기각 이유 3**: OS 레벨 토스트는 사이드 패널보다 **더** 침입적이다. 브라우저 밖으로 나가고 OS 알림 설정에 따라 아예 안 뜬다.
- 사이드 패널이 권한 추가 0으로 같은 목적을 달성하므로 불필요.

### C. `chrome.action.setBadgeText` / `setTitle` 배지·툴팁만 — 기각

미지원 탭에 `!` 배지와 툴팁을 걸어두는 안. `apply(tabId, url)`이 이미 모든 탭 활성화·네비게이션마다 `isSupportedUrl`을 계산하므로 배관은 있다(현재 코드베이스에 `setBadgeText`/`setTitle` 사용처 0).

- 장점: 개입 0, 권한 0, URL 무관하게 항상 동작. 클릭 **전에** 알려준다.
- **기각 이유**: "왜 안 되는지"는 알려주지만 "어디로 가야 하는지"를 못 알려준다. 첫 설치 사용자는 무반응을 겪은 뒤 툴팁을 호버해볼 이유가 없어 activation을 회복하지 못한다. 패널 오픈이 가능하다고 실측된 이상 열위다.
- Phase 1·2로 첫 실행·역방향이 모두 커버되므로 별건으로도 필요성이 낮다.

### D. `chrome.tabs.update`로 현재 스토어 탭을 퀵스타트로 이동 — 기각

리뷰를 쓰려던, 설명을 더 읽으려던 사용자의 페이지를 뺏는다. 새 탭보다 적대적이다.

### E. 미지원 페이지에서 동작하는 기능만 살려두기 (녹화 유지) — 기각

`startScreenCapture`엔 지원 게이트가 없어 `getDisplayMedia`로 실제 동작한다. 정확성만 보면 녹화 버튼을 남기는 게 맞다.

- **기각 이유 1** (제품): 콘솔·네트워크 로그가 없는 녹화는 반쪽이다. BugShot의 가치는 "캡처 + 자동 수집된 로그"의 결합이고 로그 없는 영상은 그 가치를 전달하지 못한다.
- **기각 이유 2** (UX): 회색 버튼 4개와 활성 버튼 1개가 섞인 화면은 "이 페이지에선 못 쓴다"는 단일 메시지보다 헷갈린다. 첫 실행 사용자에게 반쯤 죽은 화면은 나쁜 첫인상이다.
- 대신 사용자를 지원 페이지로 유도해 온보딩하게 만드는 쪽이 낫다는 판단.

### F. Debug 탭 전체를 `UnsupportedPage`로 교체 (서브탭 바까지 숨김) — 기각

`hideSubTabs`(`DebugTab:25-29`) 메커니즘을 재사용하면 가장 단순하다.

- **기각 이유**: `PageFooter`의 `[가이드]`와 `IntegrationsCta`가 미지원 페이지에서도 **실제로 동작한다**. 통째로 숨기면 동작하는 기능을 없애고, 특히 첫 실행에서 완주 가능한 유일한 생산적 행동(트래커·LLM 연결 진입)을 잃는다.

### G. 패널 전체를 `App.tsx:481`의 전체화면 `UnsupportedPage`로 교체 — 기각

- **기각 이유**: 메인 탭 4개 중 페이지를 필요로 하는 것은 `debug` 하나뿐이다. `issue-list`/`integrations`/`settings`는 미지원 페이지에서 완전히 동작한다(prd.md 가용성 표). 전체화면 교체는 잘 되는 탭 3개를 숨기는 퇴행이다. `App.tsx:221`의 그 분기는 `tabId === null`(탭 바인딩 자체 실패)용이며 조건이 다르다.

### H. `EmptyShell`에 새로고침 `action` 버튼 추가 — 기각

`EmptyShell`은 `action` 슬롯을 지원한다(`:685,698`).

- **기각 이유**: 자동 감지가 가능하다. 패널 내부 `chrome.tabs.onUpdated` 구독 선례가 2곳 있고(`useBackgroundRecorder.ts:108`, `useEditorSessionSync.ts:282`), 지원 여부 전이는 항상 cross-document 네비게이션이라 `info.url`이 발화한다. 수동 새로고침을 요구하면 "이 확장은 뭔가 수동으로 달래야 한다"는 인상을 줘 지금 고치려는 문제와 같은 계열의 마찰이 된다.

## 위험 요소

### 1. user gesture 소실 (높음 / Phase 1)

`activateTab`에서 가드를 삭제할 때 실수로 `await`를 도입하면 `sidePanel.open()`이 **조용히 실패**한다. 예외도 없고 로그도 남지 않아 "가드는 지웠는데 여전히 안 열린다"로 오진하게 된다. `docs/ARCHITECTURE.md:15-32`가 이 함정을 명시하고 있다.

→ 대응: 단위 테스트로 `setOptions`·`open`이 **동기 호출**임을 단언(호출 순서 + `await` 없음). 그리고 실물 확인.

### 2. `activateTab`에 e2e 그물이 없다 (높음 / Phase 1)

- `e2e/unsupported-url.spec.ts:29`가 `ext.openPanel(tabId)` 픽스처로 패널을 직접 열어 **`activateTab`을 우회**한다.
- Playwright는 확장 액션 아이콘을 클릭할 수 없다(`e2e/activetab-broad-permission.spec.ts:11-13` 주석에 명시).
- `activateTab`의 현재 단위 테스트는 **0개**다(`src/background/__tests__/tab-bindings.test.ts`는 `resolveNavigationAction`·`isBroadCoveredUrl` 등 순수 함수만 다룬다).

→ 즉 이 함수의 회귀를 잡을 자동 그물이 지금 전혀 없다. Phase 1에서 단위 테스트 추가가 필수이며, 그래도 "실제 아이콘 클릭"은 수동 확인만 가능하다.

### 3. 서비스워커 자동화 불가로 수동 검증 의존 (중간)

`docs/POSTMORTEM.md:304-306`: crxjs가 서비스워커를 `type:module`로 emit하는데 Playwright `worker.evaluate`가 그 실행 컨텍스트를 못 잡아 **무한 대기**하며, `workers:1`이라 첫 `sw.evaluate` 하나가 전 스위트를 정지시킨 전례가 있다. 따라서 background 동작은 e2e에서 SW를 직접 구동해 검증할 수 없고, 관찰 가능한 신호(activated set·세션 키를 SW storage로 읽기)로 우회해야 한다 — `activetab-broad-permission.spec.ts`가 그 우회의 선례다.

### 4. `permission-expired` 오분류 (중간 / Phase 1)

`classifyTabSupport`는 `tab.url`이 비었을 때 `contentUrl`로 `"permission-expired"`와 `"unsupported"`를 가른다. `useTabSupport`가 `contentUrl`을 안 넘기면(= content script 왕복을 생략하면) 지원 페이지인데 activeTab만 풀린 상태가 `"unsupported"`로 오분류돼 **정상 페이지에 미지원 안내가 뜰 수 있다.**

→ 대응: 훅에서 `tab.url`이 비어 있을 때의 동작을 명시적으로 결정하고 단위 테스트로 고정한다. 안전한 기본값은 **"불확실하면 지원으로 취급"**(= 기존 UI 유지) — 오검출 방향을 사용자가 덜 손해 보는 쪽으로 둔다. `<all_urls>`가 required라 `tab.url`이 비는 빈도는 낮다.

### 5. `picker-unavailable-dialog`의 주 트리거 소실 (중간)

진입 화면에서 캡처 버튼이 사라지면 `onPickerUnavailable`은 "가드 통과 후 캡처 시작 전에 탭이 미지원으로 이동"하는 race 경로에서만 발화한다. 다이얼로그와 5개 게이트(`ensureSupportedTab` 호출부)는 **제거하지 않는다** — race는 실재한다. 다만 e2e로 재현하기 어려워져 커버리지가 얇아진다.

### 6. Phase 2가 권한 라이프사이클 상태 기계를 건드린다 (높음 / Phase 2)

`deactivatePanelIfCrossOrigin`은 단순한 "쓸모없으니 닫기"가 아니라 activeTab 만료·광역 커버 판정 로직이다. `deactivate` 분기는 `setActivated(false)` + `setOptions({enabled:false})` + 세션 제거를 **함께** 한다(`:195-199`). 이를 `clearSession`으로 라우팅하면 activated set이 보존되는데, 그 상태 변화가 다른 경로(탭 전환 시 `stopRecorders`, `onRemoved` 정리)에 영향을 주지 않는지 확인이 필요하다.

또 `resolveNavigationAction`의 테스트 주석(`tab-bindings.test.ts:6`)에 "미보유 닫힘·deferred 분기는 프로덕션 도달 불가 — 순수함수 회귀 자산으로만 남음"이라고 되어 있다. 즉 이 함수에는 테스트에서만 도달하는 분기가 있으므로, 입력을 추가할 때 도달 가능/불가 분기를 구분해 테이블을 갱신해야 한다.

### 7. 기존 e2e 2개가 깨진다 (확실 / 아래 표)

| spec | 현재 단언 | 필요 조치 | Phase |
|---|---|---|---|
| `e2e/unsupported-url.spec.ts:31,37` | `chrome://version` 탭에서 `mode-element` 클릭 → `picker-unavailable-dialog` → 닫으면 `mode-element` 다시 보임 | 캡처 버튼이 사라지므로 **시나리오 전면 재작성** | 1 |
| `e2e/activetab-broad-permission.spec.ts:94-101` | "광역 보유라도 비커버 URL(`chrome://`) 이동 → 패널 종료(deactivate)" | **단언 반전** (패널 유지 + activated 보존) | 2 |

### 8. `sidepanel_opened` 지표 의미 변화 (낮음)

`bgPort` 연결이 background `onConnect`에서 `captureEvent("sidepanel_opened")`를 발화한다(`src/background/index.ts`). 미지원 페이지에서도 패널이 열리므로 이 이벤트가 증가한다. activation 퍼널 측정에는 이득이지만, **배포 후 지표 점프를 회귀로 오해하지 않도록** 기록해 둔다.

### 9. 스코프 밖이지만 인접한 것

`IssueTab.tsx:265`의 기존 `UnsupportedPage`(`PageShell > EmptyShell`, footer 없음)는 `App.tsx:221`이 `tabId === null`을 먼저 전체화면으로 걸러내므로 사실상 도달하지 않는 경로로 보인다. **기존 dead code이므로 삭제하지 않고 언급만 한다**(CLAUDE.md 외과적 변경 원칙). 이번 작업은 이것을 재사용하지 않고 `EmptyState` 제자리 교체 방식을 쓴다.
