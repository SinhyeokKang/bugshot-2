# audit-refactor-7 — 구현 태스크

## 선행 조건

- `docs/POSTMORTEM.md`를 변경 영역으로 grep해 과거 함정을 소환한다(CLAUDE.md 소환 회로). 이 배치에 직접 걸리는 것: 2026-08-16(계획-태스크 불일치)·2026-08-15(import 혼용 반경 오산)·2026-08-14(`ActionLogContent` 톤 이월 — M1이 그 이월분이다)·2026-08-01(cmdk controlled value 역통보)·2026-07-16(단일 출처 승격 주석이 거짓)·2026-07-14(콤보박스 검색어 수명)·2026-06-28(복제 dict 미동기화).
- 새 의존성 없음. 권한·env·OAuth 앱 설정 변경 없음. manifest 변경 없음.
- 신규 i18n 키는 **1개**(`issueList.linear.noStates`) — 반경은 정확히 **2파일 3편집**(`i18n/namespaces/issue.ts` ko/en + 배지). log-viewer 복제 사전과 `public/_locales/`는 **대상 아니다**(각각 `issueList.*` 0건 / manifest 4키뿐).
- `pnpm build`는 돌리지 않는다(CLAUDE.md). 타입 확인은 `pnpm typecheck`. 예외는 Task 6-3의 번들 경계 최종 확인 1회로, 사용자 승인 또는 `/build`로만 한다. **`pnpm build:log-viewer`는 `pnpm test`의 pretest 훅이 이미 매번 돌린다**(`package.json:18`) — 별도 실행이 필요 없다.
- **e2e를 추가하므로 `docs/CI.md`의 spec/테스트 카운트가 대상이다**(Task 13-2).

---

## 항목 ↔ 태스크 대조표

**이 표가 이 문서의 계약이다.** POSTMORTEM 2026-08-16이 "design.md가 편입했다고 명시한 항목이 tasks.md 어느 태스크에도 없어 배치가 조용히 약속을 어길 뻔했다"를 기록했다. 착수 전과 완료 후 두 번 대조하고, 미배정 행이 하나라도 있으면 배치를 닫지 않는다.

| # | 항목 요약 | 그룹 | 태스크 |
|---|---|---|---|
| 1 | 🔴 `IssueCreateModal` 비활성 이유 툴팁 미노출 | G4 | Task 4 |
| 2 | `serializeOAuthError` 401 fallthrough | G5 | Task 5-1 |
| 3 | 토큰 응답 본문 error 미검사 (notion + jira **2건**) | G5 | Task 5-2 |
| 4 | 업로드 응답 4종 판별자 부재 | G5 | Task 5-3 |
| 5 | `scrollCaptureTo` settle 예외 무응답 + `{ok:false}` truthy 오판정 | G1 | Task 1-1 |
| 6 | 클립보드 복사 첫 await가 IDB 왕복 | G3 | Task 3 |
| 7 | css 캐시 실패 promise 영구 메모이즈 | G1 | Task 1-3 |
| 8 | store → `annotation/presets` value import | G6 | Task 6-1 |
| 9 | store → `picker-control` value import | G6 | Task 6-2 |
| 10 | `apply()` read가 activation 큐 밖 | G9 | Task 9 |
| 11 | picker css 보강 IIFE `.catch` 부재 **3곳** | G1 | Task 1-2 |
| 12 | `aria-labelledby` 다중 ID 미파싱 → 마스킹 우회 | G2 | Task 2 |
| 13 | `sidepanel/index.html` `lang` 고정 | G10 | Task 10-1 |
| 14 | `log-viewer/index.html` `lang` 고정 | G10 | Task 10-2 |
| 15 | `FILTER_LABEL` 테이블이 i18n 스캐너 사각 | G10 | Task 10-3 |
| 16 | `markers.ts` 삼항 `t()`가 스캐너 사각 | G10 | Task 10-3 |
| 17 | `LinearStatusBadge` 빈 목록 분기 부재 | G11 | Task 11-1 |
| 18 | `PropertiesFieldset` FieldRow 손복제 + 접근 이름 부재 | G11 | Task 11-2 |
| 19 | `JsonTreeViewer` 클릭 요소 **2곳** 키보드 접근 0 | G11 | Task 11-3 |
| 20 | `LlmConnectForm` 빈 상태 아이콘 muted 누락 | G11 | Task 11-4 |
| 22 | `imageCell` 3벌 + `escapeMdLinkText` 미적용 | G7 | Task 7-2 |
| 23 | `escapeHtml` 사본 드리프트 | G7 | Task 7-1 |
| 25 | `MarkdownIt` 설정 4벌 | G7 | Task 7-3 |
| 30 | frozen phase 집합 3벌 | G7 | Task 7-4 |
| 32 | `setAnnotationTool` 인자 중복 | G12 | Task 12-1 |
| 33 | `readErrorBody` 테스트 0 | G12 | Task 12-2 |
| 34 | import 표기 이탈 2건 + 신규 유입 그물 | G12 | Task 12-3 |
| **M1** | **`ActionLogContent` 톤 드리프트** (POSTMORTEM 2026-08-14 이월) | G7 | Task 7-5 |
| ~~21~~ | ~~`DomTreeDialog` raw button~~ → **드랍**, DESIGN 예외 등재로 소멸 | G11 | Task 11-5 |

> **28행.** #24·#26·#27·#31은 **의도적 제외**(prd.md 스코프 표), #28·#29·#21은 **검수 드랍**(prd.md "검수 드랍"), #59는 ⚪라 애초에 스코프 밖. 배치 종료 시 Task 13-1이 이 사실을 `DROPPED.md`에 옮긴다. **#21은 항목을 고치지 않지만 Task 11-5(DESIGN 등재)가 항목을 소멸시키므로 대조표에 남긴다.**

---

## P0 — 무음 유실 · 행 · Privacy

### Task 0: `labelForText` 이관 + 회귀 그물 선행 (G0)

- **변경 대상**: `src/content/action-recorder.ts`(`labelForText`·`cleanText` 제거), `src/content/action-recorder-helpers.ts`(이관 수신), `src/content/__tests__/action-recorder-helpers.test.tsx`(**신규 파일**), `src/sidepanel/lib/__tests__/issueBodyShared.test.ts`(기존)
- **작업 내용**:
  1. **`labelForText`(`action-recorder.ts:258`)와 `cleanText`(`:253`)를 헬퍼 파일로 순수 이관한다.** `labelForText`는 `actionRecorderScript()`(`:21`) **내부 클로저**이고 그 파일의 `export`는 0건이므로 **이관 없이는 테스트가 import조차 못 한다** — 그래서 이게 Task 0의 첫 단계다. 동작은 한 줄도 안 바꾼다.
  2. **`.tsx`(jsdom) 트랙으로 신규 파일**을 만든다 — `labelForText`가 `document.getElementById`·`CSS.escape`·`closest`를 쓰므로 기존 `action-recorder-helpers.test.ts`(node, 76케이스)에는 못 넣는다. 고정: 단일 ID · `label[for]` · 래핑 label 3경로. **다중 ID는 red로 둔다**(Task 2가 green으로 만든다).
  3. `issueBodyShared.test.ts`에 **`imageCell`이 형제 함수(`defaultVideoEmbed`)와 달리 `escapeMdLinkText`를 안 쓴다**는 red 케이스 1개를 추가한다. **"3벌 출력 대조"는 하지 않는다** — 셋 다 escape가 없고 url 프로퍼티명만 달라 대조가 green이라 약속한 red가 안 뜬다(design.md G0 인용 박스).
  4. **커버리지 실측** — `coverage/baseline.json`이 2026-08-14 생성이라 stale하다. `pnpm coverage:report`로 착수 시점 로직 스코프 %를 재고 그 값을 기록한다(prd 성공기준 5의 기준선).
- **검증**:
  - [ ] `pnpm test` — red가 **정확히 2종**(다중 ID 1 + `escapeMdLinkText` 미적용 1), 나머지 green. 더 많거나 **더 적으면** 감사 리포트가 놓친 게 있다는 신호 — 보고 후 판단
  - [ ] 이관 전후로 `action-recorder.ts`의 기존 유닛 전부 green (순수 이동 확인)
  - [ ] `grep -n "function labelForText" src/content/action-recorder.ts` → 0건
  - [ ] 착수 시점 로직 스코프 % 가 결과에 기록됨

### Task 1-1: 스크롤 캡처 실패 3경로 (G1 · #5)

- **변경 대상**: `src/content/scroll-capture.ts`(`settle`), `src/content/picker.ts:316`, **`src/sidepanel/scroll-capture.ts:81`**
- **작업 내용**: design.md G1 (a)(b)(c) 셋. **이건 한 픽스가 아니라 서로 다른 실패 모드 셋이다.**
  - (a) `settle` 본문의 후보 수집·숨김을 `try/catch`로 감싸 `resolve`가 항상 불리게 한다. **`catch` 안에서 로깅하지 않는다** — 이 파일은 import가 3개뿐이고 로거가 없다(design.md 원안의 `dlogOrConsole`은 존재하지 않는 함수였다). 삼킨다는 사실만 주석으로 남긴다.
  - (b) `picker.scrollCaptureTo` 수신부를 `.then(sendResponse, () => sendResponse(undefined))`로 바꾼다.
  - (c) **오케스트레이터에 shape 가드를 넣는다** — `if (!ack || typeof ack.y !== "number") throw`. 6줄 위 형제 호출(`:58-61` 주석 + `if (!begun?.viewport)`)이 같은 판정을 이미 쓴다.
