# 이슈 본문 언어 — 기술 설계

## 개요

`t()`는 모듈 전역 `currentLocale`을 읽는다(`src/i18n/index.ts:10`). 본문 빌더 8곳이 이 전역을 통해 헤딩·라벨을 만들므로, 본문 언어를 갈아끼우는 방법은 둘뿐이다 — **① 모든 빌더에 `TranslationFn`을 스레딩**하거나 **② 빌드 동기 구간 동안 전역을 임시로 바꾸기**. ②를 택한다. 빌더 8곳 + 하위 헬퍼 수십 개의 시그니처를 건드리지 않고, 새 진입점이 생겨도 `MarkdownContext`만 제대로 만들면 자동으로 따라오기 때문이다.

전역 스왑의 위험은 **누출**이다(감싼 구간 밖까지 로케일이 바뀐 채 남는 것). 이걸 네 겹으로 막는다: `try/finally` 복원 · 비동기 함수 거부 · 래핑 지점을 호출부가 아니라 **빌더 진입점**에 두기 · **소스 스캔 테스트로 래핑 누락을 red로 만들기**. 네 번째가 없으면 "잊을 자리가 없다"는 주장이 검증되지 않은 채 남는다 — `apiHostRow` 선례의 핵심은 게이트를 단일 함수에 두는 것과 **테스트로 고정하는 것**이 한 쌍이라는 점이다.

전파 경로는 `MarkdownContext.bodyLocale`(**required**)이다. optional로 두면 미지정 생산지가 현재 로케일로 무음 폴백하므로, 컴파일러가 모든 생산지를 지목하게 만든다.

### realm 경계 — 빌더 래핑만으로 안 닿는 3곳

`currentLocale`은 **realm마다 별도 인스턴스**다(SW 1 + sidepanel 1 + 주입 탭 N). background는 `src/i18n/bg-init.ts:17-19`가 `bugshot-app-settings.state.locale`(= **화면 언어**)로 세팅하고, 사이드패널의 `withLocale`은 여기에 닿지 않는다. 그런데 제출물 본문 문자열을 background에서 만드는 자리가 셋 있다:

| 위치 | 키 | 무엇 |
|---|---|---|
| `src/background/messages.ts:919` | `styleTable.snapshot` | Jira ADF styleChanges 표에 splice되는 "스냅샷" 행 라벨. 같은 키를 Linear·ClickUp·Markdown은 빌더 안에서 찍는데 **Jira만 background** |
| `src/background/messages.ts:863` | `md.videoAttached` | 영상이 media로 안 붙었을 때 placeholder를 대체하는 Jira 본문 문단 |
| `src/background/notion-api.ts:595` | `notion.attachmentSection` | Notion 첨부 섹션 제목. **빌더에 아예 없고 오직 여기서만 생성된다** — 래핑으로 절대 커버되지 않는다 |

이걸 안 메우면 영어 본문 안에 한국어 한 줄이 섞인다. **해결**: submit 메시지 payload에 `bodyLocale`을 실어 background로 전달하고, 그 3곳을 `withLocale`로 감싼다. 기각안 B(호출부 래핑)를 택했어도 똑같이 새는 갭이라 대안 선택과 무관하다.

## 변경 범위

### 신규 파일

없다. 로케일 축의 단일 출처가 이미 `src/i18n/locales.ts`이므로 새 모듈을 만들지 않는다.

### `src/i18n/locales.ts`

- **현재 역할**: 로케일 축 단일 출처(`LOCALES`·`LocaleMode`·`normalizeLocale`·`detectLocale` 등). **런타임 import가 0이어야 하는 파일**(log-viewer가 상대경로로, background SW가 같이 끌어간다 — `locale-registry.test.ts`가 정규식 소스 스캔으로 강제).
- **변경**: `BodyLocale` 타입과 `normalizeBodyLocale`·`resolveBodyLocale` 두 순수 함수 추가. 외부 import를 늘리지 않으므로 import-0 제약을 유지한다.

