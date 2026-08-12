# 액션 로그 네비게이션 유형 판별 — 구현 태스크

## 선행 조건

- **audit-refactor-3이 dev에 커밋된 뒤 착수한다.** `src/content/recorder-globals.ts`·`sentinel-registry.ts`가 아직 untracked이고 `action-recorder.ts`가 106줄 미커밋 상태다. Task 2·3이 그 두 파일을 직접 건드리므로 먼저 들어가야 충돌이 없다.
- 새 권한·새 env·새 의존성 없음. manifest 변경 없음.
- `pnpm build:log-viewer`가 한 번은 돌아 있어야 한다(`dist-log-viewer/index.html`이 없으면 테스트 3개가 ENOENT로 죽는다 — `pnpm test`의 pre-훅이 자동 처리).

## 태스크

### Task 1: 판정 순수 함수 + 타입 확장

- **변경 대상**: `src/content/action-recorder-helpers.ts`, `src/types/action.ts`, `src/content/action-recorder.ts:34`(내부 NavType 미러)
- **작업 내용**:
  - `entryNavType(perfType)` 추가 — `"reload"` → `"reload"`, `"back_forward"` → `"traverse"`, 그 외/`undefined` → `"load"`.
  - `traverseDirection(fromIndex, toIndex)` 추가 — 유한한 수 2개일 때만 부호로 `"back"`/`"forward"`, 델타 0이거나 판정 불가면 `null`.
  - `ActionEntry.navType` 유니온에 `"reload" | "traverse" | "back" | "forward"` 추가. 기존 5개 유지.
  - `action-recorder.ts`의 내부 `type NavType`을 동일하게 확장.
  - **`src/content/` 밖 import를 추가하지 않는다.**
- **검증**:
  - [ ] `pnpm test` — 신규 유닛(아래 테스트 계획 U1·U2) green
  - [ ] `pnpm typecheck` 통과

### Task 2: `window.navigation` 전역 스냅샷

- **변경 대상**: `src/content/recorder-globals.ts`
- **작업 내용**: 히스토리 인덱스만 읽는 최소 구조적 타입(`{ currentEntry?: { index?: number } }`)으로 `navigationRef` export. document_start 모듈 평가 시점에 떼어 둔다. `any` 노출 금지.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (lib.dom에 Navigation 타입이 없어도 컴파일)
  - [ ] 이 파일이 `src/content/` 밖을 import하지 않음 — 수동 확인

### Task 3: 레코더 판정 지점 배선

- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**:
  1. 모듈 초기화에서 `entryNavType(performance.getEntriesByType("navigation")[0]?.type)`을 1회 계산해 `entryType` 상수로 보관.
  2. `:580`의 `recordNavigation("load", …)` → `recordNavigation(entryType, …)`.
  3. `setSentinel`의 보충 경로 `:661`도 `"load"` 대신 같은 `entryType`.
  4. `recordNavigation`의 조기 반환(`:308`)을 진입 계열(`load`/`reload`/`traverse`) 통과로 확장.
  5. `entryNavEmitted` 세팅 조건(`:321`)을 같은 진입 계열 집합으로 확장.
  6. `lastNavIndex` 추적 — 초기화 1회 + `pushState`/`replaceState` 패치 안 + `popstate` 처리 끝.
  7. `popstate` 리스너(`:598`)가 `traverseDirection` 결과를 쓰고, `null`이면 `"popstate"` 폴백.
  8. `pageshow` 리스너 신설 — `persisted === true`일 때만 `recordNavigation("traverse", location.href, location.href)`. `addEventListener`는 `recorder-globals` 것을 쓴다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm build && pnpm check:prearm` — recorders-entry가 동기 IIFE·world=MAIN·document_start 유지
  - [ ] Task 6 e2e green (이 태스크의 실질 검증은 e2e뿐 — 레코더 본문은 유닛 불가)

### Task 4: 문구 키 단일 출처 + 사전 2벌

- **변경 대상**: `src/sidepanel/lib/actionInline.ts`, `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts`
- **작업 내용**:
  - `navVerbKey(navType)` 추가 — `back`/`forward`/`reload`/`traverse` → 신규 키 4개, 그 외 전부 `"actionLog.verb.navigate"` 폴백.
  - 신규 키 4개를 ko/en × 사전 2벌 = 16 엔트리로 추가(값은 design.md 표 그대로). 슬롯은 `{target}` 하나만.
- **검증**:
  - [ ] `pnpm test` — `src/i18n/__tests__/locales.test.ts`(키 대칭·placeholder) green
  - [ ] `pnpm test` — `src/log-viewer/__tests__/i18n.test.ts`(ko/en 대칭 + 메인 테이블 값 일치) green
  - [ ] 신규 유닛 U3 green

### Task 5: 표시 분기 (탭 + 타임라인 + AI 요약)

- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`, `src/log-viewer/components/TimelineRow.tsx`, `src/log-viewer/markers.ts`, `src/sidepanel/lib/buildLogSummary.ts`
- **작업 내용**:
  - `KindIcon`에 `navType?` prop 추가 → `back`=`ArrowLeft`, `forward`=`ArrowRight`, `reload`·`traverse`=`RotateCw`, 그 외 기존 `MapPin`. 색 `TONE_TEXT.blue` 유지. lucide-react 기존 의존성만 쓴다.
  - 호출부 2곳(`ActionLogContent.tsx:324`, `TimelineRow.tsx:58`)에 `navType={…}` 전달.
  - `renderActionContent`의 `navigation` 케이스(`:146`)와 `markers.ts`의 `navigation` 케이스(`:115`)가 `navVerbKey`로 키 선택. `splitTemplate`/`InlineLink`/`variant="navigate"` 구조 유지.
  - `buildActionLogSummary`(`:85`)의 navigation 분기를 유형별 영문 문구로. **i18n을 끌어오지 않는다**(이 함수는 영어 고정이 기존 규칙).