- **주의**: 실패 시 **절대 `{y: ...}`를 지어내지 않는다.** 그리고 (a)의 throw는 **rAF 콜백 안**이라 promise가 reject되지 않으므로 (b)의 rejection 핸들러로는 **절대 안 잡힌다** — 둘을 하나로 합치려 하지 말 것.
- **검증**:
  - [ ] `src/content/__tests__/scroll-capture.test.ts`에 "후보 수집이 throw해도 promise가 resolve된다" → green
  - [ ] `src/sidepanel/lib/__tests__/`(또는 해당 위치)에 "`deps.send`가 `{ok:false}`를 주면 throw한다" → green — **이게 (c)의 유일한 그물이다**
  - [ ] "`deps.send`가 `undefined`/`null`을 주면 throw한다" → green
  - [ ] 기존 `scroll-capture` 유닛 전부 green (동작 보존)
  - [ ] `grep -n "then(sendResponse)" src/content/picker.ts` → 0건
  - [ ] **e2e에는 넣지 않는다** — (a)는 ISOLATED world 결함 주입 seam이 없어 유도 불가(design.md 위험 ④). 그 사실을 결과에 적는다

### Task 1-2: picker 보강 IIFE `.catch` 부착 (G1 · #11)

- **변경 대상**: `src/content/picker.ts:142`, `:1181`, **`:1216`**
- **작업 내용**: **무보호 async IIFE는 2곳이 아니라 3곳이다.** `grep -c "void (async () =>"` → 4이고 `:239`만 내부 `try/catch`로 보호돼 있다. `:1216`(`ensureCssCacheLoaded`+`ensureCrossOriginLoaded` await, `selectionUpdateTimer` 경로)이 감사가 놓친 세 번째다. 셋 다 `.catch(() => {})`. 지배 패턴은 `respondAfterPaint`(정의 `:369`, `.catch` `:380`)·`area-select.ts`(`.catch` `:42`)다. **삼킨다는 사실과 이유**를 한 줄 주석으로.
- **검증**:
  - [ ] `void (async () =>` 4곳 각각의 **닫는 줄**(`:151`·`:1191`·`:1223` 부근)에 `.catch` 또는 내부 `try/catch`가 있는지 **수동 열거**로 확인 — `grep -A 1`은 `.catch`가 붙는 자리를 못 보므로 판정 수단이 아니다
  - [ ] `pnpm typecheck` green

### Task 1-3: css 캐시 실패 promise 재시도 가능화 (G1 · #7)

- **변경 대상**: `src/content/css-source-cache.ts:57`(`ensureLoaded`)·`:1013`(`ensureCrossOriginLoaded`)
- **작업 내용**: design.md G1의 코드 형태. 실패 시 슬롯을 비우되 **`loadPromise === p` 확인 필수** — `invalidate()`(`:85-90`)가 이미 `null`을 넣으므로, 확인 없이 지우면 invalidate 뒤 새로 깔린 promise를 죽인다.
- **주의**: 이 파일은 **회고 상위 영역**이다. 착수 전 ARCHITECTURE.md "CSSOM shorthand 한계 우회"와 `css-source-cache-epoch.test.tsx`를 읽는다. **`epoch`·`isStaleLoad`·`loadAbortController`·`isReady`는 이미 존재하는 것들**이고(design.md 스니펫이 신규처럼 보이지만 아니다) epoch·stale 판정에는 손대지 않는다.
- **검증**:
  - [ ] `src/content/__tests__/css-source-cache-epoch.test.tsx` 기존 케이스 전부 green
  - [ ] "로드 실패 후 재호출하면 새로 시도한다" → green
  - [ ] "invalidate 뒤 실패한 이전 promise가 새 슬롯을 지우지 않는다" → green

### Task 2: `aria-labelledby` 다중 ID 파싱 (G2 · #12)

- **변경 대상**: `src/content/action-recorder-helpers.ts`(`labelForText` — Task 0이 이관을 끝낸 상태)
- **작업 내용**: `aria-labelledby`를 공백으로 쪼개 각 ID를 조회·연결한다. `document` 의존은 **인자로 빼지 않는다**(요청되지 않은 유연성 — jsdom 트랙이 실제 DOM으로 검증한다).
- **스코프 밖으로 남기는 잔여 2건**(결과에 기록만 — design.md G2):
  - `rawFieldLabel`(`action-recorder.ts:196-210`)·`rawAccessibleName`(`:170-190`)은 `aria-labelledby`를 아예 안 읽는다 → POSTMORTEM 2026-07-14 재발방지(2)의 "마스킹 판정 소스 = 라벨 추출 소스" 요구가 반쪽만 충족된다.
  - `document.getElementById`는 shadow DOM 타깃에서 틀린 트리를 본다(`getRootNode()`가 정답).
- **검증**:
  - [ ] Task 0에서 red였던 "다중 ID" 케이스 green
  - [ ] `<input aria-labelledby="l1 l2">` + 민감 라벨 조합에서 `shouldMaskField`가 `true`를 내는 통합 케이스 → green
  - [ ] 단일 ID·`label[for]`·래핑 label 3경로 무회귀
  - [ ] `grep -rn "getElementById(labelledBy)" src/content/` → 0건

### Task 3: 클립보드 복사 gesture 보존 (G3 · #6)

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx:293-390`(`handleCopyMarkdown`), **e2e 클립보드 스텁 3개**
- **작업 내용**: design.md G3의 형태. 본문 조립을 `buildForCopy(): Promise<{md: string; html: string}>`로 그대로 들어내고, `navigator.clipboard.write`를 클릭 핸들러에서 **동기로** 호출한다. 조립 로직 자체는 한 줄도 바꾸지 않는다.
- **결정적 주의 3개**:
  1. **`text/html` flavor를 지우지 않는다.** 현재 `:381-386`이 **이미** `text/plain` + `text/html` 두 flavor를 쓴다. 단일 flavor로 바꾸면 Jira·Notion·Asana 붙여넣기에서 헤딩·스타일 diff 표·`<img>`가 전부 사라진다 — 노출 회귀다.
  2. **두 flavor를 하나의 공유 promise에서 파생시킨다.** 따로 만들면 `resolveSectionImages` IDB 왕복이 2회다.
  3. **폴백이 그 공유 promise를 참조해야 한다** — `md`를 deferred 안에서만 만들면 `catch` 스코프에 없어 폴백이 컴파일조차 안 된다. `.catch(() => built.then((b) => navigator.clipboard.writeText(b.md)))`.
- **부수**: 원인 서술이 "5초 transient activation"이 아니라 **`hasFocus()`**임을 알고 진행한다. promise-valued `ClipboardItem`은 **Chrome 98+**(116 pin이라 안전).
- **검증**:
  - [ ] `pnpm typecheck` green
  - [ ] 복사 결과 문자열이 기존과 바이트 동일 — `buildForCopy`를 직접 부르는 유닛으로 `md`·`html` **둘 다** 고정
  - [ ] **e2e 스텁 3곳(`freeform-draft.spec.ts:43-48`·`issue-body-locale.spec.ts:55-62`·`code-block-collapse.spec.ts:42-47`)에 `getType("text/html")` 검증 추가 → green** — 안 하면 flavor 소실이 green으로 머지된다. **이게 이 태스크의 유일한 자동 그물이다**
  - [ ] **수동**: 인라인 이미지 3개 이상 프리뷰에서 복사 → Notion·Jira에 붙여넣어 표·이미지 유지 확인

### Task 4: 🔴 제출 버튼 비활성 이유 노출 (G4 · #1)

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx:489-499`, **`src/sidepanel/tabs/__tests__/IssueCreateModal.test.tsx`(신규 파일)**, `e2e/COVERAGE.md`
- **작업 내용**: `IssueTab.tsx:368-389` 구조를 따른다 — `TooltipProvider delayDuration={0}` → `Tooltip` → `TooltipTrigger asChild` → `Button aria-disabled` → `onClick`에 `if (!canOpen) return;` 가드 → `{!canOpen && <TooltipContent className="max-w-60">{t("platform.empty.title")}</TooltipContent>}`. 상위에 `TooltipProvider`가 없으므로 이 자리에 직접 둔다.
- **주의 4개** (design.md G4):
  1. **className은 2종만** — `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`. 선례의 `aria-disabled:hover:bg-background`·`aria-disabled:hover:text-foreground`는 **`variant="outline"` 종속**이고 대상은 default(primary)라 그대로 얹으면 비활성 버튼이 hover에서 하얗게 뒤집힌다.
  2. **`title={tooltip}`(`:499`)을 제거한다** — Radix 툴팁과 native OS 툴팁 이중 노출.
  3. **`aria-disabled={!canOpen}`를 실 boolean으로** 넘긴다 — 활성 시 `"false"`가 렌더돼 Playwright 조상 탐색을 끊는다(이 testid를 클릭하는 5개 스펙의 안전 조건).
  4. `data-testid="issue-submit-open"`(`:496`) 유지.
