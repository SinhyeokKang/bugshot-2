# audit-refactor-4 — 세션·데이터 정합

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다.

## 코드 기준 갱신 (v1.7.19 + N-way 로케일 인프라 이후)

이 문서는 커밋 `225efb7b`(v1.7.18) 시점 코드로 감사한 결과를 옮긴 것이고, 그 뒤 v1.7.19와 **N-way 로케일 인프라 대공사**(프랑스어 추가 준비 — `src/i18n/locales.ts` 신설, `LocaleMode`·`detectLocale`·`normalizeLocale`이 store에서 그쪽으로 이관)가 리베이스로 들어왔다. **재검증 결과 이 배치의 항목은 하나도 해소되지 않았다** — 12·13·14·71·73~76은 인용 파일이 아예 안 바뀌었고, 17은 여전히 문서 v9 / 코드 v10, 18은 여전히 리터럴 5벌(+테스트 1벌)이다.

바뀐 건 **인용한 코드의 모습과 줄번호**뿐이라 그 부분만 갱신했다: `src/store/settings-ui-store.ts`(로케일 정규화 한 줄 추가 + `mergePersistedSettings` named export 추출로 전 구간 하향 이동)·`src/i18n/bg-init.ts`(`@/i18n/locales` import 2줄 추가로 +3행)·`docs/ARCHITECTURE.md`(500번대 이후 +6행). 나머지 인용 파일의 줄번호는 그대로다.

## 사용자 노출 변화

대부분은 내부 정합·문서 수정이지만 **두 항목은 사용자에게 보인다**.

- **항목 12 (본문이 바뀐다)**: 저장된 초안을 나중에 재제출할 때, 초안 상세에서 **로그 첨부를 끈 상태**면 `재현 환경`의 `API Hosts` 자동 행이 이슈 본문에서 **빠진다**(현재는 로그를 껐어도 8개 플랫폼 본문·Slack 메시지·`logs.html` Report 탭에 그대로 실린다). 라이브 캡처 → 즉시 제출 경로는 이미 이렇게 동작하므로, 이 변경은 **두 경로를 같게 만드는 것**이다. 사용자가 값을 고친 행과 직접 추가한 행은 로그 토글과 무관하게 그대로 남는다. 판정 재료(`apiHostsDerived`)를 담지 못한 **기존 저장 초안은 지금과 동일하게 자동 행을 유지**한다(하위호환 근거는 design.md).
- **항목 14 (동작이 복구된다)**: 패널을 닫았다 열어 편집 세션이 복원된 뒤에도, 페이지의 스타일시트가 교체되면(다크모드 토글·SPA 라우트 이동) 요소 인스펙터의 CSS 값이 다시 수집된다. 현재는 복원 세션에서만 이 갱신이 죽어 있어 hover 카드가 옛 값·hex 폴백을 보여준다.

나머지(13·17·18·71·73~76)는 실패 정책·상수화·문서·주석 정합이라 정상 경로의 화면·본문이 바뀌지 않는다.

## 배치 지도

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| ~~audit-refactor-1~~ (완료·문서 삭제) | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| ~~audit-refactor-2~~ (완료·문서 삭제) | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| audit-refactor-3 | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| **audit-refactor-4** | **세션·데이터 정합** | **🟡12~14,17,18 · ⚪71,73~76** | **중** |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

세션·영속 저장에 실리는 데이터가 **경로에 따라 갈리는** 결함을 묶었다. 셋 다 같은 형태다 — 라이브 경로엔 가드가 있는데 복원·재제출 경로엔 없거나(12·14), 같은 저장소의 두 실패 정책이 서로 반대이거나(13), 크로스레이어 계약의 한쪽만 상수로 보호돼 있다(18).

