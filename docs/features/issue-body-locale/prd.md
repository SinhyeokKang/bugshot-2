# 이슈 본문 언어

## 배경

BugShot의 언어 축은 지금 둘이다 — 화면 언어(`locale`)와 AI 작성 언어(`aiLanguage`). 셋째가 빠져 있다: **제출되는 이슈 본문의 언어.**

본문 빌더 8곳(`buildMarkdownIssueBody`·`buildIssueAdf`·`buildNotionIssueBody`·`buildLinearIssueBody`·`buildAsanaIssueBody`·`buildClickupIssueBody`·`buildSlackBody`·`buildIssueMarkdown`)이 제출 시점에 `t()`로 섹션 헤딩·표 헤더·로그 요약 문장을 만든다. `t()`는 화면 언어를 읽으므로 **화면 언어가 곧 본문 언어**다. 그래서 지금은 한국어 UI로 쓰는 사람이 영어권 팀 트래커에 영어 본문을 올리려면 **화면 언어를 통째로 영어로 바꾸는 방법밖에 없다.**

`docs/features/french-locale/`이 이 축을 이미 지목했다. 비목표 30줄이 "이슈 본문 로케일 — 별도 축이다. 이번엔 안 건드린다"로 미뤘고, S7(107–110줄)이 "fr UI 사용자가 제출하면 프랑스어 헤딩이 영어권 팀 트래커에 올라간다 / 의도된 결과는 아니지만 이번 스코프에서 고치지 않는다"로 구멍을 명시해뒀다. 즉 드랍이 아니라 **연기**이고, 이 기획이 그 연기를 회수한다.

### 수요 근거의 강도 (약하다 — 명시해둔다)

이 기획을 요청한 외부 리포트는 **없다.** 저장소 전체를 훑어도 이 수요의 사용자 신호는 0건이다 — `ai-nano-downloadable-banner`가 웹스토어 리뷰를 원문 인용하고 `french-locale`이 실명 고객을 지목하는 것과 대비된다. 근거는 셋인데 성격이 다르다:

1. **자기 문서의 연기** — `french-locale`이 스스로 미뤄둔 비목표. 순환 근거는 아니지만 외부 신호도 아니다.
2. **가이드가 이미 약속하고 있다** — `guide/ko/settings/ai.md`(46–48행)가 *"화면은 한국어로 두고 이슈 본문만 영어로 받는 식"* 이라고 쓰여 있다. 실제로는 AI가 쓴 **내용**만 그 언어이고 헤딩은 화면 언어였으므로 **이 문장은 지금 거짓**이다. 이 기획이 그 문장을 사실로 만든다. (역으로, 거짓인 채로 아무 항의가 없었다는 것 자체가 수요가 약하다는 신호이기도 하다.)
3. **"흔한 조합"이라는 직관** — 도구는 모국어, 산출물은 팀 공용어. 출처 없는 단언이다.

**따라서 이 기획은 수요 검증이 아니라 구조 정합성으로 정당화한다.** 언어 축이 둘인데 셋째 표면(제출물)이 첫째에 무음으로 묶여 있는 상태는, fr이 착지하는 순간 검수되지 않은 번역이 트래커로 나가는 경로가 된다.

### 인접 선례 — `DROPPED.md:15`

`docs/features/DROPPED.md`를 `i18n`·`로케일`·`언어`로 grep하면 0건이지만, **비용 구조가 같은 항목이 하나 있다**: `DROPPED.md:15`(2026-08-10, 요소 식별 정보 표시 재설계)는 **같은 8개 빌더 목록과 같은 골든 스냅샷 아티팩트**를 비용으로 들어 기각됐다. 기각 사유 둘 — *"비용이 근거보다 크다"*, *"근거가 실측이 아니다"* — 는 이 기획에도 그대로 겨눌 수 있다.

이 기획이 같은 결론에 이르지 않는 이유는 하나다: **그쪽은 8개 빌더의 출력을 바꿔 골든 62장을 전부 갱신해야 했고, 이쪽은 기본값 경로에서 출력이 바이트 동일이라 골든이 무수정이다.** 변경 표면은 비슷해도 검증 부담이 다르다. 단 이 논거는 골든이 실제로 로케일을 관측할 때만 성립하는데 지금은 아니다 — 아래 "성공 기준"의 실사전 골든 참조.