- **검증**:
  - [ ] **`IssueCreateModal.test.tsx` 신규 생성** — 파일이 없다. 531줄·28 import라 `vi.mock` 하네스가 필요하다(선례 `IssueTab.test.tsx:5-16`)
  - [ ] "연동 0개면 버튼이 `aria-disabled`이고 클릭해도 다이얼로그가 안 열린다" → green
  - [ ] "연동 0개면 툴팁 문구가 렌더된다" / "연동 1개 이상이면 `aria-disabled="false"`이고 툴팁이 없다" → green
  - [ ] `grep -n "title=" src/sidepanel/tabs/IssueCreateModal.tsx` → 제출 버튼에 0건
  - [ ] `e2e/onboarding.spec.ts:109`(`toBeDisabled()`) green — Playwright ^1.60은 `aria-disabled="true"`를 인정한다
  - [ ] `issue-submit-open`을 클릭하는 5개 스펙 green (`jira-project-switch:97`·`jira-project-sticky:94`·`jira-sprint-field:150`·`slack-submit-gating:70`·`clickup-submit-gating:52`)
  - [ ] **신규 e2e**: 무연동 상태에서 제출 버튼 hover → 이유 문구 노출. `onboarding.spec.ts:99-109`의 무시드 경로를 재사용하고, **`TooltipContent`에 `data-testid`를 붙인다**(저장소에 Radix 툴팁을 검증하는 e2e가 0이라 잡을 핸들이 없다)
  - [ ] `e2e/COVERAGE.md:59`의 "disabled 공존" 문구 갱신

---

## P1 — 계약 · 경계 · 단일 출처

### Task 5-1: OAuth 401 레인을 명시 플래그로 뒤집기 (G5 · #2)

- **변경 대상**: `src/background/oauth/errors.ts`(`refreshFailed` 추가), `src/background/oauth.ts:43-60`(`serializeOAuthError`)·`:249-276`(jira refresh), `src/background/lib/createRefreshRunner.ts`(`refreshHook` 호출 2지점 + `:44` 레인 분리), `src/background/notion-api.ts:80`, `src/background/__tests__/connect-reason-coverage.test.ts`(스캔 규칙 추가)
- **작업 내용**: 기본값을 400(플래그 없음)으로 내리고 401은 `error.refreshFailed === true`일 때만.
  - **`refreshFailed` 필드는 options bag + `?? false`** 패턴에 맞춘다(`errors.ts:66-81`) — construction site 무변경.
  - **`oauthConnectFailed` 플래그는 만들지 않는다** — `oauth.ts:40-42` 주석이 소비처 없는 reader 추가를 금지한다.
  - **태깅 지점은 3곳으로 줄인다.** github/gitlab/linear/asana는 전부 `createRefreshRunner`의 `refreshHook` 호출(`:29`·`:41`)을 통과하므로 거기 + jira 직접 경로만. 20여 곳 열거를 하지 않는다.
  - **누락은 소스 전수 스캔으로 잠근다** — `connect-reason-coverage.test.ts` 패턴(그 파일 주석: "호출부 누락이므로 원문 전수 대조로 잠근다"). `HTTP_LANE`이 이미 `token(Exchange|Refresh)`를 매칭하므로 델타가 작다.
- **경계 결정 3건** (반대 방향 회귀 지점 — design.md 위험 ⑥):
  1. **`createRefreshRunner.ts:44`의 단일 throw가 최초 연결 401과 refresh 소진을 공유한다**(`:42-43` 주석 명시). 여기 무조건 플래그를 세우면 고치려던 🔴이 잔존 → **저장 토큰 유무로 레인을 갈라야 한다**.
  2. **`notion-api.ts:80`은 refresh 함수가 없는데 401 fallthrough에 의존한다**("refresh가 없으므로 즉시 재인증으로 안내"). 반전 후 안내가 사라지므로 **`refreshFailed: true`로 명시 태깅**한다. clickup·slack도 같은 축인지 확인.
  3. `oauth.ts:277-285` `persistOAuthTokens`는 최초 연결·refresh 양쪽에서 불린다 → **최초 연결 레인(400)** 으로 보낸다(저장 실패는 재로그인으로 안 풀린다).
- **검증**:
  - [ ] `src/background/__tests__/oauth.test.ts`: refresh 실패 → 401+`oauthRefreshFailed` / state mismatch → 400 / cancelled·notConfigured·launchFailed 무회귀
  - [ ] "최초 연결 401(저장 토큰 없음) → 400" 케이스 → green — **이게 🔴의 실제 회귀 테스트다**
  - [ ] "notion 권한 박탈 → 401+`oauthRefreshFailed`" → green (역방향 회귀 방지)
  - [ ] 전수 스캔 규칙이 일부러 뺀 태깅에 red를 내는지 확인 후 되돌림 (vacuous green 방지)
  - [ ] `pnpm test` green

### Task 5-2: 토큰 응답 error 검사 — notion + jira (G5 · #3)

- **변경 대상**: `src/background/notion-oauth.ts:72`(`exchangeCode`), **`src/background/oauth.ts:196`(jira `exchangeCodeForTokens`)**, `src/background/__tests__/connect-reason-coverage.test.ts:65-79`
- **작업 내용**: **갭은 2건이다** — 원안의 "notion이 프록시 경유 6종 중 유일한 이탈"은 틀렸다. 둘 다 `res.ok`만 본다. 형제 5종(`github`·`gitlab`·`linear`·`asana`·`clickup`)의 `if ("error" in data && data.error)` + `grantRejection(is<X>CancellationCode(...))` 관용구를 **복사**한다(slack은 `if (!data.ok)`로 형태가 달라 참조하지 않는다).
- **주의**: **`connect-reason-coverage.test.ts:78`이 red가 된다** — `GRANT_LANE_FILES` 6개를 집합으로 고정(`expect(owners).toEqual(...)`)하고 주석에 "jira·notion은 그 분기 자체가 없다"고 박아뒀다. **목록과 주석을 함께 갱신**하고, 갱신했다는 사실을 커밋 메시지에 적는다(그물이 정상 작동한 것이지 구현 오류가 아니다).
- **검증**:
  - [ ] notion·jira 각각 "200 + error 본문이면 throw" 케이스 → green
  - [ ] 정상 토큰 응답 경로 무회귀 (양쪽)
  - [ ] `GRANT_LANE_FILES`가 8개로 갱신되고 `:78` green
  - [ ] 형제 5종과 형태가 같은지 diff를 나란히 대조

### Task 5-3: 업로드 응답 판별자 통일 (G5 · #4)

- **변경 대상**: `src/types/messages.ts`(응답 타입 **신설**), `src/background/messages.ts:492`(gitlab)·`:573-577`(asana)·`:647`(clickup) + **핸들러 반환 annotation**, `src/background/github-upload.ts:139`, `src/sidepanel/lib/submitTo{Github,Gitlab,Asana,Clickup}.ts`·`prepareUpload.ts`, **`submitTo*.test.ts` 목 10개**
- **작업 내용**: `{ ok: true; … } | { ok: false; filename }` 판별자 union. github+gitlab+clickup은 `prepareUpload.ts:35`의 정본(`{filename, href}`)으로 수렴, asana만 `gid`+`viewUrl`.
- **결정적 주의 — 타입이 소비처를 짚어주지 않는다**: `handleMessage`는 `Promise<unknown>`(`messages.ts:201-204`), `sendBg<T>`(`bg-client.ts:17`)의 `T`는 **호출자 단언**이고 `types/messages.ts`엔 요청 타입만 있다. **typecheck는 어느 쪽을 바꿔도 green이다.** 그래서 게이트를 셋 둔다:
  1. **양단을 함께 명시** — 핸들러 반환에 `): Promise<UploadFileResult[]>` annotation을 **붙이고** 각 소비처 `sendBg<UploadFileResult[]>`도 바꾼다. **한쪽만 하면 다른 쪽이 조용히 남는다.**
  2. **목을 갱신** — `submitTo*.test.ts` 10개가 `sendBg`를 spec별로 mock하므로(`submitToGitlab.test.ts:55,97,128,…`) 목 반환을 새 형태로 바꾸지 않으면 **구 형태로 계속 green**이다.
  3. 소비처 손감사 목록을 결과에 적는다: `prepareUpload.ts:50,92-93,111-114` · `submitToGitlab.ts:38-43,82-89` · `submitToAsana.ts:46,181-199` · `submitToGithub.ts:33-38` · `submitToClickup.ts:90-105,113` · `submitToSlack.ts:76-83`.
