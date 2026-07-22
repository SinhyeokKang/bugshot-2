# 본문 구성 순서 변경 — 기술 설계

## 개요

순서는 이미 단일 출처(`issueSections` 배열)이고 draft·preview·8개 빌더가 모두 이 배열을 순회한다. 핵심 전략은 **미디어/스타일 diff/로그 요약 클러스터를 `issueSections`의 스위치 없는 엔트리(`id: "media"`)로 편입**하고, 이때 각 소비처에 복제돼 있던 `POST_MEDIA_SECTION_IDS` 앵커 규칙을 **삭제**하는 것이다. 순서가 배열 데이터가 되므로 각 빌더의 특수 앵커 분기가 단순한 `id === "media"` 분기로 축약된다. 순서 결정 로직은 순수 함수 `bodyBlocks()` 한 곳으로 승격해 11곳의 복제를 제거한다(회귀 봉쇄의 핵심).

`"media"` 엔트리는 순서 배열에만 산다 — **텍스트 섹션을 소비하는 간접 경로(AI 초안 프롬프트·logs.html Report 데이터)에는 절대 유입되면 안 된다**(아래 "간접 소비처 격리" 참조). 이게 이 설계의 최대 함정이다.

## 변경 범위

### 스토어 · 순서 모델

**`src/store/settings-ui-store.ts`**
- `IssueSectionId` 유니온에 `"media"` 추가.
- `IssueSectionRenderAs`에 `"meta"` 추가(미디어 엔트리 전용). ⚠️ 이 값은 **`buildReportData`/`IssuePreviewView`의 하드코딩 renderAs 유니온과 충돌**하므로, 그 경로들은 media를 사전 필터해 `"meta"`가 도달하지 않게 한다(아래 참조).
- `DEFAULT_ISSUE_SECTIONS`에 미디어 엔트리를 `재현과정`과 `기대결과` 사이에 삽입.
- **`POST_MEDIA_SECTION_IDS` 상수 삭제**(전 소비처에서 제거).
- 신규 액션 `reorderIssueSections(from, to)`. `arrayMove`는 `@dnd-kit/sortable`에서 import하지 **않고** 스토어에 4줄 순수 구현으로 인라인한다 — `settings-ui-store`는 `i18n → bg-init → background/index.ts` 체인으로 **background service worker 번들에 포함**되므로 UI DnD 라이브러리를 스토어 그래프에 유입시키면 안 된다.
- `setIssueEnabled`에 `if (id === "media") return;` 방어 가드.
- 순수 헬퍼 `normalizeSections(sections)` — **미디어 엔트리를 정확히 1개** 보장(없으면 레거시 앵커 위치 backfill, 2개 이상이면 첫 항목만 남기고 dedupe, 발견된 media는 `enabled:true` 강제). 마이그레이션·rehydrate 공용.
- persist `version` 8 → **9**, `migrateSettingsUi`에서 `normalizeSections` 호출. rehydrate(`onRehydrateStorage` 또는 `merge`)에서도 정규화해 외부 오염 상태를 교정.

### 순서 결정 단일화 (신규)

**`src/sidepanel/lib/bodyBlocks.ts`** (신규)
```ts
export type BodyBlock =
  | { kind: "section"; section: IssueSection }
  | { kind: "meta" }; // 미디어/스타일 diff + 로그 요약 클러스터

export function bodyBlocks(sections: IssueSection[]): BodyBlock[] {
  return sections
    .filter((s) => s.id === "media" || s.enabled) // media는 enabled 무관 항상 포함(오염 방어)
    .map((s) =>
      s.id === "media"
        ? ({ kind: "meta" } as const)
        : ({ kind: "section", section: s } as const),
    );
}
```
모든 빌더·draft·preview가 이 결과를 순회. 순서 규칙은 여기 한 곳에만 존재.

### 빌더 (8 플랫폼 + 공용 + 클립보드)

