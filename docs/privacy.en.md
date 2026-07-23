# BugShot Privacy Policy

**Effective date**: July 23, 2026

BugShot (the "extension") values your privacy and collects and processes only the minimum information necessary. This policy transparently explains what information the extension handles.

---

## 1. Information We Collect

### Platform Credentials and User Information

| Information | When collected | Purpose |
|---|---|---|
| Jira credentials (API token or OAuth token), site URL | When configuring the Jira integration | Creating and attaching to issues |
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

When you use a field that selects a user — such as assignee, CC (watcher), or Slack mention — the extension fetches candidates (name, handle, avatar, email) from the connected platform (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack). **Only Jira receives the search term you type** — it goes to Jira's user-search API. Every other platform returns the user list for the project or workspace and the **search runs on your device**, so your search term never leaves it, though the member directory for that scope (name, handle, avatar, email) is delivered to your device (it is not stored). Avatar images in the candidate list are loaded directly from each platform's image CDN. To display already-selected users at the top of the list, the extension may additionally fetch those users' profiles (name, avatar, email). **This lookup happens not only when you write an issue, but also when you set a default assignee in the Integrations tab.** The identifiers of the targets you select are included in the body of the created issue (or Slack message) and sent to that platform.

Search terms and the candidate/profile lists returned are not stored on the device. However, **the identifier and display name of the assignee, CC, or mention target you picked are stored on your device** so they can be filled in again next time (as the default assignee in your integration settings, and as your last submission).

### Page Data and Debug Information

| Information | When collected | Purpose |
|---|---|---|
| DOM element style information | When selecting an element | Style comparison and issue body generation |
| Screenshots (area / screen / full page / element) / tab recordings | When capturing / recording a tab | Capturing the range you choose to attach to an issue — **full-page capture automatically scrolls the page beyond the visible screen and stitches multiple shots together, so content that was off-screen is included in the image** |
| Inline editor images | When inserting part of the screen into the issue body | Capturing the current tab's screen (`captureVisibleTab`) and inserting only the selected region into the body |
| Screen recording video | When the screen-recording mode is selected, **or when tab recording is unavailable and BugShot falls back to screen sharing** | Recording the target **you choose yourself** in the browser's screen-share dialog (which may include the entire screen, other app windows, or other tabs — including screens outside the tab where BugShot is open) to attach to an issue. If tab-capture permission is revoked mid-flow (for example by navigating away), the screen-share dialog opens instead, and **even then recording does not start until you pick a target yourself** |
| Annotations | When you draw on a screenshot or on the page during a recording | Composited into the image or video **on your device only**. Nothing is collected or transmitted separately |
| Audio | — | **Never collected.** Tab recording, screen recording, and the 30-second replay all capture video without microphone or system audio |
| Network request logs | While the side panel is open (including before a capture starts) | Attaching to an issue (debug information) |
| WebSocket messages (text frame payloads) | While the side panel is open (including before a capture starts) | Attaching to an issue (debug information — sent/received text messages, excluding binary) |
| Console logs | While the side panel is open (including before a capture starts) | Attaching to an issue (debug information) |
| User action logs (clicks, input, navigation, shortcut keys, toggles, dropdown selections, drag) | While the side panel is open (including before a capture starts) | Attaching to an issue (reproduction steps — attached by default in every capture mode except element style editing) |
| 30-second replay frames | When 30-second replay is enabled | Periodically capturing the current tab's screen and temporarily holding the last 30 seconds in memory (not stored, not transmitted; attached as video only when you explicitly capture) |
| User-attached files | When attaching a file to an issue after enabling the file-attachment feature (optional, off by default) | Attaching an arbitrary local file you select yourself to an issue |


