# Contributing

Thanks for looking. BugShot is a solo project, so the fastest way to get a change
in is to keep it small and say what problem it solves.

Found a security problem? Don't open an issue — see [SECURITY.md](SECURITY.md).

## Before you write code

For a bug fix that's obviously a bug, just send the PR. For anything else — a new
feature, a new platform integration, a refactor that moves files around — open an
issue first so we don't both spend an evening on incompatible ideas.

## Setup

The Node version in `.nvmrc` and pnpm (the version is pinned in `package.json`'s
`packageManager` field, so `corepack enable` picks it up for you).

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

CI runs those plus `pnpm sync:agents:check` and `pnpm check:prearm`, on the Node
version in `.nvmrc` — worth matching locally, since that is the version the gate
actually judges you on.

Tests live in a `__tests__/` directory next to the code they cover, and there are
two tracks: `*.test.ts` runs in Node and is for pure functions and helpers,
`*.test.tsx` runs in jsdom with Testing Library and is for components and
anything that needs a real DOM. Logic changes should come with a test.

The Playwright suite (`pnpm test:e2e`) is headed-only — the extension's service
worker doesn't wake up in headless Chrome — but CI runs it anyway under `xvfb`,
split across four sharded runners. It needs no secrets: the build reads a
committed dummy `.env.ci`, so it works on pull requests from forks too. The
aggregated result lands as the `e2e-gate` check, which is required to merge.
You don't need to run it locally, though you can (`pnpm build:e2e` first).

## Adding a language

Open an issue first to coordinate the language and scope. A draft PR is welcome
if you want feedback on terminology before finishing the translations.

The interface language, issue body language, and AI writing language are separate
settings. A new UI locale also becomes an issue body language: it translates fixed
headings and labels, not the user's text. AI writing languages have their own
presets; Japanese is already one of them.

### Files to update

Use an existing locale such as `fr` as a structural reference:

| File | Change |
| --- | --- |
| `src/i18n/namespaces/*.ts` | Add a dictionary for the language to every namespace, using `satisfies Bundle`, and include it in each namespace's exported object. |
| `src/i18n/<code>.ts` | Combine the namespace dictionaries and check the result with `satisfies TranslationMap`, following `src/i18n/fr.ts`. |
| `src/i18n/locales.ts` | Add the code to `LOCALES` and its date-formatting tag to `BCP47` (for example, `ja` and `ja-JP`). Keep this module free of runtime imports. |
| `src/i18n/index.ts` | Import the combined dictionary and register it in `locales`. |
| `src/sidepanel/lib/localeLabels.ts` | Add the language's own name to `LOCALE_LABELS`, such as `日本語`. |
| `src/sidepanel/lib/aiLanguage.ts` | Add the locale's mapping to `LOCALE_AI_PRESET`, using the existing preset when available (for example, `ja: "Japanese"`). Discuss a missing preset in the issue. |
| `src/log-viewer/i18n.ts` | Add the standalone log viewer dictionary and register it in `DICTS`. Shared keys must have exactly the same translations as the main dictionaries. |
| `public/_locales/<code>/messages.json` | Add Chrome extension metadata, following an existing locale's keys and message structure. |

The Korean dictionaries define the key set; English can serve as a wording
reference. Translate values only, preserving keys, interpolation tokens such as
`{n}` and `{target}`, and any markup or links. Keep terminology consistent across
screens. Familiar developer terms such as “Backlog” and “Todo” can stay in English
where that reads naturally. Keep button and tab labels short enough for a narrow
side panel.

### Tests and verification

Add cases for browser language detection (including a regional tag), stored locale
normalization, issue body language resolution, and the AI preset mapping. The
existing parity tests automatically check every registered locale for missing
keys, empty values, and interpolation tokens. They also check log viewer wording
against the main dictionaries and enforce Chrome metadata length limits.

Some fallback tests currently use real, unsupported language codes such as `ja`.
When adding that language, replace those fixtures with a deliberately unsupported
code such as `xx`; keep the fallback assertions and add supported-language cases.

While translating, run the focused checks:

```bash
pnpm typecheck
pnpm test --run src/i18n/__tests__ src/log-viewer/__tests__/i18n.test.ts src/sidepanel/lib/__tests__/localeLabels.test.ts src/sidepanel/lib/__tests__/aiLanguage.test.ts src/sidepanel/lib/__tests__/bodyLocaleIntegration.test.ts
```

`pnpm test` builds the standalone log viewer first, including on a fresh checkout.
Before submitting, also complete the full checks under “Before you push” above.

In the unpacked extension, verify:

- The language appears under its own name in the interface and issue body language
  selectors, and the selection survives reopening the panel.
- Settings, capture controls, report editing, and dialogs read naturally without
  clipped labels in a narrow panel, in both light and dark themes.
- Copying a report with the new issue body language produces translated headings
  while preserving user text, including when the interface uses another language.
- An exported `logs.html` displays the translated report and log controls.
- With a configured AI provider that supports the writing-language setting,
  `Auto` follows the interface language and an explicit choice stays independent.
  Note in the PR if you could not check this; Chrome's compact built-in AI path
  does not expose this setting.

Include the screens you checked and any terminology questions in the PR. A locale
PR does not need to translate the engineering docs or add a new user-guide language.

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
