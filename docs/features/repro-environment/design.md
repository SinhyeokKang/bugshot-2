# 재현 환경 섹션 + drafting 패널 어코디언 — 기술 설계

## 개요

custom 환경 row를 담는 신규 데이터 필드 `environment`를 `EditorDraft`에 추가하고, drafting 패널에 신규 `ReproEnvironmentSection` 컴포넌트를 제목 섹션 아래에 렌더한다. 이 컴포넌트는 editor-store에서 모드별 환경 메타를 파생해 readonly row로, `draft.environment`를 편집 가능한 custom row로 보여준다. custom row는 `MarkdownContext.environment`를 거쳐 5개 이슈 빌드 함수의 Environment 섹션에 추가된다. drafting 패널의 기존 섹션들은 이미 존재하는 `Section` 컴포넌트의 `collapsible` prop을 켜는 것으로 어코디언화한다.

## 변경 범위

### 1. `src/types/environment.ts` (신규)
- 역할: `EnvironmentRow` 타입 단일 출처. 스토어·빌드 함수가 공유하므로 순환 회피용 중립 위치.
```ts
export interface EnvironmentRow {
  label: string;
  value: string;
}
```

### 2. `src/sidepanel/lib/environmentRows.ts` (신규)
- 역할: custom row 정제 순수 함수. 5개 빌드 함수의 중복 제거 + 단위 테스트 대상.
```ts
import type { EnvironmentRow } from "@/types/environment";
// label·value 둘 다 trim 후 비어있지 않은 row만 남긴다.
export function filterEnvironmentRows(rows: EnvironmentRow[]): EnvironmentRow[];
```

### 3. `src/sidepanel/lib/__tests__/environmentRows.test.ts` (신규)
- `filterEnvironmentRows` 단위 테스트.

### 4. `src/store/editor-store.ts`
- 현재 역할: 에디터 상태·세션 스냅샷. `EditorDraft = { title, sections }`.
- 변경:
  - `EditorDraft`에 `environment?: EnvironmentRow[]` 추가.
  - `EditorSnapshot`은 이미 `draft`를 통째로 Pick하므로 세션 영속화는 자동. 별도 변경 불필요.
  - 신규 필드는 optional — 구 세션 스냅샷 hydrate 시 `undefined`. 읽는 쪽에서 `?? []`로 방어.

### 5. `src/store/issues-store.ts`
- 현재 역할: 이슈/초안 영속 저장 (`issues` v5). `IssueDraftContent = { title, sections }`.
- 변경:
  - `IssueDraftContent`에 `environment?: EnvironmentRow[]` 추가.
  - `defaultDraft`(L36 `draft: { title: "", sections: {} }`)에 `environment: []` 추가.
  - **버전 bump 불필요**: optional 필드라 구 레코드(키 없음)는 `?? []`로 호환. `editor-store`의 `saveDraft` 호출부는 `draft: { ...state.draft }`로 spread하므로 `environment`가 자동 전달됨.

### 6. `src/sidepanel/lib/buildIssueMarkdown.ts`
- 현재 역할: `MarkdownContext` 정의 + 마크다운 본문 조립. Environment 섹션(L58-68).
- 변경:
  - `MarkdownContext`에 `environment: EnvironmentRow[]` 추가.
  - Environment 섹션 끝(`- **Captured**` 다음)에 `filterEnvironmentRows(ctx.environment)`를 순회하며 `- **${label}**: ${value}` 추가.
  - `buildMetaComment`은 변경하지 않음 (비목표).

### 7. `src/sidepanel/lib/buildGithubIssueBody.ts` / `buildLinearIssueBody.ts`
- 현재 역할: 플랫폼별 마크다운 본문. 각자 Environment 섹션을 조립.
- 변경: Environment bullet 목록 끝에 `filterEnvironmentRows` 결과를 `- **${label}**: ${value}`로 추가.

### 8. `src/sidepanel/lib/buildIssueAdf.ts`
- 변경: Environment `envItems` / `elemItems` 배열 끝에 custom row를 `keyValueItem(label, value)`로 추가.

### 9. `src/sidepanel/lib/buildNotionIssueBody.ts`
- 변경: Environment 블록 끝에 custom row를 `{ type: "bulleted_list_item", text: `${label}: ${value}` }`로 추가.

### 10. `src/sidepanel/tabs/IssueCreateModal.tsx`
- 현재 역할: 제출 진입점. `buildCtx()`가 `draft`로 `MarkdownContext`를 만든다 (freeform/element 등 4개 return 분기).
- 변경: 각 return 분기에 `environment: draft.environment ?? []` 추가.