### 실효 사정거리 (이름값보다 좁다)

`/feature` 드랍 판정 기준 3번에 해당하므로 명시한다. 이 설정이 실제로 바꾸는 문자열은 **번역 키 24개**다:

| 갈래 | 키 | 개수 |
|---|---|---|
| 섹션 헤딩 | `md.section.*` (env·description·stepsToReproduce·media·attachments·styleChanges·before·after·expectedResult·notes) | 10 |
| 로그 요약 문장 | `logSummary.*` | 8 |
| 표 헤더·플레이스홀더 | `md.column.property`·`md.noValue`·`md.imageAttached`·`md.videoAttached` | 4 |
| Asana 비교 헤딩 | `styleTable.asIs`·`styleTable.toBe` | 2 |

바뀌지 **않는** 것: 사용자가 쓴 본문, AI 초안 내용, env 행 라벨(`OS`/`Browser`/`Page`/`DOM`/`Viewport`/`Captured` — 하드코딩 영어), Jira·Linear·ClickUp 표의 `As is`/`To be` 열 헤더(하드코딩 리터럴 — `injectSnapshotRows.ts`가 표 식별에 쓴다), 이슈 제목.

즉 결과물은 **영어 헤딩 + 영어 로그 요약 + 사용자가 쓴 언어 그대로의 본문 + 영어 하드코딩 env 라벨**의 혼합이다. "본문 언어"라는 이름이 약속하는 것보다 좁다. 이걸 수용하고 진행한다 — 트래커에서 이슈를 스캔하는 사람이 먼저 보는 게 헤딩과 구조이기 때문이다.

## 목표

- 설정 > 이슈에서 **이슈 본문 언어**를 고를 수 있고, 기본값 `자동`은 화면 언어를 따라간다.
- 마크다운·HTML 클립보드 복사와 8개 플랫폼 제출 본문의 **섹션 헤딩·로그 요약 문장·`Captured` 시각 포맷**이 그 언어로 나간다(위 표의 24개 키).
- **background realm에서 생성되는 제출물 문자열 3곳도 같은 언어로 나간다** — 사이드패널과 background는 `currentLocale` 인스턴스가 달라 빌더 래핑만으로는 안 닿는다. 아래 "구현 범위" 참조.
- 이슈에 첨부되는 `logs.html`의 Report 탭(`envTitle`·섹션 label·미리 빌드된 copy 페이로드)도 같은 언어로 박제돼, 제출된 본문과 문자열이 일치한다.
- 옵션 목록이 `LOCALES` 단일 출처에서 파생돼, `french-locale`이 `fr`을 등록하면 **이 기획 쪽 수정 없이** 본문 언어 셀렉터에 `Français`가 늘어난다.
- 위 전부가 기본값(`자동`) 사용자의 출력을 **한 바이트도 바꾸지 않는다.**

## 비목표 (Non-goals)

- **사용자가 쓴 본문·AI 초안 내용의 번역** — 이 설정이 바꾸는 건 스캐폴딩(헤딩·라벨·표 헤더·요약 문장)뿐이다. 사용자가 한국어로 쓴 「발생 현상」 본문은 본문 언어를 English로 바꿔도 한국어 그대로다. 설정 라벨을 "리포트 언어"가 아니라 **"이슈 본문 언어"**로 두는 이유가 이것이다.

- **AI 작성 언어 `자동`의 재바인딩 — 2차로 미룬다.** 원안은 `aiLanguage: "auto"`의 해석 기준을 화면 언어에서 본문 언어로 옮기려 했으나, 이건 **v1.7.18에 출시된 기능의 semantics 변경**이고 옵트아웃 경로가 없다. 본문 언어 축이 먼저 착지해 실사용 신호가 생긴 뒤 별건으로 판단한다. **그래서 본문 언어를 English로 둬도 AI 초안은 화면 언어(한국어)로 온다** — 사용자가 둘 다 영어로 받으려면 AI 작성 언어를 명시적으로 `English`로 고르면 된다. 가이드가 이 역할 분담을 설명해야 한다.

