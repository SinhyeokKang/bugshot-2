# 이슈 본문 언어 — 기술 설계

## 개요

`t()`는 모듈 전역 `currentLocale`을 읽는다(`src/i18n/index.ts:10`). 본문 빌더 8곳이 이 전역을 통해 헤딩·라벨을 만들므로, 본문 언어를 갈아끼우는 방법은 둘뿐이다 — **① 모든 빌더에 `TranslationFn`을 스레딩**하거나 **② 빌드 동기 구간 동안 전역을 임시로 바꾸기**. ②를 택한다. 빌더 8곳 + 하위 헬퍼 수십 개의 시그니처를 건드리지 않고, 새 진입점이 생겨도 `MarkdownContext`만 제대로 만들면 자동으로 따라오기 때문이다.

전역 스왑의 위험은 **누출**이다(감싼 구간 밖까지 로케일이 바뀐 채 남는 것). 이걸 세 겹으로 막는다: `try/finally` 복원 · 비동기 함수 거부 · 래핑 지점을 호출부가 아니라 **빌더 진입점**에 두어 감싸는 걸 잊을 자리를 없애기.

전파 경로는 `MarkdownContext.bodyLocale`(**required**)이다. optional로 두면 미지정 생산지가 현재 로케일로 무음 폴백하므로, 컴파일러가 모든 생산지를 지목하게 만든다.

## 변경 범위

### 신규 파일

없다. 로케일 축의 단일 출처가 이미 `src/i18n/locales.ts`이므로 새 모듈을 만들지 않는다.

### `src/i18n/locales.ts`

- **현재 역할**: 로케일 축 단일 출처(`LOCALES`·`LocaleMode`·`normalizeLocale`·`detectLocale` 등). **런타임 import가 0이어야 하는 파일**(log-viewer가 상대경로로, background SW가 같이 끌어간다 — `locale-registry.test.ts`가 소스 스캔으로 강제).
- **변경**: `BodyLocale` 타입과 `normalizeBodyLocale`·`resolveBodyLocale` 두 순수 함수 추가. 외부 import를 늘리지 않으므로 import-0 제약을 유지한다.

`aiLanguage.ts`가 아니라 여기에 두는 이유: 본문 언어의 도메인이 `LocaleMode`이지 AI 프리셋이 아니고, 이 파일을 background·log-viewer가 이미 공유하기 때문이다.

### `src/i18n/index.ts`

- **현재 역할**: `t()`·`setLocale`·`getLocale`·`dateBcp47`·`useT`.
- **변경**: `withLocale` 추가. 동기 전용이며 비동기 함수를 거부한다.

### `src/store/settings-ui-store.ts`

- **현재 역할**: 화면 언어·AI 언어·섹션 구성 등 UI 설정 persist(background SW 번들에도 포함).
- **변경**: `bodyLocale: BodyLocale` 필드(기본 `"auto"`) + `setBodyLocale` + `migrateSettingsUi`에 v11 정규화 + `mergePersistedSettings`에 재정규화. `aiLanguage`가 잡은 자리를 그대로 따른다.

### `src/sidepanel/lib/buildIssueMarkdown.ts`

- **현재 역할**: `MarkdownContext` 타입 정의 + 마크다운/HTML 본문 빌더(`t()` 33회).
- **변경**: `MarkdownContext`에 `bodyLocale: LocaleMode` 추가(required). `buildIssueMarkdown`·`buildIssueHtml` 진입부를 `withLocale`로 감싼다.

### 본문 빌더 진입점 8개

`withLocale(ctx.bodyLocale, () => …)` 래핑만 추가한다. 내부 로직·헬퍼는 무수정.

| 파일 | 진입 함수 |
|---|---|
| `buildIssueMarkdown.ts` | `buildIssueMarkdown` · `buildIssueHtml` |
| `buildMarkdownIssueBody.ts` | `buildMarkdownIssueBody` |
| `buildIssueAdf.ts` | `buildIssueAdf` |
| `buildNotionIssueBody.ts` | `buildNotionIssueBody` |
| `buildLinearIssueBody.ts` | `buildLinearIssueBody` |
| `buildAsanaIssueBody.ts` | `buildAsanaIssueBody` |
| `buildClickupIssueBody.ts` | `buildClickupIssueBody` |
| `buildSlackBody.ts` | `buildSlackBody` |

`buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`는 `t()` 호출이 0이고 내부에서 `buildMarkdownIssueBody`에 위임하므로 **수정 불필요** — 위임 대상이 감싸지면 자동으로 따라온다.

### `src/sidepanel/lib/buildReportData.ts`

- **현재 역할**: `logs.html`의 Report 탭 데이터(`LogViewerReport`) 생성 + `deriveContextEnvRows`.
- **변경**: `buildReportData`가 **async**(내부 `await resolveSectionImages`)라 함수 전체를 감쌀 수 없다. `await` 이후의 **동기 구간만** 감싼다. `deriveContextEnvRows`는 동기이고 `ctx`를 받으므로 함수 전체를 감싼다(`formatTimestamp`가 `dateBcp47()`를 타므로 `Captured` 값이 본문 언어를 따라간다).

### `src/sidepanel/lib/buildMarkdownContext.ts` · `buildEditorCapture.ts`

`MarkdownContext`의 생산지는 이 둘뿐이다.

- `buildMarkdownContext()` — 미리보기·클립보드 복사 경로(`PreviewPanel`이 4곳에서 호출).
- `buildEditorMarkdownContext()` — 제출 경로(`IssueCreateModal.buildCtx`가 위임).

둘 다 `useSettingsUiStore.getState()`에 이미 접근하거나 접근 가능하므로, 여기서 `bodyLocale: resolveBodyLocale(bodyLocale, locale)`을 채운다. **`ctx.bodyLocale`은 이미 해석된 `LocaleMode`**이지 `"auto"`가 아니다 — 빌더가 `"auto"`를 다시 해석하게 두면 해석 지점이 둘로 갈린다.

`buildMarkdownContext`는 `BuildMarkdownContextArgs`에 store 접근이 없으므로 인자로 받는다(`PreviewPanel`이 주입). `buildEditorMarkdownContext`는 store를 직접 읽는 함수라 내부에서 읽는다.

### `src/sidepanel/lib/prompts/draftRich.ts`

- **현재 역할**: rich 프롬프트 조립. `ctx.locale`을 **두 용도**로 쓴다 — ① 92행 `resolveAiLanguage(ctx.aiLanguage, ctx.locale)`(출력 언어) ② 74·216행 `localeValue(SECTION_DESC_BASE, ctx.locale)`(프롬프트 스캐폴딩, 폴백 허용 테이블).
- **변경**: `ctx`에 `bodyLocale: LocaleMode` 추가하고 **92행만** 그것을 쓴다. **`ctx.locale`을 바꾸면 안 된다** — 스캐폴딩까지 따라가면 본문 언어를 바꿨을 때 프롬프트 뼈대 언어가 같이 바뀌어 `draftRich.test.ts`가 깨지고, 애초에 그 테이블은 화면 언어에 묶어두는 게 설계다.
- `buildAiDraftPrompt.ts`의 `AiDraftPromptContext`(126행 `locale: LocaleMode`)에 `bodyLocale` 추가, 생산지에서 주입.

### `src/sidepanel/tabs/settings/LlmConnectForm.tsx`

- **현재 역할**: AI 작성 언어 셀렉터. 111행이 `resolveAiLanguage("auto", locale)`로 `자동 (한국어)` 표기를 만든다.
- **변경**: `locale` 대신 해석된 본문 로케일을 넘긴다 → 본문 언어를 English로 두면 표기가 `자동 (English)`가 된다.

### `src/sidepanel/tabs/SettingsTab.tsx`

- **현재 역할**: `IssueSettingsContent`에 `settings.titleSettings` 섹션(제목 접두어 Input)이 있다.
- **변경**: 섹션 제목을 **이슈 공통 설정**으로 바꾸고(새 i18n 키), 그 안에 제목 접두어와 이슈 본문 언어 셀렉터를 함께 둔다. 셀렉터 옵션은 `["auto", ...LOCALES]`를 순회해 만든다 — 화면 언어 셀렉터(`GeneralSettingsContent`)가 이미 쓰는 `LOCALES.map` 패턴을 그대로 따르고, `LOCALE_LABELS`로 표기한다.

### `src/i18n/namespaces/settings.ts`