- **검증**:
  - [ ] `pnpm typecheck` green — **단 이건 소비처 누락을 증명하지 않는다**(그 사실을 결과에 적는다)
  - [ ] **4플랫폼(github·gitlab·asana·clickup) × 성공/실패 8분기 각각 "업로드 1건 실패해도 나머지가 첨부되고 실패분이 실패로 판정된다"** → green. **이게 유일한 실질 그물이다**
  - [ ] `submitAdapters.test.ts`·`prepareUpload.test.ts`의 목이 새 형태로 갱신됨 (갱신 없이 green이면 그게 놓친 신호다)
  - [ ] `grep -rn "gid: null\|url: null\|href: null" src/background/` → 판별자로 대체됐는지 확인 (4플랫폼 전부 — 원안 grep은 asana만 잡았다)

### Task 6-1: 어노테이션 기본값 leaf 승격 (G6 · #8)

- **변경 대상**: `src/sidepanel/lib/annotationDefaults.ts`(신규), `src/sidepanel/components/annotation/presets.ts`(re-export), `src/store/editor-store.ts:16`
- **작업 내용**: store가 실제로 쓰는 `DEFAULT_COLOR`·`DEFAULT_THICKNESS`·`ThicknessKey`만 leaf로 뗀다. `presets.ts`는 거기서 re-export해 **기존 소비처 4곳을 안 건드린다**.
- **검증**:
  - [ ] `grep -rn "annotation/presets" src/store/` → 0건
  - [ ] `pnpm typecheck` green, `pnpm test` green
  - [ ] `presets.ts`의 기존 소비처 4곳이 그대로 동작 (import 경로 무변경)
  - [ ] `builderLocaleWrap.test.ts` green — **아무것도 등록하지 않고** 통과해야 한다(그 테스트는 `t`를 import하는 파일만 본다. `EXEMPT`에 넣으면 유령 항목 검사로 red)

### Task 6-2: `clearPicker` + 소유 상태 분리 (G6 · #9)

- **변경 대상**: `src/sidepanel/picker-clear.ts`(신규), `src/sidepanel/picker-control.ts`(import + re-export), `src/store/issues-store.ts:8`, **`scripts/coverage-report.mjs`(`BROWSER_BOUND_EXACT` 등록)**
- **작업 내용**: `clearPicker`(`picker-control.ts:290-293`)는 **store를 읽지도 쓰지도 않는다**(확인 완료) — 원안의 분기 기준은 통과한다. **진짜 블로커는 module-level 공유 상태다**: 본문이 `tabFrameTokens`(`:145`, `:148`·`:153`·`:158`·`:254`·`:303`·`:307`이 함께 씀)와 `sendAll`(`:122-130`, 17 호출부)을 쓴다.
  → **`tabFrameTokens` + `sendAll` + `clearPicker`를 함께 leaf로 내리고** `picker-control.ts`가 그걸 import한다(Map 1개 유지). 나이브하게 `clearPicker`만 옮기면 **Map이 둘로 갈려** clearPicker 후에도 토큰이 살아 `restartPickerInFrame`이 유령 blocker를 재주입한다(typecheck·테스트 green인 채로).
  `picker-control.ts`는 `clearPicker`를 re-export해 기존 호출부 28곳(9파일)을 안 건드린다.
- **커버리지 필수 단계**: `picker-control.ts`는 `coverage-report.mjs:52 BROWSER_BOUND_EXACT`에 등재돼 로직 분모에서 빠져 있다. **새 `picker-clear.ts`를 같은 목록에 추가한다** — 안 하면 ~0%로 분모에 들어와 prd 성공기준 5를 자기 손으로 깬다.
- **부수 기록**: `stopPicker`(`:253-256`)가 `clearPicker` 본문을 바이트 복제 중 — **이번엔 안 고치고** 사실만 결과에 적는다(외과적 변경).
- **검증**:
  - [ ] `grep -rn "picker-control" src/store/` → 0건
  - [ ] `pnpm typecheck` green, `pnpm test` green
  - [ ] `tabFrameTokens` 정의가 저장소 전체에 **1개**인지 확인 (`grep -rn "tabFrameTokens = new Map" src/`)
  - [ ] `picker-clear.ts`가 `BROWSER_BOUND_EXACT`에 등록됨 → `pnpm coverage:report`로 로직 % 무하락 확인
  - [ ] `picker-control`의 기존 소비처 무변경

### Task 6-3: 번들 경계 최종 확인 (G6)

- **변경 대상**: 없음 (확인만)
- **작업 내용**: typecheck·테스트가 못 잡는 축이라 산출물로 확인한다. **`pnpm build`는 사용자 승인 또는 `/build`로만** 돌린다. **승인이 없으면 이 그룹은 검증 수단 없이 닫힌다** — 그 사실을 결과에 명시한다.
- **검증**:
  - [ ] `grep -rn "annotation/presets\|picker-control" src/store/` → 0건. **`grep '@/sidepanel' src/store/` → 0건은 게이트로 쓰지 않는다** — 현재 9건이고 두 태스크 후에도 7건 잔존한다(`sidepanel/lib` 경유는 의도된 것)
  - [ ] (승인 시) 배치 전 `dist/assets/` 청크 크기를 **먼저 기록**한 뒤 `pnpm build` 후 비교 — 사전 값 없이는 "무증가"를 판정할 수 없다
  - [ ] (승인 시) `pnpm check:prearm` green — **단 이건 `recorders-entry`만 검사하므로 picker 청크에 대해서는 아무것도 말해주지 않는다**(design.md 위험 ②)

### Task 7-1: `escapeHtml` 단일 출처 (G7 · #23)

- **변경 대상**: `src/lib/escape-html.ts`(승격 — **kebab-case**, `src/lib/` 컨벤션), `src/sidepanel/lib/escapeHtml.ts`(제거 또는 re-export), `src/content/overlay.ts:685`(사본 제거), `src/lib/__tests__/escape-html.test.ts`
- **작업 내용**: 정본을 `src/lib/`로 올리고 양쪽이 import. **값은 무변경(`& < > "` 4문자)** — overlay 사본이 갖고 있던 `'` → `&#39;`를 **버린다**(narrowing).
  - 근거: `overlay.ts`에 **단일인용 속성이 0건**(`grep -n "='"` → 0)이고 유일한 속성 보간 `:705`가 이중인용이라 `'` 이스케이프가 불필요하다. 반대로 넓히면 정본 소비처 4개(클립보드 `text/html`·`logs.html`·Asana `html_notes`·라이브 프리뷰)의 출력이 모든 아포스트로피에서 바뀌는데 **그걸 잡는 그물이 하나도 없다**(design.md 대안 H).
- **검증**:
  - [ ] `escapeHtml` 정의가 저장소 전체에 **1곳**. **`grep "replace(/&/g" src/`는 게이트가 아니다** — `markdownToMrkdwn.ts:71 escapeMrkdwn`이 정당한 제3의 hit이다(Slack mrkdwn, 자체 스코핑 주석 `:67-68`)
  - [ ] **`escape-html.test.ts`에 "`'`는 이스케이프하지 않는다" 케이스 추가** → green — 결정을 못 박아 다음 배치가 같은 계산을 반복하지 않게
  - [ ] **수동**: overlay 라벨·색상 swatch에 `'`가 든 값이 정상 표시
  - [ ] 골든 스냅샷 무변경 — **단 이건 판정 수단이 아니다**(스냅샷에 `'` 0건이라 어느 방향으로 가도 green. design.md 위험 ③)

### Task 7-2: `imageCell` + `escapeMdLinkText` 통합 (G7 · #22)

- **변경 대상**: `src/sidepanel/lib/issueBodyShared.ts`(추가 **2개**), `src/sidepanel/lib/buildIssueMarkdown.ts:223`(`escapeMdLinkText` 이동 + re-export), `buildMarkdownIssueBody.ts:45`·`buildClickupIssueBody.ts:35`·`buildLinearIssueBody.ts:32`
- **작업 내용**: url을 인자로 받는 `imageCell(filename, url)`로 올린다.
  - **`escapeMdLinkText`도 함께 내려야 한다** — 지금 `buildIssueMarkdown.ts:223`에 있고 `:19`가 `issueBodyShared`를 import하므로, leaf가 그걸 부르면 **`issueBodyShared → buildIssueMarkdown → issueBodyShared` 순환**이다(그 파일 `:8-10` 주석이 금지한 형태). `issueBodyShared.ts`로 옮기고 `buildIssueMarkdown.ts`가 re-export(기존 소비처 무변경).
  - 호출부는 `media ? imageCell(media.filename, media.url) : ""`, linear는 `media.assetUrl`. (가드를 호출부로 올린다 — 원 시그니처는 `media | undefined`를 표현하지 못한다.)
