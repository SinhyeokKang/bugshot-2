# 액션 로그 네비게이션 유형 판별 — 기술 설계

> **위치 표기 규칙**: 이 문서는 라인 번호를 쓰지 않고 **심볼·스니펫**으로 지목한다. `action-recorder.ts`는 동시 편집이 잦아 라인 핀이 항상 밀린다(리뷰 시점에도 8곳이 어긋나 있었다).

## 개요

판정 소스를 **두 갈래**로 나눈다. 문서가 새로 실행되는 경로(최초 로드·새로고침·문서 재로드 traverse)는 도착 문서의 내비게이션 타이밍 엔트리 하나로 판정하고, 같은 문서 안에서 히스토리를 오가는 경로(SPA traverse)는 `popstate` 시점에 Navigation API의 히스토리 인덱스 델타로 **방향까지** 판정한다.

판정 자체는 전부 **순수 함수 2개**로 뽑아 `action-recorder-helpers.ts`에 두고 유닛으로 고정한다. 레코더 본문에는 "무엇을 읽어 그 함수에 넘기는가"만 남는다. 표시 문구 선택도 순수 함수 1개(`navVerbKey`)로 뽑아 액션 로그 목록과 log-viewer 타임라인이 **같은 출처**를 쓰게 한다.

bfcache 복원은 **비목표**(PRD 참조)라 `pageshow` 후크를 두지 않는다.

## 변경 범위

### `src/types/action.ts` — 타입 단일 출처

- 현재 역할: `ActionEntry.navType`이 `"load" | "pushState" | "replaceState" | "popstate" | "hashchange"`.
- 변경: 유니온에 `"reload" | "traverse" | "back" | "forward"` 추가. 기존 5개는 **그대로 남긴다**(구 로그 하위호환 + Navigation API 실패 시 `popstate` 폴백).
- **컴파일러 안전망은 없다.** 저장소 전체에 `navType` 축의 exhaustive 검사가 0건이다(`never` 가드는 전부 `kind` 축). 유니온을 넓혀도 렌더 분기 누락이 컴파일 에러로 안 잡히고 조용히 "이동"으로 뜬다 — U3·U4의 폴백 케이스가 유일한 그물이다.

### `src/content/action-recorder.ts` — 판정 지점

- 현재 역할: MAIN world 액션 레코더. document_start에 `recordNavigation("load", …)`, `pushState`/`replaceState` 패치, `popstate`/`hashchange` 리스너.
- 변경:
  1. 내부 `type NavType` 미러를 `types/action.ts`와 동일하게 확장.
  2. 진입 판정: 모듈 초기화에서 `entryNavType(...)`을 1회 계산해 `entryType` 상수로 잡고, `recordNavigation("load", …)` 자리와 `setSentinel`의 `entryNavOnBind` 보충 경로에서 **같은 값**을 쓴다 — 후자에 `"load"`를 하드코딩한 채 두면 pre-arm이 놓친 새로고침이 일반 이동으로 강등된다.
  3. `popstate` 리스너: 히스토리 인덱스를 읽어 `traverseDirection(prevIndex, idx)`로 방향을 얻고, `null`이면 기존 `"popstate"`로 폴백.
  4. **`clear` 핸들러 대칭 수정** — 아래 별도 항목.
- **인덱스는 미러 변수로 유지하지 않는다.** `<a href="#x">` 클릭은 `popstate` 없이 히스토리 인덱스를 +1 하므로, `초기화 / pushState·replaceState / popstate` 세 지점만 갱신하면 HashRouter 앱에서 인덱스가 한 스텝 뒤처져 이후 방향 판정이 전부 `null` 폴백된다. 대신 **`recordNavigation` 진입 시(또는 각 핸들러 첫 줄) 현재 인덱스를 매번 읽어 직전 값과 비교하고 곧바로 덮어쓴다.** 갱신 지점을 열거하지 않으므로 새 히스토리 경로가 생겨도 드리프트가 없다.
  - 부수 효과: `pushState`/`replaceState` 패치 안에서 인덱스를 다룰 때는 **원본 호출 뒤에 읽어서 대입**한다(카운터 증가가 아니다 — `replaceState`는 인덱스를 올리지 않는다). 앞에서 읽으면 항상 한 스텝 뒤처진다.