- **사이드패널 UI 전체의 언어 — 화면 언어를 유지한다.** 미리보기 패널의 섹션 제목·env 라벨·복사 버튼·빈 상태 문구 전부 포함이다. 본문 키(`md.section.*`)와 미리보기 키(`section.*`)가 이미 분리돼 있어 추가 비용 없이 갈라진다. **결과적으로 미리보기 제목과 제출물 헤딩의 언어가 달라질 수 있다** — 의도된 상태이고, 설정 도움말 한 줄로 알린다. 이 결정 때문에 `IssuePreviewView`(PreviewPanel과 log-viewer Report 탭 공용)가 **표면별로 다른 언어를 렌더**하게 되므로 `docs/DESIGN.md`의 해당 서술을 함께 갱신한다.

- **`logs.html` 뷰어 chrome UI의 언어** — 탭·버튼·필터 라벨은 기존 설계대로 **읽는 사람의 브라우저 언어**를 따른다(`src/log-viewer/i18n.ts:294` 주석의 명시적 결정). 이번에 박제 대상이 되는 건 `LogViewerReport` 데이터뿐이다.

- **9개 AI 언어 프리셋과 동등한 목록** — 본문 언어는 사전이 존재하는 로케일(`LOCALES`, 현재 ko·en)만 가능하다. AI 작성 언어는 프롬프트 지시문이라 임의 언어를 지시할 수 있지만 본문 헤딩은 사전 조회다. **두 셀렉터의 옵션 개수가 다른 건 구조적 차이이고 좁힐 수 없다.**

- **`freeform`·미리보기 env 행 라벨의 번역** — `OS`·`Browser`·`Page`·`DOM`·`Viewport`·`Captured`는 이미 하드코딩 영어라 이 축과 무관하다. **감수하는 결과는 하나의 산출물 안에 언어가 섞인다는 것**이다: 영어 `## Environment` 아래 영어 `OS`/`Browser`, 그 옆에 사용자가 한국어로 쓴 본문. 의도한 상태다.

- **Jira·Linear·ClickUp 스타일 표의 `As is`/`To be` 열 헤더** — 하드코딩 리터럴이고, `background/injectSnapshotRows.ts`가 **이 문자열로 styleChanges 표를 식별**한다(`headers.includes("As is") && headers.includes("To be")`). 번역하면 Jira 스냅샷 이미지 행 삽입이 무음으로 깨진다. 건드리지 않는다. (Asana의 `styleTable.asIs`/`toBe`는 표가 아니라 비교 섹션 헤딩이고 표 식별에 안 쓰이므로 본문 언어를 따라간다.)

- **이슈 제목의 언어** — `defaultTitle(titlePrefix)`는 사용자가 입력한 접두어뿐이라 로케일 의존이 없다.

- **과거에 제출한 이슈의 소급 변경** — 이미 트래커에 올라간 본문은 건드릴 수 없다. 아래 S5 참조.

- **compact(Chrome 내장 AI) 경로** — `ai-provider.ts:51`의 `outputLanguage: "en"` 하드코딩과 별개로 `draftCompact.ts:56`은 `localeAiPreset(ctx.locale)`을 읽어 `Write in ${lang}.`을 내보낸다. 즉 compact 프롬프트는 **화면 언어에 묶여 있다.** `french-locale` PRD 31줄과 같은 이유로 별건이고 건드리지 않는다.

- **본문 언어별 프롬프트 스캐폴딩 분기** — `SECTION_DESC_BASE`·`MODE_HINTS`는 화면 언어(`ctx.locale`)에 묶인 채로 둔다. 폴백 허용 테이블이고 "영어 뼈대 + `Write in X`"가 설계다.

- **채택률 측정** — 제품 지표는 측정하지 않는다. PostHog 익명 집계에 이 축을 추가하지 않는다(`french-locale`·`body-composition`과 같은 관례).