- **주의**: **셋 다 escape가 없다.** 드리프트는 3벌 사이가 아니라 파일 내부다(`defaultVideoEmbed:51`·`:202`·`:206`은 escape를 쓴다). 그리고 **골든 스냅샷은 이 변경을 못 본다** — `imageCell`의 유일 호출부인 `styleTable.snapshot` 행이 스냅샷에 0건이고 픽스처 파일명이 escape-char-free다.
- **검증**:
  - [ ] Task 0의 "`escapeMdLinkText` 미적용" red 케이스 green
  - [ ] `grep -rn "function imageCell" src/sidepanel/` → 1건
  - [ ] `grep -rn "function escapeMdLinkText" src/sidepanel/` → 1건 (`issueBodyShared.ts`)
  - [ ] `issueBodyShared` ↔ `buildIssueMarkdown` 순환 없음 — `pnpm typecheck` + import 방향 눈확인
  - [ ] `builderLocaleWrap.test.ts` green
  - [ ] 파일명·URL에 `[`·`]`·`\`가 든 케이스에서 링크가 깨지지 않는지 유닛으로 고정

### Task 7-3: `MarkdownIt` 팩토리 (G7 · #25)

- **변경 대상**: `src/sidepanel/lib/markdownIt.ts`(신규), `markdownToAdf.ts:19`·`markdownToNotionBlocks.ts:7`·`markdownToAsanaHtml.ts:10`·`renderMarkdown.ts:16`
- **작업 내용**: `createMarkdownIt(options?)` 팩토리. **`md.enable("strikethrough")`를 팩토리에 반드시 포함한다** — 4곳 전부 다음 줄에서 그걸 부르므로 빠뜨리면 넷 다 회귀한다. **인스턴스는 파일별로 유지**(공유하면 한 파일의 `md.use()`가 나머지에 샌다).
- **주의**: **`builderLocaleWrap.test.ts`에 아무것도 등록하지 않는다.** 원안의 "면제 분류에 등록" 지시는 red를 만든다 — 그 테스트의 대상 집합은 `IMPORTS_T`(`:13`)로 걸러진 `t` import 파일들이고, `EXEMPT`(`:37-43`)에 넣으면 유령 항목 검사(`:87-88`)에 걸린다. 증거: `escapeHtml.ts`·`renderMarkdown.ts`·`markdownToAsanaHtml.ts`가 두 목록 어디에도 없고 스위트는 green이다.
- **검증**:
  - [ ] `grep -rn "MarkdownIt({" src/` → `markdownIt.ts` 1곳만
  - [ ] `grep -rn 'enable("strikethrough")' src/` → 1곳만
  - [ ] `builderLocaleWrap.test.ts` green (등록 없이)
  - [ ] 4개 소비처의 파싱 결과 무변경 — ADF·Notion blocks·Asana HTML·프리뷰 각각 기존 유닛 green

### Task 7-4: frozen phase 단일 출처 (G7 · #30)

- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts:47`(`DRAFT_PHASES` 제거)·`:270-272`(인라인 재열거 → `FROZEN_PHASES.has`)
- **작업 내용**: `lib/session-keys.ts:42-46`의 `FROZEN_PHASES`(`ReadonlySet<string>`)로 수렴. `:2`가 이미 그 모듈을 import한다. **`ACTIVE_CAPTURE_PHASES`(`:50`)는 건드리지 않는다.** 세 집합의 원소가 동일하므로 순수 리팩터다.
- **검증**:
  - [ ] `grep -n '"drafting"' src/sidepanel/hooks/useEditorSessionSync.ts` → 0건
  - [ ] `useEditorSessionSync.test.ts` 무회귀 (`:146`·`:160`이 `DRAFT_PHASES` 소비처였다)
  - [ ] `tab-bindings.test.ts`·`log-merge` 관련 테스트 무회귀 (`FROZEN_PHASES` 기존 소비처 2곳)
  - [ ] **저장소 전체 `"previewing"` 10건 중 3건만 대상**임을 확인 — `IssueTab.tsx:240`·`DebugTab.tsx:30`·`useBackgroundRecorder.ts:25`·`editor-store.ts:40,863,1011,1116`은 무관한 단일 phase 비교이므로 **쓸어 담지 않는다**

### Task 7-5: `ActionLogContent` 톤 단일 출처 (G7 · M1)

- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx:91,97`
- **작업 내용**: `text-sky-600`·`text-red-700`을 `@/lib/log-colors`의 `TONE_TEXT`로 수렴한다. 같은 파일 `:69`가 이미 `TONE_TEXT.blue`를 쓴다. `docs/POSTMORTEM.md:143`이 이월로 남긴 항목.
- **주의**: **색 값이 실제로 같은지 먼저 대조한다.** 다르면 그건 시각 변경이므로 prd "사용자에게 보이는 변화" 표에 행을 추가하고 다크모드 대비도 확인한다.
- **검증**:
  - [ ] `grep -n "text-sky-\|text-red-" src/sidepanel/components/ActionLogContent.tsx` → 0건
  - [ ] 색 값이 `TONE_TEXT`와 동일함을 결과에 기록 (다르면 노출 변화로 승격)
  - [ ] log-viewer가 이 컴포넌트를 재사용하므로 `src/log-viewer/__tests__/` 무회귀

### Task 9: activation 큐에 `apply` 편입 (G9 · #10)

- **변경 대상**: `src/background/tab-bindings.ts:40-70`(`apply`)·`:24-35`(큐 헬퍼). **`:301-330`은 리스너 범위일 뿐 수정 지점이 아니다**
- **작업 내용**: `apply()`의 read→`setOptions`를 write와 같은 큐에 태운다.
- **주의 4개** (design.md G9):
  1. **재진입은 없다** — `apply()`는 `getActivatedSet()`만 읽고 `setActivated`(`:233`·`:268`·`:338`)를 부르지 않는다. 확인 근거를 결과에 한 줄로 적는다.
  2. **`activatedWriteQueue = task.catch(() => {})`(`:32`) 관용구를 반드시 재사용한다** — 안 쓰면 `apply` 한 번의 reject로 **이후 모든 activation write가 무음 사망**한다(P2 수정이 P0급 실패를 심는 경로).
  3. **`activateTab`(`:253-269`)의 gesture 경로 `setOptions`/`open`은 큐 밖에 유지한다** — 그 위 주석이 await 금지를 명시한다. 큐에 넣으면 사이드패널 열기가 증도로 막힌다.
  4. **경합은 완전히 사라지지 않는다** — `activateTab:257-263`·`deactivatePanelIfCrossOrigin:234`의 `setOptions`가 큐 밖에 남는다. 유닛은 큐 내부 순서만 고정하므로 **green이면서 실경합이 일부 남고**, 수동 확인이 로드베어링이다. 그 사실을 결과에 적는다.
- **검증**:
  - [ ] `tab-bindings` 유닛에 "onActivated와 onUpdated가 겹쳐도 `setOptions` 커밋 순서가 큐 순서와 같다" → green
  - [ ] "`apply`가 reject해도 이후 `setActivated`가 계속 동작한다" → green (관용구 확인)
  - [ ] 재진입 없음 근거 한 줄이 결과에 있음
  - [ ] 큐 밖에 남는 `setOptions` 2곳이 결과에 목록으로 있음
  - [ ] **수동**: 탭 A(지원)↔탭 B(미지원) 빠른 전환 + cross-origin 네비게이션 중 패널 깜빡임 없음

---

## P2 — 컨벤션 · 그물

### Task 10-1: 사이드패널 문서 언어 런타임 반영 (G10 · #13)

- **변경 대상**: `src/sidepanel/index.html:2`, `src/sidepanel/hooks/useDocumentLangEffect.ts`(**신규**), `src/sidepanel/App.tsx`, `src/sidepanel/hooks/__tests__/useDocumentLangEffect.test.tsx`(**신규 파일**)
- **작업 내용**: html을 `<html lang="en-US">`(런타임 `BCP47.en`과 일치)로 두고, 로케일 확정 지점에서 `document.documentElement.lang = BCP47[locale]`.
- **주의**: **`useThemeEffect`에 넣지 않는다.** 그 훅은 `theme` 단일 축만 구독하고 `system`일 때 `matchMedia`를 등록/해제하므로(`:17-20`) locale을 섞으면 **로케일 전환마다 matchMedia를 재구독**한다. 형제 훅으로 신설한다. `BCP47`(`locales.ts:17-20`)은 **폴백 금지 테이블**이라 `Record<LocaleMode, …>`를 유지한 채 소비한다.
- **검증**:
  - [ ] **신규 테스트 파일 생성** ("로케일이 en이면 `documentElement.lang === "en-US"`", "ko면 `ko-KR`", "전환 시 따라 바뀐다") → green
  - [ ] `src/i18n/locales.ts` 무변경 (런타임 import 0 규칙 유지 — `locale-registry.test.ts` green)
  - [ ] `useThemeEffect.ts` 무변경

### Task 10-2: log-viewer 문서 언어 반영 (G10 · #14)

- **변경 대상**: `src/log-viewer/index.html:2`, log-viewer 엔트리(`main.tsx`)
- **작업 내용**: `log-viewer/i18n.ts:3`이 이미 `../i18n/locales`를 상대경로로 끌고 있고 `main.tsx:10-15`에 `syncDarkClass` 선례가 있으므로 같은 계층에 lang 세팅을 둔다.
- **검증**:
  - [ ] `src/log-viewer/__tests__/` 무회귀
  - [ ] `pnpm test` green (pretest가 `build:log-viewer`를 자동 실행한다 — 별도 빌드 불필요)

### Task 10-3: log-viewer i18n 스캐너 사각 제거 (G10 · #15 #16)

- **변경 대상**: `src/log-viewer/components/TimelinePanel.tsx:23-27`, `src/log-viewer/markers.ts:147`, `src/log-viewer/__tests__/i18n.test.ts`(앵커 추가)
- **작업 내용**: 코드를 스캐너가 보는 형태로 바꾼다(design.md 대안 E).
  - #15: `FILTER_LABEL`을 지우고 렌더에서 4개 리터럴을 `t()` 인자로 직접 쓴다. **"log-viewer 사전 키 union으로 좁힌다"는 불가능하다** — log-viewer엔 키 union이 없다(`i18n.ts:5-8`이 `key: string`, 테스트가 `:207`·`:212`에서 `as any` 캐스트 중).
  - #16: 삼항을 밖으로 빼서 `t()` 인자를 리터럴로.
- **주의**: **Task 10-2와 병렬 가능하다.** 원안의 "10-2의 `build:log-viewer` 산출물이 있어야 테스트가 돈다"는 틀렸다 — 이 테스트는 `dist-log-viewer`를 import하지 않고(`node:fs`는 `src/` 소스 스캔용 `:60-61`), pretest가 매번 빌드한다.
- **검증**:
  - [ ] 6개 키(`timeline.filter.*` 4 + `actionLog.verb.toggle.*` 2)가 `referencedKeys`에 들어오는지 **자기검증 앵커** 케이스로 고정 → green (기존 앵커 `:120`·`:195`와 같은 방식)
  - [ ] `src/log-viewer/__tests__/i18n.test.ts` 전체 green
  - [ ] 화면 문구 무변경

### Task 11-1: Linear 상태 빈 목록 안내 (G11 · #17)

- **변경 대상**: `src/sidepanel/tabs/statusBadges/LinearStatusBadge.tsx:97`, `src/i18n/namespaces/issue.ts`(ko ~`:130` + en ~`:271`), **`src/sidepanel/tabs/statusBadges/__tests__/LinearStatusBadge.test.tsx`(신규 파일)**
- **작업 내용**: `JiraStatusBadge.tsx:100-103`의 형태를 복사(`px-3 py-2 text-sm text-muted-foreground`). 신규 키 `issueList.linear.noStates` — **반경은 정확히 2파일 3편집**이다. log-viewer 복제 사전(`issueList.*` 0건)·`public/_locales/`(manifest 4키)는 대상 아니다.
- **주의**: **`:42`의 `.catch(() => setStates([]))` 때문에 조회 실패도 이 분기로 떨어진다** — 즉 네트워크·권한 실패에도 "상태가 없습니다"가 뜬다. 문구는 1개로 유지하되(Jira `:100`·Notion `:103`도 같은 구조라 에러/빈목록 분리는 3곳 계열 변경) **이 사실을 결과에 적고** prd "검수 신설"과 같은 급의 후보로 남긴다.
- **검증**:
  - [ ] `locales.test.ts` green (ko/en 대칭 — 훅이 자동 실행한다)
  - [ ] **신규 테스트 파일**: "states가 빈 배열이면 안내 문구" / "조회 실패도 같은 문구가 뜬다(현 구조상)" / "로딩 중엔 스피너" / "정상 목록이면 항목 렌더" → green
  - [ ] Asana·Clickup·Github·Gitlab 배지는 정적 `options`라 대상 아님을 확인

### Task 11-2: `PropertiesFieldset` FieldRow 이행 + 접근 이름 (G11 · #18)

- **변경 대상**: `src/sidepanel/tabs/notionFields/PropertiesFieldset.tsx:29,35`, `PropertySelectCombobox`(prop 추가)
- **작업 내용**:
  1. 손복제 마크업을 `FieldRow`로 교체(`grid gap-1.5` + `label text-xs text-muted-foreground`로 바이트 동일 drop-in).
  2. **`htmlFor`는 쓰지 않는다.** `PropertySelectCombobox` Props(`:20-24`)에 `id`가 없어 그대로 채우면 **없는 id를 가리키는 label**이 되고, `role="combobox"` 버튼은 accname이 contents 우선이라 `<label for>`가 이름을 못 준다. **저장소가 이미 이 결론에 도달했다** — `jiraFields/FieldCombobox.tsx:52-54` 주석("FieldRow의 `<label>`은 htmlFor로 연결되지 않아 콤보에 접근 이름이 없다 — 필요한 필드가 직접 붙인다") + `ProjectField.test.tsx:151-159`가 고정. → **`ariaLabel` prop을 추가**해 트리거 `Button`에 입힌다.
  3. **부모 `:29`의 `gap-3`을 `gap-4`로** 맞춘다 — 형제 폼이 `gap-4`(`NotionIssueFields.tsx:108`)라 Notion select 속성 행만 4px 좁다. FieldRow 이행은 행 내부만 바꿔 이 비대칭을 안 고친다.
- **검증**:
  - [ ] 렌더 결과 DOM이 기존과 동일(`ariaLabel`·`gap` 변경분 제외) — **기존 테스트가 없으므로 이번에 신규 케이스로 고정한다**
  - [ ] **"각 select 트리거가 속성명을 접근 이름으로 갖는다"** → green (`getByRole("combobox", { name })`). 원안의 "라벨 클릭 시 포커스 이동"은 달성 불가라 대체
  - [ ] `pnpm test` green

### Task 11-3: `JsonTreeViewer` 클릭 요소 2곳 키보드 접근 (G11 · #19)

- **변경 대상**: `src/sidepanel/components/JsonTreeViewer.tsx:209`(`<div onClick>`)·**`:246-252`**(`json.showAll` `<span onClick>`)
- **작업 내용**: **쌍둥이가 둘이다** — 하나만 고치면 한 컴포넌트 안에서 접근성이 갈린다. 둘 다 `<button type="button">`로.
  - `aria-expanded`는 **붙이지 않는다**(disclosure가 아니라 다음 청크 추가라 상태 속성이 거짓말이 된다).
  - 기존 className과 자리맞춤 `<span className="inline-block h-4 w-4 shrink-0" />`를 유지하되 **`w-full text-left`를 추가**한다 — button은 `display:flex`를 줘도 shrink-to-fit이라 클릭 영역이 텍스트 폭으로 좁아진다.
- **주의**: **기존 `JsonTreeViewer.test.tsx:20`("행에 임의 크기 클래스가 남지 않는다")이 red가 될 수 있다** — button은 UA font를 상속하지 않는다. `font-[inherit]`·`text-inherit`이 필요한지 확인하고, 테스트를 갱신했다면 커밋 메시지에 적는다(그물이 정상 작동한 것).
- **검증**:
  - [ ] `JsonTreeViewer.test.tsx`에 "Enter/Space로 '더 보기'가 동작한다" / "'모두 보기'도 키보드로 동작한다" → green
  - [ ] 기존 5케이스 green (`:20` 갱신 여부를 결과에 기록)
  - [ ] `grep -n "onClick" src/sidepanel/components/JsonTreeViewer.tsx` → `<button>` 밖의 클릭 핸들러 0건
  - [ ] 시각 변화 없음 (className 유지 + `w-full text-left`만 추가)

### Task 11-4: 빈 상태 아이콘 muted (G11 · #20)

- **변경 대상**: `src/sidepanel/tabs/settings/LlmConnectForm.tsx:81`
- **작업 내용**: `<Bot className="h-6 w-6" />` → `h-6 w-6 text-muted-foreground`. **실측 지배형은 사이드패널 18곳 + log-viewer 2곳이고 예외가 0이다**(원안의 "다른 6곳"은 과소 계수).
- **부수 기록**: `LlmOnboarding` 자체가 공용 `EmptyState`(`IssueTab.tsx:757-770`)의 손복제다(`mx-auto`/max-width 누락, `mt-5` vs `mt-4`) — #18과 같은 계열이지만 **이번엔 색만 고치고** 이행은 다음 배치 후보로 결과에 적는다.
- **검증**:
  - [ ] `grep -rn 'className="h-6 w-6"' src/sidepanel/` → 빈 상태 아이콘 잔존 0건 — **검사 범위를 `settings/`가 아니라 사이드패널 전역으로** 넓힌다
  - [ ] 라이트·다크 양쪽 대비 확인 (수동)

### Task 11-5: `DomTreeDialog` 예외 등재 (G11 · #21 드랍 처리)

- **변경 대상**: `docs/DESIGN.md`(raw `<button>` 예외 목록)
- **작업 내용**: **코드는 안 고친다.** #21은 검수에서 드랍됐다(prd "검수 드랍"). 대신 **DESIGN.md의 raw `<button>` 예외에 5번째 계열 "sticky 헤더의 클릭 가능한 제목"을 등재**해 항목 자체를 소멸시킨다. 현재 등재는 2계열(`:204` 입력 내 클리어 X, `:205` `TreeChevronButton`)뿐이고 design 원안이 인용한 "4계열"은 **문서에 없던 근거**였다.
  등재 사유를 함께 적는다: `Button variant="ghost"`로 감싸면 `inline-flex h-9 px-4`가 `block w-full truncate text-2xl`과 충돌해 **`truncate`가 파손**되고(익명 flex item이 되어 하드 클립) 행 높이 +4px·텍스트 폭 −32px, hover가 `opacity-70`→면색 블록이 된다. 이행하려면 override 4종이 원본 className보다 길어진다.
- **검증**:
  - [ ] `DomTreeDialog.tsx` diff 0 (코드 무변경)
  - [ ] `DESIGN.md`에 5번째 계열 + 사유가 등재됨
  - [ ] `dom-tree-nav.spec.ts:37`·`dom-tree-overflow.spec.ts:30` green (무변경이므로 자동)

### Task 12-1: `setAnnotationTool` 시그니처 축소 (G12 · #32)

- **변경 대상**: `src/content/annotation.ts:251-268`, `src/content/picker.ts:328-333`, **`src/content/annotation.ts:186`**
- **작업 내용**: `setAnnotationTool(style: PenStyle | null)` 단일 인자로. `tool === null` 게이트는 `style === null`로 대체된다(`:256 tool === null || !style`이고 호출부가 `msg.tool === null`일 때만 style을 null로 넘기므로 동치).
- **주의 2개**:
  - **호출부는 2곳이다** — `picker.ts:328-333`과 **`annotation.ts:186`(`setAnnotationTool(null, null)`)**. 원안의 "유일 호출부"는 틀렸다.
  - **동명 심볼이 3개다** — `content/annotation.ts:251`(대상)·`sidepanel/annotation-control.ts:17`(메신저)·`store/editor-store.ts:292`(store action). grep 검증 시 오탐 주의. 메시지 형태(`annotation.setTool{tool, color, strokeWidth, opacity}`)는 **안 바뀐다**.
- **검증**:
  - [ ] `pnpm typecheck` green
  - [ ] `grep -rn "setAnnotationTool(" src/content/` → 호출 2곳 모두 단일 인자
  - [ ] `editor-store.test.ts:247,1664-1684` green — **단 이건 store 사본을 테스트하므로 이 변경을 커버하지 않는다**(그 사실을 결과에 적는다)
  - [ ] **수동(로드베어링)**: 실제 페이지에서 pen·rect·highlight 전환 + off (캔버스라 유닛으로 못 잡는다)

### Task 12-2: `readErrorBody` 테스트 (G12 · #33)

- **변경 대상**: `src/background/lib/__tests__/readErrorBody.test.ts`(신규)
- **작업 내용**: **4갈래** 고정 — JSON 본문 → 파싱된 객체 / 비-JSON → 원문 문자열 / `res.text()` 자체 throw → `undefined` / **빈 본문 → `""`**(`JSON.parse("")`가 throw해 원문 fallback을 타는 경로. 원안의 3갈래에 없었다).
- **검증**:
  - [ ] 4케이스 green
  - [ ] 소비처 5파일(`github-api.ts:120`·`jira-api.ts:142,155`·`clickup-api.ts:75`·`gitlab-api.ts:116`·`asana-api.ts:114`)의 기존 테스트 무회귀
  - [ ] 로직 스코프 커버리지 순증 확인 (이 파일은 현재 0%)

### Task 12-3: import 표기 이탈 + 신규 유입 그물 (G12 · #34)

- **변경 대상**: `src/background/lib/createRefreshRunner.ts:3`, `src/types/picker.ts:1-3`, `src/lib/__tests__/import-convention.test.ts`(신규 — **kebab-case**)
- **작업 내용**: 두 이탈을 상대경로로. 소스 스캔 테스트는 `src/background`·`src/types`·`src/store`·`src/i18n`만 검사하고 **`src/sidepanel`은 대상에서 뺀다**(혼용이라 즉시 red이고, 예외 목록을 박으면 그물이 아니라 장부가 된다 — 그 사실을 테스트 파일 주석에 남긴다).
- **테스트 정의 조건 2개** (없으면 착수 즉시 red):
  1. **`__tests__` 카브아웃** — `store/__tests__/editor-store.test.ts:47,65,66,73`이 `vi.mock("@/store/…")`·`import("@/store/settings-store")`를 쓴다. `vi.mock`은 SUT와 같은 specifier여야 맞으므로 "상대경로로 고쳐라"가 정답이 아니다. `i18n/locales.ts:2`·`locale-registry.test.ts:202`의 주석 언급도 제외.
  2. **매칭은 `from "…"` 형태만** — 동적 import·`vi.mock`·주석을 세면 그물이 아니라 오탐기가 된다.
- **주의**: **G5(#2 태깅)가 `createRefreshRunner.ts`를 먼저 고친다** — 그룹당 1커밋 정책과 충돌하므로 G5 → G12 순서를 지킨다.
- **검증**:
  - [ ] `grep -rn 'from "@/background/' src/background/` → 0건 (`__tests__` 제외)
  - [ ] `grep -rn 'from "@/types/' src/types/` → 0건
  - [ ] `src/store`·`src/i18n`은 프로덕션 코드에 이미 0건 → 즉시 green 래칫
  - [ ] 신규 테스트가 일부러 넣은 위반에 red를 내는지 확인 후 되돌림 (vacuous green 방지)
  - [ ] 파일명이 `import-convention.test.ts`(kebab-case)인지 — `src/lib/`은 모듈↔테스트 1:1 kebab-case 컨벤션이다

---

## 배치 종료

### Task 13-1: DROPPED.md 추기 (배치 종료)

- **변경 대상**: `docs/features/DROPPED.md`
- **작업 내용**:
  1. **재소환 3건 추기** — audit-refactor-6 ④(#24)·⑥(#31)·①(#59) 각 항목에 "2026-08-18 전체 재감사에서 같은 항목이 다시 나왔다. 다시 볼 조건은 여전히 미충족" 한 줄씩. **셋 다** 적는다(원안은 2건만 다뤘다). ④엔 **"감사 리포트가 3벌이라 했지만 실제 정의는 2벌"**이라는 정정도 함께 남긴다.
  2. **새로 안 하기로 한 것 6건**을 새 섹션으로: #26 배지 셸 · #27 PatDialog · #34 sidepanel 전량 통일 · **#21 DomTreeDialog** · **#28 SingleLazyCombobox 수렴** · **#29 useDebouncedSearch 수렴**. 각각 사유 + 다시 볼 조건.
  3. **검수 신설 3건**(prd "검수 신설")을 다음 배치 후보로 기록: `SingleLazyCombobox` query 리셋 부재 · `send`의 포트 닫힘/undefined 미구별 · seq-guard 4·5번째 사본.
  4. 이번 배치가 얻은 판별 기준을 한 줄로: **"지배 패턴이 저장소에 있다"만으로 수렴을 정당화하지 않고, 대상이 그 패턴의 전제(로드 모델)를 공유하는지까지 본다."**
- **검증**:
  - [ ] 추기 3 + 신규 6 + 후보 3건이 전부 "왜 안 하는지 + 무엇이 바뀌면 다시 볼 만한지" 형식
  - [ ] `pnpm postmortem:check` — **이 태스크에는 무의미하다**(그 스크립트는 `docs/POSTMORTEM.md`만 읽는다). 실행하지 않는다

### Task 13-2: 문서 신선도 갱신 (배치 종료)

- **변경 대상**: `docs/DIRECTORY.md`, `docs/CI.md`, `CLAUDE.md`
- **작업 내용**:
  - `docs/DIRECTORY.md` — 신규/이동 파일 6개 등재(`lib/escape-html.ts`·`sidepanel/lib/markdownIt.ts`·`annotationDefaults.ts`·`sidepanel/picker-clear.ts`·`hooks/useDocumentLangEffect.ts`·`content/action-recorder-helpers.ts`의 새 export) + `:53`의 `setAnnotationTool(tool·style)` 서술 갱신(#32가 stale로 만든다).
  - `docs/CI.md:8` — e2e spec/테스트 카운트 갱신(Task 4가 신규 스펙 1개, Task 3이 기존 스펙 3개에 검증을 추가한다).
  - `CLAUDE.md` — 레코더 전용 모듈 카운트 확인. 현재 문서는 **4개**(`recorder-prearm.ts` 포함)로 맞고 design 원안이 3개로 쓴 것이 오류였으므로 **CLAUDE.md는 무변경**이지만 대조는 한다.
- **검증**:
  - [ ] 6개 신규/변경 파일이 DIRECTORY에 있고 역할 한 줄이 정확
  - [ ] CI.md 카운트가 실측(`pnpm test:e2e` 출력)과 일치
  - [ ] `pnpm sync:agents:check` green (CLAUDE.md를 건드렸다면)

---

## 테스트 계획

### 단위 테스트 — `*.test.ts` (node)

| 대상 | 케이스 |
|---|---|
| `scroll-capture.ts` | 후보 수집 throw → resolve 보장 |
| `sidepanel/scroll-capture.ts` | `{ok:false}` truthy → throw / `undefined`·`null` → throw / 정상 `{y:number}` → 진행 |
| `css-source-cache.ts` | 실패 후 재시도 가능 / invalidate와 경합해도 새 슬롯 보존 |
| `oauth.serializeOAuthError` | refresh 실패 401 / 최초 연결 400 / notion 권한 박탈 401 / cancelled·notConfigured·launchFailed 무회귀 |
| `notion-oauth`·`oauth`(jira) `exchangeCode` | 200+error 본문 → throw (2곳) |
| `connect-reason-coverage` | `GRANT_LANE_FILES` 8개 + refresh 태깅 전수 스캔 |
| 업로드 판별자 | 4플랫폼 × 성공/실패 8분기 (목 갱신 포함) |
| `issueBodyShared.imageCell` | url 없음 → 빈 문자열 / `[`·`]`·`\` 이스케이프 |
| `escape-html` | 4문자 이스케이프 + **`'`는 하지 않는다** |
| `readErrorBody` | JSON / 원문 / read throw / **빈 본문** 4갈래 |
| `tab-bindings` | 큐 순서와 `setOptions` 커밋 순서 일치 / `apply` reject 후에도 write 계속 동작 |
| `import-convention` | 4패키지 자기 별칭 참조 0 (`__tests__` 카브아웃, `from "…"` 한정) |
| `markdownIt` 소비처 4곳 | ADF·Notion blocks·Asana HTML·프리뷰 파싱 무변경 |
| `useEditorSessionSync` | `FROZEN_PHASES` 수렴 후 phase 3종 무회귀 |