### 11. `src/sidepanel/tabs/PreviewPanel.tsx`
- 현재 역할: 미리보기. 자체 `ctx`(`MarkdownContext`)를 3개 분기로 조립(L102-168) → `buildIssueMarkdown`/`buildIssueHtml`. 별도로 `<Section title={t("section.env")}>`에 환경 표시 컴포넌트 렌더(L208-213).
- 변경:
  - 3개 ctx 분기에 `environment: draft.environment ?? []` 추가.
  - L208 env 표시 컴포넌트 — custom row(`filterEnvironmentRows(draft.environment ?? [])`)도 함께 렌더하도록 확장 (제출 본문과 미리보기 일치).

### 12. `src/sidepanel/tabs/DraftingPanel.tsx`
- 현재 역할: drafting 패널. 제목 `<Section>` + 동적 `sectionNodes` + `mediaBlock`/`logCardsBlock`.
- 변경:
  - 신규 인라인 컴포넌트 `ReproEnvironmentSection` 추가 (`OrderedListEditor`/`SectionTextarea`와 같은 파일 내 헬퍼 컴포넌트 패턴).
  - 렌더 트리: 제목 `<Section>` 바로 다음, `{sectionNodes}` 앞에 `<ReproEnvironmentSection />` 삽입.
  - `mediaBlock`(3개 분기), `SectionTextarea`의 `<Section>`, `logCardsBlock`에 `collapsible` prop 추가 (`defaultOpen` 미지정 → 기본 펼침). 제목 `<Section>`은 변경 안 함.
  - `handleAIDraft`의 `setDraft({ ...parsed, title: aiTitle })` → `environment: draft.environment ?? []` 보존 추가.
  - 초기 `setDraft`(L97-100)에 `environment: []` 추가.

### 13. `src/i18n/ko.ts` / `src/i18n/en.ts`
- 신규 키 3개: `draft.envLabelPlaceholder`("항목 이름" / "Label"), `draft.envValuePlaceholder`("값" / "Value"), `draft.envAddRow`("행 추가" / "Add row").
- 섹션 제목은 기존 `section.env` 키 재사용. readonly row 라벨("Page"/"DOM"/"Viewport"/"Captured")은 이슈 본문 빌드 함수가 영문 리터럴로 쓰므로 동일하게 리터럴 사용 — 신규 키 없음.

## 데이터 흐름

```
[ReproEnvironmentSection]
  readonly row  ← editor-store (target.url, selection/screenshot/video/freeform viewport·capturedAt, selection.selector)  // 파생, 저장 안 함
  custom row    ↔ draft.environment (EditorDraft)  → EditorSnapshot(draft) → chrome.storage.session 영속
                                                    → saveDraft → IssueRecord.draft.environment → chrome.storage.local

[제출/미리보기]
  draft.environment → buildCtx()/PreviewPanel ctx → MarkdownContext.environment
    → filterEnvironmentRows → buildIssueMarkdown/Adf/Github/Linear/Notion 의 Environment 섹션
```

## 인터페이스 설계

```ts
// src/types/environment.ts
export interface EnvironmentRow { label: string; value: string }

// src/sidepanel/lib/environmentRows.ts
export function filterEnvironmentRows(rows: EnvironmentRow[]): EnvironmentRow[];

// src/store/editor-store.ts
export interface EditorDraft {
  title: string;
  sections: Record<string, string>;
  environment?: EnvironmentRow[];   // 신규
}

// src/store/issues-store.ts
export interface IssueDraftContent {
  title: string;
  sections: Record<string, string>;
  environment?: EnvironmentRow[];   // 신규
}

// src/sidepanel/lib/buildIssueMarkdown.ts
export interface MarkdownContext {
  /* ...기존... */
  environment: EnvironmentRow[];    // 신규 (호출부에서 항상 ?? [] 로 채움)
}

// src/sidepanel/tabs/DraftingPanel.tsx — 신규 인라인 컴포넌트
// editor-store에서 readonly 메타를 파생하고, draft.environment를 편집한다.
function ReproEnvironmentSection(): JSX.Element;
```

### `ReproEnvironmentSection` 동작
- 자체적으로 `<Section title={t("section.env")} collapsible defaultOpen={false}>`를 렌더.
- editor-store 구독: `target`, `captureMode`, `selection`, `screenshotViewport`/`videoViewport`/`freeformViewport`, `*CapturedAt`, `draft`, `setDraft`.
- **readonly row** (위쪽): 모드별로 파생.
  - Page = `target.url` (항상)
  - DOM = `selection.selector` (element 모드 + selection 있을 때만)
  - Viewport = 모드별 viewport `${w}×${h}` (null이면 생략)
  - Captured = 모드별 capturedAt → `formatTimestamp`
