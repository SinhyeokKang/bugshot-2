# audit-refactor-4 — 구현 태스크

## 선행 조건

- 새 의존성·권한·env **없음**. manifest 변경 0. 새 파일은 테스트 1개(`src/lib/__tests__/inline-ref.test.ts`)뿐이고 소스 파일은 전부 기존 파일 안에서 끝난다(design.md §개요).
- 착수 전 읽을 것: `docs/POSTMORTEM.md`의 2026-07-30(API Hosts 도메인 게이트)·2026-07-31(element 모드 누출이 e2e mutation으로 뚫린 건)·2026-08-04(게이트 교체 함정) 세 항목. Task 1·5·14가 직접 그 위를 지난다.
- `pnpm test`는 pre-훅이 `build:log-viewer`를 먼저 돌린다(새 체크아웃이면 필수).
- **`ISSUES_STORE_VERSION`은 5 유지**(design.md §기존 패턴 준수). Task 3에서 bump하지 않는다.
- 문서 커밋은 문서별로 분리(`docs(ARCHITECTURE): ...` / `docs(DIRECTORY): ...`) — Task 8·11.
- **줄번호는 v1.7.19 + N-way 로케일 인프라 기준으로 갱신돼 있다**(prd.md §코드 기준 갱신). `settings-ui-store.ts`·`bg-init.ts`·`docs/ARCHITECTURE.md` 세 파일만 밀렸고 나머지는 그대로다.
- **`docs/features/french-locale/`와 소스 충돌·순서 의존 없음** — fr 기획은 `src/i18n/{locales,index}.ts`·`aiLanguage.ts`·`localeLabels.ts`·`log-viewer/i18n.ts`를 건드리고 이 배치가 만지는 `bg-init.ts`·`settings-ui-store.ts`는 안 건드린다. 겹치는 건 Task 8·11의 문서 줄번호뿐이니(fr Task 8이 `DIRECTORY.md:99-101`·`ARCHITECTURE.md:256`을 고친다) 착수 시 대상 줄을 다시 확인한다.

## 태스크

### Task 1: `environmentForSubmit()` 신설 (항목 12-a, 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/apiHostRow.ts`, `src/sidepanel/lib/__tests__/apiHostRow.test.ts`
- **작업 내용**: 라이브·draft 제출 경로의 단일 초크포인트가 될 순수 함수를 export한다. 시그니처와 본문은 design.md §인터페이스 설계 그대로:

  ```ts
  export function environmentForSubmit(input: {
    captureMode: CaptureMode | undefined;
    logsAttach: boolean;
    rows: readonly EnvironmentRow[] | undefined;
    lastDerived: string | null | undefined;
  }): EnvironmentRow[] {
    const rows = input.rows ?? [];
    if (supportsConsoleNetworkLog(input.captureMode) && input.logsAttach) return [...rows];
    return [...stripApiHostsRows(rows, input.lastDerived ?? null)];
  }
  ```

  `stripApiHostsRows`는 **시그니처·동작 모두 불변**이다(`lastDerived: string | null`). `?? null` 흡수는 새 함수만 한다 — 구 초안의 `undefined`가 "판정 불가"로 정확히 읽혀야 한다. 게이트를 컴포넌트가 아니라 lib에 두는 이유는 `apiHostRow.ts:61-62` 주석이 이미 적어둔 것과 동일하므로, 새 함수 위에도 같은 취지의 한 줄(왜 두 호출부가 여기로 모이는가)을 남긴다. 테스트를 먼저 작성한다(CLAUDE.md "신규 인터페이스는 테스트 먼저").
- **검증**:
  - [ ] `pnpm test src/sidepanel/lib/__tests__/apiHostRow.test.ts` green — 아래 6케이스가 전부 포함된다: 지원 모드+로그 ON → 원본 행 전부 유지, element 모드 → strip, `logsAttach: false` → strip, `lastDerived: undefined`(구 초안) → **no-op**, `source:"api-hosts"`이지만 `value !== lastDerived`(사용자가 고친 행) → **보존**, `rows: undefined` → `[]`
  - [ ] 반환값이 입력 배열과 **다른 참조**(모든 분기에서 새 배열)임을 단언 — 로그 ON 분기의 현행 `[...rows]` 동작 보존(위험 4)
  - [ ] `stripApiHostsRows`의 기존 describe(`apiHostRow.test.ts:269`)가 무수정 green — 시그니처를 안 건드렸음의 증거
  - [ ] `pnpm typecheck` green

### Task 2: 라이브 제출 경로를 새 함수로 교체 (항목 12-b, 동작 불변)

