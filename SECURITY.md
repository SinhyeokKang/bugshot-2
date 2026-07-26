# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** BugShot runs with
broad host permissions and handles OAuth tokens and capture data, so a public
report exposes users before a fix can ship.

Two private channels:

- **[Report a vulnerability](https://github.com/SinhyeokKang/bugshot-2/security/advisories/new)** — GitHub's private advisory form (preferred)
- **ox501501@gmail.com** — if you'd rather use email

Whatever detail you can give helps: what you did, what happened, and what an
attacker gets out of it. A proof of concept is welcome but not required.

## What's supported

BugShot auto-updates through the Chrome Web Store, so the current store release
is the only version that receives fixes. There are no maintained older branches.

## Scope

In scope — anything that lets a page or a third party reach data it shouldn't:

- escaping the extension's isolation from page context, or the reverse
- reading or exfiltrating OAuth tokens, API keys, or capture data
- getting the background worker to fetch or send somewhere it shouldn't
  (the stylesheet fetch path in [`src/lib/ssrf-guard.ts`](src/lib/ssrf-guard.ts)
  is the obvious surface)
- defeating the masking applied to logs and recorded actions

Known and already documented, so no need to report:

- the iframe registration token is a correlation hint, not authentication — a
  hostile parent page can read it, since the child broadcasts it
- the SSRF guard filters hostnames statically and cannot stop a domain that
  resolves to an internal address, because `fetch` re-resolves DNS

## Expectations

This is a solo project. Reports get read and answered on a best-effort basis —
no SLA, but I'd rather hear about it than not.
