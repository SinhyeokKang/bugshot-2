# Contributing

Thanks for looking. BugShot is a solo project, so the fastest way to get a change
in is to keep it small and say what problem it solves.

Found a security problem? Don't open an issue — see [SECURITY.md](SECURITY.md).

## Before you write code

For a bug fix that's obviously a bug, just send the PR. For anything else — a new
feature, a new platform integration, a refactor that moves files around — open an
issue first so we don't both spend an evening on incompatible ideas.

## Setup

Node 22 and pnpm (the version is pinned in `package.json`'s `packageManager`
field, so `corepack enable` picks it up for you).

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev                     # or: pnpm build
```

Then load `dist/` as an unpacked extension at `chrome://extensions` with
developer mode on. Every key in `.env.example` is optional: without OAuth client
IDs the OAuth buttons hide themselves and you connect platforms with a personal
access token instead, and without a PostHog key analytics is a no-op.

## Branch off `main`, not `dev`

**Open your PR against `main`.** `dev` is my working branch — after every release
it gets `git reset --hard origin/main` and a force push, so anything based on it
will vanish.

## Before you push

```bash
pnpm typecheck
pnpm test
pnpm build
```

CI runs those plus `pnpm sync:agents:check` and `pnpm check:prearm`.

Tests live in a `__tests__/` directory next to the code they cover, and there are
two tracks: `*.test.ts` runs in Node and is for pure functions and helpers,
`*.test.tsx` runs in jsdom with Testing Library and is for components and
anything that needs a real DOM. Logic changes should come with a test.

The Playwright suite (`pnpm test:e2e`) is headed-only — the extension's service
worker doesn't wake up in headless Chrome — but CI runs it anyway under `xvfb`,
split across four sharded runners. It needs no secrets: the build reads a
committed dummy `.env.ci`, so it works on pull requests from forks too. You
don't need to run it locally, though you can (`pnpm build:e2e` first).

## Generated files

`AGENTS.md` and `.agents/skills/` are generated from `CLAUDE.md` and
`.claude/commands/`. Don't edit them by hand; edit the source and run
`pnpm sync:agents`. CI fails if they drift.

## Dependencies

Adding one may surprise you. `pnpm-workspace.yaml` sets `minimumReleaseAge` to 24
hours, so a version published today won't resolve, and lifecycle scripts are
blocked unless the package is on the `onlyBuiltDependencies` allowlist. Both are
supply-chain guards. Prefer not adding a dependency at all — most of what this
project needs is already in the tree.

## What won't be merged

The privacy architecture isn't a feature, it's the point. Capture data —
screenshots, recordings, console/network/action logs, CSS diffs, report bodies —
goes from the browser straight to the destination the user connected, and it
never passes through a server I run. Changes that add a capture backend, a hosted
workspace, or a BugShot account are out of scope, however convenient they'd be.

Related: if your change adds a new capture, collection, storage, or transmission
behavior, update **both** `docs/privacy.ko.md` and `docs/privacy.en.md`. That
applies even when `manifest.config.ts` doesn't change — reusing an existing
permission for a new purpose still needs disclosure.

## Language

Code comments and the engineering docs under `docs/` are written in Korean; it's
a one-person project and that's the language it was thought in. Commit messages
and PR titles are English. Issues and PR descriptions are fine in either.

## License

By contributing you agree that your work is licensed under the
[MIT License](LICENSE).