- **변경 대상**: `src/sidepanel/lib/buildEditorCapture.ts`
- **작업 내용**: `:55-59`의 인라인 삼항(`supportsConsoleNetworkLog(captureMode) && logsAttach ? draft.environment ?? [] : stripApiHostsRows(...)`)을 `environmentForSubmit({ captureMode, logsAttach, rows: draft.environment, lastDerived: s.apiHostsDerived })` 호출로 교체한다. import를 `stripApiHostsRows` → `environmentForSubmit`으로 바꾸고, 삼항 위의 설명 주석은 새 함수 쪽으로 옮겨 호출부에 중복해 남기지 않는다. `supportsConsoleNetworkLog` import는 같은 파일의 `hasActionLog` 등 다른 사용처가 없으면 함께 정리한다(내 변경이 만든 고아만 제거).
- **검증**:
  - [ ] `pnpm test src/sidepanel/lib/__tests__/buildEditorCapture.test.ts` green (무수정)
  - [ ] `pnpm test src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts` green — **스냅샷 diff 0**. 8개 빌더 출력이 한 글자도 안 바뀌어야 한다(위험 4)
  - [ ] `grep -n "stripApiHostsRows" src/sidepanel/lib/buildEditorCapture.ts` 결과 0줄
  - [ ] `pnpm typecheck` green

### Task 3: `IssueRecord.apiHostsDerived` 스키마 확장 (항목 12-c)

- **변경 대상**: `src/store/issues-store.ts`
- **작업 내용**: `IssueRecord`(`:180-253`)에 비파괴 optional 필드 `apiHostsDerived?: string | null`을 추가한다. JSDoc은 design.md §인터페이스 설계의 문구를 그대로 — "저장 시점의 API Hosts 자동 파생값 스냅샷 / `stripApiHostsRows`가 미수정 행을 판정하는 유일한 재료 / 구 draft는 `undefined` → strip이 no-op". **버전 bump 없음** — `ISSUES_STORE_VERSION = 5` 유지, `migrateIssuesState`에 분기 추가 없음, **backfill 마이그레이션도 하지 않는다**(design.md 대안 3-④: 저장된 행 값을 파생값으로 간주하는 건 추측을 마이그레이션으로 굳히는 것). `:255-259`의 "비파괴 optional 필드는 버전 bump 불필요" 주석 목록에 이번 필드를 한 줄 덧붙인다(`actionLogBlobKey`·`videoStartedAt`·`bufferedElements`·`slackPreserved` 선례와 같은 자리).
- **검증**:
  - [ ] `pnpm typecheck` green — optional이라 기존 `IssueRecord` 생성부가 전부 무수정 통과
  - [ ] `grep -n "ISSUES_STORE_VERSION = 5" src/store/issues-store.ts` 히트 유지(bump 안 됨)
  - [ ] `pnpm test src/store/__tests__/issues-store.test.ts` green (무수정) — 특히 `migrateIssuesState` describe(`:345`)가 그대로 통과

### Task 4: `confirmDraft` 4개 분기가 `apiHostsDerived`를 기록 (항목 12-d)

- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**: `confirmDraft`의 `saveDraft` 호출 4곳(`:869` freeform · `:893` video · `:937` screenshot · `:984` element)에 **전부** `apiHostsDerived: state.apiHostsDerived`를 명시 기입한다. **조건부 스프레드 금지** — `saveDraft`는 교체가 아니라 병합이라(`issues-store.ts:353-361`) 키를 빼면 직전 세션 값이 되살아난다. element 분기는 값이 항상 `null`이지만 같은 이유로 포함한다(같은 파일 `:947` selector·`:1019` bufferedElements가 이미 못박은 규율이며, 그 두 곳의 주석과 같은 형태의 한 줄을 남긴다).
- **검증**:
  - [ ] `pnpm test src/store/__tests__/editor-store.test.ts` green — 4개 캡처 모드 각각에서 `saveDraft` 인자에 `apiHostsDerived` **키가 존재**함을 단언(`toHaveProperty`류로 `undefined`와 "키 없음"을 구분). element 분기는 `null` 기대
  - [ ] element 분기에서 직전 세션의 비-null 값이 병합으로 되살아나지 않음을 회귀 케이스로 고정(같은 id로 두 번 `confirmDraft`)
  - [ ] `grep -c "apiHostsDerived: state.apiHostsDerived" src/store/editor-store.ts` == 4
  - [ ] `pnpm typecheck` green

### Task 5: draft 재제출 경로가 strip (항목 12-e, 배치의 사용자 노출 변화)

- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: `buildCtxForSubmit`(`:307-401`)의 `environment: issue.draft.environment ?? []`(`:352`)를 아래로 교체한다.

  ```ts
  environment: environmentForSubmit({
    captureMode: issue.captureMode,   // legacyNoDiff 강제변환(:337) 이전의 원본 모드
    logsAttach: logsOn,               // = issue.logsAttached !== false (:311)
    rows: issue.draft.environment,
    lastDerived: issue.apiHostsDerived,
  }),
  ```

  두 인자에 함정이 하나씩 있다. **`captureMode`는 `ctx.captureMode`(`:337`의 `legacyNoDiff ? "screenshot" : issue.captureMode`)가 아니라 `issue.captureMode`** — 강제 변환값을 넣으면 element 초안이 "로그 지원 모드"로 뒤집힌다. 같은 함수의 로그 blob 로드 게이트 3개(`:313`·`:317`·`:321`)가 이미 `issue.captureMode`를 쓰므로 그 규율을 따른다. **`logsAttach`는 `issue.logsAttached`를 직접 넘기지 않는다** — 필드는 `boolean | undefined`이고 `undefined = 첨부`가 계약이라(`issues-store.ts:212-214`) 그대로 넘기면 뒤집힌다. `:311`에 이미 있는 `logsOn`을 쓴다(위험 5). `logsAttached` 토글(`:924`·`:1001`)은 계속 `patchIssue`로 레코드만 바꾸고 `draft.environment`는 건드리지 않는다 — **행은 저장된 채 제출 시점에만 걸러지고 off→on으로 되돌리면 다시 실린다**(설계 전제, 대안 2).