- **두 개의 조기 반환 가드를 함께 넓혀야 한다.** 놓치면 기능이 무음으로 죽는다:
  - `recordNavigation`의 `if (navType !== "load" && fromUrl === toUrl) return;` — 새로고침은 `document.referrer`가 비어 `fromUrl === toUrl`이 되기 쉬워 **여기서 버려진다.** 조건을 "문서 진입 계열(`load`/`reload`/`traverse`)이면 통과"로 바꾼다.
  - `if (navType === "load" && capturing) entryNavEmitted = true;` — 같은 진입 계열 집합으로 넓힌다. 안 넓히면 새로고침 진입 후 `setSentinel`이 `load` 항목을 한 번 더 합성해 **중복**이 생긴다.
  - 이 래치 확장이 중복의 **유일한 방어**다. 하류 `mergeLogItems`는 `id`만으로 dedup하고 액션 경로에 타임윈도·kind별 collapse가 전무해서, 레코더가 내보낸 중복은 UI·타임라인·JSON·AI 요약에 그대로 간다.
  - 래치는 pre-arm grace 만료 경로에서 `entryNavEmitted = false`로 리셋된다. 진입 계열로 넓힌 뒤에도 리셋 후 재arm이 `entryType`으로 합성하는지 확인한다.

#### `clear`가 의도를 실어 나른다 (개정 — 구현 중 1차 처방이 회귀를 만들어 재설계)

`logClear`는 사이드패널 store만 비우는 게 아니라 `editor-store.clearActionLog` → `clearActionRecorder` → 브리지를 거쳐 **새 문서의 MAIN world 버퍼까지** 지운다. 그런데 MAIN의 `clear` 핸들러는 `clearBuffer()`만 하고 **`entryNavEmitted`를 되돌리지 않는다**.

결과: reload 항목이 버퍼에 들어가 `entryNavEmitted = true`가 된 뒤 clear가 도착하면 버퍼가 비워지고, 이어지는 `setSentinel` 보충(`entryNavOnBind`)이 "이미 실었다"고 판단해 **reload 항목이 영구 유실**된다. 도달 여부는 `onCommitted → Promise.all 2홉 → logClear` 체인과 `tabs.onUpdated → setSentinel` 체인의 경합에 달렸다.

##### 1차 처방(`clear`에서 무조건 래치 리셋)이 왜 틀렸나

> 이 항목은 실패한 설계를 남겨 둔다 — 지우면 다음 사람이 같은 처방을 다시 제안한다.

"grace 만료 경로와 동일한 대칭"이라는 근거 자체가 성립하지 않는다. **두 경로는 배타적 구간에서 돈다**:

- grace 만료는 `if (armedOnce) return;` 가드를 달고 **arm 이전**에만 동작한다.
- `clear` 리스너는 `setSentinel` **안에서만** 등록되고 같은 함수가 `armedOnce = true`를 세운다 → clear 핸들러가 도는 시점엔 `armedOnce`가 **항상 true**다. 즉 grace의 가드를 그대로 옮기면 죽은 코드가 된다.

가드 없이 리셋만 옮기면 **새 회귀**가 생긴다. `clear` 발신자가 둘인데 의미가 반대이기 때문이다:

- `video-capture.ts:prepareRecorders`는 **activate → clear 순서**라 clear 시점에 이미 armed다. 그 뒤 `useBackgroundRecorder`의 `visibilitychange → inject()`가 **같은 문서를 재arm**한다(녹화 중 탭 전환 복귀. `recordersStopped`가 false).
- 그때 래치가 내려가 있으면 보충이 한 번 더 돌아, **일어나지도 않은 새로고침을 녹화 중간 시각(`Date.now()`)으로 단언하는 유령 항목**이 생긴다. 하류에 흡수 장치가 없어 이슈 본문·JSON·AI 요약까지 나간다.
- `rejectUnsupported`·`chrome.tabs.get` throw 경로는 `cancelRecording` → `preserveLogs`로 패널 로그를 남기므로 **진짜 중복**(같은 from/to, 다른 id)이 된다.

