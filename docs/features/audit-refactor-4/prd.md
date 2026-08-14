# audit-refactor-4 — 세션·데이터 정합

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다.

## 코드 기준 갱신 (v1.7.23 재검증 — 2026-08-14)

이 문서는 커밋 `225efb7b`(v1.7.18) 시점 감사 결과를 옮긴 것이고, v1.7.20까지 한 번 리베이스됐다. **그 뒤 v1.7.21~23이 들어왔고 `/feature-review`로 전수 재검증했다**(HEAD `34ac3380`).

**해소·축소된 항목이 둘, 제외한 항목이 하나 있다:**

- **항목 17 (절반 해소)** — 코드는 이제 `version: 11`(v11 = `bodyLocale`, v1.7.21)이고 **`docs/DIRECTORY.md:99`는 이미 v11까지 갱신 완료**다. 남은 stale은 `docs/ARCHITECTURE.md:622` **한 곳뿐**이며 목표 버전은 v10이 아니라 **v11**이다. 이전 판의 "v9 → v10" 지시를 그대로 실행하면 DIRECTORY가 **되돌아간다**.
- **항목 13 (배치에서 제외)** — `git show v1.0.1:src/store/issues-store.ts`가 이미 `version: 2`라 **v0/v1 봉투는 릴리스된 적이 없다**. 결함은 실재하나 대상 인구가 공집합이라 이번 배치에서 뺐다(tasks.md Task 6에 보류 사유·재개 조건 기록).
- **항목 12 (범위 확대)** — `stripSubmitted`(`issues-store.ts:38-59`)가 필드를 **열거식으로** 비우므로 신규 `apiHostsDerived`가 제출 후에도 살아남는다. 그 필드를 비우는 작업이 편입됐다.

**나머지(12·14·18·71·73~76)는 그대로 유효하다.** 다만 **인용 줄번호가 대부분 밀렸다** — `editor-store.ts` +20, `DraftDetailDialog.tsx` +13~22, `settings-ui-store.ts` +6~16, `buildEditorCapture.ts` +2~4, `picker.ts` +4, `apiHostRow.ts` +1~2. 이전 판이 적었던 "나머지 인용 파일의 줄번호는 그대로다"는 **거짓이 됐다.**

**검증 그물 하나가 공허했다는 것도 이때 드러났다**: `bodyOutputGolden.test.ts`는 ctx 리터럴을 직접 조립하고 `buildEditorMarkdownContext()`를 호출하지 않아 스냅샷에 `API Hosts`·`inline:`이 각 0회다. 항목 12·74의 "골든 diff 0" 검증은 **게이트를 뒤집어도 통과**한다(POSTMORTEM 2026-08-12의 재발). 진짜 그물은 `buildEditorCapture.test.ts`에 신설하는 환경 행 케이스다.

**배치 5와 공유 태스크가 생겼다**: 항목 14와 배치 5 D-1이 `picker.ts`의 같은 overlay 재생성 블록을 고치므로 tasks.md Task 7로 합쳤다.

## 사용자 노출 변화

대부분은 내부 정합·문서 수정이지만 **두 항목은 사용자에게 보인다**.

- **항목 12 (본문과 화면이 함께 바뀐다)**: 저장된 초안을 나중에 재제출할 때, 초안 상세에서 **로그 첨부를 끈 상태**면 `재현 환경`의 `API Hosts` 자동 행이 이슈 본문에서 **빠진다**(현재는 로그를 껐어도 8개 플랫폼 본문·Slack 메시지·`logs.html` Report 탭에 그대로 실린다). 라이브 캡처 → 즉시 제출 경로는 이미 이렇게 동작하므로, 이 변경은 **두 경로를 같게 만드는 것**이다. **초안 상세 화면의 `재현 환경` 블록에서도 같이 사라진다**(2026-08-14 편입) — 그러지 않으면 화면엔 보이는데 본문엔 없는 상태가 되기 때문이다. 사용자가 값을 고친 행과 직접 추가한 행은 로그 토글과 무관하게 그대로 남는다. 판정 재료(`apiHostsDerived`)를 담지 못한 **기존 저장 초안은 지금과 동일하게 자동 행을 유지**한다(하위호환 근거는 design.md).
- **항목 12 (보이지 않는 변화 하나 더)**: 제출이 끝난 이슈 레코드에서 `apiHostsDerived`가 함께 비워진다. 지금은 제출 후에도 캡처 문맥이 남을 자리인데, 사내 호스트명이 로컬에 무기한 잔류할 이유가 없다.
- **항목 14 (동작이 복구된다)**: 패널을 닫았다 열어 편집 세션이 복원된 뒤에도, 페이지의 스타일시트가 교체되면(다크모드 토글·SPA 라우트 이동) 요소 인스펙터의 CSS 값이 다시 수집된다. 현재는 복원 세션에서만 이 갱신이 죽어 있어 hover 카드가 옛 값·hex 폴백을 보여준다.

