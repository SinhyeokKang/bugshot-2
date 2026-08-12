# 이슈 본문 언어 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 없음. manifest 무수정.
- 착수 전 `docs/POSTMORTEM.md`를 `i18n`·`locale`·`toLocaleString`·`골든`으로 grep한다(2026-07-16 `toLocaleString` 함정, 2026-08-06 "기대값을 SUT가 계산"·"빈 그물 3연속", 2026-08-11 소스 스캔 테스트 항목이 각각 Task 3·8·7과 직접 겹친다).
- **`docs/features/french-locale/`과의 상호작용**: 그쪽은 미구현(문서만)이고 **1,001키 완성까지 dev 머지 불가인 장기 feature 브랜치**를 택했다(`french-locale/design.md:141`). 이 기획이 `src/i18n/namespaces/settings.ts`에 키 4개를 추가하고 하나를 삭제하므로, **fr 브랜치가 리베이스할 때 무음 자동머지로 fr에만 키가 빠지는 위험이 커진다**(`:149`가 지목한 최대 비용). fr 착수자에게 이 기획의 키 변경을 알려야 한다. 순서 자체에는 강제 의존이 없다.
- **AI 작성 언어 축은 이번 스코프가 아니다** — `buildAiDraftPrompt.ts`·`draftRich.ts`·`LlmConnectForm.tsx`를 건드리지 않는다. 2차 착수 시 재사용할 설계 메모는 design.md "AI 작성 언어 체인 — 이번에 안 한다" 절에 있다.

## 태스크

### Task 1: `withLocale` — 동기 전용 로케일 스왑

- **변경 대상**: `src/i18n/index.ts`, `src/i18n/__tests__/` (신규 테스트)
- **작업 내용**: `withLocale<T>(locale: LocaleMode, fn: () => T): T` 추가. `currentLocale`을 스왑하고 `try/finally`로 복원한다. 반환값이 `Promise`면 던져서 비동기 사용을 즉시 실패시킨다. **인자는 정규화하지 않는다**(trusted by construction — 방어하면 무음 폴백이 생겨 배선 오류가 숨는다).
- **검증**:
  - [ ] 테스트 먼저 작성(TDD). `fn` 안에서 `t()`가 지정 로케일 값을 반환
  - [ ] 종료 후 `getLocale()`이 진입 전 값으로 복원
  - [ ] `fn`이 throw해도 복원 (throw는 호출부로 전파)
  - [ ] 중첩 호출이 각 층의 이전 값으로 복원
  - [ ] async 함수를 넘기면 throw. **한계도 테스트로 고정**: `void asyncFn()`·`setTimeout`은 잡히지 **않는다**는 걸 명시적 케이스로 남겨 다음 사람이 과신하지 않게 한다
  - [ ] `dateBcp47()`도 스왑된 로케일을 반환

### Task 2: `BodyLocale` 타입과 정규화·해석 함수

- **변경 대상**: `src/i18n/locales.ts`, `src/i18n/__tests__/` (신규 또는 기존 파일에 추가)
- **작업 내용**: `BodyLocale = "auto" | LocaleMode`, `normalizeBodyLocale(value: unknown): BodyLocale`, `resolveBodyLocale(value, locale): LocaleMode` 추가. `src/sidepanel/lib/aiLanguage.ts`의 `normalizeAiLanguage`/`resolveAiLanguage` 골격을 복제한다(경로 주의 — `src/i18n/`이 아니다).
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] 미등록 코드(`"jp"`)·`null`·`undefined`·객체·빈 문자열 → `"auto"`
  - [ ] 등록 로케일 문자열은 그대로 통과
  - [ ] `resolveBodyLocale("auto", "ko")` → `"ko"`, `resolveBodyLocale("en", "ko")` → `"en"`, `resolveBodyLocale(undefined, "en")` → `"en"`
  - [ ] `locale-registry.test.ts`가 여전히 green (런타임 import 0 유지)