손익도 뒤집힌다: 막으려던 **유실은 이 기능 이전부터 있던 조건**이고(예전엔 같은 race에서 `load` 항목을 잃었다 — 라벨만 `reload`로 바뀐다), 유령 항목은 **이번에 새로 생기는 회귀**다.

##### 개정 설계 — 판정을 발신자로 올린다

MAIN world는 "패널 로그도 함께 비워졌는가"를 알 수 없다. 알 수 있는 건 **보내는 쪽**이다. 그러니 `clear`에 의도를 실어 보낸다. 발신자는 정확히 둘이고 1:1로 갈린다:

| 발신자 | 상황 | 진입 항목 |
|---|---|---|
| `usePickerMessages`의 `logClear` → `editor-store.clearActionLog` | 네비게이션 경계. 패널 로그도 같은 블록에서 비워진다 | **보충해야 함** |
| `video-capture.ts:prepareRecorders` | 녹화 세션 준비. 같은 문서가 계속 살아 있다 | **보충하면 안 됨** |

`clearActionLog`의 비테스트 호출자는 `usePickerMessages.ts`의 `logClear` 분기 **하나뿐**이라 이 매핑에 예외가 없다.

- `PickerMessage`의 `actionRecorder.clear`에 `resupplyEntryNav?: boolean` 추가. **기본값(필드 부재) = 보충 안 함** — 새 발신자가 생겼을 때 잊으면 "유령 항목"이 아니라 "기존 동작"으로 떨어지는 fail-safe 방향을 고른다.
- `clearActionRecorder(tabId, opts?)` → 브리지가 `CustomEvent.detail`로 중계 → MAIN `clear` 핸들러가 그 플래그일 때만 `entryNavEmitted = false`.
- **`network`/`console`의 clear는 건드리지 않는다** — 진입 항목 개념이 액션 로그에만 있다.

이 설계는 액션 로그에만 있는 비대칭(진입 항목 합성)을 발신자 의도로 해소하는 것이고, 래치의 의미("이 문서의 진입 항목이 패널에 살아 있다")를 바꾸지 않는다.

### `src/content/action-recorder-helpers.ts` — 판정 순수 함수 (신규 2개)

- 현재 역할: 레코더가 쓰는 순수 헬퍼 모음. `entryNavOnBind`가 같은 성격(네비게이션 결정)의 선례다.
- 변경: `entryNavType` / `traverseDirection` 추가. **`src/content/` 밖을 import하지 않는다** — 이 파일은 recorders-entry 청크에 인라인되고, 밖을 물면 `scripts/check-prearm-chunk.mjs`가 막는다(막지 못하면 pre-arm이 조용히 죽는다).

### `src/content/recorder-globals.ts` — 전역 스냅샷

- 현재 역할: 페이지가 갈아끼울 수 있는 내장(`JSON.parse`, `CustomEvent`, `EventTarget.prototype.*`)을 document_start에 스냅샷.
- 변경: **`window.navigation`과 `performance` 둘 다** 같은 방식으로 스냅샷해 export. 페이지가 나중에 덮어써도 레코더는 원본을 본다. 하나만 스냅샷하면 위협모델이 비대칭이 된다.
- **선행 의존 없음**: 이 파일은 `ed83867`에 이미 커밋돼 있다. 다만 착수 시점에 `action-recorder.ts`·`logs.ts`·log-viewer 사전이 미커밋 상태로 남아 있을 수 있으니 그 변경분을 먼저 커밋하고 시작한다.

### `src/sidepanel/lib/actionInline.ts` — 문구 키 단일 출처 (신규 1개)

- 현재 역할: 액션 렌더를 두 표면이 공유하기 위한 순수 헬퍼(`splitTemplate`·`resolveClickTarget`·`actionSearchText`). log-viewer의 `markers.ts`가 이미 여기서 `splitTemplate`을 끌어간다.
- 변경: `navVerbKey(navType)` 추가 — `navType`을 i18n 키로 매핑. 목록과 타임라인이 이걸 공유해 문구가 갈라지지 않게 한다.
- **반환 타입은 `TranslationKey`** — 사이드패널 `t`가 `(key: TranslationKey, …)`라 `string`을 넘기면 typecheck가 깨진다.
- **`TranslationKey`는 반드시 `import type`으로 끌어온다.** `vite.log-viewer.config.ts`의 `@/i18n` alias는 prefix 매칭이라 값 import면 log-viewer 빌드가 접힌 경로로 깨진다(`@/i18n/locales`와 동일 함정). 이 파일은 log-viewer가 끌어가는 공유 모듈이므로 주석으로 못박는다.