각 파일에서 **동일 패턴 교체**: `POST_MEDIA_SECTION_IDS` import·앵커 분기·트레일링 `emitMedia()` 폴백을 제거하고, `bodyBlocks()` 순회로 바꿔 `kind === "meta"`에서 `emitMedia()` 호출. `emitMedia`의 **내용(미디어/diff/로그 렌더, freeform의 "미디어 없음+로그만" 미묘 동작 포함)은 유지** — 위치 결정만 데이터로 이관.

- `buildIssueMarkdown.ts` (`buildIssueMarkdown` + `buildIssueHtml`)
- `buildMarkdownIssueBody.ts` (GitHub/GitLab 공용)
- `buildIssueAdf.ts` (Jira)
- `buildNotionIssueBody.ts`
- `buildAsanaIssueBody.ts`
- `buildClickupIssueBody.ts`
- `buildLinearIssueBody.ts`
- `buildSlackBody.ts`

> env 블록은 루프 이전 emit(현행 유지). 첨부 블록은 루프 이후 최하단 emit(현행 유지). 둘 다 `bodyBlocks` 밖. `mediaEmitted` 가드는 유지해도 무해(단일 meta라 1회 호출).

### 간접 소비처 격리 (⚠️ 신규 변경 대상 — CTO/QA 지적)

`issueSections`를 **텍스트 섹션으로 소비**하는 두 경로는 media 엔트리를 반드시 걸러야 한다:

- **`src/sidepanel/tabs/AiDraftDialog.tsx`**: `issueSections.filter(s => s.enabled).map(s => ({id: s.id}))`로 AI 초안 프롬프트의 응답 스키마(`required:[...sectionIds]`)를 만든다. media가 유입되면 AI가 `"media"` 텍스트 섹션을 생성해 `draft.sections.media`로 병합되는 회귀. → `.filter(s => s.enabled && s.renderAs !== "meta")`.
- **`src/sidepanel/lib/buildReportData.ts`**: `sectionConfig.filter(enabled).map(...)`로 logs.html Report 탭 섹션을 만들며 `renderAs: s.renderAs`를 `LogViewerReportSection.renderAs`(`"paragraph"|"orderedList"` 하드코딩, `src/types/log-viewer.ts`)에 대입 → `"meta"` 유입 시 typecheck 실패. → media 사전 필터.

### 프리뷰 · draft UI

- **`src/sidepanel/lib/composePreviewLayout.ts`** — `bodyBlocks` 규칙과 정합하게 재구현하되 **인자는 `sectionIds: string[]` 유지**(현행). `postMediaSectionIds` 인자 제거, `id === "media"`에서 `{kind:"media"}`+`{kind:"logCards"}` push. `IssueSection[]`을 요구하지 **않는다** — `IssuePreviewView`가 log-viewer Report 탭과 공유되고 그쪽은 `settings-ui-store`(`enabled`/`builtIn`) 의존을 격리해야 하므로, 미디어 판별은 `id === "media"`만으로 충분하다.
- **`src/sidepanel/components/IssuePreviewView.tsx`** — `postMediaSectionIds` prop 제거. `sectionIds`에 media id가 포함된 형태로 전달받아 `composePreviewLayout` 호출. `IssuePreviewViewSection.renderAs`도 `"meta"` 미도달(media는 레이아웃 슬롯으로만, 섹션 목록엔 불포함).
- **`src/sidepanel/tabs/PreviewPanel.tsx`** — `previewSections` 매핑에서 media 엔트리를 **표시 섹션 목록에서 제외**하고 `sectionIds`(순서용, media id 포함)만 레이아웃에 전달. `postMediaSectionIds` 전달 제거.
- **`src/sidepanel/tabs/DraftingPanel.tsx`** — 순회를 `bodyBlocks(issueSections)`로 교체. `kind==="meta"`→`mediaBlock`+`logCardsBlock`, `kind==="section"`→`SectionTextarea`. 기존 앵커 삽입·트레일링 append 제거.
- **`src/sidepanel/tabs/DraftDetailDialog.tsx`** — 동일 패턴 교체(순서는 현재 설정에서 파생).

### 설정 UI