`aiLanguage.ts`(실제 경로: `src/sidepanel/lib/aiLanguage.ts`)가 아니라 여기에 두는 이유: 본문 언어의 도메인이 `LocaleMode`이지 AI 프리셋이 아니고, 이 파일을 background·log-viewer가 이미 공유하기 때문이다. `aiLanguage.ts`는 사이드패널 전용이라 background가 끌어갈 수 없다.

### `src/i18n/index.ts`

- **현재 역할**: `t()`·`setLocale`·`getLocale`·`dateBcp47`·`useT`.
- **변경**: `withLocale` 추가. 동기 전용이며 비동기 함수를 거부한다.
- **인자 신뢰 규약**: `withLocale`은 인자를 정규화하지 **않는다.** `locales[bad]`는 `undefined`라 `t()`가 TypeError로 죽으므로, 미등록 값이 여기까지 오면 안 된다. 정규화 게이트는 store(`normalizeBodyLocale`)와 생산지(`resolveBodyLocale`) 두 곳이고, `withLocale`은 **trusted by construction**이다. 방어 코드를 넣지 않는 이유: 넣으면 무음 폴백이 생겨 배선 오류가 숨는다.

### `src/store/settings-ui-store.ts`

- **현재 역할**: 화면 언어·AI 언어·섹션 구성 등 UI 설정 persist(background SW 번들에도 포함).
- **변경**: `bodyLocale: BodyLocale` 필드(기본 `"auto"`) + `setBodyLocale` + `migrateSettingsUi`에 v11 정규화 + `mergePersistedSettings`에 재정규화.
- **v11 bump가 `mergePersistedSettings`와 중복인 이유**: `mergePersistedSettings`(`:162`)가 rehydrate마다 무조건 재정규화하므로 migrate 라인 없이도 오염값은 교정된다. 그럼에도 v11을 올리는 건 ① `aiLanguage` 선례와의 일관성 ② persist version이 "이 스키마에 필드가 추가된 시점"의 기록이라 다음 마이그레이션 작성자가 기준선을 읽을 수 있기 때문이다. 기능적 필요가 아니라 이력 관리다.

### `src/sidepanel/lib/buildIssueMarkdown.ts`

- **현재 역할**: `MarkdownContext` 타입 정의 + 마크다운/HTML 본문 빌더(`t(` 포함 줄 33, 호출 35회).
- **변경**: `MarkdownContext`에 `bodyLocale: LocaleMode` 추가(required). `buildIssueMarkdown`·`buildIssueHtml` 진입부를 `withLocale`로 감싼다.

### 본문 빌더 진입점 8개

`withLocale(<ctx>.bodyLocale, () => …)` 래핑만 추가한다. 내부 로직·헬퍼는 무수정. **`ctx`에 닿는 표기가 파일마다 다르므로 아래 표를 그대로 따른다** — 6곳은 `input.ctx`이고 `buildIssueAdf`는 3인자다.

| 파일 | 진입 함수 | 로케일 접근 |
|---|---|---|
| `buildIssueMarkdown.ts` | `buildIssueMarkdown` · `buildIssueHtml` | `ctx.bodyLocale` |
| `buildIssueAdf.ts` | `buildIssueAdf(ctx, inlineImageRefIds?, cc?)` | `ctx.bodyLocale` |
| `buildMarkdownIssueBody.ts` | `buildMarkdownIssueBody` | `input.ctx.bodyLocale` |
| `buildNotionIssueBody.ts` | `buildNotionIssueBody` | `input.ctx.bodyLocale` |
| `buildLinearIssueBody.ts` | `buildLinearIssueBody` | `input.ctx.bodyLocale` |
| `buildAsanaIssueBody.ts` | `buildAsanaIssueBody` | `input.ctx.bodyLocale` |
| `buildClickupIssueBody.ts` | `buildClickupIssueBody` | `input.ctx.bodyLocale` |
| `buildSlackBody.ts` | `buildSlackBody` | `input.ctx.bodyLocale` |

`buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`는 `t()` 호출이 0이고 내부에서 `buildMarkdownIssueBody`에 위임하므로 **수정 불필요** — 위임 대상이 감싸지면 자동으로 따라온다.

**감싸면 안 되는 자리**: `prepareUpload.ts:93`은 async 함수가 `await uploadFn` 이후 `t()`로 에러 토스트 문구를 만든다. 여기는 **화면 언어가 정답**이다. "일관성 있게" 감싸지 말 것.

### 소스 스캔 게이트 (신규 테스트)

`src/sidepanel/lib/build*.ts` 중 `@/i18n`에서 `t`를 import하는 파일은 `withLocale(`도 포함해야 한다 — 정규식 소스 스캔으로 강제한다. `locale-registry.test.ts`의 "순수성" describe와 같은 방식이고, **자기검증 앵커**(현재 걸리는 파일이 실제로 9개에 도달하는지)를 같이 둔다. 앵커가 없으면 스캔이 0개 파일을 훑고도 green이 된다.

이게 없으면 "빌더 진입점 래핑은 잊을 자리가 없다"는 주장이 기각안 B에 씌운 죄목("새 어댑터가 감싸는 걸 잊으면 무음으로 샌다")을 그대로 되받는다.

### 실사전 통합 테스트 (신규)

빌더 테스트 20개를 포함해 `vi.mock("@/i18n"` 하는 파일이 **55개**이고, 그중 `getLocale`을 스텁하는 파일은 **0개**다. 모킹된 `t`는 키를 그대로 에코한다. 따라서:

- 기존 빌더 테스트에 `expect(getLocale())`을 넣으면 `getLocale is not a function`으로 죽는다.
- mock에 `getLocale`을 추가하면 스텁 상수라 **항진명제**가 된다.
- 같은 이유로 "영어 헤딩" 단언도 그 파일들에선 불가능하다.

그래서 **모킹 없이 실사전을 쓰는 전용 테스트 파일 1개**를 신설한다: `setLocale("ko")` → 10개 빌더 순회 → 영어 헤딩 단언 + 종료 후 `getLocale() === "ko"` + 빌더가 throw하는 케이스에서도 복원. `finally`를 일시 제거해 red가 실제로 뜨는지 확인하는 절차까지 포함한다(빈 그물 방지).

### `src/sidepanel/lib/buildReportData.ts`

- **현재 역할**: `logs.html`의 Report 탭 데이터(`LogViewerReport`) 생성 + `deriveContextEnvRows`.
- **변경**: `buildReportData`가 **async**(내부 `await resolveSectionImages`)라 함수 전체를 감쌀 수 없다. `await` 이후의 **동기 구간만** 감싼다 — `await`는 `:52` 하나뿐이고 `t()`·빌더 호출(`:56`·`:66`·`:70`·`:71`)이 전부 그 뒤 단절 없는 동기 tail이라 리팩터가 깔끔하게 성립한다. `deriveContextEnvRows`는 동기이고 `ctx`를 받으므로 함수 전체를 감싼다(`formatTimestamp`가 `dateBcp47()`를 타므로 `Captured` 값이 본문 언어를 따라간다).
- **키셋이 섞여 있다**: `:56`의 섹션 라벨은 미리보기 키셋(`sectionLabelKey` → `section.*`), `:66`의 `envTitle`은 md 키셋(`t("md.section.env")`)이다. 이번에 통일하지 않는다 — 통일은 별건이고, 아래 값 일치 가드로 전제를 고정한다.

### `MarkdownContext` 생산지 — **셋**이다

