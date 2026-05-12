# Debug Log Tab

## Background

Console/network recorders are already implemented and capture logs while the side panel is open. However, logs can only be viewed through preview dialogs inside the issue creation flow (DraftingPanel). Users need to inspect logs independently of issue creation -- for example, checking network errors before deciding to file an issue.

## Goals

- Add a "Debug" main tab that groups the existing issue creation ("Report") with new console and network log viewer sub-tabs.
- Console/network sub-tab UIs are identical to the existing preview dialogs (ConsoleLogPreviewDialog, NetworkLogPreviewDialog).
- Maintain the current 4 main tab layout (no grid-cols change) by replacing "Issue" with "Debug" as a grouping tab.
- No changes to recording pipeline, storage schema, or eviction policies.

## Non-goals

- Background recording when side panel is closed (recorder injection still requires open panel).
- Historical log browsing across past issues (only current recording session).
- New recording controls (start/stop/pause) in the log tabs.
- Changes to log cap limits (2000 console entries, 50MB network cap).

## User Scenarios

### Primary: Inspect live logs without creating an issue
1. User opens the side panel on a web page. Recorders inject automatically.
2. User clicks the "Debug" main tab, then the "Console" or "Network" sub-tab.
3. Console sub-tab shows live console entries with level filtering (all/error/warn/info/debug/log), search, and accordion expansion for details.
4. Network sub-tab shows captured requests with content-type filtering, URL search, and split-pane detail view (headers/request body/response body).
5. User browses the inspected page -- new entries appear in real time via Zustand reactivity.

### Secondary: Switch between report creation and log inspection
1. User starts creating an issue in the "Report" sub-tab (element pick, style edit, drafting).
2. User switches to "Console" sub-tab to check for related errors.
3. User switches back to "Report" sub-tab -- all drafting state is preserved (data-[state=inactive]:hidden).

### Edge: No logs captured
1. User opens console or network sub-tab before any page activity.
2. Empty state displays a centered message ("No console logs captured" / "No network requests captured").

## Success Criteria

- Main tab bar shows [Debug] [History] [Integrations] [Settings] with no layout overflow.
- Debug sub-tabs [Report] [Console] [Network] switch correctly, preserving state across switches.
- Console sub-tab renders identical UI to ConsoleLogPreviewDialog (filtering, search, accordion, colors, timestamps).
- Network sub-tab renders identical UI to NetworkLogPreviewDialog (filtering, search, split pane with drag resize, headers/body tabs, cURL copy).
- Existing preview dialogs in DraftingPanel/PreviewPanel/DraftDetailDialog continue to work unchanged.
- i18n keys work in both Korean and English.