### `src/sidepanel/components/ActionLogContent.tsx` — 로그 목록 렌더

- 현재 역할: 액션 로그 목록. `KindIcon`이 kind별 아이콘, `renderActionContent`가 kind별 문구. 렌더 지점은 `LogPreviewDialog`·`ReplayTrimDialog`·log-viewer `App` 셋이다(Debug 탭에 액션 서브탭은 없다).
- 변경 3곳:
  - `KindIcon` props에 `navType?` 추가(선택 필드라 기존 호출부와 호환). `navigation`이면서 `back`/`forward`/`reload`/`traverse`면 `ArrowLeft`/`ArrowRight`/`RotateCw`/`History`, 그 외엔 기존 `MapPin`. 색은 `TONE_TEXT.blue` 유지.
    - **아이콘이 유형의 1차 판별축이다.** ko 문구는 `{target}`이 문두라 `TimelineRow`의 `truncate`에서 판별어(`(으)로 뒤로가기` 등)가 통째로 잘린다(en은 동사 선두라 무사 — 로케일 비대칭). 그래서 `reload`와 `traverse`에 같은 아이콘을 주면 ko 타임라인에서 두 유형이 완전히 동일해진다. `RotateCw`는 reload 전용, traverse는 `History`(lucide, 저장소 미사용 확인)로 가른다. `RotateCcw`는 "초기화" 관용구로 이미 굳어져 있어 쓰지 않고, `ArrowLeftRight`는 `NetworkLogContent`가 "데이터 교환"으로 쓴다.
  - `renderActionContent`의 `navigation` 케이스가 `navVerbKey(entry.navType)`로 키를 고른다. 슬롯(`{target}`)과 `InlineLink` 구조는 그대로.
  - **`ActionRow`에 `data-nav-type={entry.navType}` 추가** — e2e 판정용. 기존 `data-drag-target`이 정확히 같은 목적의 선례다. 앱 로케일이 비결정적이라(`e2e/GOTCHAS.md`) 문구 단언을 쓸 수 없고, 아이콘 클래스로는 유형 4종을 안정적으로 가를 수 없다.
- 호출부 2곳(`ActionLogContent`의 `ActionRow`, `log-viewer/components/TimelineRow.tsx`) 모두 entry를 들고 있으므로 `navType={entry.navType}` 한 줄씩 추가.

### `src/log-viewer/markers.ts` — 타임라인 마커 라벨

- 현재 역할: 타임라인 마커 생성. `navigation` 케이스가 `t("actionLog.verb.navigate")`로 label과 labelParts(슬롯만 파랑)를 만든다.
- 변경: 그 키를 `navVerbKey(e.navType)`로 교체. `variant = "navigate"`와 `splitTemplate` 구조는 유지.
- **`t()`가 2회 호출된다** — 보간판이 `label`로, 미보간판이 `labelParts`로 간다. **한쪽만 바꾸면** `TimelineMarkers.tsx`의 `aria-label={m.label}`(스크린리더가 읽는 값)과 화면 툴팁 문구가 갈리는 무음 a11y 회귀이고, `markers.test.ts`의 "parts를 이어붙이면 label과 같다" 불변식도 깨진다. **두 곳 모두 교체한다.**

### `src/i18n/namespaces/logs.ts` + `src/log-viewer/i18n.ts` — 사전 2벌

- 현재 역할: 전자가 사이드패널 사전, 후자가 log-viewer 전용 **복제 사전**.
- 변경: 신규 키 4개를 ko/en × 2파일 = **16개 엔트리**(현재 로케일 2개 기준)로 동시 추가. 값도 동일해야 한다 — `src/log-viewer/__tests__/i18n.test.ts`가 메인 테이블과의 값 일치까지 대조한다.
- i18n PostToolUse 훅은 `*src/i18n/*` matcher라 **log-viewer 사전에는 안 걸린다.** 그쪽 누락은 `pnpm test`에서만 잡힌다.
- **동적 키는 log-viewer 리터럴 스캐너를 우회한다.** 그 테스트는 import 그래프에서 `t("리터럴")`만 긁고, 값 drift 검사도 `Object.keys(dict).filter(k => k in table)`이라 **복제 사전에 키가 아예 없으면 통과**한다. → `navVerbKey`가 반환할 수 있는 키를 **닫힌 집합 상수로 export**하고 전용 `it()`을 추가한다(`NET_VERB_KEYS`·`STATUS_KIND_LABEL_KEYS` 선례).