- `buildMarkdownContext()` — 미리보기·클립보드 복사 경로(`PreviewPanel`이 4곳에서 호출: `:295`·`:311`·`:327`·`:351`).
- `buildEditorMarkdownContext()` — 제출 경로(`IssueCreateModal.tsx:129`).
- **`DraftDetailDialog.tsx:333`** — 이슈 목록에서 과거 draft를 재제출하는 경로. **타입 주석 없는 인라인 객체 리터럴**(`const ctx = { … }`)이라 required 필드 누락은 이 파일이 아니라 **빌더 호출부에서** 컴파일 에러로 뜬다. 여기엔 `useSettingsUiStore` 접근 + `resolveBodyLocale` 호출을 새로 넣어야 하므로 "픽스처 한 줄 추가"가 아니다. PRD S3가 정확히 통과하는 자리다.

셋 다 `resolveBodyLocale(bodyLocale, locale)`을 통과한 값을 채운다. **`ctx.bodyLocale`은 이미 해석된 `LocaleMode`**이지 `"auto"`가 아니다 — 빌더가 `"auto"`를 다시 해석하게 두면 해석 지점이 셋으로 갈린다.

`buildMarkdownContext`는 `BuildMarkdownContextArgs`에 store 접근이 없으므로 인자로 받는다(`PreviewPanel`이 주입). `buildEditorMarkdownContext`·`DraftDetailDialog`는 store를 직접 읽는다.

### `src/sidepanel/tabs/SettingsTab.tsx`

- **현재 역할**: `IssueSettingsContent`에 `settings.titleSettings`(`:172`) 섹션(제목 접두어 Input)이 있다.
- **변경**: 섹션 제목을 **이슈 공통 설정**으로 바꾸고(새 i18n 키), 그 안에 제목 접두어와 이슈 본문 언어 셀렉터를 함께 둔다. 셀렉터 옵션은 `["auto", ...LOCALES]`를 순회해 만든다 — 화면 언어 셀렉터(`GeneralSettingsContent`)가 이미 쓰는 `LOCALES.map` 패턴을 그대로 따르고, `LOCALE_LABELS`로 표기한다.
- **렌더 규범**: `FieldRow`(`grid gap-1.5` + `text-xs text-muted-foreground` 라벨)를 쓴다(DESIGN.md §13). 도움말은 셀렉터 선례를 따라 `text-sm text-muted-foreground` — 같은 섹션의 titlePrefix Input 도움말이 `text-[0.8rem]`이라 두 크기가 나란히 놓이므로, **본문 언어 항목은 titlePrefix 블록과 시각적으로 분리된 행으로** 배치한다.
- **접근성 — 새 선례로 남긴다**: 설정 화면의 기존 `Select` 3개(`SettingsTab.tsx:281`·`:298`, `LlmConnectForm.tsx:117`)는 전부 `id`/`htmlFor`/`aria-label` 없이 `Section`의 `<h3>`에만 시각적으로 기대고 있고, `aria-describedby`는 저장소 설정 화면 전체에 0건이다. **4번째로 복제하지 않는다** — 새 셀렉터에 `aria-label`을 붙이고 도움말을 `aria-describedby`로 연결한다. 기존 3개를 소급 수정하는 건 이 기획 스코프 밖이다.

### `src/i18n/namespaces/settings.ts`

- 신규 키 **5개**: `settings.issueCommon`(섹션 제목) · `settings.titlePrefix.label`(항목 라벨) · `settings.bodyLocale`(항목 라벨) · `settings.bodyLocale.help` · `settings.bodyLocale.auto`(`자동 ({lang})` — `llm.outputLanguage.auto`와 같은 형태).
  `titlePrefix.label`은 구현 중에 드러난 것이다 — 섹션 제목이 "제목 설정"에서 "이슈 공통 설정"으로 바뀌는 순간 접두어 Input이 자기 라벨을 잃는다(그전엔 섹션 제목이 라벨 노릇을 했다). 두 항목을 `FieldRow`로 나란히 놓으려면 각자 라벨이 있어야 한다.
- 제거 키: `settings.titleSettings`(ko `:5` / en `:111`). 현재 참조는 그 둘 + `SettingsTab.tsx:172` 총 3건이고 `e2e`·`guide`엔 0건이다.
- ko·en 동시 갱신 — PostToolUse 훅이 `locales.test.ts`를 자동 실행해 대칭을 강제한다.

