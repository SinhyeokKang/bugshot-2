# BugShot

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
4. **Capture** — in the *Debug* tab, pick a mode: edit element style, capture an element, capture an area, or record the screen.
5. **Submit** — the environment fills itself in; add a title, review the preview, and submit. A link to the created issue pops right up.

Full walkthrough in the [Quick Start guide](https://bugshot.gitbook.io/en/readme/quick-start).

## Features

### 🎨 Styling

Fix the bug visually before you even describe it.

- **Element picker** — hover to highlight, click to select any DOM element on the page. Works on nested and deeply styled elements.
- **Live CSS editing** — edit layout, spacing, sizing, color, typography, borders, and more through structured fields. Changes apply to the live page instantly, so you can dial in the exact fix and see it in place.
- **Design token awareness** — resolves `var()` chains and shows the token name (e.g. `--color-primary`) instead of the raw computed value, so the report speaks your design system's language.
- **Before/after diff** — every change is tracked and rendered as a before → after table in the issue, so developers see exactly which properties to change. Edits across multiple elements are stacked and preserved until you submit.

### 📸 Capture

Grab exactly what's on screen and mark it up.

- **Element capture** — click an element to crop just that element as a clean screenshot; its DOM selector is added to the issue environment automatically.
- **Area capture** — drag any region of the screen to capture a precise slice.
- **Annotation** — mark up the shot with arrows, text, shapes, and highlights before attaching it.

### 🎬 Recording

When a still image isn't enough, record the behavior.

- **Tab recording** — record the current tab, up to 60 seconds, encoded to MP4.
- **Screen recording** — record any window or the full screen via the system picker, up to 60 seconds.
- **30s Replay** — an opt-in, always-on buffer that keeps the **last 30 seconds** as MP4. It looks back across page navigations, so you can catch the bug even *after* spotting it — no need to hit record beforehand. After capture, **trim** the clip to keep only the bug moment — the attached logs are narrowed to the same range.

### 📋 Logs

Reproduction context, collected for you in the background.

- **Network & console logs** — captured automatically while a capture is active and attached to the issue. Includes **WebSocket frames** and logs from **cross-origin iframes** (payment widgets, embeds), all filterable by origin.
- **Action log** — clicks, text input, navigations, keyboard shortcuts, checkbox/radio toggles, dropdown selections, and drag & drop recorded as step-by-step reproduction. Sensitive field values are masked.
- **Log viewer** — a standalone `logs.html` report with a **video-synced timeline**: click any console/network/action entry to jump to that exact moment in the recording.

### 🤖 AI

- **AI draft & styling** — BYOK (Bring Your Own Key) with OpenAI, Anthropic, Gemini, and more; falls back to Chrome Built-in AI when no key is set. Drafts the title and body from your capture (styles, screenshot, or log summary) in one go.

### 🔗 Integrations

Connect via OAuth or a token. Every **tracker** supports project/label/assignee
selection and attachment upload. **Slack** is a messenger rather than a tracker —
it sends to a channel or DM instead.

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
- **Local download** — save the captured screenshot/video and the `logs.html` report
- **i18n** — Korean / English

## Development

```bash
pnpm install
pnpm dev          # dev server (HMR via @crxjs/vite-plugin)
pnpm build        # production build → dist/
pnpm build:store  # store upload build (strips manifest key)
pnpm typecheck    # type check only
pnpm test         # unit tests (Vitest)
pnpm test:watch   # unit tests in watch mode
pnpm build:e2e    # e2e-only build → dist-e2e/ (test fixture — never load/upload)
pnpm test:e2e     # Playwright e2e suite (run build:e2e first)
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

BugShot stores your data locally and sends issue content only to the tracker you
choose. See the [Privacy Policy](https://sinhyeokkang.github.io/bugshot-2/privacy).
