# 본문 구성 빠른 접근 — 기술 설계

## 개요

설정 탭 안에 인라인으로 박혀 있는 본문 구성 목록(`SettingsTab.tsx`의 DndContext 블록 + `IssueSectionRow`)을 **공용 컴포넌트 `BodyCompositionList`로 승격**하고, 이를 감싸는 `BodyCompositionDialog`를 만들어 drafting·preview 두 패널 푸터의 아이콘 버튼에서 연다. 상태는 기존 `useSettingsUiStore.issueSections` 하나뿐이라 동기화 로직이 따로 없다 — 두 소비처가 같은 스토어를 구독하므로 반영은 자동이다. 새 타입·메시지·스토리지·권한이 없다.

**`Card` 껍데기는 컴포넌트에 포함하지 않는다.** 설정 탭은 `<Card>`로 감싸고, 다이얼로그는 자기 자신이 이미 컨테이너라 목록만 받는다(`--card`와 `--background`가 라이트·다크 모두 동일 값이라 다이얼로그 안 Card는 다크에서 사실상 보이지 않는다 — 기존 선례 `DomTreeDialog.tsx:201`도 `bg-background shadow-none`으로 눌러 쓴다). 복원 버튼도 같은 이유로 컴포넌트 밖이다 — 배치는 소비처가 맡는다.

## 변경 범위

### 신규: `src/sidepanel/components/BodyCompositionList.tsx`

본문 구성 섹션 행 목록. `SettingsTab.tsx:216-241`의 DndContext/SortableContext 블록과 `IssueSectionRow`(`:385-456`), sensors(`:121-125`)·announcements(`:127-156`)·`handleDragEnd`(`:158-165`) 정의를 그대로 옮긴다. 스토어 구독(`issueSections`·`setIssueEnabled`·`reorderIssueSections`)도 이 컴포넌트가 직접 한다 — props로 끌어올리면 두 소비처가 같은 배선을 복제한다(선례: `components/RecordingSettingsCard.tsx:18-21`).

**함께 옮겨야 하는 접근성 자산 2개**(빠뜨리면 조용히 사라진다):

- `screenReaderInstructions`(`SettingsTab.tsx:222-224`, `settings.reorder.instructions`)
- `useSortable`의 `roleDescription` 오버라이드(`:399`, `settings.reorder.roleDescription`)
- `useT`도 함께 가져간다(라벨·공지문 전부 i18n 경유).

**`idPrefix` prop 필수.** `App.tsx:311`이 SettingsTab을 `hidden` div로 **항상 마운트**하고 `settingsSub` 기본값이 `"issue"`라, 다이얼로그를 열면 목록이 2벌 공존한다. 접두 없이 두면 `id="issue-section-{id}"`가 문서에 중복되어 `<label htmlFor>`가 숨은 사본으로 forwarding되고(HTML/a11y 위반), `data-testid`도 10개가 되어 기존 e2e 3개 spec이 strict mode violation으로 죽는다.

```
설정 탭   : idPrefix 미지정(무접두) → 기존 id·testid 그대로 → 기존 spec 무변경
다이얼로그: idPrefix="dialog"      → id="dialog-issue-section-{id}"
                                   → data-testid="dialog-issue-section-row-{id}"
```

### 신규: `src/sidepanel/components/BodyCompositionDialog.tsx`

`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter` + `BodyCompositionList`. **참조 패턴은 `StyleChangesDialog.tsx:154·162·172`**(`DraftEditDialog`가 아니다 — 그쪽은 스크롤도 `justify-between` 푸터도 없다).

```tsx
<DialogContent className="flex max-h-[80vh] flex-col">
  <DialogHeader>
    <DialogTitle>{t("settings.bodyComposition")}</DialogTitle>
    <DialogDescription>{t("settings.bodyCompositionDescription")}</DialogDescription>
  </DialogHeader>
  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <BodyCompositionList idPrefix="dialog" />
  </div>
  <DialogFooter className="!flex-row items-center !justify-between">
    <Button variant="outline" disabled={isDefaultSectionOrder(issueSections)}
            onClick={resetIssueSectionOrder} data-testid="reset-body-composition-dialog">
      {t("settings.reorder.reset")}
    </Button>
    <Button onClick={() => onOpenChange(false)}>{t("common.ok")}</Button>
  </DialogFooter>
</DialogContent>
```