### AI 작성 언어 체인 — **이번에 안 한다**

원안은 `AiDraftSessionContext`(`buildAiDraftPrompt.ts:123`)에 `bodyLocale`을 추가하고 `draftRich.ts:92`의 `resolveAiLanguage(ctx.aiLanguage, ctx.locale)`를 그것으로 바꾸려 했다. **출시된 기능의 semantics 변경이고 옵트아웃이 없어 2차로 미룬다**(PRD 비목표). 따라서 이 기획은 `buildAiDraftPrompt.ts`·`draftRich.ts`·`LlmConnectForm.tsx`를 **한 줄도 건드리지 않는다.**

미룬 것의 설계 메모(2차 착수 시 재사용):
- 타입 이름은 `AiDraftPromptContext`가 아니라 **`AiDraftSessionContext`**(`locale`은 `:126`).
- ctx 생산지는 `buildAiDraftRequest.ts`가 아니라 **`AiDraftDialog.tsx:137`·`generateReproPrefill.ts:43`** 둘.
- `draftRich.ts`에서 `ctx.locale`을 쓰는 곳은 **`:92`(출력 언어)와 `:216`(`getSectionDesc` — 프롬프트 스캐폴딩)** 둘뿐이다. `:74`는 지역 파라미터 `locale`이지 `ctx.locale`이 아니다. **`:92`만 바꿔야 하고** `:216`을 같이 바꾸면 스캐폴딩 테이블까지 따라가 `draftRich.test.ts`(경로: `src/sidepanel/lib/prompts/__tests__/`)가 깨진다.
- 깨질 픽스처: `buildAiDraftRequest.test.ts:7`의 `CTX`.
- `llm.outputLanguage.help`(`settings.ts:82`, "화면 언어와 별개입니다")와 `guide/ko/settings/ai.md`의 "자동으로 두시면 화면 언어를 그대로 따라가니"는 **2차에서 함께** 고쳐야 한다. 이번 스코프에선 둘 다 여전히 참이다.

## 데이터 흐름

```
설정 화면
  bodyLocale: "auto" | LocaleMode   ← chrome.storage.local (settings-ui-store)
        │
        ▼  resolveBodyLocale(bodyLocale, locale)      ← 호출 시점 해석
  LocaleMode ("ko" | "en" | …)
        │
        ▼
  MarkdownContext.bodyLocale   ← 생산지 3곳(buildMarkdownContext / buildEditorMarkdownContext / DraftDetailDialog)
        │
        ├─ withLocale(ctx.bodyLocale, …)  ← 사이드패널 realm
        │     ├─ buildIssueMarkdown/Html
        │     ├─ buildMarkdownIssueBody  → GitHub·GitLab
        │     ├─ buildIssueAdf           → Jira
        │     ├─ buildNotion/Linear/Asana/Clickup/Slack
        │     └─ buildReportData         → logs.html Report 탭 (박제)
        │
        └─ submit 메시지 payload         ← background realm (별도 currentLocale)
              └─ withLocale(payload.bodyLocale, …)
                    ├─ messages.ts:919  Jira 스냅샷 행 라벨
                    ├─ messages.ts:863  Jira 영상 폴백 문단
                    └─ notion-api.ts:595 Notion 첨부 섹션 제목
```

화면 언어(`locale`)는 이 경로에 직접 들어가지 않고 `"auto"`의 해석 재료로만 쓰인다. 미리보기 화면·토스트·설정 UI·AI 초안은 종전대로 화면 언어를 탄다.

## 인터페이스 설계

```ts
// src/i18n/locales.ts
export type BodyLocale = "auto" | LocaleMode;

// 저장값 정규화 — 미등록 코드·오염 문자열은 "auto"로 떨어뜨린다(폴백이 아니라 교정).
export function normalizeBodyLocale(value: unknown): BodyLocale;

// auto는 스냅샷이 아니라 호출 시점 해석 — 굳히면 화면 언어를 바꿔도 본문만 옛 언어로 남는다.
export function resolveBodyLocale(value: BodyLocale | undefined, locale: LocaleMode): LocaleMode;
```