- **검증**:
  - [ ] `pnpm typecheck` green
  - [ ] 수동/e2e — 로그 첨부 **ON** 초안 재제출 시 본문 `재현 환경`에 `API Hosts` 행이 **그대로** 실린다
  - [ ] 수동/e2e — 같은 초안에서 로그 첨부를 **OFF**로 토글 후 재제출하면 그 행이 **빠진다**
  - [ ] 수동/e2e — OFF → 다시 ON으로 되돌리면 행이 **되살아난다**(가역성)
  - [ ] `grep -n "issue.draft.environment ?? \[\]" src/sidepanel/tabs/DraftDetailDialog.tsx` 결과 0줄
  - [ ] `EnvBlock`(`:1212-1245`) 읽기 전용 상태는 그대로 — `재현 환경` 편집 UI를 추가하지 않았다(비목표)

### Task 6: v<2 이미지 마이그레이션 fail-closed (항목 13)

- **변경 대상**: `src/store/issues-store.ts`, `src/store/__tests__/issues-store.test.ts`
- **작업 내용**: `migrateIssuesState`의 v<2 블록(`:286-308`)에서 슬롯 이관을 `migrateSnapshotImage(issueId, slot, raw)` 헬퍼로 추출하고 **export**한다(단위 테스트로 고정하기 위해). 실패 경계는 design.md 결론 그대로 둘로 나눈다 — **`dataUrlToBlob` 파싱 실패는 그 슬롯만 포기하고 `false` 반환**(재시도해도 영원히 같은 결과라 전파하면 그 사용자는 영영 hydrate 못 한다, 대안 6), **`saveImageBlobRaw` reject는 그대로 전파**(IDB quota·IO 같은 일시 상태 → 마이그레이션 전체 abort → 저장소의 구버전 봉투 보존 → 다음 기동 재시도). 기존 `catch {}` 2개는 사라진다. v<2 블록은 헬퍼 2회 호출 + `issue.snapshot = { before, after }`로 축소한다. **version 미기록·dataURL 보존 재시도는 둘 다 불가/기각**(대안 4·5) — throw 외의 경로를 만들지 않는다. 부분 성공 잔여물(`${issueId}:before` blob 잔존)은 **수용**한다 — 실패 경로에 삭제를 더하는 건 fail-closed 원칙에 정면으로 어긋난다(위험 2).
- **검증**:
  - [ ] `migrateSnapshotImage` 단위 테스트 green — 4케이스: 비-문자열/비-dataURL → `false`(호출 없음), `dataUrlToBlob` throw → `false`(전파 안 함), `saveImageBlobRaw` reject → **reject 전파**, 성공 → `true`
  - [ ] `migrateIssuesState` v1 입력에서 `saveImageBlobRaw`가 reject하면 **전체가 rejects**함을 단언
  - [ ] 그 error로 `shouldPruneAfterRehydrate(error)`가 `false`를 반환함을 같은 테스트에서 이어 단언(prune 스킵 = fail-closed 레인 합류)
  - [ ] 성공 경로 회귀 0 — `migrateIssuesState` 기존 describe(`:345`)와 `pruneOrphanBlobs` describe(`:477`)가 무수정 green
  - [ ] `grep -n "image lost on migration failure" src/store/issues-store.ts` 결과 0줄

### Task 7: 복원 세션의 시트 교체 훅 재등록 (항목 14)

- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `handleSelectByPath`(`:1214-1238`)의 `if (!overlay)` 블록 **안**에 `setOnCacheReloaded(scheduleInspectorRefresh)`를 추가한다. 위치는 `startCssCacheObserver()` 직전(= `handleStart` `:607-609`의 등록 순서와 동일하게 읽히도록). 블록 밖에 두면 무해하지만(멱등 대입) 조건이 뜻하는 바 — "`handleClear`(`:656`이 null화)가 훑고 지나간 뒤인가" — 를 흐린다. **유닛으로 못 고정하므로**(브라우저 실동작: 시트 주입 → `onCacheReloaded` 발화 → `requestIdleCallback`) 두 등록 지점(`handleStart` / `handleSelectByPath`)이 서로 인접하게 읽히도록 **같은 취지의 주석을 양쪽에 남긴다** — 회귀가 조용한 한 줄이라 주석이 유일한 표식이다(위험 6).
- **검증**:
  - [ ] `grep -c "setOnCacheReloaded(scheduleInspectorRefresh)" src/content/picker.ts` == 2
  - [ ] `pnpm typecheck` green
  - [ ] 수동 체크리스트(아래 §테스트 계획) — 복원 세션 + 다크모드 토글에서 인스펙터 값 갱신

