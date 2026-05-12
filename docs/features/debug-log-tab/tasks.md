# Debug Log Tab -- Implementation Tasks

## Prerequisites

- None. All dependencies (recorders, blob-db, editor store, preview dialogs) are already implemented.

## Tasks

### Task 1: Extract ConsoleLogContent

- **Target**: Create `src/sidepanel/components/ConsoleLogContent.tsx`, modify `src/sidepanel/components/ConsoleLogPreviewDialog.tsx`
- **Work**:
  - Move from dialog: `ConsoleFilter` type, `CONSOLE_FILTERS`, `levelColor`, `levelBgColor`, `levelCodeBg`, `LevelIcon`, `formatRelativeTime`, `EntryAccordion` component
  - Create `ConsoleLogContent` component with filter/search/scroll logic (current dialog L84-L106 state + L115-L152 JSX)
  - Reduce dialog to: Dialog shell + `<ConsoleLogContent />` + footer
- **Verify**:
  - [ ] `pnpm typecheck` passes
  - [ ] DraftingPanel console log preview dialog opens and works identically (filter, search, accordion, attach/detach)

### Task 2: Extract NetworkLogContent

- **Target**: Create `src/sidepanel/components/NetworkLogContent.tsx`, modify `src/sidepanel/components/NetworkLogPreviewDialog.tsx`
- **Work**:
  - Move from dialog: all helper functions, types, sub-components (see design.md for full list)
  - Create `NetworkLogContent` component with filter/search/split-pane/detail logic (current dialog L158-L222 state + L231-L327 JSX)
  - Reduce dialog to: Dialog shell + `<NetworkLogContent />` + footer
  - Note: `JsonTreeViewer` import stays as-is (already a separate component)
- **Verify**:
  - [ ] `pnpm typecheck` passes
  - [ ] DraftingPanel network log preview dialog opens and works identically (filter, search, split pane drag, request selection, headers/body tabs, cURL copy)

### Task 3: Create Console and Network Sub-Tab Wrappers

- **Target**: Create `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`
- **Work**:
  - ConsoleSubTab: read `useEditorStore((s) => s.consoleLog)`, render empty state or `<ConsoleLogContent>`. Note: `consoleLog` 객체에서 `entries`와 `startedAt`을 꺼내 props로 전달.
  - NetworkSubTab: read `useEditorStore((s) => s.networkLog)`, render empty state or `<NetworkLogContent>`
  - Empty state: centered icon + `t("debug.console.empty")` / `t("debug.network.empty")` 단순 메시지 (UnsupportedPage 패턴 참고)
- **Verify**:
  - [ ] Components compile without errors

### Task 4: Create DebugTab + Update i18n

- **Target**: Create `src/sidepanel/tabs/DebugTab.tsx`, modify `src/i18n/ko.ts`, `src/i18n/en.ts`
- **Work**:
  - DebugTab: follow IntegrationsTab pattern (L53-57). 3 sub-tabs: issue (IssueTab), console (ConsoleSubTab), network (NetworkSubTab). All TabsContent with `data-[state=inactive]:hidden`. TabsContent className은 IntegrationsTab 패턴 (`"mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"`, `overflow-hidden` 없음).
  - ko.ts: 기존 `app.tab.issue`/`app.tab.issueList` 키 유지. 새 키 **추가만**: `app.tab.debug`, `debug.tab.issue`, `debug.tab.console`, `debug.tab.network`, `debug.console.empty`, `debug.network.empty`.
  - en.ts: same structure with English labels.
  - Note: 기존 키 삭제는 Task 5에서 코드 참조 변경과 동시에 처리 (typecheck 깨짐 방지).
- **Verify**:
  - [ ] `pnpm typecheck` passes

### Task 5: Update App.tsx + IssueTab.tsx + i18n cleanup

- **Target**: Modify `src/sidepanel/App.tsx`, `src/sidepanel/tabs/IssueTab.tsx`, `src/i18n/ko.ts`, `src/i18n/en.ts`
- **Work**:
  - App.tsx: import `TerminalSquare` (lucide), `DebugTab`. Change tab value `"issue"` → `"debug"`, default state `useState("debug")`, trigger label `t("app.tab.debug")`, content `<DebugTab />`. Remove `SquarePen`, `IssueTab` imports. 기존 `"issue-list"` 탭 값은 변경 없음.
  - IssueTab.tsx SubmitSuccessView (L296-313): "이슈 목록" 버튼 (L297-306, `setTab("issue-list")` + `t("app.tab.issueList")`) 삭제. [확인] 버튼(`reset()`)만 유지 → Debug > Issue sub-tab idle 복귀.
  - i18n: 이제 사용되지 않는 `app.tab.issue` 키 삭제 (Task 4에서 `app.tab.debug`로 대체됨). `app.tab.issueList`는 계속 사용되므로 유지.
- **Verify**:
  - [ ] `pnpm typecheck` passes

### Task 6: Add Periodic Sync for Live Log Updates

- **Target**: Modify `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx` (or create a shared hook)
- **Work**:
  - Console/Network 서브탭이 visible(active) 상태일 때 `syncConsoleRecorder`/`syncNetworkRecorder`를 주기적으로 호출 (interval TBD, e.g. 1-2s)
  - 서브탭이 hidden 상태가 되면 polling 즉시 중단
  - `useBoundTabId()`로 현재 탭 ID 획득, `syncNetworkRecorder(tabId)` / `syncConsoleRecorder(tabId)` 호출
- **Verify**:
  - [ ] `pnpm typecheck` passes
  - [ ] Console/Network 서브탭에서 페이지 활동 시 로그가 자동 갱신됨
  - [ ] 다른 서브탭으로 전환 시 polling 중단 확인

### Task 7: Full Integration Verification

- **Work**: `pnpm typecheck` + browser manual testing
- **Verify**:
  - [ ] Main tabs: [Debug/디버그] [이슈 목록/Issues] [Integrations/연동] [Settings/설정]
  - [ ] Debug sub-tabs: [이슈 작성/Issue] [Console/콘솔] [Network/네트워크]
  - [ ] Console sub-tab: level filter, search, collapsible detail expand, timestamps, color coding, live update via polling
  - [ ] Network sub-tab: content-type filter, URL search, split pane drag resize, request selection/deselection, headers panel, request/response body tabs, cURL copy, live update via polling
  - [ ] Issue sub-tab state preserved across sub-tab switches (picking/capturing/recording phase 포함)
  - [ ] DraftingPanel LogAttachmentCards + preview dialogs work unchanged
  - [ ] PreviewPanel preview dialogs work unchanged
  - [ ] DraftDetailDialog preview dialogs work unchanged
  - [ ] Issue submit → [확인] → Debug > Issue sub-tab idle 복귀 (이슈 목록 탭 이동 없음)
  - [ ] Empty states when no logs exist (단순 메시지)
  - [ ] English language labels correct (탭 바 overflow 없는지 확인)
  - [ ] Debug 탭 ↔ 다른 메인 탭 전환 후 복귀 시 마지막 서브탭 상태 확인

## Test Plan

- **Unit tests**: No new pure functions introduced. Existing `console-recorder-helpers.test.ts` and `network-recorder-helpers.test.ts` unaffected.
- **Manual tests**: Task 7 checklist above.

## Implementation Order

```
Task 1 ─┐
        ├─> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7
Task 2 ─┘
```

Task 1 and Task 2 are independent (parallel OK). Task 3 depends on 1+2. Task 4-5 depend on 3. Task 6 (periodic sync) depends on 3 (sub-tab wrappers). Task 7 is final integration verification.