- **항목 12** — `API Hosts` 자동 행은 로그 첨부 게이트에 묶인 파생물이라 라이브 제출 ctx(`src/sidepanel/lib/buildEditorCapture.ts:55-59`)가 `stripApiHostsRows`로 한 번 더 막는다. 그런데 저장된 초안의 재제출 ctx(`src/sidepanel/tabs/DraftDetailDialog.tsx:352`)는 `environment: issue.draft.environment ?? []`로 직통이다. 같은 다이얼로그가 로그 첨부 토글(`:924`·`:1001` → `patchIssue({logsAttached})`)을 제공하므로, 사용자가 로그를 끈 초안에서도 자동 행이 8개 빌더 본문에 실린다. **호출 한 줄 추가로는 못 막는다** — `stripApiHostsRows(rows, lastDerived)`는 `row.value === lastDerived`로 "사용자가 손 안 댄 행"을 판정하는데, `IssueRecord`에 `apiHostsDerived` 대응 필드가 없어 재료 자체가 없다. **스키마 확장이 선행**돼야 한다.
- **항목 13** — `migrateIssuesState`의 v<2 이미지 이관(`src/store/issues-store.ts:294-307`)이 `saveImageBlobRaw` 실패를 `catch {}`로 삼키고 `hasBefore/hasAfter=false`로 확정한다. 원본 dataURL은 그 자리에서 폐기되고 version 5 봉투가 기록되므로 **복구 경로가 없다**. 같은 파일의 rehydrate 경로(`shouldPruneAfterRehydrate`, `:64`)와 저장소 어댑터(`failClosedLocalStorage`, `src/store/chrome-storage.ts:39`)는 fail-closed인데 migrate만 fail-open이다.
- **항목 14** — `handleSelectByPath`(`src/content/picker.ts:1214-1238`)의 overlay 재생성 분기가 `startCssCacheObserver()`·`ensureCssCacheLoaded()`는 부르면서 `setOnCacheReloaded(scheduleInspectorRefresh)`를 재등록하지 않는다. 등록은 `handleStart`(`:608`)에만 있고 `handleClear`(`:656`)가 null로 되돌리므로, 복원 세션은 훅이 죽은 채 산다.
- **항목 17** — `settings-ui-store` persist `version: 10`(`src/store/settings-ui-store.ts:268`, v10 = `aiLanguage`)인데 `docs/ARCHITECTURE.md:582`·`docs/DIRECTORY.md:96`은 v9로 고정돼 있다. **문서 stale이지 코드 결함이 아니다** — `migrateSettingsUi`(`:133-158`)는 버전 비교 없는 nullish 정규화 + `mergePersistedSettings`(`:162-175`) 재정규화라 멱등하다.
- **항목 18** — persist 키 `"bugshot-app-settings"`가 `src/store/settings-ui-store.ts:266`에 하드코딩돼 있고, `src/i18n/bg-init.ts:17,18,23,24`가 같은 리터럴 4벌로 background에서 봉투를 직접 파싱한다. 다른 두 영속 키는 **정확히 이 크로스레이어 이유로** 상수화돼 있다(`ISSUES_PERSIST_KEY` in `src/lib/session-keys.ts:21` — blob-db GC가 직독 / `SETTINGS_STORAGE_KEY` in `src/lib/settings-storage.ts:10` — background 인증 봉투 직독). `docs/ARCHITECTURE.md:580`이 경고한 "조용히 깨지는" 2계약 중 한쪽만 무보호다.
- **항목 71·73~76** — 구조 취약점·문서/주석 드리프트·헬퍼 부재. 현재 오동작은 76(어노테이션 중 DOM Tree에 자체 overlay host 노출)뿐이다.

## 목표