나머지(17·18·71·73~76)는 상수화·문서·주석 정합이라 정상 경로의 화면·본문이 바뀌지 않는다. **항목 13은 배치에서 제외됐다**(위 §코드 기준 갱신).

## 배치 지도

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| ~~audit-refactor-1~~ (완료·문서 삭제) | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| ~~audit-refactor-2~~ (완료·문서 삭제) | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| ~~audit-refactor-3~~ (완료·문서 삭제) | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| **audit-refactor-4** | **세션·데이터 정합** | **🟡12,14,17,18 · ⚪71,73~76** (13 제외) | **중** |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

세션·영속 저장에 실리는 데이터가 **경로에 따라 갈리는** 결함을 묶었다. 셋 다 같은 형태다 — 라이브 경로엔 가드가 있는데 복원·재제출 경로엔 없거나(12·14), 같은 저장소의 두 실패 정책이 서로 반대이거나(13), 크로스레이어 계약의 한쪽만 상수로 보호돼 있다(18).

- **항목 12** — `API Hosts` 자동 행은 로그 첨부 게이트에 묶인 파생물이라 라이브 제출 ctx(`src/sidepanel/lib/buildEditorCapture.ts:55-59`)가 `stripApiHostsRows`로 한 번 더 막는다. 그런데 저장된 초안의 재제출 ctx(`src/sidepanel/tabs/DraftDetailDialog.tsx:352`)는 `environment: issue.draft.environment ?? []`로 직통이다. 같은 다이얼로그가 로그 첨부 토글(`:924`·`:1001` → `patchIssue({logsAttached})`)을 제공하므로, 사용자가 로그를 끈 초안에서도 자동 행이 8개 빌더 본문에 실린다. **호출 한 줄 추가로는 못 막는다** — `stripApiHostsRows(rows, lastDerived)`는 `row.value === lastDerived`로 "사용자가 손 안 댄 행"을 판정하는데, `IssueRecord`에 `apiHostsDerived` 대응 필드가 없어 재료 자체가 없다. **스키마 확장이 선행**돼야 한다.
- **항목 13** — `migrateIssuesState`의 v<2 이미지 이관(`src/store/issues-store.ts:294-307`)이 `saveImageBlobRaw` 실패를 `catch {}`로 삼키고 `hasBefore/hasAfter=false`로 확정한다. 원본 dataURL은 그 자리에서 폐기되고 version 5 봉투가 기록되므로 **복구 경로가 없다**. 같은 파일의 rehydrate 경로(`shouldPruneAfterRehydrate`, `:64`)와 저장소 어댑터(`failClosedLocalStorage`, `src/store/chrome-storage.ts:39`)는 fail-closed인데 migrate만 fail-open이다.
- **항목 14** — `handleSelectByPath`(`src/content/picker.ts:1214-1238`)의 overlay 재생성 분기가 `startCssCacheObserver()`·`ensureCssCacheLoaded()`는 부르면서 `setOnCacheReloaded(scheduleInspectorRefresh)`를 재등록하지 않는다. 등록은 `handleStart`(`:608`)에만 있고 `handleClear`(`:656`)가 null로 되돌리므로, 복원 세션은 훅이 죽은 채 산다.
- **항목 17** — `settings-ui-store` persist `version: 11`(`src/store/settings-ui-store.ts:284`, v11 = `bodyLocale`)인데 `docs/ARCHITECTURE.md:622`는 v10에 멈춰 있다. **문서 stale이지 코드 결함이 아니다** — `migrateSettingsUi`는 버전 비교 없는 nullish 정규화 + `mergePersistedSettings` 재정규화라 멱등하다. `docs/DIRECTORY.md:99`는 **이미 v11로 갱신돼 있어 대상이 아니다.**
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

