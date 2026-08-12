# 이슈 본문 언어 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 없음. manifest 무수정.
- `docs/features/french-locale/`은 **미구현 상태**(문서만)이고 이 기획과 순서 의존이 없다. 어느 쪽이 먼저 착지해도 된다 — 단 Task 10(문서 갱신)은 이 기획에서 처리한다.
- 착수 전 `docs/POSTMORTEM.md`를 `i18n`·`locale`·`toLocaleString`·`골든`으로 grep한다(2026-07-16 `toLocaleString` 함정 항목이 Task 3·8과 직접 겹친다).

## 태스크

### Task 1: `withLocale` — 동기 전용 로케일 스왑

- **변경 대상**: `src/i18n/index.ts`, `src/i18n/__tests__/` (신규 테스트)
- **작업 내용**: `withLocale<T>(locale: LocaleMode, fn: () => T): T` 추가. `currentLocale`을 스왑하고 `try/finally`로 복원한다. 반환값이 `Promise`면 던져서 비동기 사용을 즉시 실패시킨다(복원이 이미 끝난 뒤라 무음 누출이 되기 때문 — 던지는 게 유일한 신호).
- **검증**:
  - [ ] 테스트 먼저 작성(TDD). `fn` 안에서 `t()`가 지정 로케일 값을 반환
  - [ ] 종료 후 `getLocale()`이 진입 전 값으로 복원
  - [ ] `fn`이 throw해도 복원
  - [ ] 중첩 호출이 각 층의 이전 값으로 복원
  - [ ] async 함수를 넘기면 throw
  - [ ] `dateBcp47()`도 스왑된 로케일을 반환

### Task 2: `BodyLocale` 타입과 정규화·해석 함수

- **변경 대상**: `src/i18n/locales.ts`, `src/i18n/__tests__/locales.test.ts` 또는 신규 테스트 파일
- **작업 내용**: `BodyLocale = "auto" | LocaleMode`, `normalizeBodyLocale(value: unknown): BodyLocale`, `resolveBodyLocale(value, locale): LocaleMode` 추가. `aiLanguage.ts`의 `normalizeAiLanguage`/`resolveAiLanguage` 골격을 그대로 복제한다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] 미등록 코드(`"jp"`)·`null`·객체 → `"auto"`
  - [ ] 등록 로케일 문자열은 그대로 통과
  - [ ] `resolveBodyLocale("auto", "ko")` → `"ko"`, `resolveBodyLocale("en", "ko")` → `"en"`
  - [ ] `locale-registry.test.ts`가 여전히 green (런타임 import 0 유지)

### Task 3: 스토어 필드 + 마이그레이션 v11

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**: `bodyLocale: BodyLocale`(기본 `"auto"`) + `setBodyLocale` 추가. `migrateSettingsUi`에 `state.bodyLocale = normalizeBodyLocale(state.bodyLocale)` 추가하고 persist `version`을 11로 올린다(주석의 버전 이력에 `v11: bodyLocale 추가` 한 줄). `mergePersistedSettings`에도 재정규화 추가 — `aiLanguage`와 같은 이유로 rehydrate마다 교정한다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] v10 persist에서 올라오면 `"auto"`
  - [ ] 오염값(`"jp"`)이 rehydrate에서 `"auto"`로 교정
  - [ ] 기존 필드(`aiLanguage`·`issueSections`·`locale`)의 마이그레이션 결과 불변

### Task 4: `MarkdownContext.bodyLocale` 도입 + 생산지 2곳

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`(타입), `src/sidepanel/lib/buildMarkdownContext.ts`, `src/sidepanel/lib/buildEditorCapture.ts`, `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: `MarkdownContext`에 `bodyLocale: LocaleMode`를 **required**로 추가. `buildMarkdownContext`는 `BuildMarkdownContextArgs`로 받아 채우고(`PreviewPanel` 4개 호출부가 store에서 읽어 주입), `buildEditorMarkdownContext`는 내부에서 `useSettingsUiStore.getState()`로 읽어 채운다. 두 곳 모두 `resolveBodyLocale`을 통과한 값을 넣는다 — `"auto"`가 `ctx`에 실려서는 안 된다.
- **검증**:
  - [ ] `pnpm typecheck`가 픽스처 누락 지점을 전부 지목(이 시점엔 테스트가 red여도 됨)
  - [ ] `buildMarkdownContext.test.ts`에 `bodyLocale` 통과 케이스 추가
  - [ ] `buildEditorCapture.test.ts`에 스토어 `bodyLocale: "en"` + `locale: "ko"` → `ctx.bodyLocale === "en"` 케이스 추가
  - [ ] `"auto"` 저장 상태에서 `ctx.bodyLocale`이 화면 언어와 같음