## 사용자 시나리오

**S1 — 기본값(자동)**
1. 설치 직후 `bodyLocale`은 `"auto"`.
2. 화면 언어가 한국어면 제출 본문 헤딩도 한국어(`## 재현 환경`), AI 초안도 한국어.
3. **현재 동작과 완전히 동일하다.** 이 경로에서 출력이 달라지면 회귀다.

**S2 — 한국어 UI + 영어 본문**
1. 설정 > 이슈 > 이슈 공통 설정 > 이슈 본문 언어에서 `English` 선택.
2. 사이드패널 UI는 한국어 유지. 미리보기 섹션 제목도 한국어(`재현 환경`).
3. `복사`를 누르면 클립보드에는 `## Environment`가 들어간다.
4. Jira에 제출하면 ADF 헤딩이 `Environment`, `Captured` 값이 `11/14/2023, 22:13:20 GMT+9`.
5. 첨부된 `logs.html`의 Report 탭 섹션 제목도 `Environment`.
6. **AI 초안은 여전히 한국어로 온다** — AI 작성 언어 축은 이번에 안 바꾼다(비목표). 초안까지 영어로 받으려면 설정 > AI에서 작성 언어를 `English`로 명시 선택한다.

**S3 — 본문 언어를 바꾼 뒤 재제출**
1. 한국어 본문으로 이슈를 제출한 뒤, 본문 언어를 `English`로 바꾼다.
2. 같은 draft를 다른 플랫폼에 다시 제출하면 **새 설정(영어)으로 다시 빌드된다.**
3. 저장 시점 스냅샷이 아니라 호출 시점 해석이다 — `aiLanguage`의 `auto`와 같은 원칙.
4. 이슈 목록에서 과거 draft를 여는 경로(`DraftDetailDialog`)도 같다 — 이 경로가 `MarkdownContext`의 세 번째 생산지다.

**S4 — 섹션 라벨을 직접 덮어쓴 경우**
1. 사용자가 설정에서 섹션 `labelOverride`를 입력해뒀다.
2. 본문 언어를 바꿔도 그 섹션 제목은 입력한 문자열 그대로다.
3. **명시 입력이 언어 설정보다 우선**이다. 기존 `labelOverride` 우선순위를 그대로 따른다.

**S5 — 제출 후 `logs.html`을 다른 사람이 열기 (엣지)**
1. 본문 언어 English로 제출 → `logs.html`의 Report 탭은 영어로 박제된다.
2. 한국어 브라우저 동료가 열면 **탭·버튼은 한국어, Report 탭 내용은 영어**로 보인다.
3. 두 층의 정책이 다른 게 의도다 — 뷰어 chrome은 읽는 사람 기준, 리포트 데이터는 제출물과 일치.

**S6 — `fr` 등록 이후 (french-locale 착지 후)**
1. `LOCALES`에 `fr`이 들어가면 본문 언어 셀렉터가 `자동 · 한국어 · English · Français` 넷이 된다. (**오늘 기준으로는 셋** — `LOCALES = ["ko","en"]`.)
2. 프랑스어 UI 사용자가 본문 언어만 `English`로 두면, 검수되지 않은 프랑스어 번역이 트래커로 나가지 않는다.
3. 이 기획 쪽 코드 수정은 0이다 — 옵션이 `LOCALES`에서 파생되므로.

**S7 — 오염된 설정값 (엣지)**
1. `chrome.storage.local`의 `bodyLocale`에 `"jp"` 같은 미등록 값이 들어간다(다운그레이드·외부 오염).
2. `normalizeBodyLocale`이 `"auto"`로 교정한다 → 화면 언어로 폴백.
3. 사전 조회가 `undefined`가 되어 `t()`가 죽는 일은 없다.

## 엣지 케이스

