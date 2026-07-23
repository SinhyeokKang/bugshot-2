# BugShot

![BugShot at a glance — capture and report right where you spot the bug](guide/en/assets/readme-1.jpg)

**Bug reports in one shot.**

Stop explaining bugs in words. BugShot is a Chrome side panel extension that lets
you discover, fix, capture, and report bugs — all without leaving the browser. Pick
an element and tweak its CSS live, capture a screenshot or recording, and file a
complete issue — with the **environment, before/after styles, screenshots, video,
and console/network logs** bundled in — to Jira, GitHub, Linear, Notion, GitLab,
Asana, or ClickUp, or share it straight to a Slack channel or DM.

No sign-up required — just install and go.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ohakhekagkodklkickemonmifdcbhmig)](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig)

## Why BugShot

Filing a good bug report is tedious: reproduce it, screenshot it, copy the URL and
browser version, dig through the console, paste it all into the tracker. BugShot
does the busywork for you — capture right where you spot the problem and it ships a
report developers can actually act on.

## Getting Started

1. **Install** from the [Chrome Web Store](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig).
2. **Open the panel** — click the toolbar icon or press `Cmd/Ctrl+Shift+E`.
3. **Connect a destination** — in the *Integrations* tab, connect at least one of Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, or Slack.
4. **Capture** — in the *Debug* tab, pick a mode: edit element style, capture an element, capture an area (drag, viewport, or full page), or record the screen. You can also start a report from logs alone (no capture) via the console/network log tabs.
5. **Submit** — the environment fills itself in; add a title, review the preview, and submit. A link to the created issue pops right up, and the report is kept in the *Issue list* tab (save it as a draft instead if it isn't ready).

Full walkthrough in the [Quick Start guide](https://bug-shot.com/en/docs/quick-start).

## Features

### 🎨 Styling

Fix the bug visually before you even describe it.

- **Element picker** — hover to highlight, click to select any DOM element on the page. Works on nested and deeply styled elements.
- **DOM tree navigation** — can't reach it by hovering? Browse the live DOM tree in a dialog and pick the node directly, or step to its parent or first child — for wrappers and elements buried under an overlay.
- **Live CSS editing** — edit layout, spacing, sizing, color, typography, borders, and more through structured fields, or switch to a syntax-highlighted CSS code editor — prefilled with the element's current styles (four-side longhands merged into shorthands), with autocomplete and inline color swatches — to edit raw CSS directly (arbitrary properties, `!important`). Changes apply to the live page instantly, so you can dial in the exact fix and see it in place.
- **Class & text editing** — edit an element's class list or visible text live; those changes are tracked alongside its style diff.
- **Design token awareness** — resolves `var()` chains and shows the token name (e.g. `--color-primary`) instead of the raw computed value, so the report speaks your design system's language.
- **Before/after diff** — every change is tracked and rendered as a before → after table in the issue, so developers see exactly which properties to change. Edits across multiple elements are stacked and preserved until you submit.

### 📸 Capture

Grab exactly what's on screen and mark it up.

- **Element capture** — click an element to crop just that element as a clean screenshot; its DOM selector is added to the issue environment automatically.
- **Works inside iframes** — the picker reaches one level into embedded frames, cross-origin ones included.
- **Area capture** — drag any region of the screen to capture a precise slice.
- **Screen capture** — grab the whole visible viewport in one click, no dragging.
- **Full-page capture** — scroll and stitch the entire page into one tall screenshot; fixed and sticky headers are printed once, and very long pages stop at a limit with a notice.
- **Annotation** — mark up the shot with arrows, a freehand pen, text, shapes, and highlights before attaching it. Zoom (fit-to-width up to 400%) and pan the canvas so you can annotate fine detail on a tall full-page shot; the finished image is always attached at its original resolution.
- **Inline evidence** — capture an extra area or paste, drop, or add images directly into a body section, then annotate, restore, or delete them in place.

### 🎬 Recording

When a still image isn't enough, record the behavior.

- **Tab recording** — record the current tab, up to 60 seconds, encoded to MP4 (WebM fallback where MP4 isn't supported).
- **Screen recording** — record any window or the full screen via the system picker, up to 60 seconds.
- **Draw while recording** — a mini toolbar (pen, box, or highlighter; up to 5 colors, fewer on a narrow panel; three thicknesses) lets you mark up the page during tab/screen recording. Freehand strokes fade tail-first in draw order over ~3s; a box fades all at once. Either way it's baked into the video.
- **30s Replay** — an opt-in, always-on buffer that keeps the **last 30 seconds** as MP4. It looks back across page navigations, so you can catch the bug even *after* spotting it — no need to hit record beforehand. After capture, **trim** the clip to keep only the bug moment — the attached logs are narrowed to the same range.

### 📋 Logs

Reproduction context, collected for you in the background.

- **Network & console logs** — captured automatically while the panel is open and attached to the issue. Includes **WebSocket frames** and logs from **cross-origin iframes** (payment widgets, embeds), all filterable by origin.
- **Action log** — clicks, text input, navigations, keyboard shortcuts, checkbox/radio toggles, dropdown selections, and drag & drop recorded as step-by-step reproduction. Sensitive values are masked, both by field label and by value shape (emails, long digit runs); rich-text editor content is never recorded.
- **Add a log to the body** — pick one console or network entry and drop it into the issue body as a code block (JSON pretty-printed and highlighted), right where you're describing the symptom. The attachment only opens after a download; this reads in the issue itself.
- **Log viewer** — a standalone `logs.html` report with a **video-synced timeline**: click any console/network/action entry to jump to that exact moment in the recording. It also carries a **Report tab** (issue body preview + copy as markdown) and per-tab exports (HAR, console/action JSON).

All three logs ride along with every capture except element style editing, and the whole logs.html bundle can be toggled off with one switch before you submit (also toggleable on already-saved issues).

### 🤖 AI

- **AI draft** — BYOK (Bring Your Own Key) with OpenAI, Anthropic, Gemini, and more; falls back to Chrome Built-in AI when no key is set. Drafts the title and body from your capture (styles, screenshot, or log summary) in one go. When the AI cites a relevant error log, the actual console/network entry is inserted into the body as a code block — serialized by the app, so log contents can't be hallucinated.
- **AI styling** — describe the fix in words and the AI writes the CSS onto the selected element, live on the page.
- **Repro auto-fill** — **on by default** once you connect an AI: after a recording, the steps-to-reproduce section is written for you from the action log, which means the action log is sent to that AI. Turn it off under Settings → Issue settings → Other.

### 📥 Issue list & drafts

- **Submitted issues** — every report you've filed stays in the *Issue list* tab with its platform badge, searchable and filterable by submitted/draft. Refresh to pull the current state back from the tracker, or change the status right from the panel and have it written back. Reports shared to Slack can be **promoted to a tracker issue later**, and the original Slack thread gets a reply with the new issue's URL.
- **Drafts** — not ready to file? Save the report as a draft, reopen it later, edit any field, and submit when it's ready.

### 🔗 Integrations

Connect via OAuth or a token. Every **tracker** supports destination selection
and attachment upload. Assignee covers every tracker except Notion; label
selection is GitHub, Linear and GitLab only. **Slack** is a messenger rather than
a tracker — it sends to a channel or DM instead.

Set defaults once in the *Integrations* tab — destination (project, repo, team,
workspace) plus **assignee**, label, and issue type — and every new report comes
pre-filled. Whoever you assigned last still wins over the default, so the common
case stays one click.

| Platform | Auth | Highlights |
|---|---|---|
| **Jira** | OAuth 3LO / API Token | project metadata, auto-upload attachments |
| **GitHub** | OAuth / PAT | repo, labels, assignees, file upload |
| **Linear** | OAuth PKCE / API Key | team, project, labels, priority |
| **Notion** | OAuth / Internal Token | database picker, status & select properties |
| **GitLab** | OAuth PKCE / PAT | gitlab.com + self-managed instances |
| **Asana** | OAuth / PAT | workspace, project, assignee |
| **ClickUp** | OAuth / API Token | workspace → space → list, assignee |
| **Slack** | OAuth (user token) | channel/DM, @mentions, title + threaded details & files |

### 🌐 Export & i18n

- **Markdown copy** — paste into Slack, Confluence, or anywhere with tables intact
- **File attachments** — attach your own files to the report, uploaded natively to the tracker
- **Local download** — save the captured screenshot/video and the `logs.html` report
- **i18n** — Korean / English
- **Report body composition** — toggle which sections (description, steps to reproduce, expected result, notes) go into the issue and **drag them into the order you want**, media and logs included; plus a title prefix
- **Theme** — light / dark / system

## Development

```bash
pnpm install
pnpm dev          # dev server (HMR via @crxjs/vite-plugin)
pnpm build        # production build → dist/ (runs build:log-viewer first)
pnpm build:log-viewer  # log viewer bundle only (build/build:store/build:e2e run it automatically)
pnpm build:store  # store upload build (strips manifest key)
pnpm preview      # preview the production build
pnpm typecheck    # type check only
pnpm test         # unit tests (Vitest)
pnpm test:watch   # unit tests in watch mode
pnpm build:e2e    # e2e-only build → dist-e2e/ (test fixture — never load/upload)
pnpm test:e2e     # Playwright e2e suite (run build:e2e first)
pnpm sync:agents  # regenerate the Codex mirror (AGENTS.md, .agents/skills/)
```

Load the unpacked extension from `dist/` at `chrome://extensions` (developer mode).
The e2e suite lives in `e2e/` — see [`e2e/README.md`](e2e/README.md) for coverage and gotchas.

## Stack

| | |
|---|---|
| Runtime | Chrome MV3 — Side Panel + Service Worker + Content Script |
| UI | React 18, TypeScript, Tailwind CSS v3, shadcn/ui |
| State | Zustand + chrome.storage (session / local) |
| Build | Vite + @crxjs/vite-plugin |
| Test | Vitest (unit) · Playwright (e2e) |

## Privacy

BugShot stores your data locally. Issue submission data goes directly to the
destination you choose; AI features send only the context needed for that request
directly to the AI provider you configure. BugShot servers do not receive capture
or report content. See the [Privacy Policy](https://bug-shot.com/en/privacy).
