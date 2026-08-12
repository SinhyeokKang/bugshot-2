# 액션 로그 네비게이션 유형 판별 — 기술 설계

## 개요

판정 소스를 **두 갈래**로 나눈다. 문서가 새로 실행되는 경로(최초 로드·새로고침·문서 재로드 traverse)는 도착 문서의 `PerformanceNavigationTiming.type` 하나로 판정하고, 같은 문서 안에서 히스토리를 오가는 경로(SPA traverse)는 `popstate` 시점에 Navigation API의 `currentEntry.index` 델타로 **방향까지** 판정한다. bfcache 복원은 어느 쪽에도 안 걸리므로 `pageshow`(`persisted`) 후크를 따로 둔다.

판정 자체는 전부 **순수 함수 2개**로 뽑아 `action-recorder-helpers.ts`에 두고 유닛으로 고정한다. 레코더 본문에는 "무엇을 읽어 그 함수에 넘기는가"만 남는다. 표시 문구 선택도 순수 함수 1개(`navVerbKey`)로 뽑아 사이드패널 탭과 log-viewer 타임라인이 **같은 출처**를 쓰게 한다.

## 변경 범위

### `src/types/action.ts` — 타입 단일 출처

- 현재 역할: `ActionEntry.navType`이 `"load" | "pushState" | "replaceState" | "popstate" | "hashchange"`(`:35`).
- 변경: 유니온에 `"reload" | "traverse" | "back" | "forward"` 추가. 기존 5개는 **그대로 남긴다**(구 로그 하위호환 + Navigation API 실패 시 `popstate` 폴백).

### `src/content/action-recorder.ts` — 판정 지점

- 현재 역할: MAIN world 액션 레코더. document_start에 `recordNavigation("load", …)`(`:580`), `pushState`/`replaceState` 패치(`:584`–`:597`), `popstate`/`hashchange` 리스너(`:598`–`:604`).
- 변경 4곳:
  1. 내부 `type NavType` 미러(`:34`)를 `types/action.ts`와 동일하게 확장.
  2. 진입 판정: `recordNavigation("load", …)`(`:580`) → `entryNavType(...)` 결과를 넘긴다. 결과를 모듈 스코프 `entryType` 상수로 잡아두고 `setSentinel`의 보충 경로(`:661`)에서도 **같은 값**을 쓴다 — 여기서 `"load"`를 하드코딩한 채 두면 pre-arm이 놓친 새로고침이 일반 이동으로 강등된다.
  3. `popstate` 리스너(`:598`): `navigation.currentEntry.index`를 읽어 `traverseDirection(lastNavIndex, idx)`로 방향을 얻고, `null`이면 기존 `"popstate"`로 폴백. 인덱스는 `pushState`/`replaceState` 패치와 `popstate` 양쪽에서 갱신한다.
  4. `pageshow` 리스너 신설: `persisted === true`일 때만 `recordNavigation("traverse", location.href, location.href)`.
- **두 개의 조기 반환 가드를 함께 넓혀야 한다.** 놓치면 기능이 무음으로 죽는다:
  - `recordNavigation`의 `if (navType !== "load" && fromUrl === toUrl) return;`(`:308`) — 새로고침은 `document.referrer`가 비어 `fromUrl === toUrl`이 되기 쉽고, bfcache traverse는 정의상 항상 같다. **둘 다 여기서 버려진다.** 조건을 "문서 진입 계열(`load`/`reload`/`traverse`)이면 통과"로 바꾼다.
  - `if (navType === "load" && capturing) entryNavEmitted = true;`(`:321`) — 같은 진입 계열 집합으로 넓힌다. 안 넓히면 새로고침 진입 후 `setSentinel`이 `load` 항목을 한 번 더 합성해 **중복**이 생긴다.

### `src/content/action-recorder-helpers.ts` — 판정 순수 함수 (신규 2개)

- 현재 역할: 레코더가 쓰는 순수 헬퍼 모음. `entryNavOnBind`(`:71`)가 같은 성격(네비게이션 결정)의 선례다.
- 변경: `entryNavType` / `traverseDirection` 추가. **`src/content/` 밖을 import하지 않는다** — 이 파일은 recorders-entry 청크에 인라인되고, 밖을 물면 `scripts/check-prearm-chunk.mjs`가 막는다(막지 못하면 pre-arm이 조용히 죽는다).

### `src/content/recorder-globals.ts` — 전역 스냅샷

