# 액션 로그 네비게이션 유형 판별 — 구현 태스크

## 선행 조건

- **`recorder-globals.ts`·`sentinel-registry.ts`는 이미 `ed83867`에 커밋돼 있다** — 별도 선행 브랜치 대기는 필요 없다. 다만 착수 시점에 `src/content/action-recorder.ts`·`src/i18n/namespaces/logs.ts`·`src/log-viewer/i18n.ts`·`src/log-viewer/__tests__/i18n.test.ts`가 미커밋 상태로 남아 있을 수 있으니, **그 변경분을 먼저 커밋하고 시작한다**(Task 3·4가 그 위에 얹힌다).
- 새 권한·새 env·새 의존성 없음. manifest 변경 없음. 아이콘은 lucide-react 기존 의존성만 쓴다.
- `pnpm build:log-viewer`가 한 번은 돌아 있어야 한다(`dist-log-viewer/index.html`이 없으면 테스트 3개가 ENOENT로 죽는다 — `pnpm test`의 pre-훅이 자동 처리).
- **위치 표기**: design.md와 마찬가지로 라인 번호가 아니라 심볼·스니펫으로 찾는다. `action-recorder.ts`는 편집이 잦아 라인 핀이 항상 밀린다.

## 태스크

### Task 1: 판정 순수 함수 + 타입 확장

- **변경 대상**: `src/content/action-recorder-helpers.ts`, `src/types/action.ts`, `src/content/action-recorder.ts`(내부 `NavType` 미러)
- **작업 내용**:
  - `entryNavType(perfType, legacyType?)` 추가 — `"reload"` → `"reload"`, `"back_forward"` → `"traverse"`, 그 외/`undefined`면 레거시 `performance.navigation.type`(0/1/2) 폴백, 그래도 모르면 `"load"`.
  - `traverseDirection(fromIndex, toIndex)` 추가 — **유한한 0 이상의 정수** 2개일 때만 부호로 `"back"`/`"forward"`, 델타 0이거나 음수·비정수·`undefined`면 `null`.
  - `ActionEntry.navType` 유니온에 `"reload" | "traverse" | "back" | "forward"` 추가. 기존 5개 유지.
  - `action-recorder.ts`의 내부 `type NavType`을 동일하게 확장.
  - **`src/content/` 밖 import를 추가하지 않는다.**
- **검증**:
  - [x] `pnpm test` — 신규 유닛 U1·U2 green
  - [x] `pnpm typecheck` 통과

### Task 2: `window.navigation` + `performance` 전역 스냅샷

- **변경 대상**: `src/content/recorder-globals.ts`
- **작업 내용**:
  - 히스토리 인덱스만 읽는 최소 구조적 타입(`{ currentEntry?: { index?: number } }`)으로 `navigationRef` export.
  - 같은 위협모델로 `performanceRef`도 export — 하나만 스냅샷하면 비대칭이 된다.
  - lib.dom에 Navigation 타입이 없으므로 `(globalThis as unknown as { navigation?: NavigationLike }).navigation` 형태로 받는다. **`typeof navigation !== "undefined"` 형태는 컴파일 안 된다**(`declare var navigation`이 없음). `any` 노출 금지.
- **검증**:
  - [x] `pnpm typecheck` 통과 (lib.dom에 Navigation 타입이 없어도 컴파일)
  - [x] 이 파일이 `src/content/` 밖을 import하지 않음 — 수동 확인

### Task 3: 레코더 판정 지점 배선

- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**:
  1. 모듈 초기화에서 `entryNavType(performanceRef?.getEntriesByType("navigation")[0]?.type, performanceRef?.navigation?.type)`을 1회 계산해 `entryType` 상수로 보관.
  2. 진입 `recordNavigation("load", …)` → `recordNavigation(entryType, …)`.
  3. `setSentinel`의 `entryNavOnBind` 보충 경로도 `"load"` 대신 같은 `entryType`.
  4. `recordNavigation`의 조기 반환(`navType !== "load" && fromUrl === toUrl`)을 진입 계열(`load`/`reload`/`traverse`) 통과로 확장.
  5. `entryNavEmitted` 세팅 조건을 같은 진입 계열 집합으로 확장. grace 만료 리셋 경로 뒤 재arm이 `entryType`으로 합성하는지 확인.
  6. **`clear` 핸들러은 발신자가 실어 보낸 의도를 따른다** — `detail.resupplyEntryNav`가 참일 때만 `entryNavEmitted = false`. 자세한 근거와 폐기된 1차 처방은 design.md 동명 섹션. **무조건 리셋하면 안 된다** — `prepareRecorders`가 activate 뒤에 clear를 보내고 녹화 중 탭 복귀가 같은 문서를 재arm하므로 유령 진입 항목이 생긴다. 배선은 Task 3.5.
  7. **히스토리 인덱스는 미러 변수로 유지하지 않는다** — 각 판정 시점(`recordNavigation` 진입 또는 각 핸들러 첫 줄)에 `navigationRef?.currentEntry?.index`를 읽어 직전 값과 비교하고 즉시 덮어쓴다. 갱신 지점을 열거하면 `<a href="#x">`(popstate 없이 인덱스 +1)에서 드리프트가 나 HashRouter 앱의 방향 판정이 통째로 죽는다.
     - `pushState`/`replaceState` 패치 안에서 다룰 때는 **원본 호출 뒤에 읽어서 대입**한다(카운터 증가가 아니다 — `replaceState`는 인덱스를 올리지 않는다).
  8. `popstate` 리스너가 `traverseDirection` 결과를 쓰고, `null`이면 `"popstate"` 폴백.
  - **`pageshow` 리스너는 만들지 않는다** — bfcache는 비목표(PRD).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] Task 6 e2e green (이 태스크의 실질 검증은 e2e뿐 — 레코더 본문은 유닛 불가)
  - [x] Task 6에서 `pnpm build:e2e && pnpm check:prearm dist-e2e` — recorders-entry가 동기 IIFE·world=MAIN·document_start 유지

### Task 3.5: `clear` 의도 배선 (개정 — design.md "clear가 의도를 실어 나른다")

- **변경 대상**: `src/types/picker.ts`, `src/sidepanel/recorder-control.ts`, `src/content/recorder-bridge.ts`, `src/store/editor-store.ts` (+ `src/sidepanel/video-capture.ts`는 **무변경 확인 대상** — 인자를 주지 않는 쪽이 정답이라 diff가 0이어야 한다)
- **작업 내용**:
  - `PickerMessage`의 `actionRecorder.clear`에 `resupplyEntryNav?: boolean` 추가. **필드 부재 = 보충 안 함**(fail-safe 방향 — 새 발신자가 잊으면 기존 동작으로 떨어진다).
  - `clearActionRecorder(tabId, opts?: { resupplyEntryNav?: boolean })`가 그 필드를 실어 보낸다.
  - `recorder-bridge.ts:handleActionClear`가 메시지의 플래그를 `CustomEvent.detail`로 중계.
  - `editor-store.clearActionLog`(= `logClear` 경로)만 `{ resupplyEntryNav: true }`로 호출. `video-capture.prepareRecorders`는 인자 없이 그대로 둔다.
  - **network·console의 clear는 건드리지 않는다** — 진입 항목 개념이 액션 로그 전용이다.
- **검증**:
  - [x] `pnpm test` — 신규 유닛 U6(발신자 2개의 의도 대조) green
  - [x] `pnpm typecheck` 통과
  - [x] `clearActionLog`의 비테스트 호출자가 `usePickerMessages`의 `logClear` 분기 하나뿐임을 재확인(grep) — 늘어나 있으면 매핑 재검토

### Task 4: 문구 키 단일 출처 + 사전 2벌

- **변경 대상**: `src/sidepanel/lib/actionInline.ts`, `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts`, `src/log-viewer/__tests__/i18n.test.ts`
- **작업 내용**:
  - `navVerbKey(navType): TranslationKey` 추가 — `back`/`forward`/`reload`/`traverse` → 신규 키 4개, 그 외 전부 `"actionLog.verb.navigate"` 폴백. 반환 타입이 `string`이면 `t()` typecheck가 깨진다.
  - **`TranslationKey`는 `import type`으로만** 끌어온다 — `@/i18n` alias가 prefix 매칭이라 값 import면 log-viewer 빌드가 깨진다. 주석으로 못박을 것.
  - `NAV_VERB_KEYS` 닫힌 집합 상수 export.
  - 신규 키 4개를 ko/en × 사전 2벌 = 16 엔트리로 추가(값은 design.md 표 그대로). 슬롯은 `{target}` 하나만.
  - `src/log-viewer/__tests__/i18n.test.ts`에 `NAV_VERB_KEYS` 전용 `it()` 추가 — **동적 키는 기존 리터럴 스캐너를 우회하고, 값 drift 검사도 복제 사전에 키가 없으면 그냥 통과**한다. `NET_VERB_KEYS`·`STATUS_KIND_LABEL_KEYS`가 선례.
