# 본문 구성 순서 변경 — 기술 설계

## 개요

순서는 이미 단일 출처(`issueSections` 배열)이고 draft·preview·8개 빌더가 모두 이 배열을 순회한다. 핵심 전략은 **미디어/스타일 diff/로그 요약 클러스터를 `issueSections`의 스위치 없는 엔트리(`id: "media"`)로 편입**하고, 이때 각 소비처에 복제돼 있던 `POST_MEDIA_SECTION_IDS` 앵커 규칙을 **삭제**하는 것이다. 순서가 배열 데이터가 되므로 각 빌더의 특수 앵커 분기가 단순한 `id === "media"` 분기로 축약된다. 순서 결정 로직은 순수 함수 `bodyBlocks()` 한 곳으로 승격해 8빌더의 복제를 제거한다(회귀 봉쇄의 핵심).

## 변경 범위

### 스토어 · 순서 모델

**`src/store/settings-ui-store.ts`** (현재: 섹션 타입·기본 배열·앵커 상수·enable 토글 액션)
- `IssueSectionId` 유니온에 `"media"` 추가.
- `IssueSectionRenderAs`에 `"meta"` 추가(미디어 엔트리 전용, 텍스트 렌더 경로가 오판하지 않게).
- `DEFAULT_ISSUE_SECTIONS`에 미디어 엔트리를 `재현과정`과 `기대결과` 사이에 삽입.
- **`POST_MEDIA_SECTION_IDS` 상수 삭제**(전 소비처에서 제거).
- 신규 액션 `reorderIssueSections(from: number, to: number)` — `@dnd-kit/sortable`의 `arrayMove`로 재배열 후 set. persist가 자동 영속.
- `setIssueEnabled`에 `if (id === "media") return;` 방어 가드(미디어는 토글 대상 아님).
- 순수 헬퍼 `backfillMediaSection(sections)` 추가(마이그레이션·정규화 공용).
- persist `version` 8 → **9**, `migrateSettingsUi`에서 `backfillMediaSection` 호출.

### 순서 결정 단일화 (신규)

**`src/sidepanel/lib/bodyBlocks.ts`** (신규) — 본문 블록 순서의 단일 순수 함수.
```ts
export type BodyBlock =
  | { kind: "section"; section: IssueSection }
  | { kind: "meta" }; // 미디어/스타일 diff + 로그 요약 클러스터

export function bodyBlocks(sections: IssueSection[]): BodyBlock[] {
  return sections
    .filter((s) => s.enabled) // 미디어는 항상 enabled
    .map((s) =>
      s.id === "media"
        ? ({ kind: "meta" } as const)
        : ({ kind: "section", section: s } as const),
    );
}
```
모든 빌더·draft·preview가 이 함수 결과를 순회한다. 순서 규칙은 여기 한 곳에만 존재.

### 빌더 (8 플랫폼 + 공용 + 클립보드)

각 파일에서 **동일 패턴 교체**: `POST_MEDIA_SECTION_IDS` import·`emitMedia` 트레일링 폴백·앵커 분기를 제거하고, `bodyBlocks()` 순회로 바꿔 `kind === "meta"`에서 `emitMedia()`를 호출한다. `emitMedia`의 **내용(미디어/diff/로그 렌더)은 플랫폼별로 그대로 유지** — 위치 결정만 데이터로 이관.

- `src/sidepanel/lib/buildIssueMarkdown.ts` — `buildIssueMarkdown` + `buildIssueHtml`(클립보드/프리뷰 마크다운·HTML 쌍).
- `src/sidepanel/lib/buildMarkdownIssueBody.ts` — GitHub/GitLab 공용 본문.
- `src/sidepanel/lib/buildIssueAdf.ts` — Jira ADF.
- `src/sidepanel/lib/buildNotionIssueBody.ts` — Notion 블록.
- `src/sidepanel/lib/buildAsanaIssueBody.ts` — Asana html_notes.
- `src/sidepanel/lib/buildClickupIssueBody.ts`
- `src/sidepanel/lib/buildLinearIssueBody.ts`
- `src/sidepanel/lib/buildSlackBody.ts` — Slack mrkdwn.

> env 블록은 각 빌더에서 루프 이전에 emit(현행 유지). 첨부(attachments) 블록은 루프 이후 최하단 emit(현행 유지). 둘 다 `bodyBlocks` 밖.

### 프리뷰 · draft UI

- **`src/sidepanel/lib/composePreviewLayout.ts`** — `bodyBlocks` 위에서 재구현. `postMediaSectionIds` 인자 제거, `id === "media"`에서 `{kind:"media"}` + `{kind:"logCards"}`를 push. 시그니처:
  ```ts
  composePreviewLayout(args: {
    sections: IssueSection[]; // sectionIds → sections로 교체(미디어 판별 위해)
    hasMedia: boolean;
    hasLogCards: boolean;
  }): PreviewLayoutEntry[]
  ```