**`src/sidepanel/tabs/SettingsTab.tsx`** (`IssueSettingsContent`)
- **본문 구성 Section**: `@dnd-kit` `DndContext` + `SortableContext`(verticalListSortingStrategy) + `restrictToVerticalAxis`. 각 행 `useSortable`. `onDragEnd` → `reorderIssueSections`.
  - **드래그 핸들**: 좌측 아이콘(`SECTION_ICONS`)을 GripVertical **버튼**으로 대체(항상 노출). 히트 영역 `h-8 w-8`(DESIGN §10 최소 32px), `aria-label`(ko/en), `focus-visible:ring`. `useSortable`의 `attributes`+`listeners`를 **이 핸들 버튼에만** 부착(라벨 클릭·텍스트 선택·스위치와 충돌 방지).
  - **행 구분선**: 현행 Fragment 형제 `<Separator>`는 dnd transform과 함께 안 움직여 드래그 중 잔상이 남는다 → 각 행 wrapper의 `border-t`(첫 행 제외)로 구조 변경.
  - **미디어 카드 행**(`id==="media"`): 핸들 + 라벨(신규 `settings.section.media` = "미디어 · 로그") + **필수 헬프**(`settings.section.media.help`) + 스위치 자리 스페이서(또는 우측 muted "항상 포함"). 스위치 없음.
  - `DndContext`에 **로컬라이즈된 `accessibility.announcements`/`screenReaderInstructions`**(ko/en) 주입(dnd-kit 기본은 영어).
  - `AttachmentToggleRow` 제거(기타로 이전).
  - **복원 버튼**: `<Section title action={<ResetOrderButton/>}>`. `ResetOrderButton`은 `RotateCcw` 아이콘 버튼(기존 StyleEditorPanel/StyleChangesDialog `ResetButton` 톤 재사용), `issueSections`가 `DEFAULT_ISSUE_SECTIONS`와 동형이면 `disabled`, 클릭 시 `resetIssueSections()`.
  - `SECTION_ICONS` 상수는 고아화되면 제거(내 변경이 만든 고아).
- **"AI 설정" Section 제거**.
- **"기타" Section 신설**(최하단, `settings.otherSection`): `AutoReproPrefillToggleRow` → `AttachmentToggleRow`. autoRepro `disabled={!isReproSectionEnabled(issueSections)}` 가드 유지.
- `Section` 순서: 제목 설정 → 녹화 → 본문 구성 → 기타.

### i18n

**`src/i18n/namespaces/settings.ts`** (ko/en 동시)
- 신규: `settings.otherSection`("기타"/"Other"), `settings.section.media`("미디어 · 로그"/"Media & Logs"), `settings.section.media.help`(필수 — "캡처한 미디어·스타일 변경·로그는 항상 포함되며 위치만 조정할 수 있어요" 취지), `settings.reorder.reset`(복원 버튼 aria-label), `settings.reorder.handle`(핸들 aria-label), dnd 안내 문구 키.
- 제거: `settings.aiSection`(ko/en, 고아화).

> ⚠️ **`section.media` 키를 건드리지 말 것** — 이 키("미디어"/"Media")는 draft 패널 미디어 Section 제목·img alt로 이미 쓰인다(`DraftingPanel.tsx`). 값을 "미디어 · 로그"로 바꾸면 로그 없는 미디어 섹션이 오표기된다. 설정 카드는 **전용 키 `settings.section.media`**를 신설해 쓴다.
> log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 재사용 컴포넌트 키만 대상 — 위 신규 키는 설정 전용이라 복제 불요. `IssuePreviewView`가 쓰는 `md.section.media`는 무변경.

### 의존성

- **신규**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers`(`restrictToVerticalAxis`). postinstall 스크립트 없음 → `onlyBuiltDependencies` 무관. `minimumReleaseAge: 1440` 정책상 24시간 미만 신버전은 자동 회피(정상). ⚠️ `arrayMove`는 스토어에 인라인(위 참조) — dnd-kit는 UI 레이어에서만 import.

## 데이터 흐름

```
설정(본문 구성 드래그/키보드)
  → reorderIssueSections(from,to) → arrayMove → issueSections 배열
  → zustand persist → chrome.storage.local (순서 변경마다 영속)