### Task 8: settings-ui-store 버전 문서 정합 (항목 17, **코드 변경 0**)

- **변경 대상**: `docs/ARCHITECTURE.md:582`, `docs/DIRECTORY.md:96`
- **작업 내용**: 두 곳의 `settings-ui-store` 버전 서술을 **v9 → v10**으로 고치고 `v10은 aiLanguage 추가`를 편입한다. `docs/DIRECTORY.md:96`은 `settings-ui v9:` 헤더를 v10으로 바꾸고 필드 목록에 `aiLanguage`(AI 출력 언어, v10 추가·기본 `auto`)를 더한다. **코드는 손대지 않는다** — `src/store/settings-ui-store.ts:268`의 `version: 10`은 이미 정확하고, `migrateSettingsUi`(`:133-158`)는 버전 비교 없는 nullish 정규화 + `mergePersistedSettings`(`:162-175`) 재정규화라 멱등이다. **리베이스로 바뀐 두 가지도 같이 반영한다**(design.md §항목 17): 재정규화가 persist 옵션 안 익명 함수에서 `mergePersistedSettings` **named export로 추출**됐고, `migrateSettingsUi`에 `state.locale = normalizeLocale(state.locale)`(`:154`, 다운그레이드 방어)가 추가됐다. 커밋은 문서별로 분리.
  - 참고: 같은 `ARCHITECTURE.md:582` 문장 끝의 "`IssueRecord`의 비파괴 optional 필드 추가(…)" 선례 목록에 Task 3의 `apiHostsDerived`를 더할지는 design.md가 지정하지 않았다 — 항목 12 완료 후 `/push` 문서 트라이아지에서 판단한다.
- **검증**:
  - [ ] `git diff --stat`에 `src/` 파일이 **하나도 없다**
  - [ ] `grep -n "settings-ui-store\` v9\|settings-ui v9" docs/` 결과 0줄
  - [ ] 두 문서의 새 서술이 `src/store/settings-ui-store.ts:267-268`의 주석·`version` 값과 문자 단위로 일치

### Task 9: `bugshot-app-settings` persist 키 상수화 (항목 18)

- **변경 대상**: `src/lib/session-keys.ts`, `src/store/settings-ui-store.ts`, `src/i18n/bg-init.ts`, `src/lib/__tests__/session-keys.test.ts`
- **작업 내용**: `src/lib/session-keys.ts`에 `export const APP_SETTINGS_PERSIST_KEY = "bugshot-app-settings";`를 `ISSUES_PERSIST_KEY`(`:21`) 바로 아래 형제로 추가하고, 같은 형태의 이유 주석(background `i18n/bg-init.ts`가 이 봉투를 직독하므로 리터럴을 두 벌 두면 로케일 미러링이 타입 에러 없이 죽는다)을 붙인다. 호출부 5곳을 상수 참조로 교체 — `settings-ui-store.ts:266`의 `name:`, `bg-init.ts:17,18,23,24`. **위치는 `session-keys.ts` 고정** — `src/lib/settings-storage.ts`는 다른 store의 다른 키(`bugshot-settings`)를 다루고 8개 플랫폼 auth 타입을 import하므로, 한 글자 차이 이름이 한 파일에 공존하는 것 자체가 사고 지점이다(대안 7). 리베이스로 생긴 `src/i18n/locales.ts`(의존성 0 leaf)도 후보로 재검토했으나 **로케일 레지스트리에 무관한 상수를 얹지 않는다**로 유지(design.md §항목 18). `session-keys.ts`는 import 0개 leaf라 `bg-init.ts`에 sidepanel 그래프가 유입되지 않는다 — `bg-init.ts`가 이미 `@/i18n/locales`를 import하고도 SW 번들이 멀쩡한 게 같은 형태의 실측 근거다. **오타는 전 사용자 설정 초기화이고 타입 에러가 안 난다**(위험 3) — 값 동일성을 단위 테스트로 잠근다(`src/lib/__tests__/settings-storage.test.ts:93-95`가 `SETTINGS_STORAGE_KEY`에 하는 것과 같은 형태).
- **검증**:
  - [ ] `src/lib/__tests__/session-keys.test.ts`에 `expect(APP_SETTINGS_PERSIST_KEY).toBe("bugshot-app-settings")` 추가, green
  - [ ] `grep -rn '"bugshot-app-settings"' src/` 결과가 **정확히 3줄** — 상수 정의(`session-keys.ts`) 1줄 + 값 잠금 테스트 2줄(`session-keys.test.ts` 신규, `settings-ui-store.test.ts:624`의 기존 `PERSIST_KEY`). **프로덕션 코드에는 1줄만** 남는다
  - [ ] `pnpm test src/store/__tests__/settings-ui-store.test.ts` green — rehydrate 재정규화 describe(`:622`)가 여전히 저장분을 읽는다(키가 안 바뀐 증거)
  - [ ] `pnpm typecheck` green