- **검증**:
  - [x] `pnpm test` — `src/i18n/__tests__/locales.test.ts`(키 대칭·placeholder) green
  - [x] `pnpm test` — `src/log-viewer/__tests__/i18n.test.ts`(ko/en 대칭 + 메인 테이블 값 일치 + 신규 `NAV_VERB_KEYS` 커버리지) green
  - [x] 신규 유닛 U3 green

### Task 5: 표시 분기 (목록 + 타임라인 + AI 요약)

- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`, `src/log-viewer/components/TimelineRow.tsx`, `src/log-viewer/markers.ts`, `src/sidepanel/lib/buildLogSummary.ts`
- **작업 내용**:
  - `KindIcon`에 `navType?` prop 추가 → `back`=`ArrowLeft`, `forward`=`ArrowRight`, `reload`=`RotateCw`, `traverse`=`History`, 그 외 기존 `MapPin`. 색 `TONE_TEXT.blue` 유지. lucide-react 기존 의존성만.
    - **reload와 traverse는 반드시 다른 아이콘**이어야 한다 — ko 문구는 `{target}`이 문두라 `TimelineRow`의 `truncate`에서 판별어가 잘려, 아이콘이 유일한 구분 축이 된다.
  - 호출부 2곳(`ActionLogContent`의 `ActionRow`, `TimelineRow.tsx`)에 `navType={entry.navType}` 전달.
  - **`ActionRow`에 `data-nav-type={entry.navType}` 추가** — e2e 판정용(`data-drag-target` 선례).
  - `renderActionContent`의 `navigation` 케이스와 `markers.ts`의 `navigation` 케이스가 `navVerbKey`로 키 선택. `splitTemplate`/`InlineLink`/`variant="navigate"` 구조 유지.
    - **`markers.ts`는 `t()`를 2회 호출한다**(보간판 → `label`, 미보간판 → `labelParts`). **둘 다 교체할 것** — 한쪽만 바꾸면 `TimelineMarkers.tsx`의 `aria-label`과 화면 문구가 갈리는 무음 a11y 회귀이고, `markers.test.ts`의 "parts 이어붙이면 label과 같다" 불변식이 깨진다.
  - `buildActionLogSummary`의 navigation 분기를 유형별 영문 문구로(`Went back to:` / `Went forward to:` / `Reloaded:` / `Navigated via history to:`). **i18n을 끌어오지 않는다**(이 함수는 영어 고정이 기존 규칙).
- **검증**:
  - [x] `pnpm test` — `markers.test.ts` 기존 케이스 green(구 `load` 항목이 기존 문구 유지) + 신규 유닛 U4
  - [x] `pnpm test` — U5(`buildLogSummary.test.ts`)
  - [x] `pnpm typecheck` 통과
  - [x] `ACTION_FILTERS`·검색(`actionSearchText`)이 변경되지 않았음을 확인

### Task 6: e2e

- **변경 대상**: `e2e/action-log-nav-type.spec.ts`(신규)
- **작업 내용**: **`e2e/action-log-scope.spec.ts`의 패턴을 따른다** — Debug 탭에는 액션 서브탭이 없다(issue/console/network뿐). 실재하는 유일한 액션 판정 경로는 캡처 → `log-attachment-card` → `log-preview-dialog` → `log-preview-tab-action` → `[data-entry-id]:visible`이다.
  - **문구 단언 금지** (`e2e/GOTCHAS.md`) — 앱 로케일이 비결정적이라 "뒤로가기"/"새로고침" 문자열 단언은 제품이 정상이어도 flaky red가 된다. **`data-nav-type` 속성으로 판정**한다.
  - 3탭 forceMount라 `:visible` 스코프 필수.
  - `captureVisibleTab` cold-start·quota flake 이력이 있으므로 `mode-freeform` 진입이 더 안전.
  - E1·E2용 픽스처가 필요하면 `e2e/fixtures/`에 pushState 버튼이 있는 페이지를 추가. E4는 기존 `basic.html`/`second.html`로 충분.
- **검증**:
  - [x] `pnpm build:e2e && pnpm test:e2e` — 신규 spec green
  - [x] `pnpm check:prearm dist-e2e` 통과 (Task 3의 pre-arm 게이트를 여기서 태운다 — `/implement`는 `dist` 빌드를 돌리지 않는다)
  - [x] `e2e/logs-prearm.spec.ts`·`logs-cross-page.spec.ts` 기존 spec 회귀 없음

### Task 7: 문서 갱신

- **변경 대상**: `docs/privacy.ko.md`, `docs/privacy.en.md`, `docs/ARCHITECTURE.md`
- **작업 내용**:
  - privacy: 액션 로그 상세 서술과 수집 항목 표의 "페이지 이동"에 뒤로가기·앞으로가기·새로고침 구분이 기록됨을 반영. **ko가 원본, en은 번역 — 양쪽 본문과 상단 시행일을 함께 갱신.**
  - `docs/ARCHITECTURE.md`의 "액션 레코더" 단락은 **필수 갱신 대상**이다(조건부 아님) — `pushState`/`replaceState`/`popstate`/`hashchange` 기록 범위와 `entryNavOnBind` 보충을 이미 명시하고 있으므로, 판정 소스 2갈래와 `clear` 핸들러의 `entryNavEmitted` 대칭을 한 줄씩 추가.
- **검증**:
  - [ ] ko/en 본문이 같은 내용을 말하는지 대조
  - [ ] 시행일 bump 반영
  - [ ] ARCHITECTURE 액션 레코더 단락 갱신 완료

## 테스트 계획

### 단위 테스트

- **U1 `entryNavType`** (`src/content/__tests__/action-recorder-helpers.test.ts`)
  - `"reload"` → `"reload"` / `"back_forward"` → `"traverse"` / `"navigate"` → `"load"` / `"prerender"` → `"load"` / 모르는 문자열 → `"load"`
  - `undefined` + 레거시 `1` → `"reload"` / `undefined` + 레거시 `2` → `"traverse"` / `undefined` + 레거시 `0` → `"load"` / 둘 다 `undefined` → `"load"`
- **U2 `traverseDirection`** (같은 파일)
  - `(3, 2)` → `"back"` / `(2, 3)` → `"forward"` / `(2, 2)` → `null` / `(undefined, 2)` → `null` / `(2, undefined)` → `null` / `(NaN, 2)` → `null` / **`(3, -1)` → `null`** / `(1.5, 2)` → `null`
- **U3 `navVerbKey`** (`src/sidepanel/lib/__tests__/actionInline.test.ts`)
  - 신규 4종이 각 전용 키로 / `"load"`·`"popstate"`·`"pushState"`·`"hashchange"`·`undefined`가 전부 `"actionLog.verb.navigate"`로 폴백
  - `NAV_VERB_KEYS`가 반환 가능한 키 전부를 담는지
- **U4 `markers.ts` navigation 라벨** (`src/log-viewer/__tests__/markers.test.ts`)
  - `navType: "back"` 엔트리의 label이 `t("actionLog.verb.navigateBack", { target: url })`와 일치
  - `labelParts`를 이어붙이면 `label`과 같다(2회 호출을 둘 다 갈았는지 고정)
  - `labelParts`의 슬롯 토큰만 `TONE_TEXT.blue`(기존 케이스와 동형)
  - `navType` 없는 엔트리가 기존 문구 유지 — **기존 테스트가 그대로 통과해야 한다**
- **U5 `buildActionLogSummary`** (`src/sidepanel/lib/__tests__/buildLogSummary.test.ts` — `describe("buildActionLogSummary")`가 이미 존재)
  - 유형별 영문 문구 4종 + 구 값(`pushState`·`load`) 폴백

- **U6 `clear` 의도 배선** (`src/store/__tests__/` 또는 발신자별 기존 테스트)
  - `editor-store.clearActionLog(tabId)`가 `clearActionRecorder`를 `{ resupplyEntryNav: true }`로 부른다
  - `video-capture.prepareRecorders`(= `startVideoCapture` 경로)의 `clearActionRecorder` 호출엔 그 플래그가 없다 — **유령 항목 회귀의 유일한 유닛 그물**
  - `clearActionRecorder`가 그 값을 `PickerMessage`에 그대로 싣는다

> `navType` 축의 exhaustive 검사가 저장소에 0건이라 렌더 분기 누락은 컴파일러가 못 잡는다. **U3·U4의 폴백 케이스를 필수로 취급한다.**
>
> `clear` 의도 배선도 같은 성격이다 — MAIN 핸들러 본문은 유닛 불가라 **발신자 쪽 의도(U6)만 고정**할 수 있고, 실제 래치 동작은 e2e E3·E7이 본다.

### e2e 시나리오 (`/e2e-write` 입력)

판정은 전부 `[data-entry-id]:visible` 스코프 안의 **`data-nav-type` 속성**으로 한다(문구 단언 금지).

- **E1** — SPA에서 `history.pushState`로 경로를 바꾼 뒤 `page.goBack()`을 하면 액션 로그에 `data-nav-type="back"` 항목이 뜬다.
- **E2** — E1 직후 `page.goForward()`를 하면 `data-nav-type="forward"` 항목이 뜬다.
- **E3** — `page.reload()` 후 액션 로그가 클리어되고(idle/capturing phase), 남은 첫 항목이 `data-nav-type="reload"`다. 빈 상태 → 첫 항목 전이를 명시적으로 대기한다.
- **E4** — same-origin 멀티페이지에서 A→B 이동 후 `page.goBack()`(문서 재로드)을 하면 `data-nav-type="traverse"` 항목이 뜨고, 이전 페이지 로그가 보존된다.
- **E5** — 해시 링크로 이동 후 `page.goBack()`을 하면 **해당 해시 URL의 navigation 항목 수가 기존 동작과 동일**하고, 그 popstate 유래 항목이 `forward`로 오라벨되지 않는다(프래그먼트 네비게이션도 popstate를 쏜다 — design.md "popstate는 이동 전용 신호가 아니다")(popstate 유래 + hashchange 유래 2개). 절대 카운트가 아니라 해시 URL로 좁힌 상대 카운트로 센다 — 페이지 진입 `load` 항목이 항상 하나 깔려 베이스라인이 0이 아니다. 이번 변경이 개수를 바꾸지 않았음을 고정하는 보존 테스트다.
- **E6** — HashRouter 형태(`#/a` → `#/b`)로 이동 후 `page.goBack()`을 하면 `data-nav-type="back"`이다(인덱스 드리프트 회귀 방지).
- **E7** — **유령 진입 항목 회귀 방지**(Task 3.5). 캡처를 시작한 뒤 네비게이션 없이 다른 탭으로 갔다가(`otherPage.bringToFront()`) 돌아오면(`page.bringToFront()`), 액션 로그의 **navigation 항목 수가 늘지 않는다**. `visibilitychange → inject`가 같은 문서를 재arm하는 경로라, `clear`가 의도 없이 래치를 내리면 여기서 항목이 하나 더 생긴다. 절대 개수가 아니라 **복귀 전후 delta 0**으로 센다.