- 현재 역할: 페이지가 갈아끼울 수 있는 내장(`JSON.parse`, `CustomEvent`, `EventTarget.prototype.*`)을 document_start에 스냅샷.
- 변경: `window.navigation` 참조를 같은 방식으로 스냅샷해 export. 페이지가 나중에 덮어써도 레코더는 원본을 본다.
- **선행 의존**: 이 파일은 아직 커밋되지 않은 audit-refactor-3 작업물이다. 그 작업이 dev에 들어간 뒤 착수한다(tasks.md "선행 조건").

### `src/sidepanel/lib/actionInline.ts` — 문구 키 단일 출처 (신규 1개)

- 현재 역할: 액션 렌더를 두 표면이 공유하기 위한 순수 헬퍼(`splitTemplate`·`resolveClickTarget`·`actionSearchText`). log-viewer의 `markers.ts:6`이 이미 여기서 `splitTemplate`을 끌어간다.
- 변경: `navVerbKey(navType)` 추가 — `navType`을 i18n 키로 매핑. 탭과 타임라인이 이걸 공유해 문구가 갈라지지 않게 한다.

### `src/sidepanel/components/ActionLogContent.tsx` — 로그 탭 렌더

- 현재 역할: 액션 로그 탭. `KindIcon`(`:45`)이 kind별 아이콘, `renderActionContent`(`:126`)가 kind별 문구.
- 변경 2곳:
  - `KindIcon` props에 `navType?` 추가(선택 필드라 기존 호출부와 호환). `navigation`이면서 `back`/`forward`/`reload`/`traverse`면 `ArrowLeft`/`ArrowRight`/`RotateCw`/`RotateCw`, 그 외엔 기존 `MapPin`. 색은 `TONE_TEXT.blue` 유지.
  - `renderActionContent`의 `navigation` 케이스(`:146`)가 `navVerbKey(entry.navType)`로 키를 고른다. 슬롯(`{target}`)과 `InlineLink` 구조는 그대로.
- 호출부 2곳(`ActionLogContent.tsx:324`, `log-viewer/components/TimelineRow.tsx:58`) 모두 entry를 들고 있으므로 `navType={entry.navType}` 한 줄씩 추가.

### `src/log-viewer/markers.ts` — 타임라인 마커 라벨

- 현재 역할: 타임라인 마커 생성. `navigation` 케이스(`:115`)가 `t("actionLog.verb.navigate")`로 label과 labelParts(슬롯만 파랑)를 만든다.
- 변경: 그 키를 `navVerbKey(e.navType)`로 교체. `variant = "navigate"`와 `splitTemplate` 구조는 유지.

### `src/i18n/namespaces/logs.ts` + `src/log-viewer/i18n.ts` — 사전 2벌

- 현재 역할: 전자가 사이드패널 사전, 후자가 log-viewer 전용 **복제 사전**.
- 변경: 신규 키 4개를 ko/en × 2파일 = **16개 엔트리**로 동시 추가. 값도 동일해야 한다 — `src/log-viewer/__tests__/i18n.test.ts`가 메인 테이블과의 값 일치까지 대조한다.
- i18n PostToolUse 훅은 `*src/i18n/*` matcher라 **log-viewer 사전에는 안 걸린다.** 그쪽 누락은 `pnpm test`에서만 잡힌다.

### `src/sidepanel/lib/buildLogSummary.ts` — AI 프롬프트용 요약

- 현재 역할: `buildActionLogSummary`가 `navigation`을 `Navigated to: {toUrl}`로(`:85`).
- 변경: 유형별 영문 문구로 분기(`Went back to:` / `Went forward to:` / `Reloaded:` / `Navigated (history) to:`). **이 함수는 로케일 무관 영어 고정**이 기존 규칙이므로 i18n을 끌어오지 않는다.

### 무변경 확인

- `src/sidepanel/lib/buildActionLogJson.ts:21` — `navType`을 그대로 통과시켜 새 값이 자동으로 실린다.
- `src/lib/navigation-clear.ts` — 클리어 정책 불변.
- `src/background/index.ts` — `webNavigation` 경로 불변.
- `ACTION_FILTERS`·`actionSearchText`·30s Replay 트림(`trim-markers.ts`) — 불변.

## 데이터 흐름