### `src/sidepanel/lib/buildLogSummary.ts` — AI 프롬프트용 요약

- 현재 역할: `buildActionLogSummary`가 `navigation`을 `Navigated to: {toUrl}`로.
- 변경: 유형별 영문 문구로 분기(`Went back to:` / `Went forward to:` / `Reloaded:` / `Navigated via history to:`). **이 함수는 로케일 무관 영어 고정**이 기존 규칙이므로 i18n을 끌어오지 않는다. traverse 문구는 UI en 값과 같은 표현을 쓴다(표기 분기 방지).

### 무변경 확인

- `src/sidepanel/lib/buildActionLogJson.ts` — `navType`을 조건부 spread로 그대로 통과시켜 새 값이 자동으로 실린다(`version: 1` 스키마에 enum 값만 늘어난다).
- `src/lib/navigation-clear.ts` — 클리어 정책 불변. 여기의 `"reload"`는 Chrome `transitionType`이라 `ActionEntry.navType`과 이름만 같은 별개 도메인이다.
- `src/background/index.ts` — `webNavigation` 경로 불변.
- `ACTION_FILTERS`·`actionSearchText`·30s Replay 트림(`trim-markers.ts` — `navType`이 아니라 `variant === "navigate"`로 거른다) — 불변.
- `kindBgColor`·`timeline-merge.timelineFillClass` — kind 축이라 불변(KindIcon을 건드리므로 리뷰어가 찾아볼 자리).

## 데이터 흐름

```
[문서 진입 — 최초/새로고침/문서 재로드 traverse]
  document_start (MAIN world, recorders-entry 동기 IIFE)
    performanceRef.getEntriesByType("navigation")[0]?.type   (recorder-globals 스냅샷)
      "reload"       → entryNavType → "reload"
      "back_forward" → entryNavType → "traverse"
      그 외/부재      → 레거시 performance.navigation.type(0/1/2) 폴백 → 그래도 모르면 "load"
    → recordNavigation(entryType, referrer||lastUrl, location.href)
    → buffer (pre-arm이면 sentinel 전에도 적재)
    → setSentinel 시 entryNavOnBind 보충도 같은 entryType 사용

[SPA traverse — 같은 문서]
  popstate
    navigationRef.currentEntry.index (recorder-globals 스냅샷 경유, 매 판정 시점에 읽음)
    traverseDirection(prevIndex, idx)
      idx < prev → "back"
      idx > prev → "forward"
      판정 불가   → null → "popstate" 폴백
    → recordNavigation(dir ?? "popstate", lastUrl, location.href)

[공통 하류 — 기존 경로 그대로]
  throttle → CustomEvent(__bugshot_action_data__<sentinel>)
    → recorder-bridge (ISOLATED) → 사이드패널 log-merge
    → ActionLogContent / markers.ts / buildActionLogJson / buildLogSummary
```

인덱스는 갱신 지점을 열거하지 않는다 — 판정 시점에 읽고 즉시 덮어쓴다.

## 인터페이스 설계

```ts
// src/types/action.ts
navType?:
  | "load" | "pushState" | "replaceState" | "popstate" | "hashchange"  // 기존
  | "reload" | "traverse" | "back" | "forward";                        // 신규
```