### Task 5: 빌더 진입점 래핑 (8개 + 2개 함수)

- **변경 대상**: `buildIssueMarkdown.ts`(`buildIssueMarkdown`·`buildIssueHtml`), `buildMarkdownIssueBody.ts`, `buildIssueAdf.ts`, `buildNotionIssueBody.ts`, `buildLinearIssueBody.ts`, `buildAsanaIssueBody.ts`, `buildClickupIssueBody.ts`, `buildSlackBody.ts`
- **작업 내용**: 각 진입 함수 본문을 `withLocale(ctx.bodyLocale, () => { …기존 본문… })`으로 감싼다. 내부 헬퍼·시그니처는 무수정. `buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`는 손대지 않는다(위임 대상이 감싸지므로 자동).
- **검증**:
  - [ ] 테스트 먼저: 빌더별로 `bodyLocale: "en"` + 전역 로케일 `ko` → 출력에 영어 헤딩
  - [ ] 같은 케이스에서 빌드 직후 `getLocale()`이 `"ko"`로 복원(누출 회귀망)
  - [ ] GitHub·GitLab 빌더도 위임을 통해 영어 헤딩(수정 없이)
  - [ ] `bodyOutputGolden.test.ts` 스냅샷 무수정 통과 — Task 7 완료 후

### Task 6: `logs.html` Report 데이터 박제

- **변경 대상**: `src/sidepanel/lib/buildReportData.ts`, `src/sidepanel/lib/__tests__/buildReportData.test.ts`
- **작업 내용**: `deriveContextEnvRows`는 `ctx`를 받는 동기 함수라 전체를 `withLocale(ctx.bodyLocale, …)`로 감싼다. `buildReportData`는 async라 **`await resolveSectionImages` 이후 동기 구간만** 감싼다(`sections` 라벨 생성·`envTitle`·`copy.markdown`/`html`). `input.markdownContext.bodyLocale`을 읽는다 — 새 파라미터를 추가하지 않는다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] `bodyLocale: "en"` + 화면 `ko` → `envTitle === "Environment"`, 섹션 label 영어
  - [ ] `copy.markdown`이 같은 ctx의 `buildIssueMarkdown` 출력과 문자열 일치
  - [ ] `labelOverride`가 있으면 본문 언어와 무관하게 그 문자열 유지
  - [ ] `buildReportData` 완료 후 `getLocale()` 복원

### Task 7: 골든 테스트 모킹 보강

- **변경 대상**: `src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts` 및 `@/i18n`을 모킹하는 다른 테스트 파일
- **작업 내용**: `vi.mock("@/i18n", …)` 객체에 `withLocale: (_locale, fn) => fn()` 추가. 모킹된 모듈에 없으면 `undefined is not a function`으로 58장이 한꺼번에 죽는다. 픽스처의 `MarkdownContext`에 `bodyLocale` 추가.
- **검증**:
  - [ ] `bodyOutputGolden.test.ts.snap` **무수정** 통과 — 스냅샷이 바뀌면 코드가 잘못된 것이다
  - [ ] `@/i18n`을 모킹하는 파일 전수 확인(`grep -rn 'vi.mock("@/i18n"' src`)

### Task 8: 두 키셋 값 일치 가드

- **변경 대상**: `src/i18n/__tests__/` (신규 또는 기존 파일에 추가)
- **작업 내용**: `md.section.*`와 `section.*`가 겹치는 id에 대해 등록 로케일 전부에서 값이 일치하는지 검사한다. `logs.html` Report(미리보기 키셋)와 제출 본문(md 키셋)의 문자열 일치가 이 전제 위에 서 있는데, 지금은 아무 것도 강제하지 않는다.
- **검증**:
  - [ ] 겹치는 id(`env`·`description`·`stepsToReproduce`·`media`·`attachments`·`styleChanges`·`expectedResult`·`notes`)에서 ko·en 값 일치
  - [ ] 한쪽 값을 일부러 바꾸면 red