세 가지가 세트로 필요하다:

- **`max-h-[80vh]` + `flex flex-col` + 내부 `min-h-0 flex-1 overflow-y-auto`**: `DialogContent` 기본이 `h-fit`에 **`overflow-hidden`**(`components/ui/dialog.tsx:38`)이라 이게 없으면 넘친 내용이 스크롤이 아니라 **잘려서 클릭 불가**가 된다. 섹션 5행 ≈434px라 창 높이 700px 이하에서 실제로 걸린다.
- **`DialogFooter`에 `!flex-row`**: 기본이 `flex-col-reverse … sm:flex-row`(`dialog.tsx:70`)이고 `sm`(640px)은 사이드패널에서 **절대 안 걸린다**. 기존 19곳 전부 이 오버라이드를 쓴다.
- **`DialogDescription`**: `dialog.tsx:35`가 `aria-describedby={undefined}`라 없으면 다이얼로그 목적이 안 읽힌다. 내용은 **기능 설명만**("이슈 본문에 포함할 섹션과 순서를 정합니다" 톤) — 전역 소급 경고는 PRD 비목표.
- **초기 포커스**: 지정하지 않으면 첫 tabbable이 드래그 핸들 버튼(`:429`)이라 스크린 리더 사용자가 "재정렬 핸들"에 착지한다. `DialogContent`의 `onOpenAutoFocus`에서 제목 또는 첫 스위치로 보낸다.

### 신규: `src/sidepanel/lib/issueSectionOrder.ts`

`SettingsTab.tsx:167-170`에 인라인된 기본 순서 판정을 순수 함수로 승격. 설정 탭과 다이얼로그 두 곳이 같은 판정을 써야 한다.

### 변경: `src/sidepanel/tabs/SettingsTab.tsx`

- `IssueSectionRow`·sensors·announcements·`handleDragEnd`·DndContext 블록 제거 → `<Card><CardContent className="flex flex-col px-3 py-0"><BodyCompositionList /></CardContent></Card>`로 대체.
- dnd-kit·`GripVertical`·`Switch` import 중 이 블록에서만 쓰이던 것 정리(다른 곳에서 쓰면 유지).
- `isDefaultOrder` 인라인 계산 → `isDefaultSectionOrder(issueSections)` 호출로 교체.
- 섹션 헤더 `action`의 `RotateCcw` 버튼은 그대로 둔다(`data-testid="reset-body-composition"` 유지).

### 변경: `src/sidepanel/tabs/DraftingPanel.tsx`

- `bodyCompositionOpen` 로컬 `useState` 추가.
- 푸터 우측 그룹(`:439-458`)에 `[이전] [⚙] [이슈 프리뷰]` 순으로 아이콘 버튼 삽입.
- 패널 하단에 `<BodyCompositionDialog open={...} onOpenChange={...} />` 마운트(기존 `LogPreviewDialog`·`AiDraftDialog`와 같은 위치, `:463-479`).

### 변경: `src/sidepanel/tabs/PreviewPanel.tsx`

- 동일하게 로컬 state + 푸터 우측 그룹(`:415-424`)에 `[이전] [⚙] [이슈 제출]` 순으로 삽입 + 다이얼로그 마운트.

## 데이터 흐름

