# 미지원 URL에서 사이드 패널 열기 + 미지원 안내 — 기술 설계

> 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준. 리뷰 시 줄번호가 어긋나면 심볼명으로 대조할 것.

## 개요

핵심 변경은 **불변식 하나를 바꾸는 것**이다.

- **현재**: 패널 표시 여부 = `activation && URL 지원 여부`
- **변경 후**: 패널 표시 여부 = `activation`. **URL 지원 여부는 패널이 무엇을 그리는지만 결정한다.**

이 한 문장이 `activateTab`(가드 삭제)·`apply()`(조건 축소)·`resolveNavigationAction`(라우팅)을 같은 원리로 묶는다. 결과적으로 `supported`가 표시 결정에서 빠지고 렌더 결정으로 내려가므로 background 로직은 **단순해진다**.

UI는 신규 컴포넌트를 만들지 않는다. 기존 캡처 진입 화면(`EmptyState`)의 가운데 블록만 기존 `EmptyShell`로 제자리 교체한다. **신규 컴포넌트 0개, 신규 권한 0개, 신규 파일 1개(판정 훅), 신규 i18n 키 2개.**

### Phase 경계

| | 담당 | 커밋 |
|---|---|---|
| **Phase 1** | 미지원 페이지에서 패널이 **열리고 유지된다** + 안내 렌더 + 계측 property | 1 |
| **Phase 2** | 동일 탭 네비게이션으로 지원 → 미지원 이동 시 패널 유지 | 2 |

Phase 1에 `apply()` 수정이 포함되는 것이 핵심이다. `apply()`는 수동 reader가 아니라 **disable 액션**이다:

```ts
// src/background/tab-bindings.ts:61-67
if (!(activated && supported)) {
  await chrome.sidePanel.setOptions({ tabId, enabled: false });
}
```

`activateTab`의 가드만 지우면 미지원 탭이 activated set에 들어가지만 `apply()`는 여전히 `supported === false`를 보고 패널을 비활성화한다. 호출 경로가 셋이라(`onActivated:255`, `onUpdated`+`info.url`, `onUpdated`+`status==="complete"`) **패널이 열린 직후 다음 탭 전환·네비게이션에 조용히 다시 닫힌다.** `:59`의 `shouldPreserveSession` 조기 반환은 idle 세션에선 걸리지 않아 보호막이 없다. 구체적 실패 경로: prd.md S1-7의 OAuth 창 왕복이 `onActivated`를 발화시켜 온보딩 도중 패널이 사라진다.

Phase 2에 남는 것은 `resolveNavigationAction` 라우팅 변경뿐이며, 그것만으로도 이등분 단위는 유지된다(권한 라이프사이클 상태 기계를 건드리는 부분이 Phase 2에 고립된다 — 위험 요소 6).

## 변경 범위

### Phase 1

#### `src/background/tab-bindings.ts`

- **현재 역할**: 탭↔패널 바인딩 전체. 액션 클릭 핸들러(`activateTab:208`), 탭 활성화·네비게이션 시 패널 옵션 재적용(`apply:37`), cross-document 네비게이션 판정(`deactivatePanelIfCrossOrigin:150` + 순수함수 `resolveNavigationAction:116`), 탭 제거 정리.

**변경 1** — `activateTab:210`의 `if (!isSupportedUrl(tab.url)) return;` **삭제**. 그 아래 `setOptions`+`open`은 **동기 호출 순서를 반드시 유지**한다. 동시에 `setOptions`에 `.catch`를 붙여 바로 아래 `open()`(`:218-220`)·`apply()`(`:45-53`)와 대칭을 맞춘다 — 새로운 탭 종류를 이 호출로 라우팅하는 변경이므로 실패를 삼키면 위험 요소 1이 우려하는 오진을 만든다.

```ts
export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  const tabId = tab.id;

  void chrome.sidePanel
    .setOptions({ tabId, path: `${SIDEPANEL_PATH}?tabId=${tabId}`, enabled: true })
    .catch((err) => console.error("[bugshot] sidePanel.setOptions", err));
  void chrome.sidePanel
    .open({ tabId })
    .catch((err) => console.error("[bugshot] sidePanel.open", err));

  void setActivated(tabId, true);
  if (tab.url) {
    void chrome.storage.session.set({ [`${ACTIVATION_URL_PREFIX}${tabId}`]: tab.url });
  }
}
```

`isSupportedUrl` import는 계속 유효하다 — `isBroadCoveredUrl:137`이 쓴다.

**변경 2** — `apply()`(`:44`, `:61`)의 enable/disable 조건에서 `supported`를 제거해 `activated`만 보게 한다. `supported` 지역 변수(`:38`)가 미사용이 되면 함께 제거한다.

**부수 효과(의도된 것)**: 미지원 탭도 activated set에 들어가고 `ACTIVATION_URL_PREFIX` 세션 키가 쓰인다. 소비처를 전수 grep한 결과 **`apply:39`·`deactivatePanelIfCrossOrigin:156,164`·`onRemoved:294-295` 정리 3곳이 전부**다 — `stopRecorders`·`resolveTabSwitch`·`webNavigation` 핸들러·`onConnect` 로그 플러시·pending-log-prune·analytics 어디에도 결합이 없고, `onRemoved`가 무조건 정리하므로 storage 누수도 없다. 변경 2가 `apply`의 disable 액션을 제거하므로 남은 파급은 없다.

#### `src/background/analytics.ts` + `src/background/index.ts`

- `PROPERTY_ALLOWLIST`의 `sidepanel_opened: []`(`analytics.ts:30`)를 `["page_supported"]`로 확장. 목록 밖 property는 런타임에 제거되므로(`analytics.ts:22-31`) 이 한 줄이 없으면 계측이 조용히 무효화된다.
- `index.ts:89`의 `captureEvent("sidepanel_opened", {})`에 `page_supported: boolean`을 실는다. 값은 `bgPort` 연결 시점의 sender 탭 URL로 `isSupportedUrl`을 평가한다.
- 신규 이벤트는 만들지 않는다.

#### `src/sidepanel/hooks/useTabSupport.ts` (신규)

