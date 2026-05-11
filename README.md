# BugShot

A Chrome extension for design QA. Pick elements, tweak CSS, and file issues to Jira, GitHub, Linear, or Notion — all from a side panel.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ohakhekagkodklkickemonmifdcbhmig)](https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig)

## Features

- **Element picker** — select any DOM element, inspect and edit CSS in real time
- **Design token awareness** — resolves `var()` chains and displays token names instead of computed values
- **Before/after diff** — auto-generated comparison table of style changes
- **Screenshot & annotation** — area crop with arrows, text, shapes, and highlights
- **Screen recording** — record the current tab for up to 60 seconds
- **Network & console logs** — auto-capture and attach to issues
- **AI draft & styling** — BYOK (Bring Your Own Key) with OpenAI, Anthropic, Gemini, and more; falls back to Chrome Built-in AI
- **Jira integration** — OAuth 3LO / API Token, project metadata, auto-upload attachments
- **GitHub integration** — OAuth Web Flow / PAT, repo/labels/assignees, file upload
- **Linear integration** — OAuth PKCE / API Key, team/project/labels/priority, GraphQL API
- **Notion integration** — OAuth / Internal Token, database picker, status & select properties, file uploads
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

## Architecture

See [CLAUDE.md](./CLAUDE.md) for detailed architecture, conventions, and directory structure.

## Privacy Policy

[Privacy Policy](https://sinhyeokkang.github.io/bugshot-2/privacy)