- **`src/sidepanel/components/IssuePreviewView.tsx`** — `postMediaSectionIds` prop 제거, `composePreviewLayout` 새 시그니처로 호출. (log-viewer Report 탭과 공유되는 컴포넌트 — 프리뷰 순서 단일 출처.)
- **`src/sidepanel/tabs/PreviewPanel.tsx`** — `postMediaSectionIds={POST_MEDIA_SECTION_IDS}` 전달 제거.
- **`src/sidepanel/tabs/DraftingPanel.tsx`** — `enabledSections` 순회를 `bodyBlocks(issueSections)`로 교체. `kind==="meta"`에서 `mediaBlock`+`logCardsBlock` 렌더, `kind==="section"`에서 `SectionTextarea`. 기존 `POST_MEDIA` 앵커 삽입·트레일링 append 제거.
- **`src/sidepanel/tabs/DraftDetailDialog.tsx`** — 동일 패턴 교체(저장 draft 상세 렌더도 `bodyBlocks` 사용, 순서는 현재 설정에서 파생).

### 설정 UI

**`src/sidepanel/tabs/SettingsTab.tsx`** (`IssueSettingsContent`)
- **본문 구성 Section**: `issueSections.map` → `@dnd-kit` `DndContext` + `SortableContext`(verticalListSortingStrategy). 각 행을 `useSortable`로 감싸고, **좌측 아이콘(`SECTION_ICONS`)을 GripVertical 드래그 핸들로 대체**(항상 노출, `listeners`는 핸들에만 부착 — 스위치 클릭과 충돌 방지). `onDragEnd` → `reorderIssueSections(oldIndex, newIndex)`.
  - 텍스트 섹션 행: 핸들 + 라벨/헬프 + 스위치.
  - 미디어 카드 행(`id==="media"`): 핸들 + 라벨(`section.media` = "미디어 · 로그") + 헬프, **스위치 없음**.
  - `AttachmentToggleRow` 제거(기타로 이전).
  - `SECTION_ICONS` 상수는 이 변경으로 고아가 되면 제거(내 변경이 만든 고아).
- **"AI 설정" Section 제거**(`settings.aiSection` 사용처 소멸).
- **"기타" Section 신설**(최하단, `settings.otherSection`): `AutoReproPrefillToggleRow` → `AttachmentToggleRow` 순. `AutoReproPrefillToggleRow`의 `disabled={!isReproSectionEnabled(issueSections)}` 가드 유지.
- `Section` 순서: 제목 설정 → 녹화 → 본문 구성 → 기타.

### i18n

**`src/i18n/namespaces/settings.ts`** (ko/en 동시)
- 신규: `settings.otherSection` = "기타" / "Other".
- 고아화된 `settings.aiSection` 제거(ko/en 양쪽).

**`src/i18n/namespaces/issue.ts`**
- `section.media`는 이미 존재("미디어"/"Media") — 설정 카드 라벨로 재사용하거나, 구분 필요 시 `section.media.help` 신규 추가(ko/en). 라벨을 "미디어 · 로그"로 바꾸려면 `section.media` 값 갱신(ko/en 양쪽).

> log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 `NetworkLog`/`ConsoleLog`/`ActionLog`/`IssuePreview` 재사용 키만 대상. 위 신규 키는 설정 전용이라 복제 사전 갱신 불요. `IssuePreviewView`가 쓰는 `md.section.media`는 기존 키라 무변경. (i18n 훅이 `src/i18n/` 편집 시 `locales.test.ts` 자동 실행 — ko/en 대칭 확인.)

### 의존성

- **신규**: `@dnd-kit/core`, `@dnd-kit/sortable`(+ 필요 시 `@dnd-kit/modifiers`의 `restrictToVerticalAxis`). postinstall 스크립트 없음 → `onlyBuiltDependencies` 무관. `minimumReleaseAge: 1440` 정책상 24시간 미만 신버전은 자동 회피(설치 시 정상).

## 데이터 흐름

```
설정(본문 구성 드래그)
  → reorderIssueSections(from,to) → arrayMove → issueSections 배열
  → zustand persist → chrome.storage.local (순서 변경마다 영속)

빌드 시점(draft/preview/제출):
  issueSections ──bodyBlocks()──▶ [section|meta ...] 순서
     각 소비처: for block → meta면 emitMedia(), section이면 emitSection()
  env(선두 고정) + [bodyBlocks 순서] + attachments(말미 고정)
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

// 마이그레이션·정규화 공용. 미디어 엔트리가 없으면 레거시 앵커 위치에 삽입(멱등).
export function backfillMediaSection(sections: IssueSection[]): IssueSection[];

reorderIssueSections: (from: number, to: number) => void;

// bodyBlocks.ts (신규)
export type BodyBlock =
  | { kind: "section"; section: IssueSection }
  | { kind: "meta" };
export function bodyBlocks(sections: IssueSection[]): BodyBlock[];
```