### Task 10: `PLATFORM_FALLBACK_ORDER` 컴파일 강제 (항목 71)

- **변경 대상**: `src/store/settings-store.ts`, `src/store/__tests__/settings-store.test.ts`
- **작업 내용**: `PLATFORM_FALLBACK_ORDER`(`:315-324`)를 랭크 맵에서 파생시킨다.

  ```ts
  const PLATFORM_FALLBACK_RANK = {
    jira: 0, github: 1, linear: 2, gitlab: 3,
    notion: 4, asana: 5, clickup: 6, slack: 7,
  } as const satisfies Record<PlatformId, number>;

  const PLATFORM_FALLBACK_ORDER = (Object.keys(PLATFORM_FALLBACK_RANK) as PlatformId[])
    .sort((a, b) => PLATFORM_FALLBACK_RANK[a] - PLATFORM_FALLBACK_RANK[b]);
  ```

  `as const satisfies Record<PlatformId, T>`는 `src/types/platform.ts:29`·`src/background/oauth/config.ts:129`가 이미 쓰는 저장소 관용구다. **`Object.keys(...) as PlatformId[]`로 mutable 배열을 유지**해 `pickInitialPlatform`(`:330-341`)의 `for...of`와 `connectedPlatforms`(`:343-345`)의 `.filter`가 그대로 돌게 한다(위험 8). 소비처 순회 코드는 손대지 않는다. `Record<PlatformId, number>` 같은 다른 자료구조로 바꾸는 리팩터는 비목표.
- **검증**:
  - [ ] **뮤테이션 증명**: `PLATFORM_FALLBACK_RANK`에서 `slack: 7` 한 줄을 지우면 `pnpm typecheck`가 **실패**한다(확인 후 되돌린다)
  - [ ] `pnpm test src/store/__tests__/settings-store.test.ts` green — `pickInitialPlatform`·`connectedPlatforms`의 **폴백 순서가 jira→github→linear→gitlab→notion→asana→clickup→slack로 불변**임을 단언하는 케이스 포함
  - [ ] `pnpm typecheck` green

### Task 11: orphan GC 실패 정책 문서 정합 (항목 73, **코드 변경 0**)

- **변경 대상**: `docs/ARCHITECTURE.md:64` (리베이스 후에도 같은 줄 — 500번대 이후만 밀렸다)
- **작업 내용**: "pending prune의 세션 1회 플래그도 삭제가 성공한 뒤에만 기록한다"를 실제 계약으로 정정한다 — **참조 수집이 실패하면 prune 전체를 건너뛰고 플래그도 안 남기지만, 개별 delete 실패는 삼킨다(플래그는 그대로 기록된다)**. **코드를 문서에 맞추지 않는다**(대안 8): 실패 방향이 "미삭제"라 무해하고, 개별 실패를 전파하면 delete 하나가 실패할 때마다 세션 플래그가 안 서서 매 기동 전량 재스캔이 돈다. 문단의 나머지 취지("살아있는 것 계산 실패 → 아무것도 안 살아있음으로 해석 금지")는 유지한다.
- **검증**:
  - [ ] `git diff --stat`에 `src/` 파일이 **하나도 없다**
  - [ ] 새 서술이 `src/lib/pending-log-prune.ts`·`src/store/blob-db.ts`의 실제 실패 경로와 일치(두 파일을 열어 대조)

### Task 12: `inline:` 리터럴 생성기 (항목 74)

- **변경 대상**: `src/lib/inline-ref.ts`, `src/store/editor-store.ts`, `src/sidepanel/components/TiptapEditor.tsx`, `src/sidepanel/lib/submitToAsana.ts`, `src/lib/__tests__/inline-ref.test.ts`(신규)
- **작업 내용**: 파싱(`INLINE_REF_RE`)의 짝이 되는 생성기 2개를 `src/lib/inline-ref.ts`에 추가한다.

  ```ts
  export function inlineRefUrl(refId: string): string { return `inline:${refId}`; }
  export function inlineRefMarkdown(refId: string, alt = ""): string {
    return `![${alt}](${inlineRefUrl(refId)})`;
  }
  ```

  호출부 3곳 교체 — `editor-store.ts:557`의 `![](inline:${refId})` → `inlineRefMarkdown(refId)` / `TiptapEditor.tsx:526`의 `md.replaceAll(blobUrl, \`inline:${refId}\`)` → `inlineRefUrl(refId)` / `submitToAsana.ts:223`의 `imageRefs[\`inline:${refId}\`]` → `imageRefs[inlineRefUrl(refId)]`. **`INLINE_REF_RE`는 그대로 둔다** — 이 배치는 생성 쪽만 모은다(비목표). **`alt` 기본값은 반드시 빈 문자열** — 현재 생성물이 `![](...)`이라 기본값이 다르면 본문 마크다운이 바뀌어 골든이 깨진다(위험 9). 테스트를 먼저 작성한다.
