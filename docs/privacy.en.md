# BugShot Privacy Policy

**Effective date**: July 4, 2026

BugShot (the "extension") values your privacy and collects and processes only the minimum information necessary. This policy transparently explains what information the extension handles.

---

## 1. Information We Collect

### Platform Credentials and User Information

| Information | When collected | Purpose |
|---|---|---|
| Jira credentials (API token or OAuth token) | When configuring the Jira integration | Creating and attaching to issues |
| Jira user email | When verifying the integration | Displaying integration status |
| GitHub credentials (PAT or OAuth token) | When configuring the GitHub integration | Creating issues and uploading files |
| GitHub user ID | When verifying the integration | Displaying integration status |
| Linear credentials (API key or OAuth token) | When configuring the Linear integration | Creating and attaching to issues |
| Linear user name / email | When verifying the integration | Displaying integration status |
| Notion credentials (internal integration token or OAuth token) | When configuring the Notion integration | Creating and attaching to pages |
| Notion workspace information | When verifying the integration | Displaying integration status |
| GitLab credentials (personal access token or OAuth token) | When configuring the GitLab integration | Creating issues and uploading files |
| GitLab user name / email and instance URL | When verifying the integration | Displaying integration status (including the self-managed instance address) |
| Asana credentials (personal access token or OAuth token) | When configuring the Asana integration | Creating tasks and uploading files |
| Asana user name / email | When verifying the integration | Displaying integration status |
| ClickUp credentials (personal API token or OAuth token) | When configuring the ClickUp integration | Creating tasks and uploading files |
| ClickUp user name / email | When verifying the integration | Displaying integration status |
| Slack credentials (OAuth user token) | When configuring the Slack integration | Sending channel/DM messages and uploading files |
| Slack user name / workspace (team) information | When verifying the integration | Displaying integration status |

### Assignees, CC (Watchers), and Mention Targets

When you use a field that selects a user — such as assignee, CC (watcher), or Slack mention — the extension queries the user directory of the connected platform (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack) with the search term you enter and shows candidates (name, handle, avatar, email). To display already-selected users at the top of the list, the extension may additionally fetch those users' profiles (name, avatar, email). The identifiers of the targets you select are included in the body of the created issue (or Slack message) and sent to that platform. Search terms and the candidate/profile lists returned are not stored on the device.

### Page Data and Debug Information

| Information | When collected | Purpose |
|---|---|---|
| DOM element style information | When selecting an element | Style comparison and issue body generation |
| Screenshots / tab recordings | When capturing / recording a tab | Capturing the current tab's screen to attach to an issue |
| Inline editor images | When inserting part of the screen into the issue body | Capturing the current tab's screen (`captureVisibleTab`) and inserting only the selected region into the body |
| Screen recording video | When the screen-recording mode is selected | Recording the target **you choose yourself** in the browser's screen-share dialog (which may include the entire screen, other app windows, or other tabs — including screens outside the tab where BugShot is open) to attach to an issue |
| Network request logs | When debug capture is enabled | Attaching to an issue (debug information) |
| WebSocket messages (text frame payloads) | When debug capture is enabled | Attaching to an issue (debug information — sent/received text messages, excluding binary) |
| Console logs | When debug capture is enabled | Attaching to an issue (debug information) |
| User action logs (clicks, input, navigation, shortcut keys, toggles, dropdown selections, drag) | When debug capture is enabled | Attaching to an issue (reproduction steps — attached in video mode only) |
| 30-second replay frames | When 30-second replay is enabled | Periodically capturing the current tab's screen and temporarily holding the last 30 seconds in memory (not stored, not transmitted; attached as video only when you explicitly capture) |
| User-attached files | When attaching a file to an issue after enabling the file-attachment feature (optional, off by default) | Attaching an arbitrary local file you select yourself to an issue |

When collecting network logs, sensitive headers such as `authorization` and `cookie`, and sensitive query parameters such as `token` and `access_token`, are masked automatically. Values of sensitive keys such as `token`, `password`, and `secret` in request/response bodies (JSON, form data) are also masked automatically. For real-time messages a page exchanges over WebSocket, only **text frame payloads** are collected (binary frames such as images or files are not collected), and the same body masking applies. Console logs collect the messages a page prints verbatim (with no additional masking), so please be careful with debug capture on pages that print sensitive information to the console.

During debug capture, console/network logs may be collected not only from the current page but also from third-party frames embedded in that page (iframes — e.g., payment widgets, embedded SDKs). This is because errors occurring in those frames may be needed to reproduce a bug; collected logs record the origin so you can distinguish and filter them by origin when attaching to an issue. The sensitive header/parameter/body masking above applies identically regardless of the frame's origin.

Element selection, style editing, and element capture also extend to elements inside cross-origin frames embedded directly in the page (iframes — payment widgets, embeds, etc.). When you select an element inside such a frame, the extension collects that element's selector, style information, and text, records the frame origin, and shows it in the issue's list of style changes. When you capture an element inside an iframe (by capturing the current tab's screen and cropping only that element's region), the frame's screen contents may be included in the screenshot. Frames nested inside another frame, or frames blocked by a security policy (sandbox), are not accessed internally.