- 신규 키: `settings.issueCommon`(섹션 제목) · `settings.bodyLocale`(항목 라벨) · `settings.bodyLocale.help` · `settings.bodyLocale.auto`(`자동 ({lang})` — `llm.outputLanguage.auto`와 같은 형태).
- 제거 키: `settings.titleSettings`(섹션 제목이 바뀌므로 키 이름이 내용과 어긋난 채 남기지 않는다).
- ko·en 동시 갱신 — PostToolUse 훅이 `locales.test.ts`를 자동 실행해 대칭을 강제한다.

## 데이터 흐름

```
설정 화면
  bodyLocale: "auto" | LocaleMode   ← chrome.storage.local (settings-ui-store)
        │
        ▼  resolveBodyLocale(bodyLocale, locale)      ← 호출 시점 해석
  LocaleMode ("ko" | "en" | …)
        │
        ├──────────────────────────────┐
        ▼                              ▼
  MarkdownContext.bodyLocale     AiDraftPromptContext.bodyLocale
        │                              │
        ▼                              ▼
  withLocale(ctx.bodyLocale, …)   resolveAiLanguage(aiLanguage, bodyLocale)
        │                              │
        ├─ buildIssueMarkdown/Html     └─ "Write in English"
        ├─ buildMarkdownIssueBody  → GitHub·GitLab
        ├─ buildIssueAdf           → Jira
        ├─ buildNotion/Linear/Asana/Clickup/Slack
        └─ buildReportData         → logs.html Report 탭 (박제)
```

화면 언어(`locale`)는 이 경로에 직접 들어가지 않고 `"auto"`의 해석 재료로만 쓰인다. 미리보기 화면·토스트·설정 UI는 종전대로 `useT()`(화면 언어)를 탄다.

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

```ts
// src/sidepanel/lib/buildAiDraftPrompt.ts
interface AiDraftPromptContext {
  locale: LocaleMode;      // 프롬프트 스캐폴딩 테이블 전용 — 건드리지 않는다
  bodyLocale: LocaleMode;  // 출력 언어 auto 해석 전용
  // …기존 필드
}
```

## 기존 패턴 준수

- **`aiLanguage` 3종 세트** — 저장값 정규화(`normalize*`) + 호출 시점 해석(`resolve*`) + `자동 (X)` 표기. 새 축을 만들지 않고 같은 골격을 복제한다.
- **폴백 금지/허용 구분**(CLAUDE.md "로케일별 테이블") — 이 기능은 **새 테이블을 만들지 않는다.** `LocaleMode`를 그대로 재사용하므로 `LOCALES`에 로케일이 추가되면 자동으로 따라오고, 폴백 금지 5개 목록도 그대로다.
- **`locales.ts`의 런타임 import 0** — 추가하는 두 함수는 순수 함수이고 외부 import를 늘리지 않는다. `locale-registry.test.ts`가 계속 강제한다.
- **게이트를 단일 진입점에**(CLAUDE.md `apiHostRow` 사례) — 래핑을 호출부가 아니라 빌더 진입점에 둔다. 호출부에 두면 새 호출부가 감싸는 걸 잊어도 green으로 통과한다.
- **store는 `sidepanel/tabs`를 import하지 않는다** — 새 함수를 `i18n/locales.ts`에 두므로 이 제약과 무관하다.
- **i18n 동시 갱신** — ko·en 양쪽. `src/log-viewer/i18n.ts` 복제 사전은 **이번에 안 건드린다**(뷰어 chrome UI는 비목표).

## 대안 검토

**A. 빌더 전체에 `TranslationFn`을 스레딩한다.** 전역을 안 건드리므로 누출이 구조적으로 불가능하다. 기각 이유: 빌더 8곳 + `emitLogSummary` 계열 하위 헬퍼 십수 개 + `StyleChangesTable.buildStyleDiff`까지 시그니처가 번지고, 그 전부가 골든 테스트의 감시 범위 안이다. 얻는 안전성 대비 변경 표면이 과하다 — 외과적 변경 원칙 위반.

**B. 호출부(`submitToX` 8곳 + `PreviewPanel` + `buildCaptureFiles`)에서 감싼다.** 빌더를 한 줄도 안 고쳐도 된다. 기각 이유: 감쌀 자리가 10곳 이상이고 **새 플랫폼 어댑터가 추가될 때 감싸는 걸 잊으면 무음으로 화면 언어가 샌다.** 빌더 진입점 래핑은 잊을 자리 자체가 없다.