```ts
// src/content/action-recorder-helpers.ts

// 문서 진입 계열 판정. PerformanceNavigationTiming.type("navigate"|"reload"|"back_forward"|"prerender")을
// 액션 로그 navType으로. 값이 없으면 레거시 performance.navigation.type(0=navigate/1=reload/2=back_forward)로
// 폴백하고, 그래도 모르면 "load"(기존 동작 유지).
export function entryNavType(
  perfType: string | undefined,
  legacyType?: number | undefined,
): "load" | "reload" | "traverse";

// same-document traverse 방향. Navigation API 히스토리 인덱스 델타의 부호.
// 유한한 0 이상의 정수 2개가 아니거나 델타가 0이면 null(→ 호출부가 "popstate"로 폴백).
// NavigationHistoryEntry.index는 엔트리 리스트 밖일 때 -1을 반환하므로 음수를 명시적으로 거부한다.
export function traverseDirection(
  fromIndex: number | undefined,
  toIndex: number | undefined,
): "back" | "forward" | null;
```

```ts
// src/content/recorder-globals.ts
// 히스토리 인덱스만 읽는다 — 페이지가 window.navigation을 덮어쓸 수 있어 document_start에 스냅샷.
// lib.dom에 Navigation 타입이 없으므로 (globalThis as unknown as { navigation?: NavigationLike }) 형태로
// 최소 구조적 타입을 선언한다. any 노출 금지.
export const navigationRef: { currentEntry?: { index?: number } } | undefined;
// 같은 위협모델로 performance도 스냅샷.
export const performanceRef: Performance | undefined;
```

```ts
// src/sidepanel/lib/actionInline.ts
import type { TranslationKey } from "@/i18n";  // 값 import 금지 — log-viewer alias가 prefix 매칭

// navigation 항목의 i18n 동사 키. 구 값·미상은 기존 "actionLog.verb.navigate"로 폴백한다.
export function navVerbKey(navType: ActionEntry["navType"]): TranslationKey;

// navVerbKey가 반환할 수 있는 닫힌 집합 — log-viewer 복제 사전 커버리지 테스트용.
export const NAV_VERB_KEYS: readonly TranslationKey[];
```

```ts
// src/sidepanel/components/ActionLogContent.tsx
export function KindIcon({ kind, navType }: {
  kind: ActionEntryKind;
  navType?: ActionEntry["navType"];  // optional — 기존 호출부 호환
}): ReactNode;
```

### i18n 키 (4개 × ko/en × 사전 2벌 = 16 엔트리, 현재 로케일 2개 기준)

| 키 | ko | en |
|---|---|---|
| `actionLog.verb.navigateBack` | `{target}(으)로 뒤로가기` | `Went back to {target}` |
| `actionLog.verb.navigateForward` | `{target}(으)로 앞으로가기` | `Went forward to {target}` |
| `actionLog.verb.navigateReload` | `{target} 새로고침` | `Reloaded {target}` |
| `actionLog.verb.navigateTraverse` | `{target}(으)로 히스토리 이동` | `Navigated via history to {target}` |

슬롯은 기존 `actionLog.verb.navigate`와 동일하게 `{target}` 하나뿐이어야 한다 — `markers.ts`의 `splitTemplate` 경로가 슬롯 **전부**를 파랗게 칠하므로 슬롯이 2개면 조용히 둘 다 URL 색이 된다.

## 기존 패턴 준수

- **pre-arm 동기 IIFE 제약**: 판정 함수는 `src/content/` 안에만 둔다. 밖을 import하면 recorders-entry가 async loader로 강등돼 pre-arm이 죽는다 — 빌드·typecheck·유닛이 전부 green인 채로. `pnpm build:e2e && pnpm check:prearm dist-e2e`가 1차 그물, `e2e/logs-prearm.spec.ts`가 행동 그물.
- **MAIN world 전역 스냅샷**: `window.navigation`·`performance` 둘 다 `recorder-globals.ts`의 기존 원칙(페이지가 갈아끼울 수 있는 것은 document_start에 떼어 둔다)을 따른다.
- **사전 2벌 동시 갱신**: `src/i18n/namespaces/logs.ts`와 `src/log-viewer/i18n.ts`는 값까지 일치해야 한다.
- **로케일 테이블 분류 불필요**: 새로 만드는 건 일반 사전 키뿐이고 `Record<LocaleMode, …>` 테이블이 아니다.
- **표시 문구 단일 출처**: 목록과 타임라인이 `navVerbKey`를 공유한다 — `splitTemplate` 선례와 같은 구조(POSTMORTEM 2026-07-03의 재발방지 처방).
- **`data-*` 관측 표면**: `data-drag-target` 선례대로 e2e 판정용 속성을 행에 단다.
- **타입 확장은 additive**: 액션 로그는 IndexedDB에 저장된 초안에도 실리므로, 구 값이 남아도 렌더가 폴백으로 살아야 한다. 마이그레이션은 두지 않는다.