- **검증**:
  - [ ] `pnpm test` — `markers.test.ts` 기존 케이스 green(구 `load` 항목이 기존 문구 유지) + 신규 유닛 U4
  - [ ] `pnpm typecheck` 통과
  - [ ] `ACTION_FILTERS`·검색(`actionSearchText`)이 변경되지 않았음을 확인

### Task 6: e2e

- **변경 대상**: `e2e/action-log-nav-type.spec.ts`(신규)
- **작업 내용**: `e2e/logs-cross-page.spec.ts`의 픽스처 패턴(`enterDebug` → 서브탭 → 레코더 활성화 polling)을 따른다. 아래 E1–E5.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` — 신규 spec green
  - [ ] `e2e/logs-prearm.spec.ts`·`logs-cross-page.spec.ts` 기존 spec 회귀 없음

### Task 7: 문서 갱신

- **변경 대상**: `docs/privacy.ko.md`, `docs/privacy.en.md`
- **작업 내용**: 액션 로그 상세 서술(ko `:70`)과 수집 항목 표(ko `:53`)의 "페이지 이동"에 뒤로가기·앞으로가기·새로고침 구분이 기록됨을 반영. **ko가 원본, en은 번역 — 양쪽 본문과 상단 시행일을 함께 갱신.**
- **검증**:
  - [ ] ko/en 본문이 같은 내용을 말하는지 대조
  - [ ] 시행일 bump 반영
  - [ ] `docs/ARCHITECTURE.md`에 레코더 관련 불변식 섹션이 있으면 판정 소스 2갈래를 한 줄 추가 (없으면 스킵)

## 테스트 계획

### 단위 테스트

- **U1 `entryNavType`** (`src/content/__tests__/action-recorder-helpers.test.ts`)
  - `"reload"` → `"reload"` / `"back_forward"` → `"traverse"` / `"navigate"` → `"load"` / `"prerender"` → `"load"` / `undefined` → `"load"` / 모르는 문자열 → `"load"`
- **U2 `traverseDirection`** (같은 파일)
  - `(3, 2)` → `"back"` / `(2, 3)` → `"forward"` / `(2, 2)` → `null` / `(undefined, 2)` → `null` / `(2, undefined)` → `null` / `(NaN, 2)` → `null`
- **U3 `navVerbKey`** (`src/sidepanel/lib/__tests__/actionInline.test.ts`)
  - 신규 4종이 각 전용 키로 / `"load"`·`"popstate"`·`"pushState"`·`undefined`가 전부 `"actionLog.verb.navigate"`로 폴백
- **U4 `markers.ts` navigation 라벨** (`src/log-viewer/__tests__/markers.test.ts`)
  - `navType: "back"` 엔트리의 label이 `t("actionLog.verb.navigateBack", { target: url })`와 일치
  - `labelParts`의 슬롯 토큰만 `TONE_TEXT.blue`(기존 케이스와 동형)
  - `navType` 없는 엔트리가 기존 문구 유지 — **기존 테스트가 그대로 통과해야 한다**
- **U5 `buildActionLogSummary`** (`src/sidepanel/lib/__tests__/buildLogSummary.test.ts`가 있으면 추가)
  - 유형별 영문 문구 4종 + 구 값 폴백

### e2e 시나리오 (`/e2e-write` 입력)

- **E1** — SPA에서 `history.pushState`로 경로를 바꾼 뒤 `page.goBack()`을 하면 액션 로그에 "뒤로가기" 문구 항목이 뜬다.
- **E2** — E1 직후 `page.goForward()`를 하면 "앞으로가기" 문구 항목이 뜬다.
- **E3** — `page.reload()` 후 액션 로그가 클리어되고, 남은 첫 항목이 "새로고침" 문구다.
- **E4** — same-origin 멀티페이지에서 A→B 이동 후 `page.goBack()`(문서 재로드)을 하면 "히스토리 이동" 문구 항목이 뜨고, 이전 페이지 로그가 보존된다.
- **E5** — 해시 링크로 이동 후 `page.goBack()`을 하면 네비게이션 항목이 **1개만** 생긴다(popstate+hashchange 이중 발화 dedup 회귀 방지).

> E1·E2용 픽스처가 필요하면 `e2e/fixtures/`에 pushState 버튼이 있는 페이지를 추가한다. E4는 기존 `basic.html`/`second.html`로 충분하다.

### 수동 테스트 (Chrome, 자동화 불가)

- [ ] **bfcache 복원** — Playwright에서 bfcache 히트를 신뢰성 있게 유도하기 어렵다. 실탭에서 A→B 이동 후 뒤로가기로 A가 bfcache 복원될 때 "히스토리 이동" 항목이 1개 생기고, 일반 로드에서는 중복 항목이 안 생기는지 확인.
- [ ] **iframe traverse** — cross-origin iframe 내부에서 뒤로가기 시 항목이 생기고 origin 필터로 구분되는지.
- [ ] **아이콘 시각 정합** — `ArrowLeft`/`ArrowRight`/`RotateCw`가 기존 `MapPin`과 같은 시각 무게로 보이는지(다크모드 포함).
- [ ] **cross-origin 뒤로가기** — 로그가 클리어된 뒤 traverse 항목이 첫 항목으로 남는지.

## 구현 순서 권장

```
Task 1 (판정 함수 + 타입)
   ├─→ Task 2 (전역 스냅샷) ─→ Task 3 (레코더 배선) ─┐
   └─→ Task 4 (문구 키 + 사전) ─→ Task 5 (표시 분기) ─┴─→ Task 6 (e2e) ─→ Task 7 (문서)
