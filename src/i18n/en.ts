import type { TranslationMap } from "./ko";

const en = {
  // Common
  "common.ok": "OK",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.loading": "Loading...",
  "common.empty": "Empty",
  "common.actions": "Actions",
  "common.deselect": "Deselect",
  "common.untitled": "(Untitled)",
  "common.next": "Next",
  "common.done": "Done",
  "common.reset": "Reset",
  "common.submit": "Submit",
  "common.verify": "Verify",
  "common.delete": "Delete",

  // App tabs
  "app.tab.issue": "Issue",
  "app.tab.issueList": "Issues",
  "app.tab.settings": "Jira",
  "app.tab.appSettings": "Settings",
  "app.unsupported.title": "Unavailable on this page",
  "app.unsupported.body": "Please run BugShot on a web page (http, https, file).",
  "app.oauthExpired.title": "Jira auth has expired",
  "app.oauthExpired.body": "Please reconnect Jira.",
  "app.pickerUnavailable.title": "Unavailable on this page",
  "app.pickerUnavailable.body": "Chrome policy prevents BugShot from running on the Chrome Web Store and similar restricted pages. Try another page.",

  // Issue sections
  "section.issueTitle": "Issue title",
  "section.env": "Environment",
  "section.description": "Description",
  "section.media": "Media",
  "section.styleChanges": "Style changes",
  "section.expectedResult": "Expected result",

  // Issue tab
  "issue.unsupported": "Unsupported page",
  "issue.empty.title": "Choose capture mode",
  "issue.mode.element": "Select DOM element",
  "issue.mode.screenshot": "Screenshot",
  "issue.mode.video": "Record video",
  "issue.picking.title": "Select an element",
  "issue.capturing.title": "Select capture area",
  "issue.recording.title": "Recording {time}",
  "issue.recording.stop": "Stop recording",
  "issue.sessionExpired.title": "Page has been refreshed",
  "issue.sessionExpired.body": "Your draft will be reset.",

  // Jira (shared)
  "jira.submitted": "Issue submitted",
  "jira.submit": "Submit issue",
  "jira.notConnected.title": "Jira is not connected",
  "jira.notConnected.body": "To create Jira issues, connect Jira in the settings tab first.",
  "jira.connectFirst": "Connect Jira in the settings tab first",

  // Style editor
  "editor.resetChanges": "Reset changes",
  "editor.resetChanges.body": "Reset {count} change(s)? All styles will revert to original values.",
  "editor.textPlaceholder": "Element text",
  "editor.revertText": "Revert to original text",
  "editor.revertClass": "Revert to original classes",
  "editor.revertSection": "Revert inline for this section",

  // Style prop editors
  "prop.editIndividual": "Edit individually",
  "prop.editTogether": "Edit together",
  "prop.align.left": "Left",
  "prop.align.center": "Center",
  "prop.align.right": "Right",
  "prop.align.justify": "Justify",
  "prop.side.top": "Top",
  "prop.side.right": "Right",
  "prop.side.bottom": "Bottom",
  "prop.side.left": "Left",
  "prop.corner.topLeft": "Top left",
  "prop.corner.topRight": "Top right",
  "prop.corner.bottomRight": "Bottom right",
  "prop.corner.bottomLeft": "Bottom left",
  "prop.gap.row": "Row gap",
  "prop.gap.column": "Column gap",

  // Value combobox
  "value.placeholder": "Enter value or search tokens",
  "value.reset": "Original value (reset)",
  "value.unset": "Unset value",
  "value.manualInput": "Manual input",
  "value.noMatch": "No match",
  "value.showMore": "Show {count} more tokens",
  "value.otherTokens": "Other tokens",

  // DOM tree
  "dom.parent": "Parent element",
  "dom.child": "First child element",
  "dom.repick": "Pick another element",
  "dom.dialogTitle": "DOM Selection",
  "dom.loading": "Loading DOM tree...",
  "dom.error": "Failed to load DOM tree.",
  "dom.collapse": "Collapse",
  "dom.expand": "Expand",

  // Drafting panel
  "draft.titlePlaceholder": "Issue title",
  "draft.bodyPlaceholder": "Reproduction steps, expected behavior, etc.",
  "draft.expectedResultPlaceholder": "Expected behavior or design spec after fix",
  "draft.removeAnnotation": "Remove annotation",
  "draft.editAnnotation": "Edit annotation",
  "draft.addAnnotation": "Add annotation",
  "draft.preview": "Issue preview",

  // Preview panel
  "preview.copied": "Copied",
  "preview.copyMarkdown": "Copy markdown",
  "preview.newIssue": "New issue",

  // Issue create modal
  "create.issueType": "Issue type",
  "create.assignee": "Assignee",
  "create.priority": "Priority",
  "create.parentEpic": "Parent epic",
  "create.linkedIssue": "Linked issue",

  // Field combobox
  "field.issueType.select": "Select issue type",
  "field.issueType.search": "Search issue types...",
  "field.issueType.empty": "No matching issue types.",
  "field.priority.select": "Select priority",
  "field.priority.search": "Search priorities...",
  "field.priority.empty": "No matching priorities.",
  "field.priority.label": "Priority",
  "field.assignee.select": "Select assignee",
  "field.assignee.search": "Search by name...",
  "field.assignee.empty": "No matching users.",
  "field.assignee.label": "Assignee",
  "field.epic.select": "Select issue (optional)",
  "field.epic.search": "Search issues...",
  "field.epic.empty": "No matching issues.",
  "field.epic.label": "Issues",

  // Issue list
  "issueList.empty": "No issues yet",
  "issueList.deleteAll": "Delete all",
  "issueList.deleteAll.title": "Delete all issues?",
  "issueList.deleteAll.body": "Only BugShot's list will be cleared. Issues in Jira won't be affected.",
  "issueList.refresh": "Refresh",
  "issueList.draft": "Draft",
  "issueList.deleteDraft.title": "Delete this draft?",
  "issueList.deleteDraft.body": "Deleted drafts cannot be recovered.",
  "issueList.deleteIssue": "Delete issue",
  "issueList.unknown": "Unknown",

  // Time
  "time.justNow": "Just now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",

  // Settings
  "settings.jiraConnection": "Jira connection",
  "settings.project": "Project",
  "settings.issueSettings": "Issue settings",
  "settings.defaultIssueType": "Default issue type",
  "settings.noJiraSites": "No accessible Jira sites.",
  "settings.onboarding.title": "Connect Jira",
  "settings.onboarding.body": "Connect with your Atlassian account or API token.",
  "settings.selectSite": "Select a site to connect",
  "settings.atlassianLogin": "Atlassian login",
  "settings.apiKeyDialog.title": "API Token Auth",
  "settings.apiKeyDialog.body": "Enter your Jira workspace URL and credentials.",
  "settings.workspaceUrl": "Workspace URL",
  "settings.email": "Email",
  "settings.apiToken": "API token",
  "settings.getToken": "Get token",
  "settings.oauthError.noJira.title": "No Jira found for this account.",
  "settings.oauthError.noJira.body": "Try switching accounts.",
  "settings.switchAccount": "Switch account",
  "settings.projectDialog.title": "Select project",
  "settings.projectDialog.body": "Select a project to create issues in.",
  "settings.projectDialog.label": "Project",
  "settings.titlePrefix": "Title prefix",
  "settings.titlePrefix.help": "Automatically prepended to issue titles. Leave empty to disable.",
  "settings.connected": "Connected to Jira successfully.",
  "settings.disconnect": "Disconnect Jira",
  "settings.disconnect.title": "Disconnect from Jira?",
  "settings.disconnect.body": "Credentials and project settings will be cleared. Re-authentication is required to reconnect.",
  "settings.disconnect.confirm": "Disconnect",

  // App settings
  "appSettings.theme": "Theme",
  "appSettings.language": "Language",
  "appSettings.theme.light": "Light",
  "appSettings.theme.dark": "Dark",
  "appSettings.theme.system": "System",

  // Draft detail
  "draftDetail.title": "Review draft",

  // IssueType combobox (settings)
  "issueType.selectProjectFirst": "Select a project first",

  // Project combobox
  "project.select": "Select project",
  "project.search": "Search projects...",
  "project.empty": "No matching projects.",

  // Cancel confirm dialog
  "cancelConfirm.trigger": "Cancel editing",
  "cancelConfirm.title": "Cancel editing?",
  "cancelConfirm.body": "All unsaved changes will be lost.",

  // Annotation overlay
  "annotation.cancel": "Cancel",
  "annotation.done": "Done",

  // Style changes table
  "styleTable.snapshot": "Snapshot",
  "styleTable.noChanges": "No changes.",

  // Build issue markdown / ADF
  "md.section.env": "Environment",
  "md.section.description": "Description",
  "md.section.media": "Media",
  "md.section.styleChanges": "Style Changes",
  "md.section.expectedResult": "Expected Result",
  "md.videoAttached": "(See attached video)",
  "md.imageAttached": "(See attached image)",
  "md.column.property": "Property",
  "md.noValue": "(none)",

  // Background errors
  "bg.error.network": "Check your network connection. Cannot reach Jira server.",
  "bg.error.communication": "Extension communication error. Please refresh the page.",
  "bg.error.unknown": "An unknown error occurred.",

  // Jira API errors
  "jira.error.401": "Auth failed: check your credentials.",
  "jira.error.403": "Forbidden: check your account permissions.",
  "jira.error.404": "Not found: check workspace URL or site.",
  "jira.error.429": "Too many requests. Try again later.",
  "jira.error.5xx": "Jira server error. Try again later.",
  "jira.error.generic": "Jira request failed ({status})",

  // OAuth errors
  "oauth.error.notConfiguredClient": "Atlassian OAuth app is not configured. Set VITE_ATLASSIAN_CLIENT_ID.",
  "oauth.error.notConfiguredProxy": "OAuth proxy is not configured. Set VITE_OAUTH_PROXY_URL.",
  "oauth.error.cancelled": "OAuth cancelled",
  "oauth.error.stateMismatch": "OAuth state mismatch",
  "oauth.error.codeMissing": "OAuth code missing",
  "oauth.error.tokenExchange": "Token exchange failed ({status}) {text}",
  "oauth.error.siteList": "Failed to fetch site list ({status})",
  "oauth.error.tokenRefresh": "Token refresh failed ({status}) {text}",
  "oauth.error.tokenPersist": "Failed to persist tokens. Please sign in again. ({message})",
  "oauth.error.refreshExhausted": "Authentication still failing after token refresh. Please sign in again.",
};

export default en satisfies TranslationMap;