### Task 3: 스토어 필드 + 마이그레이션 v11

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**: `bodyLocale: BodyLocale`(기본 `"auto"`) + `setBodyLocale` 추가. `migrateSettingsUi`(`:133`)에 `state.bodyLocale = normalizeBodyLocale(state.bodyLocale)` 추가하고 persist `version`을 10→11로 올린다(주석 이력에 `v11: bodyLocale 추가` 한 줄). `mergePersistedSettings`(`:162`)에도 재정규화 추가.
  **주석 한 줄 남길 것**: `mergePersistedSettings`가 rehydrate마다 재정규화하므로 migrate 라인은 기능적으로 중복이다. `aiLanguage` 선례와의 일관성 + 필드 도입 시점 기록용으로 둔다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] v10 persist에서 올라오면 `"auto"`
  - [ ] 오염값(`"jp"`)이 rehydrate에서 `"auto"`로 교정
  - [ ] **멱등**: 이미 v11이고 `bodyLocale: "en"`인 상태를 재수화해도 `"en"` 보존
  - [ ] **역방향**: v11 → (다운그레이드로 v10 코드가 읽음) → 재업그레이드 시 오염 없이 `"auto"`로 안착 (PRD S7 경로)
  - [ ] 기존 필드(`aiLanguage`·`issueSections`·`locale`)의 마이그레이션 결과 불변

### Task 4: `@/i18n` 모킹 보강 — **required 필드 도입보다 먼저**

- **변경 대상**: `vi.mock("@/i18n"` 하는 파일 중 빌더를 태우는 전부
- **작업 내용**: 모킹 객체에 `withLocale: (_locale, fn) => fn()` 추가. 없으면 `undefined is not a function`으로 골든 62장이 한꺼번에 죽는다. **Task 5(required 필드) 앞에 두는 이유**: 이 편집은 단독으로 무해하고, 먼저 넣으면 red 창이 픽스처 편집 한 번으로 줄어든다.
- **검증**:
  - [ ] `grep -rl 'vi.mock("@/i18n"' src`로 전수 확인 — 현재 **55개 파일**. 그중 빌더/`buildReportData`를 태우는 파일만 대상
  - [ ] 이 태스크만 적용한 상태에서 `pnpm test` green (동작 변화 0)