빌드 시점(draft/preview/제출):
  issueSections ──bodyBlocks()──▶ [section|meta ...] 순서
     각 소비처: for block → meta면 emitMedia(), section이면 emitSection()
  env(선두 고정) + [bodyBlocks 순서] + attachments(말미 고정)

간접 소비(텍스트 섹션만): AiDraftDialog / buildReportData
  → issueSections.filter(enabled && renderAs !== "meta")  ← media 격리
```

- 순서는 배열 인덱스가 유일 출처. `order` 필드 없음.
- draft는 순서를 저장하지 않음 → 렌더/빌드 시 현재 `issueSections`에서 파생.

## 인터페이스 설계

```ts
// settings-ui-store.ts
export type IssueSectionId =
  | "description" | "stepsToReproduce" | "media" | "expectedResult" | "notes";
export type IssueSectionRenderAs = "paragraph" | "orderedList" | "meta";

export const DEFAULT_ISSUE_SECTIONS: IssueSection[] = [
  { id: "description",      enabled: true,  renderAs: "paragraph",   builtIn: true },
  { id: "stepsToReproduce", enabled: true,  renderAs: "orderedList", builtIn: true },
  { id: "media",            enabled: true,  renderAs: "meta",        builtIn: true },
  { id: "expectedResult",   enabled: true,  renderAs: "paragraph",   builtIn: true },
  { id: "notes",            enabled: false, renderAs: "paragraph",   builtIn: true },
];

// 미디어 엔트리를 정확히 1개로 정규화(backfill + dedupe + enabled 강제). 멱등.
export function normalizeSections(sections: IssueSection[]): IssueSection[];

reorderIssueSections: (from: number, to: number) => void;

// bodyBlocks.ts (신규)
export type BodyBlock =
  | { kind: "section"; section: IssueSection }
  | { kind: "meta" };