### 컴포넌트 테스트 — `*.test.tsx` (jsdom + testing-library)

**★ = 파일 신설** (prd 성공기준 7 — "케이스 추가"가 아니다)

| 대상 | 케이스 |
|---|---|
| `action-recorder-helpers` ★ | 다중 ID·단일 ID·`label[for]`·래핑 label 4경로 + `shouldMaskField` 통합 |
| `IssueCreateModal` ★ | 연동 0개 → `aria-disabled` + 툴팁 문구 + 클릭 무반응 / 1개 이상 → `aria-disabled="false"` + 툴팁 없음 |
| `LinearStatusBadge` ★ | 빈 목록 → 안내 문구 / 조회 실패 → 같은 문구 / 로딩 / 정상 목록 |
| `useDocumentLangEffect` ★ | ko → `ko-KR` / en → `en-US` / 전환 반영 |
| `PropertiesFieldset` | FieldRow 이행 후 각 select가 속성명을 접근 이름으로 가짐 / gap 정렬 |
| `JsonTreeViewer` | "더 보기"·"모두 보기" 둘 다 키보드 동작 / 기존 5케이스 무회귀 |
| `ActionLogContent` | 톤 색상이 `TONE_TEXT`와 일치 |
| `buildForCopy`(G3) | `md`·`html` 둘 다 기존과 바이트 동일 |