- **custom row** (아래쪽): `draft.environment ?? []`를 순회. 각 row = Label `<Input>` + Value `<Input>` + 삭제 `<Button>`.
- **"행 추가" 버튼**: custom row 목록 아래. 클릭 시 `setDraft({ ...draft, environment: [...(draft.environment ?? []), { label: "", value: "" }] })`.
- 삭제: 행 우측 `Trash2` 아이콘 버튼 (`OrderedListEditor`의 삭제 버튼과 동일 스타일 `h-9 w-9`), 해당 인덱스 제거.

### row 레이아웃 (readonly·custom 공통)
```
<div className="flex items-center gap-1">
  <Input className="w-60 shrink-0" .../>   // Label, 240px 고정 (200~300px 범위 내)
  <Input className="flex-1" .../>          // Value, 가득 채움
  {custom && <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 ..."><Trash2/></Button>}
</div>
```
- readonly row: 두 `<Input>` 모두 `readOnly`, 삭제 버튼 없음.

## 기존 패턴 준수

- **collapse**: `Section` 컴포넌트(`src/sidepanel/components/Section.tsx`)의 `collapsible`/`defaultOpen` prop을 그대로 사용. StyleEditorPanel과 동일. 접힘 상태는 `Section` 내부 로컬 `useState` — 영속화 안 함.
- **row 추가/삭제**: 삭제는 `OrderedListEditor`의 `Trash2` 아이콘 버튼(`h-9 w-9`) 패턴. 추가는 label/value 2개 입력이라 Enter-키 방식 대신 명시적 "행 추가" 버튼.
- **세션 영속화**: `draft`가 `EditorSnapshot`에 이미 포함 → `environment` 필드 추가만으로 자동 영속.
- **i18n 동시 갱신**: `ko.ts`/`en.ts` 양쪽에 키 추가.
- **순수 함수 + 단위 테스트**: `filterEnvironmentRows`를 `__tests__/`에서 Vitest로 검증. 빌드 함수 테스트도 갱신.
- **인라인 헬퍼 컴포넌트**: `DraftingPanel.tsx`는 `OrderedListEditor`/`SectionTextarea`/`VideoPreview`를 같은 파일 인라인 함수로 둔다. `ReproEnvironmentSection`도 동일하게.

## 대안 검토

**대안 A — custom row를 `draft.sections`에 특수 섹션 ID로 저장.** 신규 필드 없이 기존 `sections: Record<string,string>`에 `__environment` 같은 키로 직렬화. 타입·마이그레이션 변경이 없지만, label/value 쌍을 문자열로 인코딩/디코딩해야 하고 빌드 함수가 그 특수 키를 알아야 해 결합도가 높다. 명시적 `environment` 필드가 타입 안전하고 단순해 채택하지 않음.

**대안 B — `EnvironmentRow` 타입을 `editor-store.ts`에 두기.** 신규 파일을 안 만들어도 되지만 `issues-store.ts`·`buildIssueMarkdown.ts`가 store를 타입 import하게 된다. `src/types/`에 두는 게 기존 `types/platform.ts` 등과 일관되고 의존 방향이 깔끔해 신규 파일 채택.

## 위험 요소

- **빌드 함수 5개 동시 수정**: Environment 섹션 조립 코드가 함수마다 형태가 다르다(markdown bullet / ADF `keyValueItem` / Notion 블록). 각 함수의 기존 테스트(`buildIssueMarkdown.test.ts` 등 5개 존재)에 custom row 케이스를 추가해 회귀를 막는다.
- **`MarkdownContext.environment`를 required로 추가**: `ctx`를 만드는 모든 호출부(`IssueCreateModal.buildCtx` 4분기, `PreviewPanel` 3분기)가 빠짐없이 채워야 한다. 누락 시 `pnpm typecheck`가 잡는다 (optional 아닌 required로 둔 이유).
- **AI 초안 덮어쓰기**: `handleAIDraft`가 `setDraft`로 draft 전체를 교체하므로 `environment` 보존 코드를 빠뜨리면 custom row가 사라진다. Task에 명시.
- **구 초안 호환**: `environment` 없는 기존 `IssueRecord.draft` / 세션 스냅샷 — 모든 읽기 지점에서 `?? []`. 버전 bump를 생략하므로 이 방어가 유일한 안전장치.
- **freeform 뷰포트 null**: `freeformViewport`는 executeScript 실패 시 null. readonly Viewport row 생략 분기 필요 (빌드 함수는 이미 `if (ctx.viewport)`로 처리 중).