```ts
// src/i18n/index.ts
// 동기 전용. fn 안에서 await하면 복원 시점과 실행 시점이 어긋나 로케일이 누출된다 —
// Promise 반환을 런타임에 거부해 무음 누출 대신 즉시 실패시킨다.
// 한계: 반환된 Promise만 잡는다. void asyncFn() / setTimeout / queueMicrotask는 통과한다.
// locale 인자는 정규화하지 않는다(trusted by construction) — 게이트는 store와 생산지에 있다.
export function withLocale<T>(locale: LocaleMode, fn: () => T): T;
```

```ts
// src/sidepanel/lib/buildIssueMarkdown.ts
export interface MarkdownContext {
  // 이미 해석된 값 — "auto"가 여기까지 오지 않는다. required라 생산지 누락을 컴파일러가 잡는다.
  bodyLocale: LocaleMode;
  // …기존 필드
}
```

```ts
// src/store/settings-ui-store.ts
interface SettingsUiState {
  // 화면 언어와 독립된 축 — "auto"면 locale을 따라간다(해석은 resolveBodyLocale).
  bodyLocale: BodyLocale;
  setBodyLocale: (bodyLocale: BodyLocale) => void;
  // …기존 필드
}
```

## 기존 패턴 준수

- **`aiLanguage` 3종 세트** — 저장값 정규화(`normalize*`) + 호출 시점 해석(`resolve*`) + `자동 (X)` 표기. 새 축을 만들지 않고 같은 골격을 복제한다.
- **폴백 금지/허용 구분**(CLAUDE.md "로케일별 테이블") — 이 기능은 **새 테이블을 만들지 않는다.** `LocaleMode`를 그대로 재사용하므로 `LOCALES`에 로케일이 추가되면 자동으로 따라오고, 폴백 금지 5개 목록도 그대로다.
- **`locales.ts`의 런타임 import 0** — 추가하는 두 함수는 순수 함수이고 외부 import를 늘리지 않는다. `locale-registry.test.ts`가 계속 강제한다.
- **게이트를 단일 진입점에 + 테스트로 고정**(CLAUDE.md `apiHostRow` 사례) — 래핑을 빌더 진입점에 두고, 소스 스캔 테스트로 누락을 red로 만든다. 앞쪽만 하면 절반이다.
- **store는 `sidepanel/tabs`를 import하지 않는다** — 새 함수를 `i18n/locales.ts`에 두므로 이 제약과 무관하다.
- **i18n 동시 갱신** — ko·en 양쪽. `src/log-viewer/i18n.ts` 복제 사전은 **이번에 안 건드린다**(뷰어 chrome UI는 비목표).

## 대안 검토

**A. 빌더 전체에 `TranslationFn`을 스레딩한다.** 전역을 안 건드리므로 누출이 구조적으로 불가능하다. 기각 이유: 빌더 8곳 + `emitLogSummary` 계열 하위 헬퍼 십수 개 + `StyleChangesTable.buildStyleDiff`까지 시그니처가 번지고, 그 전부가 골든 테스트의 감시 범위 안이다. 얻는 안전성 대비 변경 표면이 과하다 — 외과적 변경 원칙 위반. **덧붙여 background realm 3곳은 이 대안으로도 안 풀린다**(거기엔 `ctx`가 없다).

**B. 호출부(`submitToX` 8곳 + `PreviewPanel` + `buildCaptureFiles`)에서 감싼다.** 빌더를 한 줄도 안 고쳐도 된다. 기각 이유: 감쌀 자리가 10곳 이상이고 **새 플랫폼 어댑터가 추가될 때 감싸는 걸 잊으면 무음으로 화면 언어가 샌다.** 빌더 진입점 래핑 + 소스 스캔 게이트는 그 실패를 red로 만든다.