1. **라이브 제출 본문이 바뀌지 않는가** (항목 12) — `buildEditorCapture.ts`의 게이트를 공용 헬퍼로 옮기는 과정에서 로그 ON일 때의 통과 동작이 바뀌면 정상 경로 전체가 영향을 받는다. **그물은 `buildEditorCapture.test.ts`에 신설하는 환경 행 케이스다** — `bodyOutputGolden.test.ts`는 이 경로를 지나지 않아(ctx 리터럴 직접 조립, 스냅샷에 `API Hosts` 0회) 근거가 못 된다. 기존 `buildEditorCapture.test.ts`도 `environment: []`만 써서 커버리지가 0이었다.
2. **사용자가 고친 행이 살아남는가** (항목 12) — `syncApiHostsRow`의 `promoteEditedRow`는 effect 재실행 시에만 돌고 deps에 `draft`가 없다(`DraftingPanel.tsx:636-643`). 즉 **값을 고쳤지만 `source:"api-hosts"`가 아직 붙어 있는 행이 저장될 수 있다**. `value === lastDerived` 비교가 그 행을 지키는 유일한 장치이므로, strip을 "source 태그만 보고 지우기"로 단순화하면 사용자 입력이 소실된다.
3. **구 초안(필드 없음)이 지금과 다르게 동작하지 않는가** (항목 12) — `apiHostsDerived`가 `undefined`인 레코드에서 strip이 발화하면 안 된다.
4. **element 모드에 자동 행이 새지 않는가** (항목 12) — `apiHostRowFor`의 모드 게이트는 e2e가 mutation으로 한 번 뚫린 전례가 있다(POSTMORTEM 2026-07-31). 새 헬퍼도 같은 게이트를 통과해야 하고, 게이트를 컴포넌트가 아니라 lib에 두는 이유(`apiHostRow.ts:61-62`)가 그대로 적용된다 — `DraftDetailDialog`에도 테스트 파일이 없다.
5. ~~**v<2 사용자의 이슈가 사라지지 않는가**~~ / ~~**부분 성공의 잔여물**~~ (항목 13) — 배치에서 제외. 다시 볼 때 참고: zustand는 `api.setState`를 패치하므로 창을 여는 것은 "새 초안 저장"만이 아니라 `patchIssue`·`removeIssue`·`markSubmitted`를 포함한 **모든 store 액션**이다.
6. **제출 후 잔류가 없는가** (항목 12, 신규) — `stripSubmitted`의 필드 비우기는 열거식이라 새 필드가 자동으로 살아남는다. `apiHostsDerived`가 제출 처리 후 `undefined`인지 단위 테스트로 고정한다.
7. **복원 세션의 인스펙터 갱신** (항목 14) — 유닛으로 못 고정한다(`picker.ts`는 브라우저 실동작). 수동 체크리스트로 내린다. **등록만 되살리고 priming을 빼면 증상의 절반(복원 직후 옛 값)이 남는다** — tasks.md Task 7이 둘 다 넣는다.
8. **background 로케일 미러링** (항목 18) — `bg-init.ts`의 키가 store와 어긋나면 타입 에러 없이 background 에러 문자열만 조용히 영어로 굳는다.
9. **DOM Tree에 자체 overlay가 안 보이는가** (항목 76) — `ANNOTATION_HOST_ID` 제외를 추가할 때 `HOST_ID` 제외가 유지되는지 함께 본다(교체가 아니라 OR로 얹기 — POSTMORTEM **2026-08-06** `:286`의 "교체가 아니라 AND로 얹기" 함정. 2026-08-04로 적었던 이전 인용은 오류였고 그날 항목 3건은 전부 무관하다).
10. **화면과 본문이 갈리지 않는가** (항목 12, 신규) — `EnvBlock`이 `buildCtxForSubmit`을 지나지 않으므로, 본문만 고치면 초안 상세 화면엔 행이 그대로 남는다. 두 소스를 같은 함수로 모은다.

## 성공 기준

- `pnpm typecheck` · `pnpm test` green, `pnpm test:e2e`에서 `api-hosts-env-row.spec.ts`·`draft-resume.spec.ts` green.
- 항목 12: `IssueRecord.apiHostsDerived`가 4개 `confirmDraft` 분기 전부에서 명시적으로 기록되고, 라이브·draft **두 제출 경로와 `EnvBlock` 표시 경로가 같은 순수 함수**를 호출한다. 구 초안(필드 없음)에서 strip이 no-op임과 `stripSubmitted`가 그 필드를 비움을 단위 테스트가 고정한다. **`buildEditorCapture.test.ts`의 신설 환경 행 케이스가 그물이다**(골든이 아니다).
- ~~항목 13~~: 배치에서 제외.
- 항목 14: `handleSelectByPath`의 overlay 재생성 분기가 `setOnCacheReloaded(scheduleInspectorRefresh)`**와 priming**을 포함하고, theme이 재생성 3경로 전부에 적용된다. 수동 체크리스트(복원 세션 + 다크모드 토글 + 패널 재오픈 후 테마)로 실동작 확인.
- 항목 17: `docs/ARCHITECTURE.md:622`가 settings-ui **v11**과 `bodyLocale`을 반영한다. `docs/DIRECTORY.md`는 이미 반영돼 있어 diff 0. 코드 변경 0.
- 항목 18: `"bugshot-app-settings"` 리터럴이 **프로덕션 코드에 정확히 1개**(상수 정의)만 남는다 — `grep -rn '"bugshot-app-settings"' src/`로 확인(값 잠금 테스트의 리터럴은 제외 — tasks.md Task 9).
- 항목 71: `PLATFORM_FALLBACK_ORDER`에서 플랫폼 하나를 지우면 `pnpm typecheck`가 실패한다(뮤테이션으로 증명).
- 항목 73·75: 문서·주석이 코드 동작과 일치한다. 코드 변경 0(73)/주석만(75).
- 항목 74: `inline:` 리터럴 생성이 헬퍼 1곳으로 모이고 3개 호출부가 그것을 쓴다.
- 항목 76: `dom-describe.test.tsx`가 어노테이션 host 제외를 고정한다.