- **역할**: 바인딩된 탭의 지원 여부를 판정하고 네비게이션에 따라 갱신.
- 마운트 시 `chrome.tabs.get(tabId)` → `classifyTabSupport({url: tab.url})`로 초기 판정.
- `chrome.tabs.onUpdated` 구독으로 재판정. **`info.url`에만 의존하지 않는다** — `manifest.config.ts:60-70`에 `tabs` 권한이 없고 `<all_urls>`는 `chrome:`를 매칭하지 않으므로 `https → chrome://` 전이에서 `changeInfo.url`은 **redact되어 도착하지 않는다**(저장소가 이미 기록: `e2e/unsupported-url.spec.ts:3` "chrome:// 탭은 tab.url을 못 읽고(호스트 권한 밖)"; 선례 훅도 그래서 no-op한다 — `useEditorSessionSync.ts:240` `if (!info.url) return;`). 따라서 `info.status` 전이에서 `chrome.tabs.get(tabId)`로 재조회해 재판정한다.
- 선례: `useBackgroundRecorder.ts:45-46`이 정확히 이 패턴이다 — `info.url`은 pageKey 부기에만 쓰고, 지원 판정은 `status === "complete"`에서 **새로 `chrome.tabs.get` + `isSupportedUrl`**로 한다.
- `tabIdRef`(ref로 최신 tabId를 들고 effect 의존성을 줄이는) 패턴을 쓸 경우 실제 선례는 `useRecorderSyncInterval.ts:11-12`·`DebugTab.tsx:34-35`·`30s-replay/use-30s-replay.ts:43-44`다. (`useBackgroundRecorder`·`useEditorSessionSync`는 `tabIdRef`가 **없고** `[tabId]` deps로 리스너를 재생성하는 반대 패턴이다 — 초기 설계가 잘못 인용했다.)

#### `src/sidepanel/tabs/IssueTab.tsx`

- **현재 역할**: Debug > 이슈 서브탭 본체. phase별 화면 분기. 캡처 진입 화면은 `isCaptureEntryScreen(...)` 가드 안에서 `EmptyState`를 렌더(`:241-252`).
- **변경 1**: `EmptyState`를 **export**한다. props 직접 주입 테스트를 가능하게 하려는 것 — 지금은 비-export라 `<IssueTab/>` 풀 렌더를 거쳐야 하고 그러면 `DraftingPanel`·`PreviewPanel`·`StyleEditorPanel`(tiptap·sonner 포함 100+ transitive import)이 EmptyState 경로에서도 전부 평가된다.
- **변경 2**: `useTabSupport(tabId)`로 판정해 `EmptyState`에 `unsupported` prop 전달(`:243-250`).
- **변경 3**: `EmptyState`(`:277-348`) 내부에서 `:288`의 래퍼 div(아이콘+제목+**버튼 5개**, `:288-327`)를 `unsupported`일 때 `EmptyShell`로 교체. `:328-330`의 `IntegrationsCta`와 `:331-345`의 `PageFooter`는 **분기 밖에 그대로 둔다**.
- **변경 4**: `PageFooter` 안 `[이슈 작성]`(`:340`, `data-testid="mode-freeform"`)을 `unsupported`일 때 **렌더하지 않는다**. `[가이드]`(`:333-339`)만 남으므로 `:332`의 `flex items-center justify-between` 래퍼 정렬을 1줄 조정한다.

교체 대상 래퍼 안의 버튼은 **5개**다 — `mode-element`(`:297`), `mode-element-shot`(`:302`), `mode-screenshot`(`:306`), `mode-record`(`:312-319`), **`ReplayButton`(`:323` → `replay-button`)**.

`EmptyShell`(`:682-701`)의 래퍼는 `flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center`이고 교체 대상 `:288`은 `flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-5`다. **같은 레벨의 거의 동일한 래퍼**라 중첩 없이 갈아끼워진다.

> **주의 — `EmptyShell`은 제목↔본문 간격을 주지 않는다.** `:695-700`을 보면 `mb-3`은 **아이콘↔제목** 간격이고 `mt-4`는 `action` 슬롯 전용이며, `children`은 `<h3>` 바로 뒤에 클래스 없이 렌더된다. 본문 `<p>`에 `mt-1`을 명시하지 않으면 제목에 간격 0으로 밀착한다. 기존 동형 빈 상태는 전부 명시적 간격을 준다(`LlmConnectForm` `mt-1`, `IntegrationsTab`의 `ConnectedEmpty` `mt-1`, `App.tsx:483`의 `UnsupportedPage` `gap-3`).

> **주의 — `EmptyShell` + `PageFooter` + `IntegrationsCta` 조합은 저장소 최초다.** 기존 `EmptyShell` 호출부 3곳(`UnsupportedPage:269`·`PickingState:409`·`CapturingState:446`)은 전부 `PageFooter`가 없다. `flex-1` 충돌은 없지만(교체이지 중첩이 아니므로) 수동 검증에서 세로 중앙 정렬을 확인한다. 세로 예산 자체는 여유롭다 — 고정 크롬 ≈ 247px(메인 탭 바 69 + 서브탭 바 69 + CTA 40 + footer 69) vs 안내 블록 ≈ 110px.

#### `src/i18n/namespaces/app.ts` (신규 키 2개)

기존 `app.unsupported.title`/`body`(ko `:6-7`, en `:64-65`)를 **재사용하지 않는다.** 그 문구는 "이 페이지에서는 사용할 수 없습니다 / 웹 페이지(http, https, file)에서 BugShot을 실행해주세요"이고 원래 `tabId === null`(탭 바인딩 자체 실패 = 진짜로 아무것도 안 되는 상태)용이다. 새 맥락에서는 **4개 탭 중 3개가 완전히 동작**하므로(prd.md 가용성 표) 목표 2를 문구가 정면으로 부정한다. 특히 prd.md S3(연동 ≥ 1)은 `IntegrationsCta`도 안 뜨므로 "여기선 안 됨"만 말하는 막다른 길이 된다.

또 `app.unsupported.title`은 `app.pickerUnavailable.title`(`:8`)과 **바이트 동일**하다. 재사용하면 문자열 2개를 표면 3개가 공유하는데, 같은 파일 `:47-48`에 이 상황에 대한 명시적 컨벤션이 있다 — *"값은 위 두 키와 같지만 맥락이 달라 일부러 분리했다 — 한쪽 문구만 고칠 수 있어야 한다. 중복은 의도된 것이니 합치지 말 것."*

신규 키 (ko 원본 + en 번역, `locales.test.ts` 대칭 검사 대상):

| 키 | ko | en |
|---|---|---|
| `app.captureUnsupported.title` | 이 페이지에서는 캡처할 수 없습니다 | Can't capture on this page |
| `app.captureUnsupported.body` | 브라우저가 확장 접근을 막아둔 화면이에요. 웹 페이지(http, https, file)에서 실행해주세요. 연동·설정은 지금 그대로 사용할 수 있어요. | The browser blocks extensions on this page. Try running BugShot on a web page (http, https, file). Integrations and settings still work here. |