**C. 두 사전을 동시에 로드해 본문 전용 `t`를 만든다.** 전역 스왑이 없어 비동기 안전. 기각 이유: `locales[locale]` 조회를 우회하는 두 번째 `t` 구현이 생기고, 어느 쪽을 써야 하는지가 파일마다 판단 대상이 된다. 사전이 이미 셋(namespaces·log-viewer 복제·`_locales`)인데 네 번째 경로를 만든다.

**D. 본문 언어를 화면 언어에 종속시키지 않고 AI 언어처럼 9개 프리셋을 준다.** 기각: 헤딩은 프롬프트 지시가 아니라 사전 조회다. 사전 없는 언어를 고르면 표시할 문자열이 없다.

## 위험 요소

### 1. 래핑 구간 안에서의 store write — **이 설계의 진짜 무음 실패 모드**

`TiptapEditor.tsx:223`·`:385`는 렌더 코드가 아니라 **zustand `subscribe` 콜백**이고, 이건 `set()` 호출 스택에서 **동기로** 발화한다. 즉 `withLocale` 구간 안에서 누군가 `useSettingsUiStore.setState`를 부르면 구독자가 그 자리에서 `setLocale(화면 언어)`를 덮어써, `finally` 복원은 정상인데 **그 지점 이후의 빌드만 화면 언어로 돈다.** 현재 빌더는 전부 순수 read-only라 발생하지 않지만, **"래핑 구간 안에서 store write 금지"를 불변식으로 명시**하고 실사전 테스트에 회귀 케이스를 둔다.

### 2. 두 키셋 값이 갈라질 때 — 가드 범위를 `IssueSectionId`에서 파생시킨다

`logs.html` Report의 섹션 라벨은 `sectionLabelKey`(`section.*`), 제출 본문은 `sectionMdLabelKey`(`md.section.*`)를 쓴다. 두 함수가 받는 건 **`IssueSectionId` 5종**(`description`·`stepsToReproduce`·`media`·`expectedResult`·`notes`, `settings-ui-store.ts:17-22`)뿐이고, 그 5개는 ko·en 모두 값이 일치한다. 이 일치가 "제출물과 문자열 일치"의 전제다.

**함정**: `env`·`attachments`·`styleChanges`는 섹션 id가 아니라 각 표면의 리터럴 키다. 그리고 `section.attachments`(`issue.ts:76`, ko `"첨부 파일"`)와 `md.section.attachments`(`logs.ts:103`, ko `"첨부"`)는 **이미 값이 다르다.** en은 둘 다 `Attachments`라 en만 보면 안 보인다(2026-07-16 회고 "en-only 테스트로는 구조적으로 못 잡힌다"와 같은 모양).

따라서 가드는 **하드코딩 목록이 아니라 `IssueSectionId`에서 파생**시킨다 — 섹션이 늘면 자동 편입되고, 사정권 밖 키를 잘못 끌어와 첫날 red가 되는 일도 없다.

### 3. 골든 테스트는 이 기능에 대해 눈이 멀어 있다

`bodyOutputGolden.test.ts:15`의 `vi.mock("@/i18n")`은 `t`를 키 에코로, `dateBcp47`을 `"en-US"` 고정으로 바꾸고 `:11`에서 `formatTimestamp`까지 통째로 모킹한다. **스냅샷 무수정 통과는 로케일 회귀를 탐지할 수 없다.** 이 그물은 "블록 순서·구조 불변"으로만 읽고, 로케일은 위 실사전 통합 테스트가 잡는다. (스냅샷은 **62장**, 189KB.)

또한 `withLocale`이 모킹 객체에 없으면 `undefined is not a function`으로 62장이 한꺼번에 죽는다. 모킹에 `withLocale: (_l, fn) => fn()`을 추가해야 하고, **대상은 이 파일 하나가 아니라 `vi.mock("@/i18n"` 하는 55개 파일 중 빌더를 태우는 전부**다.