User action logs record, in addition to the clicked element, input field, and navigation, reproduction steps for shortcut/special-key input (e.g., Enter, Esc, ⌘K — printable characters and input field values themselves are not recorded), checkbox/radio toggles, dropdown selections, and drag actions (identifying information for the dragged element and the drop-target element). Drag, like clicks, records only the element's accessible name and selector and collects no new sensitive information. Values entered in sensitive input fields (`type=password`, autocomplete hints, or fields identified by sensitive keywords in their name/label) are masked automatically, and keystrokes while such a sensitive field is focused are not recorded at all, so the original text never leaves the device.

During screen recording, even if you navigate (including to other sites), the console/network/action logs are preserved continuously, so an issue created from that recording may include debug logs from the pages visited during recording.

When you reload a page on which you have previously started debug capture, resuming capture may retroactively include console/network/action logs from the early part of that page load (just before resuming). These early-load logs are held only temporarily in device memory until capture is restarted, and are not stored or transmitted.

### App Settings

| Information | When collected | Purpose |
|---|---|---|
| LLM provider settings (base URL, API key, model) | When configuring the AI draft feature | Calling the LLM API |

The LLM API key is stored obfuscated.

On browsers that support Chrome's built-in AI (Prompt API), drafts can be generated with the on-device model without any external API call. In that case, data never leaves your device and no separate API key is required.

### Anonymous Usage Analytics

The extension collects anonymous aggregate events to improve the product (effective June 19, 2026).

| Information | When collected | Purpose |
|---|---|---|
| Install (extension_installed, extension version) | On new install | Understanding install scale and version distribution |
| Side panel opened (sidepanel_opened) | When the side panel is opened | Understanding activation level |
| Platform connect (platform_connect: platform, success/cancel/failure) | On an OAuth connection attempt | Understanding per-platform popularity and connect success/cancel/failure rates |
| Platform disconnected (platform_disconnected: platform) | On disconnect | Understanding integration churn |
| Issue submitted (issue_submitted: platform, capture mode, submission result, replay-trim flag) | On issue submission | Understanding per-platform usage, capture-method priority, submission success/failure rates, and 30-second replay trimming usage |

These events carry only the classification strings above and never include issue titles, bodies, URLs, or personally identifiable information. To distinguish the same installation, a random identifier (distinct_id) is generated once on install, stored on the device, and sent with subsequent events. This identifier is merely a random value and is not linked to any personal information such as email, account, or IP. To ensure the actual IP address is not stored, events are sent with the IP value set to `0.0.0.0`, location estimation (GeoIP) is disabled (`$geoip_disable`), and personal profile creation is disabled (`$process_person_profile: false`). There is no separate opt-out (off) setting for this analytics.

Beyond the items above, the extension does not collect your browsing history, cookies, personally identifiable information, or the like.

## 2. Information Storage

All data is stored **only inside your browser**.

- **chrome.storage.local**: Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack integration settings, issue history, app settings, LLM provider settings (API keys stored obfuscated)
- **chrome.storage.session**: Editing sessions (per tab, automatically deleted when the browser closes)
- **IndexedDB**: Video recordings, screenshot images, network logs, console logs, user action logs, inline editor images, user-attached files (local device only)
- **Memory (temporary)**: 30-second replay frame buffer — not stored to disk; encoded to video and saved to IndexedDB only at the moment you perform a capture.

We do not store user data on external servers.

## 3. External Transmission

The extension transmits data only to the services below.

| Destination | Data transmitted | Purpose |
|---|---|---|
| Jira REST API (`*.atlassian.net`, `api.atlassian.com`) | Issue body, screenshots, video, debug logs | Creating and attaching to issues |
| GitHub REST API (`api.github.com`) | Issue body, labels, assignees | Creating issues |
| GitHub (`api.github.com`, `github.com`, and GitHub-issued upload URLs [AWS S3]) | Screenshots, video, debug logs | File upload |
| Linear GraphQL API (`api.linear.app`; attachments to Linear-issued upload URLs) | Issue body, screenshots, video, debug logs | Creating and attaching to issues |
| Notion REST API (`api.notion.com`) | Page body, screenshots, video, debug logs | Creating and attaching to pages |
| GitLab REST API (`gitlab.com` or a user-specified self-managed instance) | Issue body, labels, assignees, screenshots, video, debug logs | Creating issues and uploading files |
| Asana REST API (`app.asana.com`) | Task body, workspace/project/assignee, screenshots, video, debug logs | Creating tasks and uploading files |
| ClickUp REST API (`api.clickup.com`) | Task body, workspace/space/list/assignee, screenshots, video, debug logs | Creating tasks and uploading files |
| Slack Web API (`slack.com` and Slack-issued file upload URLs) | Message body (title, detail), mention targets, screenshots, video, debug logs, and — on promotion — the tracker issue link | Sending messages/attachments to channels/DMs in your own workspace, and auto-commenting the issue link in the original message thread when promoting to a tracker |
| OAuth proxy server | OAuth authorization code | Token exchange (Jira, GitHub, Notion, Asana, ClickUp, Slack) |
| User-specified LLM provider | Issue body draft, screenshot (optional), debug log summary (optional) | AI draft generation |
| PostHog (`us.i.posthog.com`) | Anonymous aggregate events (install, panel open, platform connect/disconnect, issue submission) | Anonymous usage analytics |

