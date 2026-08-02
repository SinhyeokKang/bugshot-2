# 본문 구성 빠른 접근 — 기술 설계

## 개요

설정 탭 안에 인라인으로 박혀 있는 본문 구성 UI(`SettingsTab.tsx`의 DndContext 블록 + `IssueSectionRow`)를 **공용 컴포넌트 `BodyCompositionCard`로 승격**하고, 이를 감싸는 `BodyCompositionDialog`를 만들어 drafting·preview 두 패널 푸터의 아이콘 버튼에서 연다. 상태는 기존 `useSettingsUiStore.issueSections` 하나뿐이라 동기화 로직이 따로 없다 — 두 소비처가 같은 스토어를 구독하므로 반영은 자동이다. 새 타입·메시지·스토리지·권한이 없다.

## 변경 범위

### 신규: `src/sidepanel/components/BodyCompositionCard.tsx`

본문 구성 섹션 목록 카드. `SettingsTab.tsx:213-242`의 `<Card>` 블록(DndContext/SortableContext/IssueSectionRow 루프)과 `IssueSectionRow`(`SettingsTab.tsx:385-456`), sensors·announcements 정의(`SettingsTab.tsx:121-165`)를 그대로 옮긴다. 스토어 구독(`issueSections`·`setIssueEnabled`·`reorderIssueSections`)도 이 컴포넌트가 직접 한다 — props로 끌어올리면 두 소비처가 같은 배선을 복제한다.

**복원 버튼은 포함하지 않는다.** 설정 탭은 섹션 헤더 `action` 슬롯의 아이콘 버튼, 다이얼로그는 푸터 텍스트 버튼으로 배치가 달라서, 카드는 목록만 담고 배치는 소비처가 맡는다.

### 신규: `src/sidepanel/components/BodyCompositionDialog.tsx`

`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` + `BodyCompositionCard`. 푸터는 좌측 **기본 순서 복원**(`variant="outline"`, `isDefaultSectionOrder`면 `disabled`), 우측 **확인**(`onOpenChange(false)`). `DraftEditDialog.tsx:1-40`의 다이얼로그 구성 패턴을 따른다.

### 신규: `src/sidepanel/lib/issueSectionOrder.ts`

`SettingsTab.tsx:168-170`에 인라인된 기본 순서 판정을 순수 함수로 승격. 설정 탭과 다이얼로그 두 곳이 같은 판정을 써야 한다.

### 변경: `src/sidepanel/tabs/SettingsTab.tsx`

- `IssueSectionRow`·sensors·announcements·DndContext 블록 제거 → `<BodyCompositionCard />` 한 줄로 대체.
- dnd-kit·`GripVertical`·`Switch`·`Card` import 중 이 블록에서만 쓰이던 것 정리(다른 곳에서 쓰면 유지).
- `isDefaultOrder` 인라인 계산 → `isDefaultSectionOrder(issueSections)` 호출로 교체.
- 섹션 헤더 `action`의 `RotateCcw` 버튼은 그대로 둔다.

### 변경: `src/sidepanel/tabs/DraftingPanel.tsx`

- `bodyCompositionOpen` 로컬 `useState` 추가.
- 푸터 우측 그룹(`:439-458`)에 `[뒤로] [⚙] [미리보기]` 순으로 아이콘 버튼 삽입.
- 패널 하단에 `<BodyCompositionDialog open={...} onOpenChange={...} />` 마운트(기존 `LogPreviewDialog`·`AiDraftDialog`와 같은 위치, `:463-479`).

### 변경: `src/sidepanel/tabs/PreviewPanel.tsx`

- 동일하게 로컬 state + 푸터 우측 그룹(`:415-424`)에 `[뒤로] [⚙] [이슈 제출]` 순으로 삽입 + 다이얼로그 마운트.

### 변경: `src/sidepanel/hooks/useReproPrefill.ts`

`sectionEnabled`를 **작성 화면 진입 시점 값으로 고정**한다. 현재는 deps(`:155`)에 들어 있어 작성 중 재현 과정을 켜면 게이트가 열리며 그 자리에서 AI 자동채움이 발화한다. 지금까지는 설정 탭을 거쳐야 해서 사실상 도달 불가였지만, 이번 진입점이 생기면 흔한 경로가 된다.

기존 `autoEnabledRef`(`:69`)와 **같은 방식**으로 `sectionEnabledRef`를 두고 deps에서 `sectionEnabled`를 뺀다. 켜는 쪽도 끄는 쪽도 이번 세션엔 반영하지 않는다(대칭).

## 데이터 흐름

```
[drafting/preview 푸터 ⚙]
        │ setBodyCompositionOpen(true)
        ▼
[BodyCompositionDialog] ── BodyCompositionCard
        │                        │
        │  setIssueEnabled(id, v) / reorderIssueSections(from, to)
        ▼                        ▼
   useSettingsUiStore.issueSections ──► chrome.storage (persist, 기존)
        │
        ├─► DraftingPanel  : bodyBlocks(issueSections) → sectionNodes
        ├─► PreviewPanel   : bodyBlocks(issueSections) → 본문 렌더 + 8개 빌더 sectionConfig
        ├─► SettingsTab    : 같은 카드
        └─► DraftDetailDialog : (소급 — 이번 변경 대상 아님)
```

새 메시지·스토리지 키·마이그레이션 없음. `issueSections`는 이미 `settings-ui-store` persist v9에 포함돼 있다.

## 인터페이스 설계