### Task 5: `MarkdownContext.bodyLocale` 도입 + 생산지 3곳

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`(타입), `src/sidepanel/lib/buildMarkdownContext.ts`, `src/sidepanel/lib/buildEditorCapture.ts`, `src/sidepanel/tabs/PreviewPanel.tsx`(`:295`·`:311`·`:327`·`:351`), **`src/sidepanel/tabs/DraftDetailDialog.tsx`(`:333`)**
- **작업 내용**: `MarkdownContext`에 `bodyLocale: LocaleMode`를 **required**로 추가. 세 생산지 모두 `resolveBodyLocale`을 통과한 값을 넣는다 — `"auto"`가 `ctx`에 실려서는 안 된다.
  - `buildMarkdownContext` — `BuildMarkdownContextArgs`로 받는다(`PreviewPanel`이 store에서 읽어 주입).
  - `buildEditorMarkdownContext` — 내부에서 `useSettingsUiStore.getState()`로 읽는다.
  - `DraftDetailDialog` — **타입 주석 없는 인라인 객체 리터럴**이라 누락이 이 파일이 아니라 빌더 호출부에서 컴파일 에러로 뜬다. `useSettingsUiStore` 접근 + `resolveBodyLocale` 호출을 새로 넣어야 한다. 이슈 목록의 과거 draft 재제출 경로(PRD S3).
- **검증**:
  - [ ] `pnpm typecheck`가 픽스처 누락 지점을 전부 지목(이 시점엔 red여도 됨 — 픽스처 **22개** + `DraftDetailDialog`)
  - [ ] `buildMarkdownContext.test.ts`에 `bodyLocale` 통과 케이스 추가
  - [ ] `buildEditorCapture.test.ts`에 스토어 `bodyLocale: "en"` + `locale: "ko"` → `ctx.bodyLocale === "en"` 케이스 추가
  - [ ] `"auto"` 저장 상태에서 `ctx.bodyLocale`이 화면 언어와 같음
  - [ ] `DraftDetailDialog` 경로에도 같은 단언 (컴포넌트 테스트가 과하면 최소 typecheck + 수동 확인으로 대체하고 그 사실을 명시)

### Task 6: 빌더 진입점 래핑 (8파일 / 9진입 함수)

- **변경 대상**: `buildIssueMarkdown.ts`(`buildIssueMarkdown`·`buildIssueHtml`), `buildIssueAdf.ts`, `buildMarkdownIssueBody.ts`, `buildNotionIssueBody.ts`, `buildLinearIssueBody.ts`, `buildAsanaIssueBody.ts`, `buildClickupIssueBody.ts`, `buildSlackBody.ts`
- **작업 내용**: 각 진입 함수 본문을 `withLocale(<로케일 표현식>, () => { …기존 본문… })`으로 감싼다. **로케일 접근 표기가 파일마다 다르다** — design.md "본문 빌더 진입점 8개" 표를 그대로 따를 것(6곳은 `input.ctx.bodyLocale`, `buildIssueMarkdown`/`buildIssueHtml`/`buildIssueAdf`는 `ctx.bodyLocale`이고 `buildIssueAdf`는 3인자). 내부 헬퍼·시그니처는 무수정.
  `buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`는 손대지 않는다(`t()` 0회 + 위임).
  **`prepareUpload.ts:93`은 감싸지 않는다** — 에러 토스트는 화면 언어가 정답.
- **검증**:
  - [ ] `bodyOutputGolden.test.ts` 스냅샷 **62장 무수정** 통과 — 바뀌면 코드가 잘못된 것이다
  - [ ] 실제 로케일 단언은 Task 8에서 (이 파일들의 mock `t`는 키를 에코하므로 여기선 불가능)

### Task 7: 소스 스캔 게이트 — 래핑 누락을 red로

- **변경 대상**: `src/sidepanel/lib/__tests__/` (신규 테스트)
- **작업 내용**: `src/sidepanel/lib/build*.ts` 중 `@/i18n`에서 `t`를 import하는 파일은 `withLocale(`도 포함해야 한다 — 정규식 소스 스캔. `src/i18n/__tests__/locale-registry.test.ts`의 "순수성" describe 방식을 복제한다.
- **검증**:
  - [ ] **자기검증 앵커**: 스캔이 실제로 대상 파일에 도달하는지 개수로 단언(현재 9개). 앵커 없으면 0개를 훑고도 green
  - [ ] 임의 빌더에서 `withLocale`을 지우면 red
  - [ ] `buildGithub`/`buildGitlab`(t 0회)은 대상에서 제외됨

### Task 8: 실사전 통합 테스트 — 이 축의 유일한 진짜 그물

- **변경 대상**: `src/sidepanel/lib/__tests__/` (신규 파일, **`vi.mock("@/i18n")` 없음**)
- **작업 내용**: 기존 빌더 테스트 20개는 전부 `@/i18n`을 모킹하고 `t`가 키를 에코하므로 로케일을 관측할 수 없다. 모킹 없이 실사전을 쓰는 전용 파일을 신설한다.
- **검증**:
  - [ ] `setLocale("ko")` 상태에서 `bodyLocale: "en"` ctx로 10개 빌더(8 + github/gitlab 위임)를 순회 → 출력에 `Environment` 등 영어 헤딩, `재현 환경` 부재
  - [ ] `bodyLocale: "auto"`로 해석된 `"ko"` → 한국어 헤딩 (기본값 경로 파리티)
  - [ ] 각 빌드 직후 `getLocale() === "ko"` 복원
  - [ ] 빌더가 throw하는 케이스에서도 복원
  - [ ] **래핑 구간 안 store write 회귀 케이스** — `withLocale` 안에서 `useSettingsUiStore.setState`가 불리면 `TiptapEditor` 구독이 동기로 `setLocale`을 덮는다는 걸 재현하고, 빌더가 그런 write를 하지 않음을 고정
  - [ ] **빈 그물 방지**: `withLocale`의 `finally`를 일시 제거해 이 파일이 실제로 red가 되는지 확인하고, 확인했다는 사실을 커밋 메시지나 PR에 남긴다

### Task 9: `logs.html` Report 데이터 박제

- **변경 대상**: `src/sidepanel/lib/buildReportData.ts`, `src/sidepanel/lib/__tests__/buildReportData.test.ts`
- **작업 내용**: `deriveContextEnvRows`는 `ctx`를 받는 동기 함수라 전체를 `withLocale(ctx.bodyLocale, …)`로 감싼다. `buildReportData`는 async라 **`await resolveSectionImages`(`:52`) 이후 동기 tail만** 감싼다(`:56` 섹션 라벨 · `:66` `envTitle` · `:70`/`:71` copy 페이로드). `input.markdownContext.bodyLocale`을 읽는다 — 새 파라미터를 추가하지 않는다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] `bodyLocale: "en"` + 화면 `ko` → `envTitle === "Environment"`, 섹션 label 영어
  - [ ] `copy.markdown`에 **리터럴 단언** — `## Environment` 포함 / `## 재현 환경` 미포함. (`:70`이 문자 그대로 `buildIssueMarkdown(copyCtx)`를 호출하므로 "출력이 서로 같다"는 단언은 항진명제다)
  - [ ] `labelOverride`가 있으면 본문 언어와 무관하게 그 문자열 유지
  - [ ] `buildReportData` 완료 후 `getLocale()` 복원
  - [ ] `envTitle`이 md 키셋(`md.section.env`), 섹션 라벨이 미리보기 키셋(`section.*`)이라는 현 구조는 유지 — 통일하지 않는다

### Task 10: background realm 3곳

- **변경 대상**: `src/types/messages.ts`(submit payload 타입), `src/background/messages.ts`(`:863`·`:919`), `src/background/notion-api.ts`(`:595`), 제출 메시지를 보내는 사이드패널 호출부, 해당 `__tests__`
- **작업 내용**: background는 `currentLocale` 인스턴스가 별도(`bg-init.ts:17-19`가 화면 언어로 세팅)라 사이드패널 `withLocale`이 닿지 않는다. submit 메시지 payload에 `bodyLocale: LocaleMode`를 실어 전달하고 그 3곳을 `withLocale`로 감싼다.
  - `messages.ts:919` — Jira ADF 스냅샷 행 라벨 `t("styleTable.snapshot")`
  - `messages.ts:863` — Jira 영상 폴백 문단 `t("md.videoAttached")`
  - `notion-api.ts:595` — Notion 첨부 섹션 제목 `t("notion.attachmentSection")` (**빌더에 없고 여기서만 생성**)
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] `bodyLocale: "en"` payload + background 전역 `ko` → 세 문자열이 전부 영어
  - [ ] payload 누락(구버전 메시지) 시 화면 언어로 폴백하고 크래시하지 않음
  - [ ] 호출 후 background `getLocale()` 복원
  - [ ] `injectSnapshotRows.test.ts` 기존 green — 표 식별은 하드코딩 `As is`/`To be`라 이 변경과 무관함을 확인