- **본문 언어 ≠ 화면 언어일 때의 에러 토스트** — 제출 실패 토스트는 UI라 화면 언어다. 본문만 영어인 상태에서 한국어 에러가 뜨는 건 정상이다. (`prepareUpload.ts:93`이 `await` 이후 `t()`로 만드는 문구가 여기 해당 — **감싸면 안 되는 자리**다.)
- **`labelOverride`가 빈 문자열/공백** — 기존 `?.trim() ||` 폴백이 그대로 동작해 본문 언어의 기본 라벨로 떨어진다.
- **비동기 제출 도중 화면 언어 변경** — 빌더 8개는 전부 동기라 빌드 시점의 값이 쓰인다. **단 `logs.html` Report 경로(`buildReportData`)는 async**이고 `await resolveSectionImages` 뒤에 `t()`가 온다 — 그 동기 tail만 감싼다(design.md 참조).
- **`md.section.*`에 없는 섹션** — `logs.html` Report의 섹션 라벨은 미리보기 키셋(`section.*`)을 쓰고, 같은 함수의 `envTitle`은 **md 키셋**(`md.section.env`)을 쓴다. 한 함수 안에 두 키셋이 섞여 있는 게 현재 상태다. 교차하는 건 `IssueSectionId` 5종(`description`·`stepsToReproduce`·`media`·`expectedResult`·`notes`)뿐이고 그 5개는 ko·en 모두 값이 일치한다.
  **주의**: `section.attachments`(`"첨부 파일"`)와 `md.section.attachments`(`"첨부"`)는 **이미 ko 값이 다르다.** 하지만 `attachments`는 `IssueSectionId`가 아니라 각 표면의 리터럴 키라 이 교차의 대상이 아니다. 값 일치 가드는 `IssueSectionId`에서 파생시켜 이 함정을 피한다(design.md 위험 요소 참조).

## 성공 기준

- `bodyLocale`이 `"auto"`인 상태에서 **기존 본문 출력이 바이트 동일**하다 — `bodyOutputGolden.test.ts` 스냅샷 189KB/**62장**이 무수정 통과.
  **단 이 기준만으로는 부족하다.** 그 테스트는 `@/i18n`을 통째로 모킹해 `t`를 키 에코로, `dateBcp47`을 `"en-US"` 고정으로, `formatTimestamp`까지 대체한다 — 즉 **로케일이 출력에 반영될 여지가 0이라 `bodyLocale` 배선이 완전히 틀려도 통과한다.** 이 기준은 *"블록 순서·구조가 안 바뀐다"*로만 읽고, 로케일 회귀는 아래 항목이 잡는다.
- **모킹 없이 실사전을 쓰는 전용 테스트**가 존재한다: 화면 언어 `ko` + `bodyLocale: "en"` → 10개 빌더 출력이 전부 영어 헤딩, `bodyLocale: "auto"` → 화면 언어와 동일.
- **소스 스캔 게이트**가 존재한다: `src/sidepanel/lib/build*.ts` 중 `@/i18n`의 `t`를 import하는 파일은 `withLocale`도 포함해야 한다. 새 플랫폼 어댑터가 래핑을 잊으면 red.
- 본문 언어를 `en`으로 두고 화면 언어를 `ko`로 둔 상태에서: 클립보드 마크다운 헤딩이 영어 · 미리보기 화면 제목이 한국어 · 8개 플랫폼 빌더 출력이 전부 영어 · **background가 생성하는 Jira 스냅샷 행 라벨·Notion 첨부 섹션 제목도 영어**.
- `withLocale` 종료 후 `getLocale()`이 진입 전 값으로 복원된다(정상 종료·예외 종료 양쪽).
- `withLocale`에 비동기 함수를 넘기면 **런타임에 즉시 실패**한다. (한계: `Promise` **반환**만 잡는다 — `void asyncFn()`·`setTimeout`·`queueMicrotask`는 무음 통과다.)
- `pnpm typecheck` 0 에러 — `MarkdownContext.bodyLocale`이 required라 모든 생산지·테스트 픽스처를 컴파일러가 지목한다.
- `french-locale` PRD의 비목표 30줄·S7이 이 기획을 가리키도록 갱신돼, 두 문서가 모순되지 않는다.
- 수동(400px): 설정 > 이슈의 새 셀렉터가 `자동 (한국어)` 표기로 렌더된다.