### 4. `MarkdownContext` required 필드의 파급

`MarkdownContext` 픽스처를 직접 만드는 테스트가 **22개** + `DraftDetailDialog.tsx`. 대부분 파일당 로컬 팩토리 하나라 한 줄씩이지만 건수는 많다. optional로 도피하면 무음 폴백이 생기므로 required를 유지한다.
**순서 최적화**: `withLocale` mock 보강은 required 필드 도입 **전에** 넣어도 무해하다. 먼저 넣으면 red 창이 픽스처 편집 한 번으로 줄어든다.

### 5. 비동기 누출 — 예방적 방어 (실측상 현재 경로 없음)

빌더 8개는 전부 동기(`async`/`await` 토큰 0건)이고 그 안에 `setTimeout`/`queueMicrotask`/`Promise.resolve().then`/`void (async` 0건이다. `buildCaptureFiles`는 `@/i18n` import 자체가 없다. React 렌더 경합도 이론적이다 — JS 단일 스레드라 동기 구간에 렌더가 못 낀다. **즉 Promise 거부 가드는 값싼 예방책이지 현존하는 함정에 대한 대응이 아니다.** 실제로 밟기 쉬운 건 위 1번(store write)이다. 유일한 async 접점은 `buildReportData`이고, 거기선 `await` 이후 동기 tail만 감싸는 것으로 처리한다.

### 6. e2e의 로케일 의존

기존 spec 다수가 ko|en 교대 정규식으로 라벨을 매칭한다. **앱 로케일은 워커 프로필에 따라 비결정**이고(`e2e/GOTCHAS.md:75`) GOTCHAS가 라벨 텍스트 단언을 금지하므로, 본문 언어 spec은 **화면 언어를 먼저 명시 선택해 결정화한 뒤** 단언해야 한다. 그리고 각 spec은 끝에서 본문 언어를 `자동`으로 되돌린다 — 안 되돌리면 같은 워커의 후속 spec이 오염된다(`french-locale` tasks Task 6과 같은 함정).
**클립보드**: 저장소 전체에 `navigator.clipboard.readText`·`clipboard-read`·`grantPermissions` **0건**이고 `e2e/helpers/`도 없다. 유일한 수단은 write 스텁 + 페이지 전역 캡처(`freeform-draft.spec.ts:40-52`·`code-block-collapse.spec.ts:42-50` 선례).

### 7. `french-locale`과의 상호작용

그쪽 PRD가 이 축을 "안 건드린다"로 못박고 있어, 갱신하지 않으면 다음에 읽는 사람이 반대 결론을 얻는다. 더해서 **이 기획이 `settings.ts`에 키 4개를 추가하고 하나를 삭제하는 것 자체가 fr의 비용을 키운다** — `french-locale/design.md:141`은 1,001키 완성까지 dev 머지 불가인 **장기 feature 브랜치**를 택했고 `:149`가 "상류가 ko/en에 키를 append하면 git이 무음 자동머지하고 fr에만 키가 빠진다"를 최대 비용으로 꼽는다. tasks 선행 조건에 명시한다.

### 8. 구버전 `logs.html` 호환

`LogViewerReport.envTitle`은 optional이고 `log-viewer/App.tsx:205`가 뷰어 자체 i18n으로 폴백한다. 이 구조는 안 바뀌므로 기존 첨부물에 영향 없다.

### 9. 스코프 밖의 인접 결함 (이 기획이 안 고친다)

- background 콜드 스타트 후 `bg-init`의 storage 콜백 전에 에러가 나면 `currentLocale`이 `BASE_LOCALE("ko")`로 고정된다(`locales.ts:11`).
- content script realm의 `currentLocale`은 아무도 세팅하지 않아 영구 `"ko"`다(`types/messages.ts:270`·`:275` 에러 경로).

둘 다 `withLocale`이 못 고친다. 기록만 남긴다.