### Task 11: 두 키셋 값 일치 가드

- **변경 대상**: `src/i18n/__tests__/` (신규 또는 기존 파일에 추가)
- **작업 내용**: `sectionLabelKey(id)`와 `sectionMdLabelKey(id)`의 값이 등록 로케일 전부에서 일치하는지 검사한다. **대상 id는 하드코딩하지 않고 `IssueSectionId`에서 파생**시킨다 — 두 함수가 받는 게 그 타입이고, 섹션이 늘면 자동 편입된다.
  **함정(하드코딩 금지 이유)**: `env`·`attachments`·`styleChanges`는 섹션 id가 아니라 각 표면의 리터럴 키다. 그리고 `section.attachments`(ko `"첨부 파일"`)와 `md.section.attachments`(ko `"첨부"`)는 **이미 값이 다르므로**, 목록에 끼워 넣으면 작성 즉시 red다.
- **검증**:
  - [ ] `IssueSectionId` 5종(`description`·`stepsToReproduce`·`media`·`expectedResult`·`notes`)에서 ko·en 값 일치 — 현재 실제로 일치하므로 첫날 green
  - [ ] 한쪽 값을 일부러 바꾸면 red
  - [ ] `IssueSectionId`에 항목을 추가하면 검사 대상이 자동으로 늘어난다(파생 확인)

### Task 12: 설정 UI — 이슈 공통 설정 섹션

- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`(`:172`), `src/i18n/namespaces/settings.ts`
- **작업 내용**: `IssueSettingsContent`의 `settings.titleSettings` 섹션 제목을 `settings.issueCommon`(이슈 공통 설정)으로 교체하고, 제목 접두어 아래에 이슈 본문 언어 셀렉터를 추가한다. 옵션은 `["auto", ...LOCALES]` 순회 — `GeneralSettingsContent`의 `LOCALES.map` + `LOCALE_LABELS` 패턴을 그대로 따른다. `auto` 라벨은 `settings.bodyLocale.auto`(`자동 ({lang})`)에 해석 결과를 넣는다. 도움말: "복사·제출되는 본문의 섹션 제목·표 헤더 언어입니다. 사이드패널 화면과 AI 초안 언어는 따로 설정합니다" 취지 한 줄. 신규 키 4개를 ko·en 동시 추가하고 `settings.titleSettings`는 제거한다.
  - **렌더**: `FieldRow`(DESIGN.md §13). 도움말은 셀렉터 선례를 따라 `text-sm text-muted-foreground`이고, 같은 섹션의 titlePrefix 도움말이 `text-[0.8rem]`이라 **두 항목을 시각적으로 분리된 행으로** 배치한다.
  - **접근성 — 새 선례**: `aria-label` 부착 + 도움말을 `aria-describedby`로 연결. 기존 `Select` 3개는 전부 결손 상태지만 소급 수정은 스코프 밖.
  - **e2e testid**: 신규 셀렉터에 `data-testid` 부착. 현재 설정 화면엔 `settings-sub-issue`만 있어 Task 15의 e2e가 셀렉터를 못 잡는다. 화면 언어 Select와 `settings-sub-general` 트리거에도 필요하면 함께 부착.
- **검증**:
  - [ ] i18n PostToolUse 훅의 `locales.test.ts`가 green(대칭·빈 값·placeholder)
  - [ ] `manifest-locales.test.ts` 영향 없음(이 축은 `_locales`와 무관)
  - [ ] 화면 언어 ko + 본문 언어 auto → 셀렉터가 `자동 (한국어)`
  - [ ] 본문 언어 `en` 선택 → `English`가 선택 표시
  - [ ] `settings.titleSettings` 잔존 참조 0 — `grep -rn titleSettings src e2e guide` (현재 참조 3건: `SettingsTab.tsx:172`, `settings.ts` ko `:5`/en `:111`)

### Task 13: 상시 문서 갱신

- **변경 대상**: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/DIRECTORY.md`(필요 시)
- **작업 내용**:
  - `CLAUDE.md` — 로케일 축 서술에 **세 번째 축(`bodyLocale`)** 추가. 현행 "AI 출력 언어" 항목의 `auto` 설명은 이번 스코프에선 여전히 참이므로 건드리지 않되, 본문 언어와 별개 축임을 한 줄로 구분.
  - `docs/ARCHITECTURE.md` — `withLocale`의 전역 스왑 규약을 절로 추가: 왜 동기 전용인지, 왜 래핑이 빌더 진입점인지, **래핑 구간 안 store write 금지** 불변식, background realm이 별도 인스턴스라 payload로 전달한다는 것. 266행 "로케일 축은 `locales.ts`가 단일 출처" 서술에 `BodyLocale`·`normalizeBodyLocale`·`resolveBodyLocale` 편입.
  - `docs/DESIGN.md`(271행 부근) — `IssuePreviewView`가 "두 표면이 같은 본문을 그리도록 강제"라는 괄호 문구를 갱신. **PreviewPanel은 화면 언어, log-viewer Report 탭은 본문 언어**로 표면별 언어 정책이 갈린다는 사실을 명시.
- **검증**:
  - [ ] 세 문서를 나란히 읽었을 때 로케일 축 서술이 모순되지 않는다
  - [ ] `pnpm sync:agents:check` green (CLAUDE.md 편집 시 PostToolUse 훅이 자동 실행)

### Task 14: `french-locale` 문서 갱신

- **변경 대상**: `docs/features/french-locale/prd.md`
- **작업 내용**: 두 지점을 이 기획과 정합하게 고친다.
  - 비목표 30줄 "이슈 본문 로케일 — 별도 축이다. 이번엔 안 건드린다" → 별도 기획(`docs/features/issue-body-locale/`)으로 착지했음을 가리키게.
  - S7(107–110줄) "고치지 않는다" → 본문 언어 설정으로 해소되는 시나리오로 교체.
  - **품질 정책 43–45줄(실패 반경)은 건드리지 않는다** — 이 기획 PRD에서 "안전 밸브" 논거를 뺐으므로(미출시 기능에 가치를 종속시키지 않기 위해), fr 쪽에서도 그 연결을 새로 만들지 않는다.
  - 상류 키 churn 위험을 fr 쪽 위험 요소에 한 줄 추가(`settings.ts` 키 4개 추가 + 1개 삭제).
- **검증**:
  - [ ] 두 PRD를 나란히 읽었을 때 모순되는 문장이 없다
  - [ ] `french-locale` 문서의 나머지(사전 세 벌·폴백 테이블·릴리스 전략)는 무수정