```
[drafting/preview 푸터 ⚙]
        │ setBodyCompositionOpen(true)
        ▼
[BodyCompositionDialog] ── BodyCompositionList (idPrefix="dialog")
        │                        │
        │  setIssueEnabled(id, v) / reorderIssueSections(from, to)
        ▼                        ▼
   useSettingsUiStore.issueSections ──► chrome.storage (persist, 기존)
        │
        ├─► DraftingPanel  : bodyBlocks(issueSections) → sectionNodes
        ├─► PreviewPanel   : bodyBlocks(issueSections) → 본문 렌더 + 8개 빌더 sectionConfig
        ├─► SettingsTab    : <Card><BodyCompositionList /></Card> (무접두)
        └─► DraftDetailDialog : (소급 — 이번 변경 대상 아님)
```

새 메시지·스토리지 키·마이그레이션 없음. `issueSections`는 이미 `settings-ui-store` persist v9에 포함돼 있다.

## 인터페이스 설계

```ts
// src/sidepanel/lib/issueSectionOrder.ts
import { DEFAULT_ISSUE_SECTIONS, type IssueSection } from "@/store/settings-ui-store";
//        ^ 값 의존 — settings-ui-store.ts:36에서 export된 기본 배열

// 순서만 본다(enabled는 사용자 것) — resetIssueSectionOrder의 대칭 판정.
export function isDefaultSectionOrder(sections: IssueSection[]): boolean;
```

```ts
// src/sidepanel/components/BodyCompositionList.tsx
export function BodyCompositionList(props: {
  idPrefix?: string;   // 미지정 = 무접두(설정 탭). 다이얼로그는 "dialog".
}): JSX.Element;       // 그 외 props 없음 — 스토어 직접 구독
```

```ts
// src/sidepanel/components/BodyCompositionDialog.tsx
export function BodyCompositionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;
```

푸터 버튼(두 패널 공통 형태). **`min-w-0` + `truncate` + `shrink-0` 세트가 필수**다 — 아래 위험 요소 "푸터 폭" 참조:

```tsx
<div className="flex min-w-0 items-center gap-2">
  {isElementMode ? (
    <Button variant="outline" onClick={() => backToStyling()}>
      <span className="truncate">{t("common.back")}</span>
    </Button>
  ) : null}
  <TooltipIconButton
    className="h-9 w-9"                    // 기본값 h-8 w-8 오버라이드
    label={t("settings.bodyComposition")}  // tooltip + aria-label (DESIGN.md:162)
    onClick={() => setBodyCompositionOpen(true)}
    disabled={aiDraftLoading || reproPrefillLoading}   // preview에는 해당 없음
    testId="open-body-composition"
  >
    <Settings2 />
  </TooltipIconButton>
  <Button onClick={/* 기존 confirmDraft 흐름 */} disabled={titleMissing || …} data-testid="to-preview">
    <span className="truncate">{t("draft.preview")}</span>
  </Button>
</div>
```

- `TooltipIconButton`은 `size="icon" variant="outline"`와 `shrink-0`을 **내부에 이미 고정**하고 있고 크기 기본값이 `h-8 w-8`이다. 푸터 default 버튼(h-9)과 높이를 맞추려면 `className="h-9 w-9"`로 오버라이드한다(`cn`이 tailwind-merge라 후자가 이긴다). testid는 `data-testid`가 아니라 **`testId` prop**으로 넘긴다.
- 프리뷰 패널 푸터도 같은 형태이되 `disabled` 없이, primary는 `IssueCreateModal` 트리거다.
- `Settings2`는 이 저장소 첫 사용 아이콘이다(설정 계열 관행은 `SlidersHorizontal`). "설정 탭 헤더와 같은 아이콘"이 아니라 **"이 화면에서 여는 구성 다이얼로그"**라는 별개 어포던스를 주기 위해 의도적으로 다른 아이콘을 쓴다.

## 기존 패턴 준수