ko 본문은 `guide/ko/faq.md:53`이 이미 쓰는 설명("Chrome 웹스토어나 `chrome://` 설정 페이지처럼 브라우저가 확장 접근을 막아 둔 화면")을 축약한 것이다 — 가이드와 톤이 맞는다. 마지막 문장이 목표 2를 문구 레벨에서 지킨다. log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 이 키를 쓰지 않으므로 무관.

#### `src/sidepanel/tabs/DebugTab.tsx`

- **현재 역할**: Debug 탭의 3개 서브탭(`issue`/`console`/`network`) 셸. `sub` 로컬 state(`:18`), `hideSubTabs`(작성 플로우에서 바 숨김, `:25-29`), `logTabsLocked`(녹화 중 console/network 잠금, `:32`), 레코더 sync 폴링(`:37-49`).
- **변경 1**: `logTabsLocked`(`:32`) 조건에 미지원 판정을 OR로 추가 → `TabsTrigger`(`:70,77`)가 `disabled`.
- **변경 2**: **미지원으로 전이할 때 `setSub("issue")`를 강제한다.** 기존 `logTabsLocked`는 항상 issue 서브탭에서 시작하는 **사용자 액션**(녹화 시작)으로 켜지므로 "console 위에 있는데 잠기는" 상태가 발생하지 않았다. 새 조건은 **네비게이션으로 켜진다** — 그러면:
  - `TabsTrigger`는 `disabled`가 되지만 `Tabs.value`는 여전히 `"console"`이라 `TabsContent value="console"`이 **계속 렌더된다** → 이전 페이지 로그가 현재 페이지 로그처럼 보인다
  - **미지원 안내는 issue 서브탭 안에 있으므로 사용자가 안내를 아예 못 본다** (목표 5가 "사라지지 않았지만 아무것도 알려주지 않는다"로 무력화)
  - `ConsoleSubTab`/`NetworkSubTab`의 `[이슈 작성]` 버튼(`ConsoleSubTab.tsx:41-43`, `NetworkSubTab.tsx:38-40` — 둘 다 testid 없음)이 **완전히 활성**인 채 남아 `ensureSupportedTab`에 막혀 `onPickerUnavailable` 다이얼로그가 뜬다 → 이 기능이 없애려던 "눌렀는데 에러 모달" 경험이 뒷문으로 돌아온다
  - 포커스가 그 트리거에 있었다면 `disabled`로 포커스 링에서 빠져 body로 날아간다
- **변경 3**: 레코더 sync 폴링 effect(`:37-49`)를 미지원이면 스킵. 현재는 `.catch(() => {})`라 미지원 페이지에서 1.5초마다 조용히 영구 실패한다.

> **sync 폴링 경로는 두 개이고, 둘 다 관계된다.** `DebugTab:37-49`의 인라인 effect(issue 서브탭에서 3종 동기화)와 `hooks/useRecorderSyncInterval.ts`(`ConsoleSubTab.tsx:17`·`NetworkSubTab.tsx:17`에서 사용). 후자의 effect deps는 `[active]`뿐이고(`useRecorderSyncInterval.ts:22-24`) `active`는 `sub === "console"`(`DebugTab.tsx:99,106`)이다 — **`disabled`는 폴링과 무관하다.** 변경 2의 `setSub("issue")`가 `active`를 `false`로 만들어 후자를 함께 멎게 한다. (초기 설계의 "후자는 서브탭이 잠기면 도달하지 않으므로 전자만 고치면 된다"는 틀렸다.)

> **비활성 서브탭의 "0" 배지는 남는다.** `TabsTrigger`(`:70-84`)의 `Badge`는 `disabled`와 무관하게 카운트를 표시하므로 미지원 페이지에선 항상 `0`이다. "여기선 못 쓴다"가 아니라 "아직 로그가 안 쌓였다"로 읽힐 수 있다 — 변경 2로 사용자가 issue 서브탭에서 안내를 읽게 되므로 오독 교정 단서가 화면에 있다고 판단해 수용한다.

#### `src/sidepanel/30s-replay/use-30s-replay.ts`

- **변경**: 미지원이면 600ms 폴링(`:88`)을 시작하지 않는다. `:85` 주석이 이 훅의 전제를 명시한다 — *"`<all_urls>`가 required라 권한 확인 없이 바로 폴링을 시작한다"*. 그 전제는 **패널이 미지원 페이지에 존재할 수 없다**는 가정에 기대고 있고 이번 변경이 그것을 깬다.
- 파급이 둘이다:
  1. `chrome://`에선 매 tick 실패하지만 실패 호출도 `capture-throttle.ts:6,29-32`의 전역 큐를 점유해 `CAPTURE_MIN_GAP_MS=500`을 **다른 창의 실제 캡처에 부과**한다. `docs/POSTMORTEM.md:373-378`이 정확히 이 결합을 경고한 항목이다.
  2. **웹스토어 페이지는 https라 캡처가 성공한다.** 안내 화면에서 `ReplayButton`은 사라졌는데(교체되는 `:288-327` 블록 안에 있다) 프레임 버퍼는 계속 채워지고, `docs/ARCHITECTURE.md`가 버퍼를 네비게이션 간 의도적으로 유지한다고 명시하므로 그 프레임이 나중 replay MP4에 섞인다. 기본 off(opt-in)라 실제 노출은 드물지만, **"사용할 수 없습니다"라고 써놓고 계속 찍는다**는 것은 privacy 관점에서 방어할 수 없는 모양이다.

### Phase 2 — 역방향 (동일 탭 네비게이션에서 지원 → 미지원 시 패널 유지) / 별도 커밋

#### `src/background/tab-bindings.ts` (2차 변경)

**`resolveNavigationAction`(`:116-130`)에 입력 `newUrlReadable: boolean` + `newUrlSupported: boolean` 추가.**

현재 입력만으로는 세 케이스를 구분할 수 없다:

| newUrl | 판독 | `isSupportedUrl` | `newUrlBroadCovered`(`isBroadCoveredUrl:137`) | 원하는 동작 |
|---|---|---|---|---|
| `chrome://version` | ✗ | — | false | **`clearSession`** (패널 유지 + 안내) |
| `file:///x.html` (토글 on) | ✓ | **✓** | false | `deactivate` (현행 유지) |
| `file:///x.html` (토글 off) | ✗ | — | false | `deactivate` (현행 유지) |