### Task 15: e2e 시나리오

- **변경 대상**: `e2e/` (신규 spec) — `/e2e-write`로 처리
- **작업 내용**: 아래 "e2e 시나리오" 절 참조. 전제 두 개를 spec 헤더 주석에 박는다 — ① **앱 로케일이 워커 프로필에 따라 비결정**이므로 각 spec은 설정 UI로 화면 언어를 먼저 명시 선택해 결정화한다 ② **클립보드 read 인프라가 없으므로**(`readText`·`grantPermissions` 0건) write 스텁 + 페이지 전역 캡처로 검증한다(`freeform-draft.spec.ts:40-52` 선례).
- **검증**:
  - [ ] 각 spec 종료 시 본문 언어를 `자동`, 화면 언어를 원래 값으로 되돌린다(워커 오염 방지)
  - [ ] `pnpm build:e2e && pnpm test:e2e` green

### Task 16: 가이드 반영

- **변경 대상**: `guide/ko/settings/issue.md`, `guide/en/settings/issue.md`, `guide/ko/settings/ai.md`, `guide/en/settings/ai.md`
- **작업 내용**: `/guide` 스킬로 처리한다. issue.md에 이슈 본문 언어 항목 추가(섹션 제목이 "이슈 공통 설정"으로 바뀐 것 + `## 제목 접두어` 헤딩 위계도 반영).
  **ai.md 46–48행은 지금 거짓이다** — ko `"화면은 한국어로 두고 이슈 본문만 영어로 받는 식"`, en `"get the issue body in French"`가 실제로는 AI가 쓴 *내용*만 그 언어이고 헤딩은 화면 언어였다. 이 기획이 스캐폴딩 쪽을 사실로 만든다. 두 설정의 역할 분담(**AI 작성 언어 = 내용 / 이슈 본문 언어 = 스캐폴딩**)을 구분해 다시 쓰고, **둘 다 영어로 받으려면 두 설정을 각각 지정해야 한다**를 명시한다.
  `"자동으로 두시면 화면 언어를 그대로 따라가니"`는 **이번 스코프에선 여전히 참**이므로 유지한다(AI 축을 안 바꾸므로).
- **검증**:
  - [ ] `guide/AUTHORING.md` 규칙 준수(IA·톤·UI 라벨 인용). 복사 버튼 라벨은 `"복사"`/`"Copy"`(`preview.copyMarkdown`) — "마크다운 복사"가 아니다
  - [ ] ko·en 대칭
  - [ ] 화면이 바뀌었으므로 `settings-issue-*.jpg` 재촬영 → `/guide-shots`

## 테스트 계획

### 단위 테스트

- `withLocale` — 스왑·복원·중첩·throw 복원·async 거부(+ 거부 못 하는 한계 케이스)·`dateBcp47` 연동 (Task 1)
- `normalizeBodyLocale`/`resolveBodyLocale` — 오염값 교정, auto 해석 (Task 2)
- `migrateSettingsUi` v11 + `mergePersistedSettings` 재정규화 + 멱등 + 역방향 (Task 3)
- 소스 스캔 게이트 + 자기검증 앵커 (Task 7)
- **실사전 통합 테스트** — 10개 빌더 × `bodyLocale: "en"` + 전역 `ko` → 영어 출력, 종료 후 복원, throw 복원, 빈 그물 실증 (Task 8)
- `buildReportData`/`deriveContextEnvRows` — 박제 언어, 리터럴 단언, `labelOverride` 우선 (Task 9)
- background 3곳 — payload 전달, 폴백, 복원 (Task 10)
- `sectionLabelKey` ↔ `sectionMdLabelKey` 값 일치 가드(`IssueSectionId` 파생) (Task 11)

**누출 회귀망의 소재는 Task 8 전용 파일 하나다.** 기존 빌더 테스트에 `getLocale()` 단언을 흩뿌리는 방식은 작동하지 않는다 — 그 파일들은 `@/i18n`을 모킹하고 `getLocale`을 스텁하지 않아 `is not a function`으로 죽거나, 스텁을 추가하면 항진명제가 된다. 게다가 `useT()`가 다음 렌더에 `currentLocale`을 되돌리므로 **누출은 자기치유돼 e2e·수동으로도 관측 불가**다.

### e2e 시나리오

