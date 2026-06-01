# BugShot

A Chrome extension for bug reporting. Pick elements, tweak CSS, and file issues to Jira, GitHub, Linear, Notion, GitLab, or Asana — all from a side panel.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ohakhekagkodklkickemonmifdcbhmig)](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig)

## Features

### Inspect & Edit

- **Element picker** — select any DOM element, inspect and edit CSS in real time
- **Design token awareness** — resolves `var()` chains and displays token names instead of computed values
- **Before/after diff** — auto-generated comparison table of style changes

### Capture

- **Screenshot & annotation** — area crop with arrows, text, shapes, and highlights
- **Screen recording** — record the current tab for up to 60 seconds
- **30s Replay** — opt-in mode that captures the last 30 seconds as MP4, looking back across page navigations (no need to hit record beforehand)

### Auto-logging

- **Network & console logs** — auto-captured in the background and attached to issues
- **Action log** — clicks, inputs, and navigations recorded as reproduction steps (sensitive field values masked)
- **Log viewer** — standalone HTML report with video-synced timeline; click any log entry to jump to that moment in the recording

### AI

- **AI draft & styling** — BYOK (Bring Your Own Key) with OpenAI, Anthropic, Gemini, and more; falls back to Chrome Built-in AI

### Integrations

- **Jira** — OAuth 3LO / API Token, project metadata, auto-upload attachments
- **GitHub** — OAuth / PAT, repo/labels/assignees, file upload
- **Linear** — OAuth PKCE / API Key, team/project/labels/priority
- **Notion** — OAuth / Internal Token, database picker, status & select properties, file uploads
- **GitLab** — OAuth PKCE (gitlab.com) / PAT (self-managed instances), project/labels/assignees, file uploads
- **Asana** — OAuth / PAT, workspace/project/assignee, task attachments

### Export & i18n

- **Markdown copy** — paste into Slack, Confluence, or other tools with tables intact
- **i18n** — Korean / English

## Development

```bash
pnpm install
pnpm dev          # dev server (HMR via @crxjs/vite-plugin)
pnpm build        # production build → dist/
pnpm build:store  # store upload build (strips manifest key)
pnpm typecheck    # type check only
pnpm test         # run tests
pnpm test:watch   # tests in watch mode
```

Load the unpacked extension from `dist/` at `chrome://extensions` (developer mode).

## Stack

| | |
|---|---|
| Runtime | Chrome MV3 — Side Panel + Service Worker + Content Script |
| UI | React 18, TypeScript, Tailwind CSS v3, shadcn/ui |
| State | Zustand + chrome.storage (session / local) |
| Build | Vite + @crxjs/vite-plugin |
| Test | Vitest |

## Privacy Policy

[Privacy Policy](https://sinhyeokkang.github.io/bugshot-2/privacy)