```ts
// src/sidepanel/lib/issueSectionOrder.ts
import type { IssueSection } from "@/store/settings-ui-store";

// 순서만 본다(enabled는 사용자 것) — resetIssueSectionOrder의 대칭 판정.
export function isDefaultSectionOrder(sections: IssueSection[]): boolean;
```

```ts
// src/sidepanel/components/BodyCompositionCard.tsx
export function BodyCompositionCard(): JSX.Element;   // props 없음 — 스토어 직접 구독
```

```ts
// src/sidepanel/components/BodyCompositionDialog.tsx
export function BodyCompositionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;
```

푸터 버튼(두 패널 공통 형태):

```tsx
<Button
  size="icon"                       // h-9 w-9 — 푸터 default 버튼(h-9)과 높이 일치
  variant="outline"
  onClick={() => setBodyCompositionOpen(true)}
  disabled={aiDraftLoading || reproPrefillLoading}   // preview에는 해당 없음
  title={t("settings.bodyComposition")}
  aria-label={t("settings.bodyComposition")}
  data-testid="open-body-composition"
>
  <Settings2 />
</Button>
```

## 기존 패턴 준수

- **i18n**: 새 키 0개. `settings.bodyComposition`(다이얼로그 제목·버튼 라벨), `settings.reorder.reset`(복원), `common.ok`(확인) 재사용. ko/en 양쪽에 이미 존재.
- **dnd-kit 격리**(CLAUDE.md): `settings-ui-store`는 background 번들에 포함되므로 dnd-kit을 스토어 그래프에 유입시키지 않는다. 이번 변경은 컴포넌트→스토어 단방향 import만 추가하므로 제약 유지. `arrayMove`는 계속 스토어 인라인.
- **transform은 `CSS.Translate`만**: `IssueSectionRow`를 옮길 때 FLIP 보정 scaleY 회피 주석·구현을 그대로 가져간다(`SettingsTab.tsx:411-413`).
- **shadcn 우선**: `Dialog`·`Button`·`Card`·`Switch` 모두 기존 컴포넌트. 신규 설치 없음.
- **DESIGN.md**: 아이콘 버튼은 `size="icon" variant="outline"`, 푸터 그룹은 `flex items-center gap-2`.
- **테스트 우선**: `isDefaultSectionOrder`는 순수 함수라 `__tests__/issueSectionOrder.test.ts`를 먼저 작성.

## 대안 검토

1. **빈 섹션을 본문에서 조용히 드롭** — 기각. 표시면 3벌(PreviewPanel·DraftDetailDialog·logs.html Report 탭)과 제출 본문이 어긋나고, `(없음)`이 담고 있는 "작성자가 비웠다"는 신호가 사라진다. `media` 블록 위치까지 흔들려 골든 테스트 전면 갱신이 필요하다.
2. **다이얼로그에서 순서 재정렬 제외(토글만)** — 기각. `BodyCompositionCard`에 `reorderable` 분기를 넣어야 해서 컴포넌트가 오히려 복잡해지고, 설정 탭과 다이얼로그의 동작이 갈린다.
3. **제목 `Section`의 `action` 슬롯에 버튼 배치** — 기각. 본문이 길어지면 스크롤 위로 사라지는데, 정작 "이 섹션 비었네"를 깨닫는 시점은 하단이다.
4. **다이얼로그에 취소(rollback) 제공** — 기각. 스토어 액션이 즉시 persist라 로컬 초안 + 커밋 경로를 새로 파야 하고, 설정 탭과 동작이 갈린다. 되돌리기는 **기본 순서 복원**으로 충분하다.

## 위험 요소

- **소급 적용**: `sectionConfig`는 스냅샷이 아니라 라이브 스토어 참조다. `DraftDetailDialog.tsx:141`이 현재 값을 읽어 **이미 제출한 이슈의 상세·복사·재제출 본문**을 그리므로, 여기서 끈 섹션은 과거 이슈 표시에서도 빠진다. 기존 동작이지만 접근성이 올라가 노출 빈도가 증가한다. 고지 문구는 넣지 않기로 했으므로 감수하는 동작이다.
- **Tiptap 인스턴스 이동**(미검증): 섹션 노드는 `key={sec.id}`라 React는 재정렬을 DOM 이동으로 처리하지만, lazy Tiptap이 이동 후 포커스·selection을 유지하는지 확인되지 않았다. jsdom으로 못 잡는 부류라 e2e로 고정한다.
- **푸터 폭**: element 모드 drafting 푸터는 컨트롤 4개(취소·뒤로·⚙·미리보기)가 된다. 아이콘 버튼이라 ~40px 추가지만 최소 폭에서 육안 확인이 필요하다.
- **`useReproPrefill` 회귀**: `sectionEnabled`를 ref로 고정하면 게이트 왕복 재실행 경로(`doneRef`/`readopt`, `:95-99`)에서 이 플래그가 더 이상 트리거가 아니게 된다. **설정 탭에서 켜 둔 뒤 작성 화면에 진입하는 정상 경로는 그대로 발화해야 한다** — 회귀 테스트로 고정.
- **e2e 설정 누수**: `issueSections`는 `chrome.storage`에 영속돼 후행 spec까지 샌다. `body-composition-reorder.spec.ts`처럼 `finally`에서 순서·enabled를 반드시 복원한다.
- **import 정리 누락**: `SettingsTab.tsx`에서 블록을 들어낸 뒤 미사용 import가 남으면 `pnpm typecheck`가 잡는다(noUnusedLocals 설정에 따라 다르므로 lint 확인).
