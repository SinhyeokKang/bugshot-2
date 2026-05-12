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
  - ConsoleSubTab: read `useEditorStore((s) => s.consoleLog)`, render empty state or `<ConsoleLogContent>`
  - NetworkSubTab: read `useEditorStore((s) => s.networkLog)`, render empty state or `<NetworkLogContent>`
  - Empty state: centered icon + `t("debug.console.empty")` / `t("debug.network.empty")` message (follow UnsupportedPage pattern in App.tsx L307-320)
- **Verify**:
  - [ ] Components compile without errors

### Task 4: Create DebugTab + Update i18n

- **Target**: Create `src/sidepanel/tabs/DebugTab.tsx`, modify `src/i18n/ko.ts`, `src/i18n/en.ts`
- **Work**:
  - DebugTab: follow IntegrationsTab pattern (L53-60). 3 sub-tabs: report (IssueTab), console (ConsoleSubTab), network (NetworkSubTab). All TabsContent with `data-[state=inactive]:hidden`.
  - ko.ts: replace `app.tab.issue`/`app.tab.issueList` with `app.tab.debug`/`app.tab.history`. Add `debug.tab.report`, `debug.tab.console`, `debug.tab.network`, `debug.console.empty`, `debug.network.empty`.
  - en.ts: same structure with English labels.
- **Verify**:
  - [ ] `pnpm typecheck` passes

### Task 5: Update App.tsx + IssueTab.tsx

- **Target**: Modify `src/sidepanel/App.tsx`, `src/sidepanel/tabs/IssueTab.tsx`
- **Work**:
  - App.tsx: import `Bug` (lucide), `DebugTab`. Change tab values (`"debug"`, `"history"`), default state, triggers, content. Remove `SquarePen`, `IssueTab` imports.
  - IssueTab.tsx L315: `setTab("issue-list")` -> `setTab("history")`. L319: `t("app.tab.issueList")` -> `t("app.tab.history")`.
- **Verify**:
  - [ ] `pnpm typecheck` passes

### Task 6: Full Integration Verification

- **Work**: `pnpm typecheck` + browser manual testing
- **Verify**:
  - [ ] Main tabs: [Debug/디버그] [History/기록] [Integrations/연동] [Settings/설정]
  - [ ] Debug sub-tabs: [Report/리포트] [Console/콘솔] [Network/네트워크]
  - [ ] Console sub-tab: level filter, search, accordion expand, timestamps, color coding
  - [ ] Network sub-tab: content-type filter, URL search, split pane drag resize, request selection/deselection, headers panel, request/response body tabs, cURL copy
  - [ ] Report sub-tab state preserved across sub-tab switches
  - [ ] DraftingPanel LogAttachmentCards + preview dialogs work unchanged
  - [ ] Issue submit -> "History" tab navigation works
  - [ ] Empty states when no logs exist
  - [ ] English language labels correct

## Test Plan

- **Unit tests**: No new pure functions introduced. Existing `console-recorder-helpers.test.ts` and `network-recorder-helpers.test.ts` unaffected.
- **Manual tests**: Task 6 checklist above.

## Implementation Order

```
Task 1 ─┐
        ├─> Task 3 -> Task 4 -> Task 5 -> Task 6
Task 2 ─┘
```

Task 1 and Task 2 are independent (parallel OK). Task 3 depends on 1+2 (uses extracted content components). Task 4-5 depend on 3.