- **i18n**: 새 키 **1개**(`settings.bodyCompositionDescription` — 다이얼로그 설명문, ko/en 동시 추가). 나머지는 기존 키 재사용: `settings.bodyComposition`(제목·버튼 라벨), `settings.reorder.reset`(복원), `common.ok`(확인), `settings.reorder.*`(공지문·핸들·roleDescription).
- **dnd-kit 격리**(CLAUDE.md): `settings-ui-store`는 background 번들에 포함되므로 dnd-kit을 스토어 그래프에 유입시키지 않는다. 이번 변경은 컴포넌트→스토어 단방향 import만 추가하므로 제약 유지. `arrayMove`는 계속 스토어 인라인(`settings-ui-store.ts:206-217`).
- **transform은 `CSS.Translate`만**: `IssueSectionRow`를 옮길 때 FLIP 보정 scaleY 회피 주석·구현을 그대로 가져간다(`SettingsTab.tsx:411-413`).
- **shadcn 우선**: `Dialog`·`Button`·`Card`·`Switch` 모두 기존 컴포넌트. 신규 설치 없음.
- **DESIGN.md**: 아이콘 버튼은 `size="icon" variant="outline"` + `shrink-0`(`TooltipIconButton`이 내장), hover 툴팁은 native `title`이 아니라 `TooltipIconButton`(DESIGN.md:162), 푸터 그룹은 `flex items-center gap-2`. `TooltipIconButton`이 푸터에 놓이는 첫 사례다(기존 40개는 툴바·Section action·다이얼로그 본문) — 높이 오버라이드가 필요한 이유.
- **테스트 우선**: `isDefaultSectionOrder`는 순수 함수라 `__tests__/issueSectionOrder.test.ts`를 먼저 작성.

## 대안 검토

1. **빈 섹션을 본문에서 조용히 드롭** — 기각. 표시면 3벌(PreviewPanel·DraftDetailDialog·logs.html Report 탭)과 제출 본문이 어긋나고, `(없음)`/"비어 있음"이 담고 있는 "작성자가 비웠다"는 신호가 사라진다. `media` 블록 위치까지 흔들려 골든 테스트 전면 갱신이 필요하다.
2. **다이얼로그에서 순서 재정렬 제외(토글만)** — 기각. `BodyCompositionList`에 `reorderable` 분기를 넣어야 해서 컴포넌트가 오히려 복잡해지고, 설정 탭과 다이얼로그의 동작이 갈린다.
3. **제목 `Section`의 `action` 슬롯에 버튼 배치** — 기각. 본문이 길어지면 스크롤 위로 사라지는데, 정작 "이 섹션 비었네"를 깨닫는 시점은 하단이다.
4. **다이얼로그에 취소(rollback) 제공** — 기각. 스토어 액션이 즉시 persist라 로컬 초안 + 커밋 경로를 새로 파야 하고, 설정 탭과 동작이 갈린다.
5. **⚙ 클릭 시 설정 > 이슈 서브탭으로 라우팅**(`setTab("settings") + setSettingsSub("issue")`) — 가장 싼 안(신규 컴포넌트 0개, 추출 0줄)이지만 기각. 작성 컨텍스트를 통째로 이탈했다가 돌아와야 하고, 되돌아오는 경로가 사용자 기억에 의존한다. 이 기능의 요점이 "작성 흐름을 끊지 않는 것"이라 목적과 정면 충돌한다.

## 위험 요소