### e2e (신규 2 · 확장 3)

- **신규**: 연동이 하나도 없는 상태에서 이슈 제출 버튼에 hover하면 이유 툴팁이 보인다 (`onboarding.spec.ts` 무시드 경로 재사용 + `TooltipContent`에 testid 부착 필요).
- **확장**: 클립보드 스텁 3개(`freeform-draft`·`issue-body-locale`·`code-block-collapse`)가 `getType("text/html")`도 검증한다 — **G3의 유일한 자동 그물**.
- **무회귀 확인**: `issue-submit-open` 6곳 · `dom-tree-trigger` 2곳 · `capture-methods.spec.ts`(페이지 전체 캡처).
- **넣지 않는 것**: "페이지 전체 캡처 중 content 예외" — ISOLATED world 결함 주입 seam이 없어 **유도 불가**(design.md 위험 ④). 유닛이 유일한 그물이다. "DOM 트리 클릭"도 넣지 않는다 — `dom-tree-nav:37`·`dom-tree-overflow:30`이 이미 2중 커버라 no-op이다.

### 수동 테스트 (Chrome)

자동화가 불가능한 것만 남긴다. **배치 종료 시 반복 축은 `e2e/MANUAL-SMOKE.md`로 승격을 검토한다**(클립보드·어노테이션 캔버스는 영구히 자동화 불가라 후보).

- [ ] 인라인 이미지 3개 이상 프리뷰에서 마크다운 복사 → Notion·Jira에 붙여넣어 표·이미지 유지 (jsdom에 `ClipboardItem` 없음)
- [ ] 탭 A↔B 빠른 전환 + cross-origin 네비게이션 중 패널 깜빡임 없음 (G9 — 큐 밖 `setOptions` 2곳이 남아 로드베어링)
- [ ] 어노테이션 pen·rect·highlight 전환 및 off (G12 #32 — 유닛이 store 사본만 봐서 로드베어링)
- [ ] overlay 라벨·색상 swatch에 `'`가 든 값이 정상 표시 (G7 #23 narrowing 방향 확인)
- [ ] `LlmConnectForm` 빈 상태 아이콘 라이트·다크 대비
- [ ] (승인 시) `pnpm build` → 청크 크기 사전 기록값 대비 무증가 + `pnpm check:prearm` green (G6 — 승인 없으면 이 그룹은 검증 없이 닫힌다)

---

## 구현 순서 권장

```
Task 0 (labelForText 이관 + 그물 선행 + 커버리지 실측)
  ↓
P0: Task 1-1 → 1-2 → 1-3   [G1: 같은 파일군, 순차]
    Task 2                  [G2: Task 0의 이관에 의존]
    Task 3                  [G3: 독립, 병렬 가능]
    Task 4                  [G4: 독립, 병렬 가능]
  ↓
P1: Task 5-1 → 5-2 → 5-3   [G5: 5-3이 소비처를 끌고 오므로 마지막]
    Task 6-1 ∥ 6-2 → 6-3   [G6: 6-3은 두 개 끝난 뒤 확인]
    Task 7-1 ∥ 7-2 ∥ 7-3 ∥ 7-4 ∥ 7-5  [G7: 서로 독립]
    Task 9                  [G9: 독립]
  ↓
P2: Task 10-1 ∥ 10-2 ∥ 10-3  [G10: 셋 다 병렬 — 원안의 10-2→10-3 의존은 없다]
    Task 11-1 … 11-5         [G11: 전부 독립, 병렬]
    Task 12-1 ∥ 12-2 → 12-3  [G12: 12-3은 G5 이후]
  ↓
Task 13-1 (DROPPED) ∥ 13-2 (문서 신선도)
  ↓
대조표 재확인 → 미배정 0 확인 → 배치 종료
```

**병렬 가능**: P0의 Task 3·4는 서로 다른 파일. P1의 G6·G7·G9는 서로 독립. P2의 G10 3개·G11 5개는 전부 독립.

**순차 필수**:
- **Task 0이 먼저** — `labelForText` 이관 없이는 Task 2를 테스트할 수 없고, 그물 없이 통합하면 드리프트가 조용히 통과한다.
- Task 1-1 → 1-2 → 1-3은 같은 content 파일군이라 순차가 안전하다.
- Task 5-3은 타입·목이 소비처를 끌고 오므로 G5 안에서 마지막.
- **Task 12-3은 G5(5-1) 이후** — `createRefreshRunner.ts`를 두 그룹이 고친다.
- Task 6-3은 6-1·6-2 완료 후.
- Task 13-1·13-2는 전부 끝난 뒤 — 무엇을 안 했는지가 확정돼야 적을 수 있다.

**의존 없음(원안 정정)**: Task 10-3은 10-2와 병렬 가능하다(pretest가 `build:log-viewer`를 자동 실행).

**커밋 단위**: 그룹당 1커밋(G1·G2·G3·G4·G5·G6·G7·G9·G10·G11·G12). Task 0은 별도 선행 커밋(이관 + 그물). Task 13-1은 `docs(DROPPED): ...`, Task 13-2는 문서별 `docs(<name>): ...`로 분리.

**테스트를 함께 갱신해야 하는 곳 2개** — 커밋 메시지에 그 사실을 적는다: `connect-reason-coverage.test.ts`(Task 5-2, `GRANT_LANE_FILES` 집합 고정) · `JsonTreeViewer.test.tsx:20`(Task 11-3, button UA font 미상속 가능). 둘 다 "그물이 정상 작동한 것"이지 구현 오류가 아니다.

## 가이드 영향

**없음.** prd.md "가이드 영향" 참조 — 사용자 노출 변화 7건은 전부 "원래 그래야 했던 것"이라 가이드에 새로 설명할 기능이 아니고, 툴팁 문구도 기존 i18n 키를 재사용한다(신규 키는 #17의 1개뿐).

## Privacy 영향

**문서 변경 불필요.** prd.md "Privacy 영향" 참조 — `docs/privacy.ko.md:76`이 `aria-labelledby` 연결 라벨 마스킹을 **이미 공언**하고 있어 #12는 코드가 방침을 따라가는 수정이다. 새 캡처·수집·저장·전송 동작 0.