`file:`은 **지원 스킴이지만 광역 커버 밖**이다 — `<all_urls>`가 `file:`을 포함하더라도 Chrome이 "파일 URL 액세스" 토글을 별도로 요구하므로 `BROAD_COVERED_SCHEMES`가 http/https만 담는다(`:132-136`).

**`isSupportedUrl(undefined)`은 `false`다**(`url-support.ts:26`). 따라서 순진하게 `newUrlSupported: isSupportedUrl(newUrl)`만 넘기면 "미지원"과 "URL 판독 불가"가 한 값으로 접혀, 파일 접근 토글 off인 `file:` 이동도 `clearSession`으로 라우팅된다 — 지키려던 carve-out이 무효화되고, 그게 바로 carve-out이 존재하는 이유인 케이스(캡처가 실제로 불가능한 상태)다. **판독 불가는 `deactivate` 유지가 기본값**이다.

**라우팅**:

```ts
  return input.preserved
    ? "notifyDeferredExpiry"
    : input.newUrlReadable && !input.newUrlSupported
      ? "clearSession"    // chrome://·웹스토어 등 판독된 미지원 URL → 패널 유지, 패널이 안내를 그린다
      : "deactivate";     // 판독 불가 또는 지원 스킴(file: 등) → 기존 동작 유지
```

새 `NavigationAction` variant는 만들지 않는다 — 기존 `clearSession`의 실효(패널 유지 + activated 보존 + stale 세션 제거)가 원하는 동작과 정확히 일치한다(`:187-189`). `:200-201`의 `action satisfies never` 소진 체크도 그대로 유지된다.

**⚠️ 미해결 전제 — 착수 전 실측 필수.** 위 라우팅이 `chrome://`에서 발화하려면 background가 **새 URL을 실제로 읽을 수 있어야** 한다. 그런데 현재 호출부는 `deactivatePanelIfCrossOrigin(tabId, info.url ?? tab.url)`(`:277`)이고 `chrome://`에서는 둘 다 `undefined`다 → `newUrlReadable === false` → `deactivate` → **Phase 2가 주 타겟에서 무효**다.

해결 방향으로 `chrome.webNavigation.onCommitted`의 `details.url`을 쓴다. `webNavigation` 권한은 이미 보유 중이고(manifest `permissions`) 저장소가 이미 `onCommitted`를 iframe sentinel 재발행에 쓰고 있다. **단 webNavigation 이벤트가 host permission으로 필터링되는지 여부는 확정되지 않았다** — Chrome이 `chrome://` 프레임에 대해 이벤트를 아예 주지 않을 가능성이 있다. 따라서:

1. **Phase 2 착수 전 프로브**: `onCommitted` 리스너를 임시로 달아 `chrome://settings`로 이동할 때 `details.url`이 실제로 도착하는지 서비스워커 콘솔로 확인한다.
2. **도착하면**: `onCommitted`를 판정 입력원으로 추가하고 `newUrlReadable`를 그 값에서 파생.
3. **도착하지 않으면**: `chrome://` 대상 Phase 2는 background 신호만으로 불가하다. 그때는 Phase 2를 **별도 feature로 분리**하고(패널 내부 신호로 background에 알리는 역방향 배관이 필요해지므로 설계 규모가 달라진다) 이번 스코프를 Phase 1로 확정한다.

**`isBroadCoveredUrl` 입력(`newUrlBroadCovered`)은 그대로 유지한다** — 광역 권한 판정 축은 지원 여부 축과 독립이다.

- **호출부**(`deactivatePanelIfCrossOrigin:176-182`)에 두 새 입력 전달.
- **`apply()`는 Phase 1에서 이미 고쳤다.** Phase 2에서 추가 변경 없음.

## 데이터 흐름

### 패널 오픈 (Phase 1)

```
[사용자] 툴바 아이콘 클릭 / 단축키 / 컨텍스트 메뉴
   → chrome.action.onClicked
   → activateTab(tab)                       ... URL 지원 여부 무관
       ├─ sidePanel.setOptions({tabId, path:?tabId=N, enabled:true})   [동기]
       ├─ sidePanel.open({tabId})                                      [동기 — gesture 소비]
       └─ setActivated(tabId, true)                                    [fire-and-forget]
   → 패널 문서 부팅 (?tabId=N)
   → bgPort 연결 → captureEvent("sidepanel_opened", {page_supported})
   → useBoundTabId() → N
   → useTabSupport(N) → chrome.tabs.get(N) → classifyTabSupport
       ├─ "supported"          → 기존 캡처 진입 화면
       ├─ "unsupported"        → EmptyShell 안내
       └─ "permission-expired" → 기존 캡처 진입 화면 (아래 결정 참조)

[이후] onActivated / onUpdated → apply(tabId, url)
   → activated만 보므로 enabled:true 유지 (Phase 1 변경 2)
```

### 네비게이션 갱신

```
[사용자] 주소창으로 이동
   → chrome.tabs.onUpdated (패널 내부 구독)
       ├─ info.url 있음(지원 URL로 이동)  → 그 값으로 재판정
       └─ info.url 없음(미지원으로 이동)  → chrome.tabs.get(tabId)로 재조회 후 재판정
   → useTabSupport 리렌더
   → (동시에 background) apply(tabId, url) → setOptions로 path·enabled 재적용
```

패널 문서는 `path`가 동일 값으로 재등록되므로 리로드되지 않는다. 그래서 **패널 내부 구독이 갱신의 단일 수단**이며, 이것이 "새로고침 버튼 불필요"의 근거다.

### 지원 여부 판정의 단일 출처

`classifyTabSupport`(`src/lib/url-support.ts:42-51`)를 그대로 쓴다.

```ts
// :46-50
if (input.url) return isSupportedUrl(input.url) ? "supported" : "unsupported";
if (input.contentUrl && isSupportedUrl(input.contentUrl)) return "permission-expired";
return "unsupported";
```

**설계 결정 1 — 빈 `tab.url`은 미지원으로 판정한다.** `chrome://` 탭은 host permission 밖이라 `tab.url`이 **항상 빈다**. 같은 파일 `:39-41` 주석이 핵심을 짚는다 — *"tab.url이 비어 있으면 … 미지원 페이지와 구분 불가"*. 즉 content script 왕복 없이는 원리적으로 못 가른다. 왕복을 하지 않기로 했으므로(미지원 페이지에는 content script가 없어 어차피 실패하고, `chrome://`에서는 타임아웃 지연만 남는다) 빈 값은 `"unsupported"`가 된다.