### Task 9: AI 작성 언어 체인 연결

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`(타입), `src/sidepanel/lib/prompts/draftRich.ts`, `src/sidepanel/lib/buildAiDraftRequest.ts`(또는 실제 ctx 생산지), `src/sidepanel/tabs/settings/LlmConnectForm.tsx`
- **작업 내용**: `AiDraftPromptContext`에 `bodyLocale: LocaleMode` 추가. `draftRich.ts:92`의 `resolveAiLanguage(ctx.aiLanguage, ctx.locale)`를 `ctx.bodyLocale`로 바꾼다. **74·216행의 `ctx.locale`은 그대로 둔다** — 프롬프트 스캐폴딩 테이블은 화면 언어에 묶어두는 게 설계다. `LlmConnectForm.tsx:111`의 `자동 (X)` 표기도 해석된 본문 로케일을 넘긴다.
- **검증**:
  - [ ] 테스트 먼저 작성
  - [ ] `aiLanguage: "auto"` + `bodyLocale: "en"` + `locale: "ko"` → 프롬프트에 `Write in English`
  - [ ] 같은 조건에서 섹션 설명 스캐폴딩은 **한국어 테이블 그대로**(`draftRich.test.ts` 기존 기대값 불변)
  - [ ] `aiLanguage: "Japanese"` 명시 선택은 본문 언어와 무관하게 우선
  - [ ] `buildAiDraftPrompt.test.ts` 기존 케이스 green

### Task 10: 설정 UI — 이슈 공통 설정 섹션

- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`, `src/i18n/namespaces/settings.ts`
- **작업 내용**: `IssueSettingsContent`의 `settings.titleSettings` 섹션 제목을 `settings.issueCommon`(이슈 공통 설정)으로 교체하고, 제목 접두어 아래에 이슈 본문 언어 셀렉터를 추가한다. 옵션은 `["auto", ...LOCALES]` 순회 — `GeneralSettingsContent`의 `LOCALES.map` + `LOCALE_LABELS` 패턴을 그대로 따른다. `auto` 라벨은 `settings.bodyLocale.auto`(`자동 ({lang})`)에 해석 결과를 넣는다. 도움말에 "복사·제출되는 본문의 섹션 제목·표 헤더 언어입니다" 취지 한 줄. 신규 키 4개를 ko·en 동시 추가하고 `settings.titleSettings`는 제거한다.
- **검증**:
  - [ ] i18n PostToolUse 훅의 `locales.test.ts`가 green(대칭·빈 값·placeholder)
  - [ ] `manifest-locales.test.ts` 영향 없음(이 축은 `_locales`와 무관)
  - [ ] 화면 언어 ko + 본문 언어 auto → 셀렉터가 `자동 (한국어)`
  - [ ] 본문 언어 `en` 선택 → `자동 (English)`이 아니라 `English`가 선택 표시되고, AI 언어 셀렉터의 auto 표기가 `자동 (English)`로 바뀜
  - [ ] `settings.titleSettings` 잔존 참조 0(`grep -rn titleSettings src`)

### Task 11: `french-locale` 문서 갱신

- **변경 대상**: `docs/features/french-locale/prd.md`
- **작업 내용**: 세 지점을 이 기획과 정합하게 고친다.
  - 비목표 30줄 "이슈 본문 로케일 — 별도 축이다. 이번엔 안 건드린다" → 별도 기획(`docs/features/issue-body-locale/`)으로 착지했음을 가리키게.
  - 품질 정책 43–45줄(실패 반경) → 검수되지 않은 fr 번역이 트래커에 영구 게시되는 위험을 **본문 언어를 English로 고정해 차단할 수 있다**는 밸브를 명시. "두 표면의 정책이 다르다"는 서술도 갱신.
  - S7(107–110줄) "고치지 않는다" → 본문 언어 설정으로 해소되는 시나리오로 교체.
- **검증**:
  - [ ] 두 PRD를 나란히 읽었을 때 모순되는 문장이 없다
  - [ ] `french-locale` 문서의 나머지(사전 세 벌·폴백 테이블·릴리스 전략)는 무수정

### Task 12: 가이드 반영

- **변경 대상**: `guide/ko/settings/issue.md`, `guide/en/settings/issue.md`, `guide/ko/settings/ai.md`, `guide/en/settings/ai.md`
- **작업 내용**: `/guide` 스킬로 처리한다. issue.md에 이슈 본문 언어 항목 추가. **ai.md 46–48행은 기존 서술이 이미 과대하다** — ko `"화면은 한국어로 두고 이슈 본문만 영어로 받는 식"`, en `"get the issue body in French"`가 실제로는 AI가 쓴 *내용*만 그 언어이고 헤딩은 화면 언어였다. 이 기획이 그 문장을 사실로 만들어주므로, 두 설정의 역할 분담(내용 vs 스캐폴딩)을 구분해 다시 쓴다.
- **검증**:
  - [ ] `guide/AUTHORING.md` 규칙 준수(IA·톤·UI 라벨 인용)
  - [ ] ko·en 대칭
  - [ ] 화면이 바뀌었으므로 `settings-issue-*.jpg` 재촬영 필요 여부 판정 → `/guide-shots`