export function bodyBlocks(sections: IssueSection[]): BodyBlock[];
```

`normalizeSections` 스케치:
```ts
const LEGACY_POST_MEDIA = new Set<IssueSectionId>(["expectedResult", "notes"]);
export function normalizeSections(sections: IssueSection[]): IssueSection[] {
  const media = sections.filter((s) => s.id === "media");
  const rest = sections.filter((s) => s.id !== "media");
  const entry: IssueSection =
    media[0] ? { ...media[0], enabled: true } : { id: "media", enabled: true, renderAs: "meta", builtIn: true };
  if (sections.some((s) => s.id === "media") && media.length === 1) {
    return sections.map((s) => (s.id === "media" ? entry : s)); // 이미 정상 — 위치 보존
  }
  const idx = rest.findIndex((s) => s.enabled && LEGACY_POST_MEDIA.has(s.id)); // 레거시 앵커
  return idx === -1 ? [...rest, entry] : [...rest.slice(0, idx), entry, ...rest.slice(idx)];
}
```
> **backfill 스냅샷 의미론**: 레거시 앵커는 동적(첫 *enabled* post-media 직전 — enabled가 바뀌면 이동)이지만 backfill은 마이그레이션 시점 위치를 정적으로 박제한다. v8 사용자가 `expectedResult`를 끈 채 마이그레이션(→media가 notes 앞) 후 다시 켜도 media는 그 자리에 머문다(의도된 동작 — 이후 순서는 사용자 제어).

## 기존 패턴 준수

- **세션/로컬 영속**: 순서는 기존 `settings-ui-store`(chrome.storage.local, persist) 그대로. 신규 스토리지·키 없음. persist가 순서 변경을 자동 저장.
- **마이그레이션 컨벤션**: 순수 헬퍼 분리 + 멱등 + nullish 병합(`migrateSettingsUi` 기존 스타일). v9 마커 bump.
- **UI 컨벤션**: shadcn 컴포넌트(Card/Switch/Separator/Button) + DESIGN.md(§9 focus-visible·§10 아이콘 버튼 32px). 복원 버튼은 기존 `RotateCcw` reset UX 재사용. `Section`의 `action` prop으로 제목 우측 배치.
- **i18n 동시 갱신**: ko/en 양쪽. log-viewer 복제 사전 비영향(설정 전용 키).
- **단일 출처 순서**: draft·preview·빌더가 한 배열을 순회하는 기존 계약을 `bodyBlocks`로 규칙까지 단일화.
- **테스트 우선**: `bodyBlocks`·`normalizeSections`·`reorderIssueSections`는 순수 함수/스토어 액션 — 단위 테스트 선작성.

## 대안 검토

- **A. 미디어를 발생 현상의 자식으로 종속**: 리스트를 4카드로 유지하지만, 발생 현상 비활성 시 fallback 규칙을 새로 추가해야 하고 미디어 자유 배치가 안 된다. 앵커를 "발생현상 뒤"로 바꾸는 특수 분기가 8빌더에 잔존. **기각** — reorder가 어차피 8빌더 개편을 강제하는 이상, 규칙을 삭제하는 B가 회귀 표면이 작다.
- **B(채택). 스위치 없는 독립 미디어 카드**: 앵커 규칙 삭제 + `bodyBlocks` 단일화. 비용은 미디어 엔트리 표현 + 정규화 + 간접 소비처 격리(일회성·순수 헬퍼).
- **C. 디프/미디어/로그 3카드 분리**: element 모드에서 미디어와 diff가 상호배타라 모드에 따라 "죽은 카드"가 생김. **기각**.
- **D. 명시적 `order:number` 필드**: 배열 위치와 이중 출처가 되어 desync. **기각**.

## 위험 요소

- **8플랫폼 빌더 회귀(최대 위험)**: 순서 로직을 `bodyBlocks` 한 곳으로 모으고, **리팩터 착수 전에 현행 출력을 골든으로 박제**(Task 0)한 뒤 리팩터 후 바이트 동일을 검증한다. ⚠️ 현재 빌더 테스트에는 스냅샷 골든이 없고(`toContain`+`vi.mock(POST_MEDIA)`), 픽스처 `sectionConfig`에 media 엔트리가 없다 → 골든을 먼저 만들지 않으면 "동일성"은 사후 추인이 된다. 기존 12+ 테스트 픽스처에 media 엔트리를 추가하고, `vi.mock(POST_MEDIA_SECTION_IDS)` dead mock을 정리한다.
- **media 엔트리 텍스트 경로 유입**: AiDraftDialog·buildReportData·IssuePreviewView renderAs 유니온 — 위 "간접 소비처 격리"로 차단. typecheck가 buildReportData 대입을 잡아준다(안전망).
- **미디어 소실/중복**: `normalizeSections`의 "정확히 1개" 불변식 + `bodyBlocks`의 media-always-include로 방어. 단위 테스트에 중복·누락·enabled 오염 케이스 포함.
- **dnd-kit 접근성**: `KeyboardSensor` + 로컬라이즈 announcements. 핸들에만 listeners.
- **dnd-kit e2e flaky**: 마우스 드래그는 Playwright에서 flaky 전례(`e2e/GOTCHAS.md`) → e2e는 **키보드 재정렬로 판정**, 마우스는 수동. 설정 영속 spec은 `finally` 복원.
- **jsdom 한계**: 실제 포인터 드래그는 jsdom으로 못 잡는다(POSTMORTEM). 순서 배열 변화·영속은 단위, 실드래그는 e2e/수동.
- **문서 신선도**: `bodyBlocks.ts` 신규 → `docs/DIRECTORY.md` 갱신. 앵커 규칙 삭제 → `docs/ARCHITECTURE.md`(이슈 섹션 구성 "자동 메타 위치" 문단) 갱신.
- **Privacy/권한**: 신규 데이터 수집·전송·저장 없음. manifest·host_permissions 무변경 → docs/privacy·PERMISSION 영향 없음.
