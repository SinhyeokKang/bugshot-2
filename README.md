# BugShot

**Spot a bug, file a complete report — without leaving the page.**

BugShot is a Chrome side panel extension that turns "this button looks off" into a
ready-to-submit issue. Pick a DOM element, tweak its CSS, capture a screenshot or
video, and BugShot bundles the **environment, before/after styles, screenshots,
video, and console/network logs** into one issue on Jira, GitHub, Linear, Notion,
GitLab, Asana, or ClickUp.

No more switching between DevTools, a screen recorder, and your issue tracker. One panel, one shot.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ohakhekagkodklkickemonmifdcbhmig)](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig)
[![Users](https://img.shields.io/chrome-web-store/users/ohakhekagkodklkickemonmifdcbhmig)](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig)

🌐 [Website](https://bug-shot.com) · 📖 User Guide [English](https://bugshot.gitbook.io/en) / [한국어](https://bugshot.gitbook.io/ko)

![BugShot side panel — Debug, Issues, Integrations, and Settings tabs with capture modes](guide/en/assets/readme-1.jpg)

## Why BugShot

Filing a good bug report is tedious: reproduce it, screenshot it, copy the URL and
browser version, dig through the console, paste it all into the tracker. BugShot
does the busywork for you — capture right where you spot the problem and it ships a
report developers can actually act on.

## Getting Started

1. **Install** from the [Chrome Web Store](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig).
2. **Open the panel** — click the toolbar icon or press `Cmd/Ctrl+Shift+E`.
3. **Connect a tracker** — in the *Integrations* tab, connect at least one of Jira, GitHub, Linear, Notion, GitLab, Asana, or ClickUp.
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

![The style editor — class and layout fields for a selected element](guide/en/assets/element-styling-1.jpg)

### 📸 Capture

Grab exactly what's on screen and mark it up.

- **Element capture** — click an element to crop just that element as a clean screenshot; its DOM selector is added to the issue environment automatically.
- **Area capture** — drag any region of the screen to capture a precise slice.
- **Annotation** — mark up the shot with arrows, text, shapes, and highlights before attaching it.

![Annotating a screenshot with arrows, text, and shapes](guide/en/assets/screenshot-annotation-1.jpg)

### 🎬 Recording

When a still image isn't enough, record the behavior.

- **Tab recording** — record the current tab, up to 60 seconds, encoded to MP4.
- **Screen recording** — record any window or the full screen via the system picker, up to 60 seconds.
- **30s Replay** — an opt-in, always-on buffer that keeps the **last 30 seconds** as MP4. It looks back across page navigations, so you can capture a bug that *already happened* without having hit record beforehand.

![Recording in progress with elapsed time and a stop button](guide/en/assets/video-record-3.jpg)

### 📋 Logs

Reproduction context, collected for you in the background.

- **Network & console logs** — captured automatically while a capture is active and attached to the issue. Includes **WebSocket frames** and logs from **cross-origin iframes** (payment widgets, embeds), all filterable by origin.
- **Action log** — clicks, text input, navigations, keyboard shortcuts, checkbox/radio toggles, and dropdown selections recorded as step-by-step reproduction. Sensitive field values are masked.
- **Log viewer** — a standalone `logs.html` report with a **video-synced timeline**: click any console/network/action entry to jump to that exact moment in the recording.

![The log viewer — video on the left, a synced action timeline on the right](guide/en/assets/logs-viewer-1.jpg)

### 🤖 AI

- **AI draft & styling** — BYOK (Bring Your Own Key) with OpenAI, Anthropic, Gemini, and more; falls back to Chrome Built-in AI when no key is set. Drafts the title and body from your capture (styles, screenshot, or log summary) in one go.

### 🔗 Integrations

Connect via OAuth or a token. Every platform supports project/label/assignee
selection and attachment upload.

| Platform | Auth | Highlights |
|---|---|---|
| **Jira** | OAuth 3LO / API Token | project metadata, auto-upload attachments |
| **GitHub** | OAuth / PAT | repo, labels, assignees, file upload |
| **Linear** | OAuth PKCE / API Key | team, project, labels, priority |
| **Notion** | OAuth / Internal Token | database picker, status & select properties |
| **GitLab** | OAuth PKCE / PAT | gitlab.com + self-managed instances |
| **Asana** | OAuth / PAT | workspace, project, assignee |
| **ClickUp** | OAuth / API Token | workspace → space → list, assignee |

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
</content>
</invoke>
