# Debug Log Tab -- Technical Design

## Overview

Extract the inner viewer content from ConsoleLogPreviewDialog and NetworkLogPreviewDialog into standalone components, then compose them into sub-tabs under a new "Debug" main tab. The "Debug" tab replaces the current "Issue" main tab by wrapping IssueTab as the default "Issue" sub-tab alongside new "Console" and "Network" sub-tabs. Additionally, add periodic sync polling so Console/Network sub-tabs show live log updates.

## Change Scope

### New Files

**`src/sidepanel/components/ConsoleLogContent.tsx`**
- Extracted from `ConsoleLogPreviewDialog.tsx`
- Contains: filter tabs, search bar, ScrollArea, EntryAccordion, and all helper functions (`levelColor`, `levelBgColor`, `levelCodeBg`, `LevelIcon`, `formatRelativeTime`, `ConsoleFilter`, `CONSOLE_FILTERS`)
- Props: `{ entries: ConsoleEntry[]; startedAt: number }`
- Root element: `<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">`
- Manages own local state: `filter`, `query`, `availableFilters`, `filteredEntries`
- `useT()` is called internally (not via props), consistent with existing sub-form pattern

**`src/sidepanel/components/NetworkLogContent.tsx`**
- Extracted from `NetworkLogPreviewDialog.tsx` (~340 lines)
- Contains:
  - Helpers: `methodColor`, `isError`, `isPending`, `rowBg`, `classifyRequest`, `ContentTypeIcon`, `formatBytes`, `formatBody`, `bodyLabel`, `buildCurl`
  - Types: `RequestFilter`, `REQUEST_FILTERS`, `DetailTab`
  - Sub-components: `RequestRow`, `CollapsibleSection`, `HeadersPanel`, `BodyPanel`, `HeadersTable`, `BodyBlock`
  - Imports to move: `JsonTreeViewer`, `formatBytes`, `networkLogPath`
- Props: `{ requests: NetworkRequest[] }`
- Manages own local state: `activeId`, `detailTab`, `listWidth`, `filter`, `query`, `containerRef`, `dragging`
- `useT()` is called internally (not via props), consistent with existing sub-form pattern

**`src/sidepanel/tabs/DebugTab.tsx`**
- Parent tab with 3 sub-tabs following IntegrationsTab pattern (L53-57: Tabs + TabsList + TabsTrigger)
- Sub-tab values: `"issue"` | `"console"` | `"network"`
- Default sub-tab: `"issue"`
- Each TabsContent uses `data-[state=inactive]:hidden` for state preservation
- TabsContent className: IntegrationsTab 패턴 (`"mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"`) 사용. `overflow-hidden`은 App.tsx 메인 탭 패턴이므로 서브탭에서는 불필요.

**`src/sidepanel/tabs/ConsoleSubTab.tsx`**
- Reads `useEditorStore((s) => s.consoleLog)`
- If no data or `captured === 0`: shows centered empty state with icon + message
- Otherwise: renders `<ConsoleLogContent entries={...} startedAt={...} />`

**`src/sidepanel/tabs/NetworkSubTab.tsx`**
- Reads `useEditorStore((s) => s.networkLog)`
- If no data or `captured === 0`: shows centered empty state
- Otherwise: renders `<NetworkLogContent requests={...} />`

### Modified Files

**`src/sidepanel/components/ConsoleLogPreviewDialog.tsx`**
- Remove all extracted code (helpers, EntryAccordion, filter logic)
- Import `ConsoleLogContent` from `./ConsoleLogContent`
- Keep: Dialog wrapper + DialogHeader + DialogFooter (Close/Attach buttons)
- Body becomes: `<ConsoleLogContent entries={entries} startedAt={startedAt} />`

**`src/sidepanel/components/NetworkLogPreviewDialog.tsx`**
- Remove all extracted code
- Import `NetworkLogContent` from `./NetworkLogContent`
- Keep: Dialog wrapper + DialogHeader + DialogFooter
- Body becomes: `<NetworkLogContent requests={requests} />`