## 테스트 계획

### 단위 테스트

- `withLocale` — 스왑·복원·중첩·throw 복원·async 거부·`dateBcp47` 연동 (Task 1)
- `normalizeBodyLocale`/`resolveBodyLocale` — 오염값 교정, auto 해석 (Task 2)
- `migrateSettingsUi` v11 + `mergePersistedSettings` 재정규화 (Task 3)
- 빌더 8곳 × `bodyLocale: "en"` + 전역 `ko` → 영어 출력 + 종료 후 로케일 복원 (Task 5)
- `buildReportData`/`deriveContextEnvRows` — 박제 언어, `copy.markdown` 일치, `labelOverride` 우선 (Task 6)
- `md.section.*` ↔ `section.*` 값 일치 가드 (Task 8)
- `draftRich` — 출력 언어는 `bodyLocale`, 스캐폴딩은 `locale` (Task 9)
- **누출 회귀망**: 각 빌더 테스트 끝에 `expect(getLocale()).toBe(진입 전 값)`을 넣는다. 이 축의 유일한 무음 실패 모드다.

### e2e 시나리오

`/e2e-write`의 입력. **각 spec은 끝에서 본문 언어를 `자동`으로 되돌린다** — 같은 워커의 후속 spec 오염 방지.

- 설정 > 이슈에서 이슈 본문 언어를 `English`로 바꾸면, 사이드패널 UI와 미리보기 섹션 제목은 한국어로 남는다.
- 본문 언어가 `English`인 상태에서 마크다운 복사를 누르면 클립보드 텍스트에 `## Environment`가 있고 `## 재현 환경`은 없다.
- 본문 언어가 `자동`이면 클립보드 텍스트의 헤딩이 화면 언어와 같다.
- 본문 언어를 `English`로 바꾸면 AI 설정 화면의 작성 언어 `자동` 표기가 `자동 (English)`로 바뀐다.
- 섹션 `labelOverride`가 설정된 상태에서 본문 언어를 바꿔도 그 섹션 제목은 입력값 그대로 복사된다.

### 수동 테스트 (Chrome)

- 400px에서 새 셀렉터·도움말이 오버플로하지 않는다.
- 본문 언어 `English`로 Jira에 실제 제출 → 이슈 본문 헤딩이 영어, `Captured` 값이 `11/14/2023, 22:13:20 GMT+9` 형식.
- 같은 제출물의 `logs.html`을 열어 Report 탭 섹션 제목이 영어이고, 탭·버튼 라벨은 브라우저 언어를 따르는지 확인.
- 본문 언어를 바꾼 뒤 진행 중이던 draft·캡처 상태가 초기화되지 않는지 확인.

## 구현 순서 권장

```
Task 1 (withLocale) ─┐
Task 2 (BodyLocale) ─┼→ Task 3 (store) → Task 4 (ctx 전파) → Task 5 (빌더 래핑) → Task 7 (골든 모킹)
                     │                                     └→ Task 6 (logs.html)
                     └→ Task 9 (AI 체인)
Task 8 (키셋 가드) — 독립, 아무 때나
Task 10 (설정 UI) — Task 3 이후
Task 11 (fr 문서) · Task 12 (가이드) — 구현 완료 후
```

- Task 1·2는 서로 독립이라 병렬 가능.
- **Task 4는 required 필드 도입이라 그 시점에 `pnpm typecheck`가 대량 에러를 낸다.** Task 4→5→7을 한 흐름으로 처리해 typecheck를 회복시킨 뒤 다른 갈래로 넘어가는 게 안전하다.
- Task 8은 다른 태스크에 걸리지 않으므로 먼저 빼서 green을 만들어두면 Task 6 검증이 쉬워진다.

## 가이드 영향

- `guide/settings/issue.md`(ko·en) — 이슈 본문 언어 항목 추가. 섹션 제목이 "이슈 공통 설정"으로 바뀐 것도 반영.
- `guide/settings/ai.md`(ko·en) — 46–48행의 "이슈 본문만 영어로 받는 식" 서술을 AI 작성 언어(내용)와 이슈 본문 언어(스캐폴딩)의 역할 분담으로 정정.
- 스크린샷: `guide/{ko,en}/assets/settings-issue-1.jpg`가 제목 접두어 설정 컷이라 섹션 제목·항목이 바뀌면 재촬영 대상. `/guide-shots`가 stale 판정.