1. **자동 행 판정을 라이브·draft 두 경로가 공유한다** — `IssueRecord`에 판정 재료를 싣고, 제출 직전 `environment` 게이트를 순수 함수 단일 초크포인트로 만들어 두 호출부가 같은 함수를 쓴다.
2. **`issues-store`의 실패 정책을 fail-closed로 통일한다** — 마이그레이션이 이미지 blob 저장에 실패하면 원본 dataURL을 폐기하지 않고, 구버전 봉투를 저장소에 남긴 채 다음 기동에서 재시도한다.
3. **복원 세션이 시작 세션과 같은 훅을 갖는다** — overlay를 재생성하는 경로가 시트 교체 콜백도 함께 재등록한다.
4. **크로스레이어 계약을 상수로 잠근다** — `bugshot-app-settings` 리터럴 5벌을 background에서 안전하게 import 가능한 단일 상수로 모은다.
5. **문서·주석이 코드와 일치한다** — settings-ui v10, pending prune 플래그 서술, `finalizeCustomProps` memo 주석.
6. **감사 연번을 태스크까지 유지**한다(12·13·14·17·18·71·73·74·75·76).

## 비목표 (Non-goals)

- `API Hosts` 파생 규칙(동족 도메인 판정·정렬·표시 형식) 변경. `deriveApiHostsRow`·`registrableDomain`은 손대지 않는다.
- `DraftDetailDialog`에 `재현 환경` 편집 UI 추가. 현재 읽기 전용(`EnvBlock`, `:1212-1245`)이고 이 배치는 그 상태를 전제로 설계한다.
- `issues-store` persist 버전 bump. 항목 12의 필드는 비파괴 optional이라 `ISSUES_STORE_VERSION = 5`를 유지한다(근거는 design.md).
- 마이그레이션 실패를 사용자에게 알리는 토스트·배너 신설. `onStateSaveFailed`류 신호는 모듈 로드 시점 hydrate를 못 받는 구조(비재생 pub/sub)라 별건이다.
- 항목 73의 개별 delete 실패 전파. 실패 방향이 "미삭제"라 무해하므로 **문서를 코드에 맞춘다**(코드를 문서에 맞추지 않는다).
- 항목 71을 `Record<PlatformId, number>` 같은 다른 자료구조로 바꾸는 리팩터. `satisfies`로 컴파일 강제만 건다.
- 항목 74의 `INLINE_REF_RE` 파싱 쪽 변경. 생성기 헬퍼만 추가하고 정규식은 그대로 둔다.

## 회귀 감시 지점

사용자 시나리오 대신, 이 배치가 건드리는 경로에서 **깨지면 조용한** 지점을 나열한다.

