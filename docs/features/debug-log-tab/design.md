# Debug Log Tab -- Technical Design

## Overview

Extract the inner viewer content from ConsoleLogPreviewDialog and NetworkLogPreviewDialog into standalone components, then compose them into sub-tabs under a new "Debug" main tab. The "Debug" tab replaces the current "Issue" main tab by wrapping IssueTab as the default "Report" sub-tab alongside new "Console" and "Network" sub-tabs.

## Change Scope

### New Files

**`src/sidepanel/components/ConsoleLogContent.tsx`**
- Extracted from `ConsoleLogPreviewDialog.tsx`
- Contains: filter tabs, search bar, ScrollArea, EntryAccordion, and all helper functions (`levelColor`, `levelBgColor`, `levelCodeBg`, `LevelIcon`, `formatRelativeTime`, `ConsoleFilter`, `CONSOLE_FILTERS`)
- Props: `{ entries: ConsoleEntry[]; startedAt: number }`
- Root element: `<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">`
- Manages own local state: `filter`, `query`, `availableFilters`, `filteredEntries`

**`src/sidepanel/components/NetworkLogContent.tsx`**
- Extracted from `NetworkLogPreviewDialog.tsx`
- Contains: filter tabs, search bar, split pane (request list + drag handle + detail panel), and all helpers (`methodColor`, `isError`, `isPending`, `rowBg`, `classifyRequest`, `ContentTypeIcon`, `formatBytes`, `formatBody`, `bodyLabel`, `buildCurl`, `RequestFilter`, `REQUEST_FILTERS`, `DetailTab`) and sub-components (`RequestRow`, `CollapsibleSection`, `HeadersPanel`, `BodyPanel`, `HeadersTable`, `BodyBlock`)
- Props: `{ requests: NetworkRequest[] }`
- Manages own local state: `activeId`, `detailTab`, `listWidth`, `filter`, `query`, `containerRef`, `dragging`

**`src/sidepanel/tabs/DebugTab.tsx`**
- Parent tab with 3 sub-tabs following IntegrationsTab pattern (L53-60)
- Sub-tab values: `"report"` | `"console"` | `"network"`
- Default sub-tab: `"report"`
- Each TabsContent uses `data-[state=inactive]:hidden` for state preservation

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
- Import: `DebugTab` replaces `IssueTab`; `Bug` replaces `SquarePen` from lucide-react
- Tab values: `"issue"` -> `"debug"`, `"issue-list"` -> `"history"`
- Default state: `useState("debug")`
- Trigger labels: `t("app.tab.debug")`, `t("app.tab.history")`
- Content: `<DebugTab />` replaces `<IssueTab />`

**`src/sidepanel/tabs/IssueTab.tsx`**
- L315: `setTab("issue-list")` -> `setTab("history")`
- L319: `t("app.tab.issueList")` -> `t("app.tab.history")`

**`src/i18n/ko.ts`** and **`src/i18n/en.ts`**
- Replace `app.tab.issue` / `app.tab.issueList` with `app.tab.debug` / `app.tab.history`
- Add `debug.tab.report`, `debug.tab.console`, `debug.tab.network`
- Add `debug.console.empty`, `debug.network.empty`

## Data Flow

No changes to the recording pipeline. Sub-tabs consume existing Zustand state:

```
MAIN world recorders -> content script bridge -> chrome.runtime.sendMessage
  -> usePickerMessages -> editor-store (setConsoleLog / setNetworkLog)
  -> ConsoleSubTab / NetworkSubTab subscribe via Zustand selector
```

Existing `pending:{tabId}` IDB keying, 2000-entry console cap, 50MB network cap, LRU eviction all unchanged. DraftingPanel's LogAttachmentCards remain for quick attach toggle within the report sub-tab.

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

- **Sub-tab pattern**: Identical to IntegrationsTab (L53-60) and SettingsTab -- internal Radix Tabs with `data-[state=inactive]:hidden`
- **TabsContent className**: `"mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"` (matches all existing TabsContent)
- **i18n**: Nested key convention (`debug.tab.*`, `debug.console.*`)
- **Empty state**: Centered icon + message pattern (matches UnsupportedPage in App.tsx)

## Alternatives Considered

**5 main tabs (flat structure)**: `[Report] [Logs] [History] [Integrations] [Settings]` with Logs having console/network sub-tabs. Rejected because: grid-cols-5 is tight in side panel width (~80px per tab), and adding a "Logs" tab that's purely a viewer feels low-density compared to other tabs.

## Risks

- **Performance**: Console/network sub-tab DOM stays mounted (hidden) when report sub-tab is active. With 2000 console entries, this adds DOM nodes. Mitigated by `hidden` attribute preventing layout/paint. No worse than opening the dialog. Virtualization can be added later if profiling shows issues.
- **Split pane width**: NetworkLogContent's default `listWidth: 260` was designed for 80vw dialog. In a full-width tab (~400px), 260px leaves only 140px for details. May need responsive initial width (`Math.min(260, containerWidth * 0.5)`). Check during implementation.