- **검증**:
  - [ ] `src/lib/__tests__/inline-ref.test.ts` green — `inlineRefUrl("abc") === "inline:abc"`, `inlineRefMarkdown("abc") === "![](inline:abc)"`(빈 alt), alt 지정 시 `![x](inline:abc)`, **생성물이 `INLINE_REF_RE`로 왕복 파싱돼 refId를 되돌려준다**(생성↔파싱 계약 잠금)
  - [ ] `pnpm test src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts` green — 스냅샷 diff 0
  - [ ] `grep -rn 'inline:\${' src/ | grep -v inline-ref.ts` 결과 0줄
  - [ ] `pnpm typecheck` green

### Task 13: `finalizeCustomProps` memo 주석 정정 (항목 75, **주석만**)

- **변경 대상**: `src/content/css-resolve.ts:1905`
- **작업 내용**: 주석 "(체인이 이미 닿았으면 memo 조회 1회로 끝난다)" 부분을 삭제한다 — **memo는 코드에도 문서에도 없다**. 앞부분의 실제 설명("shadow 경계·detached 요소는 부모 체인이 documentElement에 닿지 않아 `:root` 토큰을 통째로 잃으므로 마지막에 보정한다")은 유지한다. **주석 외 코드 변경 0.**
- **검증**:
  - [ ] `git diff src/content/css-resolve.ts`가 주석 줄만 포함(실행 코드 diff 0)
  - [ ] `pnpm test src/content/__tests__/css-resolve.test.ts` green (무수정)
  - [ ] `grep -n "memo" src/content/css-resolve.ts` 결과가 실재하지 않는 캐시를 더 이상 주장하지 않는다

### Task 14: DOM Tree에서 어노테이션 host 제외 (항목 76)

- **변경 대상**: `src/content/dom-describe.ts`, `src/content/__tests__/dom-describe.test.tsx`
- **작업 내용**: `isRenderable`(`:105`)의 `if (el.id === HOST_ID) return false;`를 `ANNOTATION_HOST_ID`까지 제외하도록 **OR로 얹는다**. `import { ANNOTATION_HOST_ID } from "./annotation";`을 추가한다. **교체가 아니라 추가** — `HOST_ID` 제외를 `ANNOTATION_HOST_ID`로 바꾸면 picker overlay가 DOM Tree에 노출된다(위험 7, POSTMORTEM 2026-08-04 "기존 게이트를 새 조건으로 대체" 계열). import 안전성은 확인됨: `dom-describe.ts`는 `picker.ts:36`에서만 import되고 그 엔트리는 이미 `./annotation`을 import한다(`picker.ts:76`) — 같은 청크라 새 그래프 유입 0이며 `scroll-capture.ts:1,141`이 동일 형태의 선례다. MAIN world라 import가 불가능한 `action-recorder.ts:26-29`의 리터럴 복제는 **그대로 둔다**.
- **검증**:
  - [ ] `dom-describe.test.tsx`에 케이스 추가 green — `id="__bugshot_annotation_host"` 요소가 트리에서 제외된다
  - [ ] **같은 테스트에서** `id`가 `HOST_ID`인 요소도 여전히 제외됨을 단언(게이트 교체가 아님의 증거)
  - [ ] 두 host 중 어느 것도 아닌 일반 요소는 그대로 포함
  - [ ] `pnpm check:prearm` 해당 없음 — 이 파일은 pre-arm 청크가 아니다(`recorders-entry` 무관). `pnpm typecheck` green

## 테스트 계획

### 단위 테스트 — `*.test.ts` (node, 순수 함수)

| 파일 | 추가 케이스 |
|---|---|
| `src/sidepanel/lib/__tests__/apiHostRow.test.ts` | `environmentForSubmit` describe 신설 — ① 지원 모드+로그 ON → 원본 유지 ② element 모드 → strip ③ `logsAttach:false` → strip ④ **`lastDerived: undefined`(구 초안, `apiHostsDerived` 필드 없음) → no-op** ⑤ `source:"api-hosts"`인데 `value !== lastDerived`(사용자가 값만 고친 행) → 보존 ⑥ `rows: undefined` → `[]` ⑦ 모든 분기에서 반환 배열이 새 참조 |
| `src/store/__tests__/issues-store.test.ts` | `migrateSnapshotImage` describe 신설(비-dataURL→false / 파싱 throw→false / IDB reject→**전파** / 성공→true) + `migrateIssuesState` v1에서 IDB 실패 시 rejects + 그 error로 `shouldPruneAfterRehydrate === false`. `saveDraft` 병합 describe(`:248`)에 `apiHostsDerived` 보존 케이스 |
| `src/store/__tests__/editor-store.test.ts` | `confirmDraft` 4개 캡처 모드가 `saveDraft` 인자에 `apiHostsDerived` **키를 항상** 싣는다(element는 `null`). 같은 id 재확정 시 이전 값이 병합으로 되살아나지 않는다 |
| `src/lib/__tests__/session-keys.test.ts` | `APP_SETTINGS_PERSIST_KEY` 값 동일성 잠금 — 오타 시 전 사용자 설정 초기화라 타입 체크가 못 잡는다 |
| `src/store/__tests__/settings-store.test.ts` | `PLATFORM_FALLBACK_ORDER` 파생 후에도 폴백 순서 8종이 불변. 컴파일 강제 자체는 테스트가 아니라 **뮤테이션 + `pnpm typecheck`**로 증명(Task 10) |
| `src/lib/__tests__/inline-ref.test.ts` (신규) | `inlineRefUrl`/`inlineRefMarkdown` — alt 기본값 빈 문자열, 생성물의 `INLINE_REF_RE` 왕복 파싱 |