```
[문서 진입 — 최초/새로고침/문서 재로드 traverse]
  document_start (MAIN world, recorders-entry 동기 IIFE)
    performance.getEntriesByType("navigation")[0].type
      "reload"       → entryNavType → "reload"
      "back_forward" → entryNavType → "traverse"
      그 외/부재      → entryNavType → "load"
    → recordNavigation(entryType, referrer||lastUrl, location.href)
    → buffer (pre-arm이면 sentinel 전에도 적재)
    → setSentinel 시 entryNavOnBind 보충도 같은 entryType 사용

[SPA traverse — 같은 문서]
  popstate
    navigation.currentEntry.index (recorder-globals 스냅샷 경유)
    traverseDirection(lastNavIndex, idx)
      idx < last → "back"
      idx > last → "forward"
      판정 불가   → null → "popstate" 폴백
    → recordNavigation(dir ?? "popstate", lastUrl, location.href)

[bfcache 복원]
  pageshow(persisted=true) → recordNavigation("traverse", href, href)

[공통 하류 — 기존 경로 그대로]
  throttle → CustomEvent(__bugshot_action_data__<sentinel>)
    → recorder-bridge (ISOLATED) → 사이드패널 log-merge
    → ActionLogContent / markers.ts / buildActionLogJson / buildLogSummary
```

`lastNavIndex` 갱신 지점은 셋이다: 초기화 시 1회, `pushState`/`replaceState` 패치 안, `popstate` 처리 끝.

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
// 액션 로그 navType으로. 값이 없거나 모르는 값이면 "load"(기존 동작 유지).
export function entryNavType(perfType: string | undefined): "load" | "reload" | "traverse";