- **목록 이중 마운트**: 위 `idPrefix` 설계로 해소한다. 구현 시 **다이얼로그 쪽에만** 접두가 붙는지, 기존 e2e 셀렉터(`issue-section-row-*`·`issue-section-handle-*`·`[id="issue-section-*"]`)가 설정 탭 쪽에 그대로 매칭되는지 확인.
- **푸터 폭**: element 모드 drafting 푸터는 컨트롤 4개(취소·이전·⚙·프리뷰)가 된다. **en 로케일 기준 소요폭 ≈356–362px인데 DESIGN.md의 공식 최소 가정은 320px**이고, `Button` base가 `whitespace-nowrap`(`button.tsx:8`)에 상위가 `overflow-hidden`이라 넘치면 줄바꿈이 아니라 **잘리거나 겹친다**. 위 스니펫의 `min-w-0`+`truncate`+`shrink-0`이 필수 대응책이다. **e2e 뷰포트가 480px 고정**(`e2e/fixtures/extension.ts:182`)이라 이 회귀는 자동으로 절대 안 잡힌다 — 수동 3점 검증이 유일한 안전망.
- **dnd-kit Escape × Radix `DismissableLayer`**: dnd-kit `KeyboardSensor`의 Escape 취소는 propagation을 막지 않아 Radix modal Dialog의 `onEscapeKeyDown`과 동시 발화할 수 있다(드래그 취소 + 다이얼로그 닫힘). POSTMORTEM 2026-07-22가 "비-modal에선 되는데 modal Dialog 안에선 안 됨"을 기록한 영역의 반대 방향 이동이다. e2e로 고정한다.
- **스크롤 컨테이너 안의 드래그**(미검증): 목록이 `overflow-y-auto` 안에 들어가면 dnd-kit auto-scroll과 `CSS.Translate` 좌표계가 스크롤 오프셋과 상호작용한다. 마우스 드래그는 e2e 금지(GOTCHAS)라 **수동 테스트 항목**으로 고정.
- **소급 적용**: `sectionConfig`는 스냅샷이 아니라 라이브 스토어 참조다. `tabs/DraftDetailDialog.tsx:141`이 현재 값을 읽어 **이미 제출한 이슈의 상세·복사·재제출 본문**을 그리므로, 여기서 끈 섹션은 과거 이슈 표시에서도 빠진다. 기존 동작이지만 접근성이 올라가 노출 빈도가 증가한다. 경고 문구는 넣지 않기로 했으므로 감수하는 동작이다.
- **Tiptap 인스턴스 이동**(부분 검증): 섹션 노드는 `DraftingPanel.tsx:356`의 `key={sec.id}`라 React가 재정렬을 DOM 이동으로 처리하고 **인스턴스는 보존된다**(코드상 확인). 남는 미검증 범위는 이동 후 **포커스·selection 유지**뿐이고, jsdom으로 못 잡는 부류라 e2e로 고정한다.
- **e2e 설정 누수**: `issueSections`는 `chrome.storage`에 영속돼 후행 spec까지 샌다. `body-composition-reorder.spec.ts`처럼 `finally`에서 순서·enabled를 반드시 복원한다.
- **import 정리 누락**: `SettingsTab.tsx`에서 블록을 들어낸 뒤 미사용 import가 남으면 `pnpm typecheck`가 잡는다(noUnusedLocals 설정에 따라 다르므로 lint 확인).

## 후속 과제 (별도 티켓)

**`useReproPrefill` 게이트를 캡처 세션 진입 시점으로 고정.** 현재 `sectionEnabled`가 effect deps(`useReproPrefill.ts:157`, deps 배열 154-169)에 있어 작성 중 재현 과정을 켜면 그 자리에서 AI 자동채움이 발화한다. 이번 진입점이 생기면 흔한 경로가 되지만, 이 PRD에서 분리하는 이유는 셋이다:

1. `autoEnabledRef`(`:70`)와 같은 **마운트 ref**로는 대칭이 성립하지 않는다. `IssueTab.tsx:218-241`이 drafting/previewing 상호배타 조건부 렌더라 `backToDraft()`가 DraftingPanel을 재마운트하고, ref가 재초기화되면서 Preview ⚙ → 켜기 → [이전] 경로에서 다시 발화한다. **editor-store 세션 플래그**(캡처 진입 시 1회 스냅샷)로 가야 한다.
2. 기존 `useReproPrefill.test.tsx:592` "AI in-flight 중 `sectionEnabled`가 꺼지면 취소되더라도 로딩은 풀린다"는 이 dep가 있어야 성립하는 **스피너 소프트락 가드**다. 지우면 POSTMORTEM 2026-07-28(vacuous green)의 재발이고, 남는 게이트 dep(`trimming` 등)로 트리거를 갈아끼우는 대체 설계가 선행돼야 한다.
3. 사용자 노출 동작 변경이라 가이드 문구 갱신이 따라붙는다.