이 선택의 오검출 위험은 **`<all_urls>`가 required가 된 뒤 사실상 소멸했다** — http/https는 activeTab과 무관하게 `tab.url`이 항상 읽히므로, 빈 값이 남는 경우는 미지원 스킴 또는 `file:` + 파일 접근 토글 off뿐이고 둘 다 캡처 불가라 안내가 옳다. (초기 설계의 "불확실하면 지원으로 취급"은 3번째 선택지가 아니라 `chrome://` 시나리오 전체를 무효화하는 것이었다.)

**설계 결정 2 — `"permission-expired"`를 미지원으로 취급하지 않는다.** 그 상태는 "지원 페이지인데 권한만 풀린" 것이고 전용 안내 다이얼로그(subscribe effect `App.tsx:191-196`, 다이얼로그 `:419-436`)가 이미 담당한다. 훅은 `"unsupported"`일 때만 미지원으로 판정한다. `contentUrl`을 넘기지 않으므로 이 분기는 실제로 도달하지 않지만, 훅이 `classifyTabSupport`의 union을 그대로 소비하므로 규약으로 명시한다.

**설계 결정 3 — 판정 중은 지원으로 접는다(`false`).** 근거는 오검출 방향이 아니라 **기존 e2e 보호**다. 3-상태(`boolean | undefined`)로 판정 중에 아무것도 그리지 않으면 first-paint를 단언하는 기존 spec 42개가 flaky 위험에 노출된다 — `capture-modes-layout.spec.ts:32-46`(idle에서 버튼 6개 노출을 단언하는 유일한 spec), `onboarding.spec.ts:45,135`, `session.spec.ts:30,54`, `style-changes-dialog.spec.ts:224`, 서브탭 `data-state="active"`를 단언하는 16개 spec.

**수용된 비용**: prd.md S1(설치 직후 웹스토어)에서 참값이 **항상** 미지원이므로 플래시가 **100% 발생**한다 — 캡처 버튼 5개가 1~3프레임 그려진 뒤 안내로 교체된다. 첫 실행 사용자에겐 "버튼이 있었는데 사라졌다"로 읽힌다. 동기적으로 URL을 알 방법이 없으므로(`chrome.tabs.get`은 async, 스토어에 현재 탭 URL 없음) 3-상태 없이는 불가피하다. `useBoundTabId`의 3-상태 선례(`App.tsx:220`이 `tabId === undefined`를 빈 화면으로 처리)가 있으므로 나중에 뒤집을 수 있는 결정이며, 그때는 42개 spec에 `waitFor` 보정이 함께 필요하다.

## 인터페이스 설계

```ts
// src/sidepanel/hooks/useTabSupport.ts (신규)

/**
 * 바인딩된 탭이 미지원 페이지인지. 네비게이션(chrome.tabs.onUpdated)에 따라 자동 갱신된다.
 * - `true`: 미지원 페이지 (= 안내를 그린다)
 * - `false`: 판정 진행 중 / 지원 페이지 / permission-expired (= 기존 UI를 그린다)
 *
 * 판정 중을 `false`로 접는 이유는 기존 e2e 42개의 first-paint 단언을 지키기 위함이다
 * (design.md "설계 결정 3"). 대가로 미지원 페이지에서 캡처 버튼이 1~3프레임 번쩍인다.
 *
 * `info.url`은 미지원 URL로의 전이에서 redact되므로 신뢰하지 않는다 —
 * `info.status` 전이에서 chrome.tabs.get으로 재조회한다 (design.md 변경 범위).
 */
export function useTabSupport(tabId: number | null | undefined): boolean;
```

```ts
// src/sidepanel/tabs/IssueTab.tsx — export로 승격 + prop 1개 추가
export function EmptyState({
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
// src/background/tab-bindings.ts — Phase 2, 입력 2개 추가
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlBroadCovered: boolean;
  newUrlReadable: boolean;    // ← 신규: 새 URL을 읽을 수 있었는가
  newUrlSupported: boolean;   // ← 신규: (읽었다면) 지원 URL인가
}): NavigationAction;
```

`NavigationAction` 타입(`:107-111`)은 **변경하지 않는다**(`keep`/`clearSession`/`notifyDeferredExpiry`/`deactivate` 그대로).

새 스토리지·메시지는 없다. `chrome.storage` 스키마 변경 없음 → **마이그레이션 불필요.**

## 기존 패턴 준수

- **user gesture 보존** (`docs/ARCHITECTURE.md:15-36`): `chrome.sidePanel.open()`은 user gesture 안에서만 동작한다. `activateTab`에서 `open()` 앞에 `await`를 넣으면 gesture가 소실되고 **조용히 실패**한다. 가드 삭제 시 동기 호출 순서를 반드시 유지한다.
- **DESIGN.md §14 — 빈 상태 관용형**: `rounded-full bg-muted p-3` + 아이콘 `h-6 w-6 text-muted-foreground` + 제목 `text-lg font-semibold`. `EmptyShell`이 이 관용형의 구현체이므로 직접 마크업하지 않고 그것을 쓴다. 아이콘은 `Globe`(`App.tsx:486`에서 이미 lucide-react로 사용 중).
- **`aria-disabled` 관용구는 쓰지 않는다.** DESIGN.md §14의 해당 항목 제목은 **"진행 중 잠금"**이고 근거는 *"`disabled`면 툴팁·hover가 죽고 스피너까지 흐려진다"*다 — 미지원은 진행 중이 아니고 스피너도 툴팁도 없어 근거가 전부 비적용이다. 저장소의 `aria-disabled` 사용처 30+곳은 **예외 없이 transient busy 잠금**(`connecting`/`validating`/`updating`/`busy`/`canceling`/`aiLoading`/`isEncoding`/`atMin`·`atMax`)이고 영속적 환경 제약에 쓴 선례는 0곳이다. 유일한 영속-상태 선례인 `ReplayButton`(`IssueTab.tsx:354-372`)은 오히려 반례다 — `aria-disabled`를 걸면서도 **클릭을 살려 설정 탭으로 보내고** 툴팁으로 이유를 말한다. 따라서 `[이슈 작성]`은 **렌더하지 않는다**. 이는 대안 E 기각 근거("회색 버튼이 섞인 화면이 더 헷갈린다")와 일관되고, 조건부 footer 컨벤션(`IssueListTab.tsx:185`이 빈 상태에서 footer를 숨김, `IntegrationsTab.tsx:152`가 `connectedCount >= 2` 게이팅)과도 맞는다.
  - 단 **Radix `TabsTrigger`는 `disabled`를 쓴다.** console/network 서브탭 잠금은 기존 `logTabsLocked`(`DebugTab:70,77`)가 이미 `disabled`이므로 그 패턴을 따른다(shadcn Button이 아니라 Radix 트리거라 `disabled:pointer-events-none` 문제가 없다).