The OAuth proxy server only relays the token exchange and does not store or log user data. Linear and GitLab exchange tokens directly via PKCE without a proxy.

Local files you select yourself through the "file attachment" feature are, on issue (task) submission, uploaded as body attachments to each platform above (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp), and to the message thread in the case of Slack. This feature is off by default and works only when enabled in settings.

When connecting to a GitLab self-managed instance with a PAT, the extension communicates directly with the instance address (an arbitrary origin) you enter. This access is covered by the required broad host permission (`<all_urls>`) granted at install and works without a separate permission dialog.

The LLM provider receives data only at the endpoint you configure yourself, and only when you explicitly run AI draft generation. Access to that host is covered by the required broad host permission (`<all_urls>`).

When searching CC (watcher) mentions, the search term you enter is sent to each platform's user-search API, and the mention targets you select are sent as part of the issue body. All of this works only when you search and select yourself.

## 4. Third-Party Sharing

We do not sell, share, or transfer the information we collect to third parties. Data is transmitted to a given platform, or to the LLM provider you configure, only when you create an issue or request an AI draft yourself.

## 5. Data Deletion

- **Removing the extension**: `chrome.storage` data is deleted automatically.
- **Media / log data**: You can clear site data in your browser settings, or delete items individually from the issue list inside the extension.
- **Disconnecting a platform**: Disconnecting on each platform's (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack) integration tab deletes the stored credentials.
- **Deleting an LLM provider**: Disconnecting the provider in settings deletes the stored settings.

## 6. Permissions Notice

### Extension Permissions

| Permission | Purpose |
|---|---|
| sidePanel | Displaying the side panel UI |
| activeTab | Collecting DOM element information from the current tab |
| scripting | Injecting scripts for DOM selection / overlay display, and running page scripts for GitHub file upload |
| storage | Storing settings, sessions, and issue history |
| commands | Registering keyboard shortcuts |
| contextMenus | Opening the side panel from the right-click menu |
| identity | OAuth sign-in (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack) |
| tabCapture | Recording tab video |
| webNavigation | Preserving the tail of console/network logs just before navigation, and connecting log collection when a newly loaded frame (iframe) is detected (detecting tab/frame navigation) |

### Host Permissions

The extension has **a single** host permission: `<all_urls>`.

- `<all_urls>` (all sites) — the required permission for performing DOM selection, screen capture (`captureVisibleTab`), and console/network log collection on arbitrary web pages, and for communicating with the LLM provider / GitLab self-managed instance you configure, as well as the **API servers of the issue trackers / Slack you connect and the OAuth proxy**. Granted at install and shown on the install screen as "Read and change your data on all sites."

There is no separate per-platform host permission; all of the communication above happens under the `<all_urls>` permission. For the external destinations to which data is actually transmitted (each platform's API server, the OAuth proxy, etc.), see "[3. External Transmission](#3-external-transmission)."

### Where the Broad Host Permission (`<all_urls>`) Is Used

`<all_urls>` (all sites) is a **required permission granted at install** (shown on the install screen as "Read and change your data on all sites"). It is needed for the extension's core features that operate on arbitrary web pages, and there is no separate runtime permission dialog. Main uses:

- **DOM selection / style editing**: Picking an element on any web page to collect information and preview styles
- **Screen capture / 30-second replay**: Current-tab screen capture (`captureVisibleTab`) does not work with ordinary host permissions and requires `<all_urls>`. Capture and log collection continue even when you navigate to another site, without the side panel closing.
- **Console / network log collection**: Recording logs on arbitrary pages (and iframes)
- **AI draft**: Transmitting to the LLM provider endpoint you configure yourself (when you explicitly run an AI draft)
- **GitLab self-managed**: PAT communication with the instance (an arbitrary origin) you enter
- **Style value enrichment**: To accurately display the "author-specified" styles of a selected element, the extension reads, in the background and without credentials (`credentials:omit`), the external stylesheets (cross-origin CSS files) the page references. Only public http(s) hosts are targeted (loopback, internal networks, and private IPs are blocked), and the CSS received is used only on the device and not transmitted to third parties.

Each feature transmits data only when you turn it on or run it yourself. The permission itself is granted at all times from install, but you can narrow the access scope in Chrome settings (Extensions > BugShot > Site access).

## 7. Changes

If this policy changes, we will provide notice through this page.

## 8. Contact

Privacy inquiries: ox501501@gmail.com