```

- Task 1이 타입을 넓히므로 최우선.
- **Task 2·3 라인**(레코더)과 **Task 4·5 라인**(표시)은 Task 1 이후 **병렬 가능** — 접점이 `navType` 타입뿐이다.
- Task 6은 양쪽이 합쳐진 뒤에만 의미가 있다.
- Task 3 완료 시점에 `pnpm build && pnpm check:prearm`을 반드시 한 번 태운다 — pre-arm 강등은 빌드·타입·유닛이 전부 green인 채로 일어난다.

## 가이드 영향

사용자 노출 문구가 바뀌므로 갱신 대상이다. 작성 기준은 `guide/AUTHORING.md`.

- `guide/ko/logs/viewer.md` · `guide/en/logs/viewer.md` — 액션 로그 설명(ko `:21` "페이지 이동에 더해…")에 뒤로가기·앞으로가기·새로고침 구분을 추가.
- `guide/ko/logs/README.md` · `guide/en/logs/README.md` — 액션 로그 한 줄 소개(ko `:7`)에 반영할지는 `/guide` 판단에 맡긴다(요약 줄이라 안 넣어도 무방).
- 스크린샷 재촬영은 액션 로그 컷이 실제로 바뀔 때만 — `/guide-shots`의 stale 탐지에 맡긴다.