## 대안 검토

### A. background `webNavigation.onCommitted`의 `transitionQualifiers` (기각)

`src/background/index.ts`가 이미 `onCommitted`를 듣고 있고 `details.transitionQualifiers`에 `"forward_back"`이, `transitionType`에 `"reload"`가 온다. 특권 API라 페이지 조작에 영향받지 않는 게 장점이다.

기각 이유: 그 신호를 액션 항목으로 만들려면 background → MAIN world 버퍼로 밀어 넣어야 하는데, `onCommitted`와 새 문서의 document_start 사이 **순서가 보장되지 않는다.** 실제로 그 핸들러는 `Promise.all([tabs.get, storage.session.get])` 뒤에 메시지를 쏘므로 지연이 관측 가능하다. 잘못 붙으면 이전 문서의 버퍼에 들어가거나 순번이 어긋난다. 같은 정보를 도착 문서 안에서 동기적으로, 순서 문제 없이 얻을 수 있으므로 크로스-월드 왕복을 지불할 이유가 없다. **또 이 경로는 top frame(`frameId === 0`)만 커버해 iframe traverse를 놓친다.**

### B. Navigation API `navigate` 이벤트로 방향까지 (부분 기각 — PRD 비목표)

`navigation.addEventListener("navigate", …)`는 cross-document 이동에서도 `navigationType`과 `destination.index`를 줘서, 떠나는 페이지에서 방향을 기록할 수 있다. 하지만 그 항목이 사이드패널까지 살아나가려면 `pagehide` flush 또는 `onBeforeNavigate` sync를 타야 하고, 놓치면 값이 **무음으로 사라진다**(로그가 틀리는 게 아니라 조용히 덜 정확해진다 — 진단이 어려운 실패 모드다). 도착 문서 판정은 그런 타이밍 의존이 없다. 방향 손실은 문서 재로드 경로에 한정되므로 그 손실을 받는다.

### C. `popstate` 시점 휴리스틱 (기각)

`history.back()`/`go()`를 패치하고, 직전에 그런 호출이 없었으면 "브라우저 UI 뒤로가기"로 추정하는 방식. 타이밍 창에 의존하고 앞으로/뒤로를 여전히 못 가른다. 인덱스 델타가 더 단순하고 정확하다.

### D. `navigate` 이벤트로 SPA 방향 판정 (기각 — B의 same-document 판)

같은 정보를 `popstate` + 히스토리 인덱스로 얻을 수 있고, 그쪽은 페이지 네비게이션에 개입할 여지가 원리적으로 없다(`navigate` 리스너는 `intercept()` 호출로 페이지 라우팅을 가로챌 수 있는 표면이라 ARCHITECTURE.md "페이지 무간섭" 불변식과 충돌한다). 이미 존재하는 `popstate` 리스너에 몇 줄을 더하는 쪽이 외과적이다.

### E. `pageshow(persisted)`로 bfcache 항목 남기기 (기각 — PRD 비목표)

항목 자체는 만들 수 있으나 (1) `recording=true`라 pre-arm 예외 마커가 안 붙어 cross-origin 복귀에서 `shouldDropPreArmEntry`에 폐기되고, (2) `capturing=false`면 `pushAction`이 조기 반환하며, (3) 복원 페이지는 콘솔 래핑이 풀린 상태라 항목만 남기면 "수집 중"으로 오독된다. (4) `pageshow`는 모든 프레임에 발화해 iframe N개면 N+1 항목이 된다. 넷을 함께 풀어야 의미가 있어 별건으로 뺐다.

## 위험 요소