**C. 두 사전을 동시에 로드해 본문 전용 `t`를 만든다.** 전역 스왑이 없어 비동기 안전. 기각 이유: `locales[locale]` 조회를 우회하는 두 번째 `t` 구현이 생기고, 어느 쪽을 써야 하는지가 파일마다 판단 대상이 된다. 사전이 이미 셋(namespaces·log-viewer 복제·`_locales`)인데 네 번째 경로를 만든다.

**D. 본문 언어를 화면 언어에 종속시키지 않고 AI 언어처럼 9개 프리셋을 준다.** 기각: 헤딩은 프롬프트 지시가 아니라 사전 조회다. 사전 없는 언어를 고르면 표시할 문자열이 없다.

## 위험 요소

- **비동기 누출** — `withLocale` 안에서 `await`하면 복원이 먼저 일어나 이후 코드가 잘못된 로케일로 돈다. `buildReportData`·`buildCaptureFiles`가 async라 실제로 밟기 쉬운 함정이다. Promise 반환 런타임 거부 + 전용 테스트로 막는다.
- **React 렌더와의 경합** — `useT()`(`i18n/index.ts:47`)와 `TiptapEditor`(219·385행)가 렌더 중 `currentLocale`을 화면 언어로 되돌린다. 동기 구간만 감싸므로 그 사이에 렌더가 끼어들 수 없지만, **비동기로 감싸는 순간 이 되돌림과 경합한다.** 위 항목과 같은 뿌리다.
- **골든 테스트의 `@/i18n` 모킹** — `bodyOutputGolden.test.ts:15`가 `@/i18n`을 통째로 모킹해 `t`·`dateBcp47`만 제공한다. `withLocale`이 모킹 객체에 없으면 `undefined is not a function`으로 58장이 한꺼번에 죽는다. 모킹에 `withLocale: (_l, fn) => fn()`을 추가해야 한다. **스냅샷 내용 자체는 변경 없음**(모킹이 키를 그대로 반환하므로 로케일 무관).
- **`MarkdownContext` required 필드의 파급** — 픽스처를 만드는 테스트가 20여 파일이다(`buildIssueMarkdown`·`buildIssueAdf`·8개 빌더·`submitToX`·`prepareUpload`·`buildEditorCapture`·`buildMarkdownContext`). 대부분 파일당 로컬 팩토리 하나라 한 줄씩이지만 건수는 많다. optional로 도피하면 무음 폴백이 생기므로 required를 유지한다.
- **두 키셋의 값이 갈라질 때** — `logs.html` Report는 미리보기 키셋(`section.*`), 제출 본문은 `md.section.*`을 쓴다. 현재 두 값이 사실상 동일해서 "제출물과 문자열 일치"가 성립하는데, 한쪽만 문구를 바꾸면 이 전제가 조용히 깨진다. `buildReportData`가 `sectionLabelKey`를 쓰는 건 기존 코드라 이번에 바꾸지 않고, **대신 두 키셋 값의 일치를 검사하는 테스트를 추가**한다.
- **`ctx.locale`과 `ctx.bodyLocale` 혼동** — `draftRich.ts`에서 둘의 용도가 다르다(스캐폴딩 vs 출력 언어). 92행만 바꿔야 하고, 74·216행을 같이 바꾸면 `draftRich.test.ts`·`buildAiDraftPrompt.test.ts`가 깨진다. 깨진 걸 스냅샷 갱신으로 추인하면 설계가 뒤집힌다.
- **e2e의 로케일 의존** — 기존 spec 다수가 ko|en 교대 정규식으로 라벨을 매칭한다. 본문 언어 spec이 설정을 바꾸고 되돌리지 않으면 같은 워커의 후속 테스트가 오염된다(`french-locale` tasks Task 6과 같은 함정).
- **`french-locale`과의 문서 모순** — 그쪽 PRD가 이 축을 "안 건드린다"로 못박고 있어, 갱신하지 않으면 다음에 읽는 사람이 반대 결론을 얻는다. tasks에 갱신 태스크로 포함한다.
- **구버전 `logs.html` 호환** — `LogViewerReport.envTitle`은 optional이고 `App.tsx:205`가 뷰어 자체 i18n으로 폴백한다. 이 구조는 안 바뀌므로 기존 첨부물에 영향 없다.