1. **라이브 제출 본문이 바뀌지 않는가** (항목 12) — `buildEditorCapture.ts`의 게이트를 공용 헬퍼로 옮기는 과정에서 로그 ON일 때의 통과 동작이 바뀌면 정상 경로 전체가 영향을 받는다. `bodyOutputGolden.test.ts`·`buildEditorCapture.test.ts`가 그물.
2. **사용자가 고친 행이 살아남는가** (항목 12) — `syncApiHostsRow`의 `promoteEditedRow`는 effect 재실행 시에만 돌고 deps에 `draft`가 없다(`DraftingPanel.tsx:636-643`). 즉 **값을 고쳤지만 `source:"api-hosts"`가 아직 붙어 있는 행이 저장될 수 있다**. `value === lastDerived` 비교가 그 행을 지키는 유일한 장치이므로, strip을 "source 태그만 보고 지우기"로 단순화하면 사용자 입력이 소실된다.
3. **구 초안(필드 없음)이 지금과 다르게 동작하지 않는가** (항목 12) — `apiHostsDerived`가 `undefined`인 레코드에서 strip이 발화하면 안 된다.
4. **element 모드에 자동 행이 새지 않는가** (항목 12) — `apiHostRowFor`의 모드 게이트는 e2e가 mutation으로 한 번 뚫린 전례가 있다(POSTMORTEM 2026-07-31). 새 헬퍼도 같은 게이트를 통과해야 하고, 게이트를 컴포넌트가 아니라 lib에 두는 이유(`apiHostRow.ts:61-62`)가 그대로 적용된다 — `DraftDetailDialog`에도 테스트 파일이 없다.
5. **v<2 사용자의 이슈가 사라지지 않는가** (항목 13) — migrate가 throw하면 zustand는 `set()`도 `setItem()`도 실행하지 않는다(저장소 봉투 보존, prune 스킵). 하지만 그 세션의 이슈 목록은 **빈 상태로 보이고**, 그 상태에서 새 초안을 저장하면 `api.setState`가 `setItem()`을 태워 **구버전 봉투를 새 v5 봉투로 덮어쓴다**. 이 하자는 `failClosedLocalStorage` 읽기 실패 경로에 이미 존재하는 기존 위험이지만, 항목 13이 그 창을 한 갈래 더 여는지 반드시 확인한다.
6. **부분 성공의 잔여물이 고아가 되지 않는가** (항목 13) — before는 저장되고 after가 실패해 abort하면 `${issueId}:before` blob이 남는다. prune은 같은 기동에서 스킵되고, 재시도 시 같은 키에 `put`으로 덮이는지 확인.
7. **복원 세션의 인스펙터 갱신** (항목 14) — 유닛으로 못 고정한다(`picker.ts`는 브라우저 실동작). 수동 체크리스트로 내린다.
8. **background 로케일 미러링** (항목 18) — `bg-init.ts`의 키가 store와 어긋나면 타입 에러 없이 background 에러 문자열만 조용히 영어로 굳는다.
9. **DOM Tree에 자체 overlay가 안 보이는가** (항목 76) — `ANNOTATION_HOST_ID` 제외를 추가할 때 `HOST_ID` 제외가 유지되는지 함께 본다(교체가 아니라 OR로 얹기 — POSTMORTEM 2026-08-04의 "게이트 교체" 함정).

## 성공 기준

- `pnpm typecheck` · `pnpm test` green, `pnpm test:e2e`에서 `api-hosts-env-row.spec.ts`·`draft-resume.spec.ts` green.
- 항목 12: `IssueRecord.apiHostsDerived`가 4개 `confirmDraft` 분기 전부에서 명시적으로 기록되고, 라이브·draft 두 제출 경로가 **같은 순수 함수**를 호출한다. 구 초안(필드 없음)에서 strip이 no-op임을 단위 테스트가 고정한다.
- 항목 13: `saveImageBlobRaw` 실패 시 `migrateIssuesState`가 throw하고, 그 경로에서 `shouldPruneAfterRehydrate`가 false를 반환함을 단위 테스트가 고정한다. 성공 경로 동작은 불변.
- 항목 14: `handleSelectByPath`의 overlay 재생성 분기가 `setOnCacheReloaded(scheduleInspectorRefresh)`를 포함하고, 수동 체크리스트(복원 세션 + 다크모드 토글)로 실동작 확인.
- 항목 17: `docs/ARCHITECTURE.md:582`·`docs/DIRECTORY.md:96`이 settings-ui v10과 `aiLanguage`를 반영한다. 코드 변경 0.
- 항목 18: `"bugshot-app-settings"` 리터럴이 **프로덕션 코드에 정확히 1개**(상수 정의)만 남는다 — `grep -rn '"bugshot-app-settings"' src/`로 확인(값 잠금 테스트의 리터럴은 제외 — tasks.md Task 9).
- 항목 71: `PLATFORM_FALLBACK_ORDER`에서 플랫폼 하나를 지우면 `pnpm typecheck`가 실패한다(뮤테이션으로 증명).
- 항목 73·75: 문서·주석이 코드 동작과 일치한다. 코드 변경 0(73)/주석만(75).
- 항목 74: `inline:` 리터럴 생성이 헬퍼 1곳으로 모이고 3개 호출부가 그것을 쓴다.
- 항목 76: `dom-describe.test.tsx`가 어노테이션 host 제외를 고정한다.