### 수동 테스트 (Chrome, 자동화 불가)

- [ ] **iframe traverse** — cross-origin iframe 내부에서 뒤로가기 시 항목이 생기고 origin 필터로 구분되는지.
- [ ] **아이콘 시각 정합** — `ArrowLeft`/`ArrowRight`/`RotateCw`/`History`가 기존 `MapPin`과 같은 시각 무게로 보이는지(다크모드 포함), 좁은 사이드패널·타임라인 양쪽에서.
- [ ] **cross-origin 뒤로가기** — 로그가 클리어된 뒤 traverse 항목이 첫 항목으로 남는지.
- [ ] **보존 phase 새로고침** — recording/drafting/previewing/done에서 새로고침하면 로그가 보존된 채 reload 항목이 뒤에 붙는지(`shouldPreserveBackgroundLogs` 경로).

## 구현 순서 권장

```
Task 1 (판정 함수 + 타입)
   ├─→ Task 2 (전역 스냅샷) ─→ Task 3 (레코더 배선) ─┐
   └─→ Task 4 (문구 키 + 사전) ─→ Task 5 (표시 분기) ─┴─→ Task 6 (e2e) ─→ Task 7 (문서)
```

- Task 1이 타입을 넓히므로 최우선.
- **Task 2·3 라인**(레코더)과 **Task 4·5 라인**(표시)은 Task 1 이후 **병렬 가능** — 접점이 `navType` 타입뿐이다. 단 Task 6의 `data-nav-type` 의존 때문에 Task 5가 Task 6보다 먼저다.
- Task 6은 양쪽이 합쳐진 뒤에만 의미가 있다. **pre-arm 강등은 빌드·타입·유닛이 전부 green인 채로 일어나므로** `check:prearm dist-e2e`를 반드시 태운다.

## 가이드 영향

사용자 노출 문구가 바뀌므로 갱신 대상이다. 작성 기준은 `guide/AUTHORING.md`.

- `guide/ko/logs/viewer.md` · `guide/en/logs/viewer.md` — 액션 로그 설명("페이지 이동에 더해…")에 뒤로가기·앞으로가기·새로고침 구분을 추가.
- `guide/ko/logs/README.md` · `guide/en/logs/README.md` — 액션 로그 한 줄 소개에 반영할지는 `/guide` 판단에 맡긴다(요약 줄이라 안 넣어도 무방).
- 스크린샷 재촬영은 액션 로그 컷이 실제로 바뀔 때만 — `/guide-shots`의 stale 탐지에 맡긴다.