// same-document traverse 방향. Navigation API 히스토리 인덱스 델타의 부호.
// 둘 중 하나라도 유한한 수가 아니거나 델타가 0이면 null(→ 호출부가 "popstate"로 폴백).
export function traverseDirection(
  fromIndex: number | undefined,
  toIndex: number | undefined,
): "back" | "forward" | null;
```

```ts
// src/content/recorder-globals.ts
// 히스토리 인덱스만 읽는다 — 페이지가 window.navigation을 덮어쓸 수 있어 document_start에 스냅샷.
export const navigationRef: { currentEntry?: { index?: number } } | undefined;
```

```ts
// src/sidepanel/lib/actionInline.ts
// navigation 항목의 i18n 동사 키. 구 값·미상은 기존 "actionLog.verb.navigate"로 폴백한다.
export function navVerbKey(navType: ActionEntry["navType"]): string;
```

```ts
// src/sidepanel/components/ActionLogContent.tsx
export function KindIcon({ kind, navType }: {
  kind: ActionEntryKind;
  navType?: ActionEntry["navType"];  // optional — 기존 호출부 호환
}): ReactNode;
```

### i18n 키 (4개 × ko/en × 사전 2벌)

| 키 | ko | en |
|---|---|---|
| `actionLog.verb.navigateBack` | `{target}(으)로 뒤로가기` | `Went back to {target}` |
| `actionLog.verb.navigateForward` | `{target}(으)로 앞으로가기` | `Went forward to {target}` |
| `actionLog.verb.navigateReload` | `{target} 새로고침` | `Reloaded {target}` |
| `actionLog.verb.navigateTraverse` | `{target}(으)로 히스토리 이동` | `Navigated history to {target}` |

슬롯은 기존 `actionLog.verb.navigate`와 동일하게 `{target}` 하나뿐이어야 한다 — `markers.ts`의 `splitTemplate` 경로가 슬롯 1개를 전제로 URL만 파랗게 칠한다.

## 기존 패턴 준수

- **pre-arm 동기 IIFE 제약**: 판정 함수는 `src/content/` 안에만 둔다. 밖을 import하면 recorders-entry가 async loader로 강등돼 pre-arm이 죽는다 — 빌드·typecheck·유닛이 전부 green인 채로. `pnpm build && pnpm check:prearm`이 1차 그물, `e2e/logs-prearm.spec.ts`가 행동 그물.
- **MAIN world 전역 스냅샷**: `window.navigation`도 `recorder-globals.ts`의 기존 원칙(페이지가 갈아끼울 수 있는 것은 document_start에 떼어 둔다)을 따른다.
- **사전 2벌 동시 갱신**: `src/i18n/namespaces/logs.ts`와 `src/log-viewer/i18n.ts`는 값까지 일치해야 한다.
- **로케일 테이블 분류 불필요**: 새로 만드는 건 일반 사전 키뿐이고 `Record<LocaleMode, …>` 테이블이 아니다.
- **표시 문구 단일 출처**: 탭과 타임라인이 `navVerbKey`를 공유한다 — `splitTemplate` 선례와 같은 구조.
- **타입 확장은 additive**: 액션 로그는 IndexedDB에 저장된 초안에도 실리므로, 구 값이 남아도 렌더가 폴백으로 살아야 한다. 마이그레이션은 두지 않는다.

## 대안 검토

### A. background `webNavigation.onCommitted`의 `transitionQualifiers` (기각)

`src/background/index.ts:137`이 이미 `onCommitted`를 듣고 있고 `details.transitionQualifiers`에 `"forward_back"`이, `transitionType`에 `"reload"`가 온다. 특권 API라 페이지 조작에 영향받지 않는 게 장점이다.

기각 이유: 그 신호를 액션 항목으로 만들려면 background → MAIN world 버퍼로 밀어 넣어야 하는데, `onCommitted`와 새 문서의 document_start 사이 **순서가 보장되지 않는다.** 잘못 붙으면 이전 문서의 버퍼에 들어가거나 순번이 어긋난다. 같은 정보를 도착 문서 안에서 `PerformanceNavigationTiming`으로 동기적으로, 순서 문제 없이 얻을 수 있으므로 크로스-월드 왕복을 지불할 이유가 없다. **또 이 경로는 top frame(`frameId === 0`)만 커버해 iframe traverse를 놓친다.**

### B. Navigation API `navigate` 이벤트로 방향까지 (부분 기각 — PRD 비목표)

`navigation.addEventListener("navigate", …)`는 cross-document 이동에서도 `navigationType`과 `destination.index`를 줘서, 떠나는 페이지에서 방향을 기록할 수 있다. 하지만 그 항목이 사이드패널까지 살아나가려면 `pagehide` flush 또는 `onBeforeNavigate` sync를 타야 하고, 놓치면 값이 **무음으로 사라진다**(로그가 틀리는 게 아니라 조용히 덜 정확해진다 — 진단이 어려운 실패 모드다). 도착 문서 판정은 그런 타이밍 의존이 없다. 방향 손실은 문서 재로드 경로에 한정되므로 그 손실을 받는다.

### C. `popstate` 시점 휴리스틱 (기각)

`history.back()`/`go()`를 패치하고, 직전에 그런 호출이 없었으면 "브라우저 UI 뒤로가기"로 추정하는 방식. 타이밍 창에 의존하고 앞으로/뒤로를 여전히 못 가른다. 인덱스 델타가 더 단순하고 정확하다.

### D. `navigate` 이벤트로 SPA 방향 판정 (기각 — B의 same-document 판)

같은 정보를 `popstate` + `currentEntry.index`로 얻을 수 있고, 그쪽은 페이지 네비게이션에 개입할 여지가 원리적으로 없다(`navigate` 리스너는 `intercept()` 호출로 페이지 라우팅을 가로챌 수 있는 표면이다). 이미 존재하는 `popstate` 리스너에 몇 줄을 더하는 쪽이 외과적이다.

## 위험 요소

1. **조기 반환 가드 2개**(`action-recorder.ts:308`, `:321`)가 이 기능의 주된 무음 실패 지점이다. `fromUrl === toUrl` 가드는 새로고침·bfcache 항목을 통째로 삼키고, `entryNavEmitted` 가드는 새로고침 진입에서 중복 항목을 만든다. 둘 다 **유닛으로 잡히지 않는다**(레코더 본문은 브라우저 바인딩) — e2e가 유일한 그물이다.
2. **reload는 로그를 클리어한다**(`shouldClearLogs`). 그래서 reload 항목은 pre-arm 버퍼를 타고 **클리어 이후에** 도착해야 보인다. pre-arm이 죽으면(청크 강등) 이 항목이 조용히 사라진다 — `check:prearm`을 반드시 태운다.
3. **`window.navigation` 타입 부재 가능성**: TS lib.dom에 Navigation API 타입이 없을 수 있다. `recorder-globals.ts`에서 최소 구조적 타입으로 선언하고 `any`를 흘리지 않는다.
4. **`pageshow` 중복**: `pageshow`는 최초 로드에서도 `persisted === false`로 발화한다. 가드를 빠뜨리면 모든 페이지 로드에서 `load` + `traverse` 두 항목이 겹친다.
5. **`hashchange`/`popstate` 이중 발화**: 해시 traverse에서 둘 다 뜬다. 기존 `fromUrl === toUrl` dedup에 의존하는데, 위 1번에서 그 가드를 건드리므로 **해시 뒤로가기 회귀를 e2e로 확인**한다.
6. **사전 누락**: log-viewer 사전은 PostToolUse 훅 matcher 밖이라 저장 시점에 안 잡힌다. `pnpm test`까지 가야 드러난다.
7. **선행 의존**: `recorder-globals.ts`는 미커밋 audit-refactor-3 산출물이다. 그게 dev에 들어가기 전에 착수하면 파일 충돌이 난다.
8. **개인정보 문서 영향**: 새 권한·새 전송 경로는 없지만, 기록되는 정보가 "페이지 이동"에서 "사용자의 히스토리 조작 방식"으로 세분화된다. `docs/privacy.{ko,en}.md`의 액션 로그 상세 서술(ko 기준 `:70`)과 수집 항목 표(`:53`)를 갱신 대상으로 본다.