- **i18n**: 신규 키 2개를 ko/en 양쪽에 추가. `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`(대칭·빈 값·placeholder)를 자동 실행한다.
- **store는 `sidepanel/tabs`를 import하지 않는다**: 이번 변경은 store를 건드리지 않으므로 무관.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`(node), 렌더·훅은 `*.test.tsx`(jsdom). `vitest.config.ts`의 `environmentMatchGlobs`는 `[["**/*.test.tsx", "jsdom"]]` 단 하나이므로 `renderHook`을 쓰는 훅 테스트도 **`.tsx`여야 한다**(선례: `useAiLoadingStep.test.tsx`, `useReproPrefill.test.tsx`).

## 대안 검토

### A. `onInstalled`에서 `chrome.tabs.create`로 퀵스타트 탭 열기 — 기각

`details.reason === "install"`일 때 `bug-shot.com/{ko,en}/docs/quick-start`를 새 탭으로 열어 사용자를 지원되는 URL 위에 놓는 안.

- 장점: 차단된 유일한 URL에서 사용자를 빼내므로 첫 클릭이 성공한다. 랜딩 페이지가 실습장이 되어 데모 영상을 대체한다.
- **기각 이유**: 사용자가 개입을 강하게 꺼렸다. `chrome.tabs.create`의 기본값 `active:true`가 **포커스를 가져간다**. `active:false`로는 사용자가 차단 URL에 그대로 남아 목적을 달성하지 못하므로 **중간 지점이 없는 트레이드오프**였다.
- 참고 제약: `onInstalled`은 일회성 디스패치이고 재전달이 문서화되어 있지 않다. 또 unpacked "새로고침"은 `reason: "update"`로 오므로 `"install"` 가드가 있으면 개발 중엔 재현되지 않고, 반대로 가드가 없으면 스토어 자동 업데이트마다 전 사용자에게 탭이 열린다.

### B. `chrome.notifications` OS 토스트 — 기각

- **기각 이유 1**: 새 권한 `notifications`가 필요하다. permissions 변경은 `docs/privacy.{ko,en}.md`·`docs/PERMISSION.md` 갱신 트리거다.
- **기각 이유 2**: v1.6.18이 스토어 심사 중이다(2026-07-26 제출). 권한 추가는 심사를 다시 돌리고, oauth-proxy 재배포(2026-08-09 목표)의 전파 시계를 리셋시킨다.
- **기각 이유 3**: OS 레벨 토스트는 사이드 패널보다 **더** 침입적이다.

### C. `chrome.action.setBadgeText` / `setTitle` 배지·툴팁만 — 기각

- 장점: 개입 0, 권한 0, URL 무관하게 항상 동작. 클릭 **전에** 알려준다.
- **기각 이유**: "왜 안 되는지"는 알려주지만 "어디로 가야 하는지"를 못 알려준다. 첫 설치 사용자는 무반응을 겪은 뒤 툴팁을 호버해볼 이유가 없어 activation을 회복하지 못한다.

### D. `chrome.tabs.update`로 현재 스토어 탭을 퀵스타트로 이동 — 기각

리뷰를 쓰려던, 설명을 더 읽으려던 사용자의 페이지를 뺏는다. 새 탭보다 적대적이다.

### E. 미지원 페이지에서 동작하는 기능만 살려두기 (녹화·30s Replay 유지) — 기각

`startScreenCapture`엔 지원 게이트가 없어 `getDisplayMedia`로 실제 동작하고, 30s Replay는 웹스토어(https)에서 캡처가 성공한다. 정확성만 보면 남기는 게 맞다.

- **기각 이유 1** (불량 산출물): `video-capture.ts:97`의 `chrome.tabs.get`이 미지원 탭에서 `url: ""`을 주므로 **page URL도 로그도 없는 이슈**가 트래커에 등록된다. 리포트로서 결함이다.
- **기각 이유 2** (UX): 회색·활성 버튼이 섞인 화면은 "이 페이지에선 못 쓴다"는 단일 메시지보다 헷갈린다. 첫 실행 사용자에게 반쯤 죽은 화면은 나쁜 첫인상이다.
- **기각 이유 3** (상태 기계 얽힘): `shouldPreserveSession`은 `captureMode === "video"`면 무조건 `true`(`tab-bindings.ts:76`). 녹화를 허용하면 미지원 탭에 보존 세션이 생겨 `apply()`·`resolveNavigationAction`의 보존 분기와 상호작용한다. 끄면 이 조합 자체가 사라진다.
- 참고: "로그 없는 녹화는 반쪽"이라는 근거는 채택하지 않는다 — `getDisplayMedia`는 시스템 피커라 다른 창·다른 탭을 녹화하므로 `chrome://settings`에 서서 자기 앱을 녹화하는 것은 정당한 사용이다.

### F. Debug 탭 전체를 `UnsupportedPage`로 교체 (서브탭 바까지 숨김) — 기각

`hideSubTabs`(`DebugTab:25-29`) 메커니즘을 재사용하면 가장 단순하다.

- **기각 이유**: `PageFooter`의 `[가이드]`와 `IntegrationsCta`가 미지원 페이지에서도 **실제로 동작한다**. 통째로 숨기면 첫 실행에서 완주 가능한 유일한 생산적 행동(트래커·LLM 연결 진입)을 잃는다.

### G. 패널 전체를 `App.tsx:481`의 전체화면 `UnsupportedPage`로 교체 — 기각

- **기각 이유**: 메인 탭 4개 중 페이지를 필요로 하는 것은 `debug` 하나뿐이다. `issue-list`/`integrations`/`settings`는 미지원 페이지에서 완전히 동작한다(prd.md 가용성 표). 전체화면 교체는 잘 되는 탭 3개를 숨기는 퇴행이다. `App.tsx:221`의 그 분기는 `tabId === null`(탭 바인딩 자체 실패)용이며 조건이 다르다.

### H. `EmptyShell`에 새로고침 `action` 버튼 추가 — 기각

`EmptyShell`은 `action` 슬롯을 지원한다(`:685,698`).

- **기각 이유**: 자동 감지가 가능하다. 수동 새로고침을 요구하면 "이 확장은 뭔가 수동으로 달래야 한다"는 인상을 줘 지금 고치려는 문제와 같은 계열의 마찰이 된다.
- 근거 보정: 초기 설계는 "지원 여부 전이는 항상 cross-document라 `info.url`이 발화한다"를 근거로 들었으나 그건 **미지원 → 지원 방향만** 참이다(변경 범위 참조). `info.status` + `chrome.tabs.get` 폴백으로 양방향 자동 감지가 성립하므로 결론은 유지된다.