When you run a full-page capture, the extension **automatically scrolls the page from top to bottom** until the capture finishes, and **temporarily hides elements pinned to the screen** (`position: fixed` headers, floating buttons, and so on) as well as repeating `position: sticky` elements that have already appeared in full and become pinned to the top or bottom, restoring them once the capture is done. Sticky elements that have not reached their original position or are taller than the screen and have not appeared in full are left visible. This keeps the same element from being printed over and over without dropping unseen content. While the capture runs, clicks and scrolling on the page are blocked so the result doesn't come out misaligned, and the page is scrolled back to where you were once it finishes. Because of this automatic scrolling, the page's own scroll-driven behavior (loading more content, the page's own analytics scripts, and so on) may run. That is behavior the page performs on its own; the extension does not collect or transmit anything beyond the captured image during this process.

When collecting network logs, sensitive headers such as `authorization` and `cookie`, and sensitive query parameters such as `token` and `access_token`, are masked automatically. Values of sensitive keys such as `token`, `password`, and `secret` in request/response bodies (JSON, form data) are also masked automatically. For real-time messages a page exchanges over WebSocket, only **text frame payloads** are collected (binary frames such as images or files are not collected), and the same body masking applies — though **only to JSON-shaped frames; other text frames are collected verbatim**. Console logs collect the messages a page prints verbatim (with no additional masking), so please be careful with debug capture on pages that print sensitive information to the console.

Console, network, and action logs may be collected not only from the current page but also from third-party frames embedded in that page (iframes — e.g., payment widgets, embedded SDKs), including clicks and input that happen inside those frames. This is because errors occurring in those frames may be needed to reproduce a bug; collected logs record the origin so you can distinguish and filter them by origin when attaching to an issue. The sensitive header/parameter/body masking above applies identically regardless of the frame's origin.

Element selection, style editing, and element capture also extend to elements inside cross-origin frames embedded directly in the page (iframes — payment widgets, embeds, etc.). When you select an element inside such a frame, the extension collects that element's selector, style information, and text, records the frame origin, and shows it in the issue's list of style changes. When you capture an element inside an iframe (by capturing the current tab's screen and cropping only that element's region), the frame's screen contents may be included in the screenshot. Frames nested inside another frame, or frames blocked by a security policy (sandbox), are not accessed internally.

User action logs record, in addition to the clicked element, input field, and navigation, reproduction steps for shortcut/special-key input (e.g., Enter, Esc, ⌘K — a shortcut entry carries no printable characters or field values), checkbox/radio toggles, dropdown selections, and drag actions (identifying information for the dragged element and the drop-target element). To make the entry readable, it also records **the on-screen text of the element you clicked or dragged (its accessible name, up to 80 characters)** — so it reads as "clicked Save" rather than a bare selector.

**The values you type into input fields and pick from dropdowns are recorded verbatim (up to 500 characters) and attached to the issue, unless they are caught by the masking rules below.** Knowing which value triggered the bug is what makes a report reproducible. Sensitive information is masked automatically (`***`) in two ways.

- **By field type and label**: `type=password`, autocomplete hints, and sensitive keywords found in the field's name, id, `aria-label`, associated label (a `label` element or `aria-labelledby`), or placeholder (password, card, cvv, ssn, token, and their Korean equivalents).
- **By value shape**: even when the label gives no clue, a value is masked if it looks like an email address or a run of 9 or more digits (phone, card, national ID, or bank account numbers).

Every action also records the **page address** it happened on. Sensitive query and fragment parameters are masked for every action, including navigation, click, input, toggle, select, shortcut-key, and drag. Ordinary address information that is not identified as sensitive remains in the log for reproduction.

The **value-shape rule above applies not just to what you type, but to the element's on-screen text and field labels as well** — if the name of the element you clicked looks like an email address or a long digit run, it is masked too.

In addition, content typed into rich-text editors (`contenteditable` — mail bodies, documents, message composers) is **never recorded, neither as a value nor as an element name**; only the fact that you typed is kept. Keystrokes while a sensitive field is focused are not recorded either. However, **a value with no sensitive signal in either its label or its shape (a search term, ordinary text) is recorded verbatim**, so on screens where you enter sensitive content, please turn off log attachment before submitting.

Console, network, and action logs are **attached by default**; you can turn the whole attachment off with a single switch on the log card on the drafting screen before submitting the issue.

On the drafting screen you can also **pick a single captured network or console log and insert it into the issue body as a code block** (a separate feature from attachment — only the log you explicitly select is inserted). An inserted network log carries the request path and status code along with the **verbatim request and response bodies**; only the capture-time body masking described above (sensitive keys such as `token`, `password`, `secret`) applies, and the rest of the body is verbatim (headers are not inserted). **An inserted console log carries the message the page printed, and its stack trace, verbatim and unmasked** — console logs are not masked at capture time to begin with. Unlike the attached file (`logs.html`), this content **appears as plain text in the issue body and is visible to everyone who can view that issue**, It is **not** sent to your AI provider, however — when an existing draft is handed to the AI, code blocks and inserted images are stripped and only the prose is sent. Please review the content in the detail pane before inserting; an inserted code block is ordinary text, so you can freely edit or delete it before submitting.

While a capture is in progress (screenshot, report drafting, or video recording), navigating away (including to another site) does not interrupt the console/network/action logs — they are preserved, so an issue created that way may include debug logs from the pages visited during the capture.

When you reload a page on which you have previously started debug capture, resuming capture may retroactively include console/network/action logs from the early part of that page load (just before resuming). These early-load logs are held only temporarily in device memory until capture is restarted, and are not stored or transmitted.

### App Settings

| Information | When collected | Purpose |
|---|---|---|
| LLM provider settings (base URL, API key, model) | When configuring the AI draft / AI styling feature | Calling the LLM API |

The LLM API key is stored obfuscated. You choose the provider yourself; presets ship base URLs for OpenAI, Anthropic, Gemini, Groq, OpenRouter, Together, and Ollama — **when you use an AI feature, the material for the draft (title, body, style changes, annotated image, log summaries) is sent to the provider you picked.** The action-log summary may carry unmasked input and selection values as-is (masked values are sent as `***`). Nothing is sent if you don't turn the AI features on. The provider setup screen is the one exception: it calls your endpoint to list the available models (API key only, no user content). In addition, when you enter the report-drafting screen after a video capture, the action-log summary along with the page address and title is sent once per session to your connected AI provider (if one is configured) to auto-fill the reproduction steps. This auto-fill is on by default and can be turned off in settings.

On browsers that support Chrome's built-in AI (Prompt API), drafts and CSS change suggestions can be generated with the on-device model without any external API call. In that case, data never leaves your device and no separate API key is required.

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

- **chrome.storage.local**: Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack integration settings (default project/repository/team and **default assignee**), your last submission (project, assignee, CC — including the identifier and display name of the person you picked), issue history, app settings, LLM provider settings (LLM API keys stored obfuscated), anonymous install identifier
- **chrome.storage.session**: Editing sessions (including the screenshot and element before/after images you're working on), and the address of the tab the side panel was opened on (so reopening the panel reconnects to that tab) (per tab, automatically deleted when the browser closes)
- **IndexedDB**: Video recordings, screenshot images, network logs, console logs, user action logs, inline editor images (including pre-annotation originals), user-attached files (local device only)
- **The visited page's sessionStorage**: a single flag (value `1`) marking whether debug capture has been started in that tab, so logs from the very start of a page load are not missed. It disappears when the tab is closed.
- **Memory (temporary)**: 30-second replay frame buffer — not stored to disk; encoded to video and saved to IndexedDB only at the moment you perform a capture.

We do not store user data on external servers.

## 3. External Transmission

The extension transmits data only to the services below.

| Destination | Data transmitted | Purpose |
|---|---|---|
| Jira REST API (`*.atlassian.net`, `api.atlassian.com`, the site URL you specify in API token mode, and Jira-issued media/CDN URLs) | Issue body, screenshots, video, debug logs | Creating and attaching to issues, and resolving the uploaded attachment's media ID |
| GitHub REST API (`api.github.com`) | Issue body, labels, assignees | Creating issues |
| GitHub (`api.github.com`, `github.com`, and GitHub-issued upload URLs [AWS S3]) | Screenshots, video, debug logs | File upload (the github.com upload path uses **the github.com session you are already signed into**; if no github.com tab is open, a background tab is opened for the duration of the upload and closed afterwards) |
| Linear GraphQL API (`api.linear.app`; attachments to Linear-issued upload URLs) | Issue body, screenshots, video, debug logs | Creating and attaching to issues |
| Notion REST API (`api.notion.com`) and Notion-issued file upload URLs | Page body, screenshots, video, debug logs | Creating and attaching to pages |
| GitLab REST API (`gitlab.com` or a user-specified self-managed instance) | Issue body, labels, assignees, screenshots, video, debug logs | Creating issues and uploading files |
| Asana REST API (`app.asana.com`) | Task body, workspace/project/assignee, screenshots, video, debug logs | Creating tasks and uploading files |
| ClickUp REST API (`api.clickup.com`) | Task body, workspace/space/list/assignee, screenshots, video, debug logs | Creating tasks and uploading files |
| Slack Web API (`slack.com` and Slack-issued file upload URLs) | Message body (title, detail), mention targets, screenshots, video, debug logs, and — on promotion — the tracker issue link | Sending messages/attachments to channels/DMs in your own workspace, and auto-commenting the issue link in the original message thread when promoting to a tracker |
| OAuth proxy server | OAuth authorization code, token refresh requests (refresh token) | Token exchange (Jira, GitHub, Notion, Asana, ClickUp, Slack) |
| User-specified LLM provider (AI draft) | Issue body draft, page URL/title, element selector/style info and design tokens, screenshot, element before/after images, and inline images placed in the body (optional), debug log summary (optional), the extra instructions you type, and any draft you have already written | AI draft generation |
| User-specified LLM provider (AI styling) | Selected element's tag, CSS selector, class list, current specified styles, design tokens, computed layout styles (display, position, width, margin, etc.), browser viewport size, and the instruction you type | CSS change suggestion |
| PostHog host configured at build time (default `us.i.posthog.com`) | Anonymous aggregate events (install, panel open, platform connect/disconnect, issue submission) | Anonymous usage analytics |

The OAuth proxy server only relays the token exchange and does not store or log user data. Linear and GitLab exchange tokens directly via PKCE without a proxy.

Local files you select yourself through the "file attachment" feature are, on issue (task) submission, uploaded as body attachments to each platform above (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp), and to the message thread in the case of Slack. This feature is off by default and works only when enabled in settings.

When connecting to a GitLab self-managed instance with a PAT, the extension communicates directly with the instance address (an arbitrary origin) you enter. This access is covered by the required broad host permission (`<all_urls>`) granted at install and works without a separate permission dialog.

The LLM provider receives data only at the endpoint you configure yourself. AI draft generation and AI styling run only when you explicitly trigger them, while reproduction-step auto-fill runs automatically once per session when you enter the drafting screen after a video capture (on by default, can be turned off in settings). Access to that host is covered by the required broad host permission (`<all_urls>`).

When searching CC (watcher) mentions, only Jira receives the search term you type (see 1-2 above), and the mention targets you select are sent as part of the issue body. All of this works only when you search and select yourself.

## 4. Third-Party Sharing

We do not sell the information we collect. Data is transmitted directly to the destinations listed above only as needed to perform a feature. This includes issue submission, integration candidate lookup, AI draft or styling requests, LLM model lookup during setup, OAuth code/token exchange, reproduction-step auto-fill (automatically upon entering the drafting screen after a video capture; can be turned off in settings), and anonymous usage analytics that contain no capture content. BugShot servers do not receive or store capture or report data.

## 5. Data Deletion

- **Removing the extension**: `chrome.storage` data is deleted automatically.
- **Media / log data**: You can clear site data in your browser settings, or delete items individually from the issue list inside the extension.
- **After a regular issue is submitted successfully**: The local draft body, page/style information, and image, video, log, and attachment blobs are deleted automatically; only submission metadata and the issue URL remain. Slack submissions preserve their source data so they can later be promoted to a tracker, and that data is removed after promotion or issue deletion.
- **Disconnecting a platform**: Disconnecting on each platform's (Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack) integration tab deletes the stored credentials.
- **Deleting an LLM provider**: Disconnecting the provider in settings deletes the stored settings.

## 6. Permissions Notice

### Extension Permissions

| Permission | Purpose |
|---|---|
| sidePanel | Displaying the side panel UI |
| activeTab | Collecting DOM element information from the current tab, and capturing the screen or the full page (including scrolling the page during capture) |
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
- **Screen / full-page capture and 30-second replay**: Current-tab screen capture (`captureVisibleTab`) does not work with ordinary host permissions and requires `<all_urls>`. Full-page capture calls the same API repeatedly while scrolling the page, stitching in the areas that were off-screen. Capture and log collection continue even when you navigate to another site, without the side panel closing.
- **Console / network log collection**: Recording logs on arbitrary pages (and iframes)
- **AI draft / AI styling / reproduction-step auto-fill**: Transmitting to the LLM provider endpoint you configure yourself (AI draft and AI styling when you explicitly run them; reproduction-step auto-fill automatically upon entering the drafting screen after a video capture — on by default, can be turned off in settings)
- **GitLab self-managed**: PAT communication with the instance (an arbitrary origin) you enter
- **Style value enrichment**: To accurately display the "author-specified" styles of a selected element, the extension reads, in the background and without credentials (`credentials:omit`), the external stylesheets (cross-origin CSS files) the page references. Only public http(s) hosts are targeted (loopback, internal networks, and private IPs are blocked), and the CSS received is used only on the device and not transmitted to third parties.

Most features transmit data only when you turn them on or run them yourself (reproduction-step auto-fill is an exception: it is on by default and runs automatically, and can be turned off in settings). The permission itself is granted at all times from install, but you can narrow the access scope in Chrome settings (Extensions > BugShot > Site access).

## 7. Changes

If this policy changes, we will provide notice through this page.

## 8. Contact

Privacy inquiries: ox501501@gmail.com