`backfillMediaSection` 구현 스케치:
```ts
const LEGACY_POST_MEDIA = new Set<IssueSectionId>(["expectedResult", "notes"]);
export function backfillMediaSection(sections: IssueSection[]): IssueSection[] {
  if (sections.some((s) => s.id === "media")) return sections; // 멱등
  const media: IssueSection = { id: "media", enabled: true, renderAs: "meta", builtIn: true };
  const idx = sections.findIndex((s) => s.enabled && LEGACY_POST_MEDIA.has(s.id));
  return idx === -1
    ? [...sections, media]
    : [...sections.slice(0, idx), media, ...sections.slice(idx)];
}
```

## 기존 패턴 준수

- **세션/로컬 영속**: 순서는 기존 `settings-ui-store`(chrome.storage.local, persist) 그대로. 신규 스토리지·키 없음. persist가 순서 변경을 자동 저장("변경마다 영속" 무료 충족).
- **마이그레이션 컨벤션**: 순수 헬퍼 분리 + 멱등 가드 + nullish 병합(`migrateSettingsUi` 기존 스타일). v9 마커 bump.
- **i18n 동시 갱신**: ko/en 양쪽 + log-viewer 복제 사전 영향 여부 확인(이 건은 미해당).
- **단일 출처 순서**: draft·preview·빌더가 한 배열을 순회하는 기존 계약을 강화(`bodyBlocks`로 규칙까지 단일화).
- **테스트 우선**: `bodyBlocks`·`backfillMediaSection`·`reorderIssueSections`는 순수 함수/스토어 액션 — 단위 테스트 선작성.

## 대안 검토

- **A. 미디어를 발생 현상의 자식으로 종속**: 리스트를 4카드로 유지(타입 churn 최소)하지만, 발생 현상 비활성 시 fallback 규칙을 새로 추가해야 하고 미디어 자유 배치가 안 된다. 게다가 앵커를 "발생현상 뒤"로 바꾸는 특수 분기가 8빌더에 잔존한다. **기각** — reorder 자체가 8빌더 개편을 강제하는 이상, 특수 분기를 남기는 A보다 규칙을 삭제하는 B가 회귀 표면이 작다.
- **B(채택). 스위치 없는 독립 미디어 카드**: 앵커 규칙 삭제 + `bodyBlocks` 단일화. 비용은 미디어 엔트리 표현 + 마이그레이션 backfill(일회성·순수 헬퍼).
- **C. 디프/미디어/로그 3카드 분리**: element 모드에서 미디어와 diff가 상호배타라 카드 분리가 사용자·코드 양쪽에 혼란. **기각**.
- **D. 명시적 `order:number` 필드**: 배열 위치와 이중 출처가 되어 desync 관리 필요. **기각**(배열 인덱스로 충분).

## 위험 요소

- **8플랫폼 빌더 회귀(최대 위험)**: 순서 로직을 `bodyBlocks` 한 곳으로 모으고, **마이그레이션된 기본 순서에서 각 빌더 출력이 변경 전과 바이트 동일**임을 골든 테스트로 고정한다. 기존 빌더 테스트(`buildIssueMarkdown.test`, `buildMarkdownIssueBody.test`, `buildIssueAdf.test`, `buildNotionIssueBody.test`, `buildAsanaIssueBody.test`, `buildClickupIssueBody.test`, `buildLinearIssueBody.test`, `buildGithubIssueBody.test`, `buildGitlabIssueBody.test`, `submitToAsana.test`, `buildMarkdownContext.test`, `buildReportData.test`)가 이미 `POST_MEDIA` 경로를 커버하므로, 이들을 새 모델로 갱신하되 **기본 순서 케이스의 기대값은 유지**한다.
- **미디어 엔트리 누락**: 마이그레이션이 모든 v<9 사용자를 커버하고 DEFAULT에도 포함되나, 방어적으로 스토어 rehydrate 후 `backfillMediaSection` 정규화를 거쳐 "항상 정확히 1개 미디어 엔트리" 불변식을 단위 테스트로 고정.
- **dnd-kit 접근성**: `KeyboardSensor` 포함해 키보드 재정렬 지원. 핸들에만 `listeners` 부착해 스위치·라벨 클릭과 드래그가 충돌하지 않게.
- **jsdom 한계**: 실제 포인터 드래그는 jsdom으로 못 잡는다(docs/POSTMORTEM.md). 재정렬 결과(순서 배열 변화·영속)는 `reorderIssueSections` 단위 테스트로, 실제 드래그 인터랙션은 e2e(@dnd-kit는 키보드/합성 이벤트로 e2e 구동 가능)로 검증.
- **Privacy/권한**: 신규 데이터 수집·전송·저장 없음. manifest·host_permissions 무변경 → docs/privacy·PERMISSION 영향 없음.