### I. 안내 화면에 "지원 페이지 열기" CTA 추가 — 기각 (이번 스코프)

`EmptyShell`의 `action` 슬롯에 버튼을 놓아 사용자를 지원 URL로 데려가는 안. 대안 A의 기각 근거(포커스 강탈 = 개입)는 **사용자가 직접 누르는 버튼에는 적용되지 않으므로** 대안 A와 별건이다.

- 장점: 목표가 activation 회복이라면 "이동하라"는 문장보다 그 이동을 대신 해주는 버튼이 직접적이다. prd.md S3(연동 ≥ 1)의 막다른 길을 실제로 없앤다.
- **기각 이유**: `chrome.tabs.create`로 새 탭을 열면 **그 탭에는 패널이 따라오지 않는다** — 패널은 탭 스코프이고 전역 비활성이므로 새 탭에서 다시 아이콘을 눌러야 한다. 즉 CTA를 누른 사용자가 "패널이 사라졌다"를 겪는다. 해결하려면 새 탭에 `activateTab`을 호출해야 하는데 그건 `sidePanel.open`의 user gesture 체인이 `tabs.create` 콜백을 넘어 살아남는지 검증이 필요하고(살아남지 않을 가능성이 높다), 그 검증은 이번 스코프가 아니다.
- 같은 문제가 기존 `[가이드]` 버튼에도 이미 있다(prd.md 가용성 표). 회귀는 아니지만 이 변경으로 미지원 화면의 주 경로가 되면서 드러난 것이므로, **패널 유지 문제를 함께 푸는 후속 건으로 남긴다.**

### J. `tabs` 권한 추가 — 기각

`manifest.config.ts:60-70`에 `"tabs"`를 넣으면 `tab.url`·`changeInfo.url`이 URL 무관하게 항상 읽혀 판정 문제(설계 결정 1)와 Phase 2의 판독 불가 문제가 동시에 사라진다.

- **기각 이유**: 심사 중 버전 + 비목표 "새 권한 0개" 위반 + 설치 시 권한 경고 문구가 늘어난다. 대안 B와 같은 릴리스 제약이다. 빈 `tab.url`을 미지원으로 접는 것으로 Phase 1은 충분하고, Phase 2는 `webNavigation`(이미 보유) 프로브로 먼저 시도한다.

## 위험 요소

### 1. user gesture 소실 (높음 / Phase 1)

`activateTab`에서 가드를 삭제할 때 실수로 `await`를 도입하면 `sidePanel.open()`이 **조용히 실패**한다. 예외도 없고 로그도 남지 않아 "가드는 지웠는데 여전히 안 열린다"로 오진하게 된다. `docs/ARCHITECTURE.md:15-36`이 이 함정을 명시하고 있다.

→ 대응: 단위 테스트로 `setOptions`·`open`이 **동기 호출**임을 단언(호출 순서 + `await` 없음). 그리고 실물 확인.

### 2. `activateTab`에 e2e 그물이 없다 (높음 / Phase 1)

- `e2e/unsupported-url.spec.ts:29`가 `ext.openPanel(tabId)` 픽스처로 패널을 직접 열어 **`activateTab`을 우회**한다.
- Playwright는 확장 액션 아이콘을 클릭할 수 없다(`e2e/activetab-broad-permission.spec.ts:11-13`).
- `activateTab`의 현재 단위 테스트는 **0개**다(`src/background/__tests__/tab-bindings.test.ts`는 순수 함수만 다룬다 — import가 `{ describe, it, expect }` + 순수 함수뿐이고 `vi`도 `chrome`도 없다).

→ Phase 1에서 단위 테스트 추가가 필수이며, 그래도 "실제 아이콘 클릭"은 수동 확인만 가능하다.

### 3. 서비스워커 자동화 불가로 수동 검증 의존 (중간)

`docs/POSTMORTEM.md:301-305`: crxjs가 서비스워커를 `type:module`로 emit하는데 Playwright `worker.evaluate`가 그 실행 컨텍스트를 못 잡아 **무한 대기**하며, `workers:1`이라 첫 `sw.evaluate` 하나가 전 스위트를 정지시킨 전례가 있다. 따라서 background 동작은 관찰 가능한 신호(activated set·세션 키를 SW storage로 읽기)로 우회 검증해야 한다 — `activetab-broad-permission.spec.ts`가 그 우회의 선례다.

### 4. 판정 중 플래시 (해소 — 실측 결과 체감 없음)

미지원 페이지에서 패널을 열면 판정(`chrome.tabs.get` 왕복) 전까지 캡처 버튼 5개가 그려진다. 설계 시점에는 prd.md S1에서 100% 발생하는 시각 거스러미로 보고 3-상태 전환을 대안으로 남겨뒀다.

**2026-07-27 실측: 체감되지 않는다.** 웹스토어·`chrome://settings` 양쪽에서 아이콘 클릭 시 버튼이 눈에 보이지 않았다. 원인은 `useTabUnsupported`가 `App.tsx`의 하이드레이션 게이트(`if (!editorHydrated || !settingsHydrated) return null`)보다 **위**에서 호출되어, `tabs.get`이 `chrome.storage` 왕복 2건과 **병렬로 경합**하고 먼저 끝나기 때문이다 — 패널이 첫 페인트를 하기 전에 판정이 이미 도착한다.

→ 3-상태 전환은 불필요하다(기존 e2e 42개의 first-paint 단언도 그대로 지킨다). 단 이 결과는 storage 왕복이 `tabs.get`보다 느리다는 **경합에 기댄 것**이므로, 하이드레이션을 최적화하거나 판정에 왕복을 추가하면 다시 드러날 수 있다.

### 5. `picker-unavailable-dialog`의 주 트리거 소실 (중간)

진입 화면에서 캡처 버튼이 사라지면 `onPickerUnavailable`은 "가드 통과 후 캡처 시작 전에 탭이 미지원으로 이동"하는 race 경로에서만 발화한다. 다이얼로그와 5개 게이트(`ensureSupportedTab` 호출부)는 **제거하지 않는다** — race는 실재한다. 다만 e2e로 재현하기 어려워져 커버리지가 얇아진다.

### 6. Phase 2가 권한 라이프사이클 상태 기계를 건드린다 (높음 / Phase 2)