**`src/sidepanel/App.tsx`**
- Import: `DebugTab` replaces `IssueTab`; `TerminalSquare` replaces `SquarePen` from lucide-react
- Tab values: `"issue"` -> `"debug"` (기존 `"issue-list"` 값은 유지)
- Default state: `useState("debug")`
- Trigger label: `t("app.tab.debug")` (기존 `t("app.tab.issueList")` 유지)
- Content: `<DebugTab />` replaces `<IssueTab />`

**`src/sidepanel/tabs/IssueTab.tsx`**
- SubmitSuccessView (L296-313): "이슈 목록" 버튼 제거. [확인] 버튼만 남기고 `reset()` 호출 → Debug > Issue sub-tab idle 복귀.
  - 기존 L300-306 (`setTab("issue-list")` + `t("app.tab.issueList")` 버튼) 삭제
  - 기존 L307-309 (`reset()` 버튼) 유지
- Note: `setTab`은 `useTabNav()`를 통해 App.tsx 메인 탭을 전환하므로, DebugTab 내부 서브탭 전환이 아님.

**`src/i18n/ko.ts`** and **`src/i18n/en.ts`**
- Add `app.tab.debug` (기존 `app.tab.issue` / `app.tab.issueList` 키 유지)
- Add `debug.tab.issue`, `debug.tab.console`, `debug.tab.network`
- Add `debug.console.empty`, `debug.network.empty`

## Data Flow

Sub-tabs consume existing Zustand state with a new periodic sync layer:

```
MAIN world recorders (buffer) -> syncNetworkRecorder / syncConsoleRecorder
  -> content script bridge -> chrome.runtime.sendMessage
  -> usePickerMessages -> editor-store (setConsoleLog / setNetworkLog)
  -> ConsoleSubTab / NetworkSubTab subscribe via Zustand selector
```

**New: Periodic Sync** — Currently sync is only triggered on screenshot capture (`useBackgroundRecorder` L107-110). Add periodic polling (interval TBD, e.g. 1-2s) when Debug tab's Console or Network sub-tab is active, calling `syncNetworkRecorder`/`syncConsoleRecorder` to push MAIN world buffer to store. Polling starts when sub-tab becomes visible, stops when hidden.

Existing `pending:{tabId}` IDB keying, 2000-entry console cap, 50MB network cap, LRU eviction all unchanged. DraftingPanel's LogAttachmentCards remain for quick attach toggle within the issue sub-tab.

## Interface Design

```typescript
// ConsoleLogContent
interface ConsoleLogContentProps {
  entries: ConsoleEntry[];
  startedAt: number;
}

// NetworkLogContent
interface NetworkLogContentProps {
  requests: NetworkRequest[];
}
```

No new types, store fields, message types, or hooks required.

## Existing Pattern Compliance

- **Sub-tab pattern**: Identical to IntegrationsTab (L53-57) and SettingsTab -- internal Radix Tabs with `data-[state=inactive]:hidden`
- **TabsContent className**: `"mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"` (IntegrationsTab 패턴. App.tsx 메인 탭의 `overflow-hidden`과 구분)
- **i18n**: Nested key convention (`debug.tab.*`, `debug.console.*`)
- **Empty state**: Centered icon + simple message ("콘솔 로그가 없습니다" / "네트워크 요청이 없습니다"). UnsupportedPage 패턴 참고.

## Alternatives Considered

**5 main tabs (flat structure)**: `[Report] [Logs] [History] [Integrations] [Settings]` with Logs having console/network sub-tabs. Rejected because: grid-cols-5 is tight in side panel width (~80px per tab), and adding a "Logs" tab that's purely a viewer feels low-density compared to other tabs.

## Risks

- **Performance**: Console/network sub-tab DOM stays mounted (hidden) when issue sub-tab is active. With 2000 console entries, this adds DOM nodes. Mitigated by `hidden` attribute preventing layout/paint. No worse than opening the dialog.
- **Split pane width**: NetworkLogContent's default `listWidth: 260` was designed for 80vw dialog. Side panel 너비는 사용자가 좌우로 조절 가능하므로 현행 유지. 27인치 이상 모니터에서 최적의 사용성 제공.
- **Periodic sync overhead**: Console/Network sub-tab 활성 시 1-2초 간격으로 sync 호출. MAIN world buffer가 비어있으면 no-op에 가까우므로 부하 미미. Sync 중 tab 전환 시 polling 즉시 중단.