**회귀 그물(무수정 green이어야 함)**: `bodyOutputGolden.test.ts`(8개 빌더 출력 스냅샷 — Task 2·12에서 **diff 0**), `buildEditorCapture.test.ts`, `settings-ui-store.test.ts`, `css-resolve.test.ts`.

### 단위 테스트 — `*.test.tsx` (jsdom + @testing-library)

| 파일 | 추가 케이스 |
|---|---|
| `src/content/__tests__/dom-describe.test.tsx` | 실제 DOM 셸이 필요한 검증 — `ANNOTATION_HOST_ID` 노드 제외 + **`HOST_ID` 제외 동시 유지** + 일반 요소 포함 |

### e2e 시나리오 (`/e2e-write` 입력)

- `e2e/api-hosts-env-row.spec.ts` — **로그를 첨부한 스크린샷 초안을 저장한 뒤 초안 상세에서 로그 첨부를 끄고 재제출하면, 이슈 본문 `재현 환경`에 `API Hosts` 행이 없다.**
- `e2e/api-hosts-env-row.spec.ts` — **같은 초안에서 로그 첨부를 다시 켜고 재제출하면 `API Hosts` 행이 다시 실린다.**
- `e2e/api-hosts-env-row.spec.ts` — **`API Hosts` 행의 값을 손으로 고친 뒤 초안을 저장하고, 로그 첨부를 끈 채 재제출해도 그 고친 값이 본문에 남는다.**
- `e2e/api-hosts-env-row.spec.ts` — **요소 스타일 편집 초안을 재제출하면 로그 첨부 상태와 무관하게 `API Hosts` 행이 본문에 없다.**(모드 게이트 — 과거 e2e mutation으로 한 번 뚫린 지점)
- `e2e/draft-resume.spec.ts` — **로그 첨부 ON 상태로 저장한 초안을 그대로 재제출하면 본문이 라이브 즉시 제출과 같은 `재현 환경` 행 집합을 갖는다.**(두 경로 파리티)

### 수동 테스트 (Chrome — 자동화 불가)

`pnpm build` 선행 후 확장을 다시 로드한다(dist stale 헛테스트 방지).

- [ ] **항목 14 — 복원 세션의 인스펙터 갱신** (design.md 위험 6: 유닛으로 못 고정한다. `picker.ts`는 시트 주입 → `onCacheReloaded` 발화 → `requestIdleCallback`의 브라우저 실동작이고, jsdom으로 재현 불가하며 e2e도 스타일시트 교체 타이밍을 못 잡는다 — **수동이 유일한 그물**)
  - [ ] 다크모드 토글이 있는 페이지에서 요소를 선택 → 사이드패널을 **닫았다 다시 연다**(복원 세션 진입)
  - [ ] 복원된 세션에서 페이지 다크모드를 토글한다 → 요소 인스펙터 hover 카드의 CSS 값이 **새 시트 기준으로 갱신**된다(옛 값·hex 폴백이 아니다)
  - [ ] SPA 라우트 이동으로 스타일시트가 교체될 때도 동일하게 갱신된다
  - [ ] 시작 세션(패널을 안 닫은 경우)의 기존 동작에 회귀가 없다
- [ ] **항목 13 — 마이그레이션 abort 창 확인만** (design.md 위험 1 [치명]. `issues-store`엔 렌더 게이트가 없어 — `App.tsx:224`는 `editorHydrated`·`settingsHydrated`만 본다 — migrate가 throw한 세션은 이슈 목록이 **정상적으로 비어 보이고**, 그 상태에서 초안을 하나라도 저장하면 `api.setState`가 `setItem()`을 태워 구버전 봉투를 새 v5 봉투로 덮어쓴다. **이 창은 `failClosedLocalStorage` 읽기 실패 경로에 이미 존재하는 기존 위험이고 항목 13이 새로 만드는 것이 아니다.** 아래는 그 사실을 확인만 하는 항목이고 **완화는 이 배치 밖이다 — 배너·토스트를 스코프로 끌어들이지 않는다**)
  - [ ] v1 봉투 + IDB 실패를 인위로 만든 상태에서 패널을 열면 이슈 목록이 빈 화면으로 보인다(= 사용자가 실패를 구분할 수 없다는 사실 확인)
  - [ ] 그 세션에서 저장하지 않고 확장을 재기동하면, IDB가 정상일 때 **원본 이슈가 그대로 복구**된다(throw가 저장소 봉투를 보존했다는 증거)
  - [ ] 부분 성공 잔여물 확인 — before 성공 후 after abort 시 `${issueId}:before` blob이 남고, 재시도에서 같은 키에 `put`으로 덮인다(위험 2, 누수 아님을 확인만)