`deactivatePanelIfCrossOrigin`은 단순한 "쓸모없으니 닫기"가 아니라 activeTab 만료·광역 커버 판정 로직이다. `deactivate` 분기는 `setActivated(false)` + `setOptions({enabled:false})` + 세션 제거를 **함께** 한다(`:195-199`). 이를 `clearSession`으로 라우팅하면 activated set이 보존되는데, 소비처 전수 grep 결과 그 보존이 다른 경로에 영향을 주지 않음은 확인됐다(변경 범위 "부수 효과" 참조).

또 `resolveNavigationAction`의 도달 가능성 주석이 있다 — **`e2e/activetab-broad-permission.spec.ts:6`**의 "미보유 닫힘·deferred 분기는 프로덕션 도달 불가 — 순수함수 회귀 자산으로만 남음"(단위 테스트 파일의 대응 주석은 `tab-bindings.test.ts:81-82`). 입력을 추가할 때 도달 가능/불가 분기를 구분해 테이블을 갱신해야 한다.

### 7. `element` + `capturing` 세션이 갇힌다 (중간 / Phase 2)

Phase 2 이후 미지원 이동은 `clearSession`(`:187-189`)이라 세션 키만 삭제되고 패널은 남는다. 그 삭제를 받는 `useEditorSessionSync.ts:209-221`의 분기는:

```ts
const needsExpiry = captureMode === "element" && phase === "styling";
const needsReset = phase === "picking" || (captureMode === "screenshot" && phase === "capturing");
```

`captureMode === "element" && phase === "capturing"`(요소 캡처 진행 중)은 **두 분기 어디에도 걸리지 않는다.** 기존에는 `deactivate`가 패널까지 닫아 이 공백을 가려줬는데 Phase 2가 그 가림막을 없앤다 → 미지원 페이지 위에 살아있는 듯한 `CapturingState`가 남는다. `video`+`recording`은 `shouldPreserveSession`이 항상 `true`라 `notifyDeferredExpiry`로 빠져 안전하고, `screenshot`+`capturing`·`picking`은 reset된다 — 구멍은 요소 캡처 하나로 좁다.

같은 계열: `capture-throttle.ts`의 `captureOwnedTab`에는 `isSupportedUrl` 체크가 없어(`windowId`·`active`만 확인) 이 상태에서 캡처가 완료되면 Chrome 원문 에러가 표면화된다.

### 8. `sidepanel_opened` 지표 의미 변화 (낮음)

미지원 페이지에서도 패널이 열리므로 이 이벤트가 **기계적으로** 증가한다. `page_supported` property가 이 증가를 분리해내는 수단이며(목표 3), 그것 없이는 배포 후 지표 상승을 activation 회복으로 오해할 수 있다.

### 9. 지원 여부 판정이 세 곳으로 늘어난다 (낮음)

같은 판정이 이미 두 곳에 imperative로 존재한다 — `useBackgroundRecorder.ts:46`의 `isSupportedUrl(tab.url)` 사전 필터, `src/sidepanel/picker-control.ts:183-191`의 `ensureSupportedTab`. `useTabSupport`가 세 번째다. 통합은 이번 스코프가 아니지만, **네 번째가 조용히 늘어나는 것을 막기 위해 통합 후보로 기록**한다.

background가 판정해 메시지·storage로 내려보내는 대안은 정보 우위를 주지 않는다 — background도 `chrome://`의 `tab.url`을 못 읽고, `bgPort`는 현재 `port.postMessage`/`onMessage` 배관이 아예 없다(`index.ts:85-107`은 `captureEvent` + disconnect만). 훅이 맞는 선택이다.

### 10. 스코프 밖이지만 Phase 2가 증폭시키는 것

- `App.tsx:198-215`의 picker port는 deps `[tabId]`라 한 번 죽으면 **재연결되지 않는다**. 오늘도 cross-document 이동에서 죽지만 `deactivate`가 문서를 파괴해 새 port를 강제했다. Phase 2 이후엔 portless 패널 문서가 임의 횟수의 네비게이션을 살아남는다.
- `originOf`(`session-keys.ts:41-47`)는 opaque origin에 문자열 `"null"`을 반환하고 `:172-173`은 `!= null`만 보므로 **모든 opaque origin이 same-origin으로 비교된다**. Phase 2 패치가 이 줄들을 건드린다.
- Phase 2는 "지원 → 미지원 → 지원 왕복 시 아이콘 재클릭"이라는 **암묵적 activeTab 재취득 체크포인트를 제거**한다 → 탭 녹화가 조용히 `getDisplayMedia` 폴백으로 강등된다(`docs/POSTMORTEM.md:400-405`: `<all_urls>`는 `tabCapture`를 커버하지 못한다). 커버 URL keep 경로에서 이미 수용된 트레이드오프의 확장이다.
- `IssueTab.tsx:265`의 기존 `UnsupportedPage`(`PageShell > EmptyShell`, footer 없음, `issue.unsupported` 키)는 `App.tsx:221`이 `tabId === null`을 먼저 걸러내므로 사실상 도달하지 않는 경로로 보인다. **기존 dead code이므로 삭제하지 않고 언급만 한다**(CLAUDE.md 외과적 변경 원칙). 단 `IssueTab.tsx:183-185`의 `!tabId` 가드는 truthy 검사라 `tabId === undefined`(판정 중)와 `0`까지 삼켜 새 안내보다 먼저 그려진다는 점은 알고 있어야 한다.

### 11. 기존 e2e 2개가 깨진다 (확실)

| spec | 현재 단언 | 필요 조치 | Phase |
|---|---|---|---|
| `e2e/unsupported-url.spec.ts:31,37` | `chrome://version` 탭에서 `mode-element` 클릭 → `picker-unavailable-dialog` → 닫으면 `mode-element` 다시 보임 | 캡처 버튼이 사라지므로 **시나리오 전면 재작성**. 깨지는 원인은 background 변경이 아니라 **UI 변경**이다(그 spec은 `openPanel`로 `activateTab`을 우회하고 activated set을 쓰지 않아 background 변경이 관측되지 않는다) | 1 |
| `e2e/activetab-broad-permission.spec.ts:94-106` (단언 `:103`) | "광역 보유라도 비커버 URL(`chrome://`) 이동 → 패널 종료(deactivate)" | **단언 반전** (패널 유지 + activated 보존) | 2 |

e2e 63개 spec 전수 대조 결과 하드 브레이크는 이 2개가 맞다 — 단 **설계 결정 3("판정 중 → `false`")에 의존한 조건부**다. 3-상태로 뒤집으면 위험 요소 4에 열거한 spec들이 즉시 flaky해진다.