`/e2e-write`의 입력. **각 spec은 시작에서 화면 언어를 명시 선택해 결정화하고, 끝에서 본문 언어를 `자동`·화면 언어를 원래 값으로 되돌린다.**

- 화면 언어를 `한국어`로 고정한 뒤 설정 > 이슈에서 이슈 본문 언어를 `English`로 바꾸면, 사이드패널 탭 라벨과 미리보기 섹션 제목은 한국어로 남는다.
- 화면 언어 `한국어` + 본문 언어 `English`에서 복사 버튼을 누르면, 스텁으로 캡처한 클립보드 텍스트에 `## Environment`가 있고 `## 재현 환경`은 없다.
- 화면 언어 `한국어` + 본문 언어 `자동`에서 복사하면 캡처 텍스트에 `## 재현 환경`이 있고 `## Environment`는 없다.
- 섹션 `labelOverride`가 설정된 상태에서 본문 언어를 `English`로 바꿔도, 캡처 텍스트의 그 섹션 제목은 입력값 그대로다.
- 본문 언어를 바꾼 뒤 진행 중이던 draft의 섹션 입력값이 유지된다(설정 store 변경이 editor store를 건드리지 않음).

### 수동 테스트 (Chrome)

- 400px에서 새 셀렉터·도움말이 오버플로하지 않는다. (리스크는 낮다 — `SelectTrigger`가 `w-full` + `line-clamp-1`이고 `Português (Brasil)`가 이미 같은 자리에 렌더된다.)
- 본문 언어 `English`로 Jira에 실제 제출 → 헤딩이 영어, `Captured` 값이 `11/14/2023, 22:13:20 GMT+9` 형식, **스냅샷 행 라벨이 `Snapshot`**(Task 10 확인).
- Notion에 실제 제출 → **첨부 섹션 제목이 영어**(Task 10 확인, 빌더 경로에 없는 유일한 문자열).
- 같은 제출물의 `logs.html`을 열어 Report 탭 섹션 제목이 영어이고, 탭·버튼 라벨은 브라우저 언어를 따르는지 확인.

## 구현 순서 권장

```
Task 1 (withLocale) ─┬→ Task 4 (mock 보강) → Task 5 (ctx 3곳) → Task 6 (빌더 래핑) ─┬→ Task 7 (스캔 게이트)
Task 2 (BodyLocale) ─┤                                                              ├→ Task 8 (실사전 테스트)
                     │                                                              └→ Task 9 (logs.html)
                     ├→ Task 3 (store) → Task 12 (설정 UI)
                     └→ Task 10 (background)

Task 11 (키셋 가드) — 독립, 먼저 빼두면 Task 9 검증이 쉽다
Task 13·14 (문서) · Task 15 (e2e) · Task 16 (가이드) — 구현 완료 후
```

- Task 1·2는 서로 독립이라 병렬 가능.
- **Task 4를 Task 5보다 먼저** 둔다 — mock 보강은 단독으로 무해하고, 먼저 넣으면 required 필드 도입의 red 창이 픽스처 편집 한 번으로 줄어든다.
- **Task 5는 required 필드 도입이라 그 시점에 `pnpm typecheck`가 23개 파일에서 에러를 낸다.** Task 5→6을 한 흐름으로 처리해 typecheck를 회복시킨 뒤 다른 갈래로 넘어간다.
- Task 11은 다른 태스크에 걸리지 않으므로 먼저 빼서 green을 만들어두면 Task 9 검증이 쉬워진다.
- Task 10(background)은 payload 타입만 공유하므로 Task 5 이후 아무 때나. 단 Task 12(설정 UI)가 있어야 수동 확인이 가능하다.

## 가이드 영향

- `guide/settings/issue.md`(ko·en) — 이슈 본문 언어 항목 추가. 섹션 제목이 "이슈 공통 설정"으로 바뀐 것도 반영.
- `guide/settings/ai.md`(ko·en) — 46–48행의 "이슈 본문만 영어로 받는 식" 서술을 AI 작성 언어(내용)와 이슈 본문 언어(스캐폴딩)의 역할 분담으로 정정. "자동 = 화면 언어" 서술은 유지(이번 스코프에서 안 바뀜).
- 스크린샷: `guide/{ko,en}/assets/settings-issue-1.jpg`가 제목 접두어 설정 컷이라 섹션 제목·항목이 바뀌면 재촬영 대상. `/guide-shots`가 stale 판정.