- [ ] **항목 18 — 설정 보존**: 기존 프로필에서 확장을 다시 로드했을 때 테마·로케일·본문 구성·BYOK 설정이 **초기화되지 않는다**(persist 키 오타는 타입 에러가 안 난다)
  - [ ] background 에러 문자열이 사용자 로케일을 따른다(ko 설정에서 한국어) — `bg-init.ts` 미러링 생존 확인
- [ ] **항목 76**: 스크린샷 어노테이션 중 DOM Tree 다이얼로그를 열면 어노테이션 overlay host가 **트리에 안 보이고**, picker overlay host도 여전히 안 보인다

## 구현 순서 권장

```
[체인 A — 항목 12, 순차 필수]
  Task 1 (헬퍼+테스트) → Task 2 (라이브 교체·골든 diff 0) → Task 3 (스키마) → Task 4 (기록) → Task 5 (draft strip)

[체인 B — 항목 13, 단독]
  Task 6

[독립 — 서로 병렬 가능, 체인 A·B와도 병렬]
  Task 7(14) · Task 8(17 문서) · Task 9(18) · Task 10(71) · Task 11(73 문서) · Task 12(74) · Task 13(75 주석) · Task 14(76)
```

- **Task 1 → 2는 반드시 붙여서** 한다. 헬퍼만 만들고 라이브를 안 바꾸면 같은 판정이 두 벌로 존재하는 구간이 생긴다. Task 2에서 골든 diff 0을 확인해야 **그 다음 태스크들이 "정상 경로는 이미 안전하다"를 전제**할 수 있다.
- **Task 3 → 4 → 5는 design.md가 정한 순서**다. 재료(스키마) 없이 4를 하면 타입 에러, 4 없이 5를 하면 새 초안까지 `lastDerived`가 `undefined`로 읽혀 strip이 영영 no-op가 된다(결함이 그대로 남고 테스트만 green).
- **Task 6은 체인 A와 같은 파일(`issues-store.ts`)을 건드린다** — Task 3과 동시 편집하면 충돌한다. 한쪽을 먼저 끝내거나 같은 세션에서 순차로 처리한다.
- **Task 8·11은 문서 전용이라 언제 해도 되지만 커밋을 분리**한다(`docs(ARCHITECTURE): ...` / `docs(DIRECTORY): ...`). Task 8은 항목 12 완료 후에 하면 `IssueRecord` 선례 목록 갱신 여부를 한 번에 판단할 수 있다.
- **Task 12는 `bodyOutputGolden` 스냅샷을 공유**한다 — Task 2와 동시에 진행하면 골든이 깨졌을 때 원인 분리가 어렵다. 둘 중 하나를 먼저 green으로 확정한 뒤 다른 쪽을 얹는다.
- 마지막에 전체 `pnpm typecheck` + `pnpm test` + `pnpm test:e2e`(최소 `api-hosts-env-row.spec.ts`·`draft-resume.spec.ts`)로 닫는다.

## 가이드 영향

**없음.**

근거: 항목 12의 사용자 노출 변화는 **저장된 초안 재제출 시 본문에서 `API Hosts` 자동 행이 빠지는 것**인데, 가이드가 이 행을 설명하는 4개 파일(`guide/ko/screenshot/issue.md:15`·`guide/ko/video/issue.md:15`·`guide/en/screenshot/issue.md:15`·`guide/en/video/issue.md:15`)은 전부 **라이브 초안 작성 화면**을 기술한다. 그 서술("로그를 함께 첨부하는 캡처라면 이 행이 붙는다" + `guide/AUTHORING.md:129`의 "행이 안 생기는 조건 ② 로그 첨부 off")은 이 변경 **이후에 오히려 더 정확해진다** — 항목 12는 draft 경로를 가이드가 이미 설명한 라이브 규칙에 맞추는 것이기 때문이다. `guide/ko/SUMMARY.md`·`guide/en/SUMMARY.md` 어디에도 "저장된 초안 재제출"을 다루는 페이지가 없어 고칠 문장 자체가 없다.

항목 14는 **복구**(현재 죽어 있는 갱신이 되살아나는 것)라 가이드가 기술한 정상 동작과 이미 일치하고, 나머지(13·17·18·71·73~76)는 실패 정책·상수화·문서·주석 정합이라 화면·본문이 안 바뀐다. 스크린샷 재촬영(`/guide-shots`)도 대상 없음.