1. **조기 반환 가드 2개**(`fromUrl === toUrl`, `entryNavEmitted` 래치)가 이 기능의 주된 무음 실패 지점이다. 전자는 새로고침 항목을 통째로 삼키고, 후자는 새로고침 진입에서 중복 항목을 만든다. 둘 다 **유닛으로 잡히지 않는다**(레코더 본문은 브라우저 바인딩) — e2e가 유일한 그물이다.
2. **중복을 흡수할 하류 장치가 없다.** `mergeLogItems`는 `id`만으로 dedup하고 액션 경로에 타임윈도·collapse가 없다. `entryNavEmitted` 래치 확장이 **유일한 방어**다.
3. **`logClear`가 새 문서 MAIN 버퍼까지 지운다** — 위 "clear가 의도를 실어 나른다"가 이 위험의 처방이다. **다만 경합의 한쪽 순서만 덮는다** — 래치 리셋 자체는 항목을 만들지 않고, 보충은 `setSentinel` 본문 안에만 있기 때문이다.
   - clear가 `setSentinel`보다 **먼저**: 버퍼 비움 → 래치 false → 뒤이은 `setSentinel`이 보충 → **복구된다.**
   - `setSentinel`이 **먼저**: 보충분이 버퍼에 들어가 flush가 예약되고, clear의 `clearBuffer()` + `throttle.cancel()`이 둘 다 날린다. 래치는 내려가지만 **다음 재arm이 올 때까지 아무도 다시 만들지 않는다** → 기존과 동일하게 유실.
   - 실사용의 지배적 순서는 `onCommitted`(→`logClear`)가 `onUpdated status==="complete"`(→`inject`→`setSentinel`)보다 앞서므로 앞쪽이고, 그래서 처방이 값을 한다. 역순은 **수용된 잔여 위험**이다 — E3가 실측할 자리.
4. **reload는 (일부 phase에서) 로그를 클리어한다.** 그래서 reload 항목은 pre-arm 버퍼를 타고 **클리어 이후에** 도착해야 보인다. pre-arm이 죽으면(청크 강등) 이 항목이 조용히 사라진다 — `check:prearm`을 반드시 태운다.
5. **`performance.getEntriesByType("navigation")[0]`이 document_start에 존재하는지 실측 전이다.** 스펙상 문서 생성 시 엔트리가 큐잉되지만 코드베이스에 선례가 0건이다. `entryNavType`이 레거시 `performance.navigation.type`(0/1/2)도 받게 해 폴백을 둔다 — 실측은 Task 3 e2e에서 확인한다.
6. **`window.navigation` 타입 부재**: TS lib.dom에 Navigation API 타입이 없다(`declare var navigation`도 없어 `typeof navigation !== "undefined"` 형태는 컴파일되지 않는다). `recorder-globals.ts`에서 `globalThis` 캐스팅 + 최소 구조적 타입으로 선언하고 `any`를 흘리지 않는다.
7. **`NavigationHistoryEntry.index`의 -1**: 엔트리 리스트 밖이면 -1이 온다. 유한수라 "유한한 수가 아니면 null" 게이트를 통과해 `(3, -1)` → `"back"` 오판이 된다. `traverseDirection`이 음수·비정수를 명시적으로 거부해야 한다.
8. **해시 라우팅 인덱스 드리프트**: `<a href="#x">`가 `popstate` 없이 인덱스를 올린다. 미러 변수 방식이면 HashRouter 앱 전체가 기능 밖으로 떨어진다 — "매 판정 시점에 읽는다"가 이 위험의 처방이다.
9. **사전 누락**: log-viewer 사전은 PostToolUse 훅 matcher 밖이고, 동적 키라 리터럴 스캐너도 우회한다. 닫힌 집합 상수 + 전용 테스트가 그물이다.
10. **e2e 관측 경로가 flaky 이력을 가진다**: 액션 엔트리 판정은 캡처 → 로그 미리보기 다이얼로그 경로뿐이고, `e2e/GOTCHAS.md`가 `captureVisibleTab` cold-start·quota 이유로 캡처 진입 spec 5개를 삭제한 이력을 남겼다. `mode-freeform` 진입 + `[data-entry-id]:visible` 스코프(3탭 forceMount)로 쓴다.
11. **개인정보 문서 영향**: 새 권한·새 전송 경로는 없지만, 기록되는 정보가 "페이지 이동"에서 "사용자의 히스토리 조작 방식"으로 세분화된다. `docs/privacy.{ko,en}.md`의 액션 로그 상세 서술과 수집 항목 표를 갱신 대상으로 본다.
