# Custom Webhook contract

BugShot's **Custom Webhook** integration POSTs bug reports directly to a server you specify. Reports never pass through a BugShot server. This document is for developers building the receiving server.

Choose one of two formats under **Format** in the integration settings.

| | Multipart | JSON template |
|---|---|---|
| Request | One `multipart/form-data` POST | One `application/json` POST |
| Captured media | Included as file parts | **Not sent** |
| Success | 2xx **and** a `{key, url}` response | Any 2xx |
| Response body | Read and validated against the contract | **Not read** (204 is valid) |
| BugShot issue list | An entry is recorded | **No entry is recorded** |

---

## 1. Authentication

When a secret is configured, every request includes:

```
Authorization: Bearer <secret>
```

**This is not a signature.** The receiver can validate it by comparing the header value:

```js
if (req.headers.authorization !== `Bearer ${process.env.BUGSHOT_SECRET}`) {
  res.writeHead(401).end();
  return;
}
```

BugShot does not use HMAC signing. Requests originate in the user's browser and go directly to the endpoint they choose, without an intermediary server. In this model, the same user would hold both the bearer secret and a signing key; a signature would not establish a separate sender identity.

The secret is stored in plaintext in `chrome.storage.local`, alongside the other eight platforms' tokens. Anyone with access to the extension's settings can read it. Scope the secret's permissions accordingly.

**An explicit `Authorization` header in Advanced settings takes precedence.** If one is present, the Secret field is ignored.

### Headers the browser cannot send

The following custom header names are **rejected when saving** because the browser's `fetch` implementation can silently drop them:

```
accept-charset · accept-encoding · access-control-request-headers
access-control-request-method · connection · content-length · cookie · cookie2
date · dnt · expect · host · keep-alive · origin · referer · set-cookie
te · trailer · transfer-encoding · upgrade · via
```

Names beginning with `Proxy-` or `Sec-` are also rejected. Names must be valid RFC 7230 tokens, and duplicate names are rejected case-insensitively.

---

## 2. Multipart mode

### Parts

| Part name | Content |
|---|---|
| `payload` | The JSON string described below |
| *(filename)* | A captured file; its part name is its filename |

File parts use names such as `screenshot-1.webp`, `replay.mp4`, and `logs.html`. The exact names depend on the report. **Read `payload.media[].part` instead of hardcoding part names.**

BugShot lets the browser set `Content-Type` with the correct boundary. A custom `Content-Type` header is removed in multipart mode, because sending it without a boundary would prevent the receiver from parsing the request.

### `payload` schema

```jsonc
{
  "title": "Save button does nothing on the settings page",
  // Markdown; media references use cid:<part name> (see below).
  "body": "## Steps\n1. ...\n\n![screenshot-1.webp](cid:screenshot-1.webp)",
  "environment": [
    // Derived rows first, then user-added and automatically added rows.
    // These share their source with the body's reproduction environment section.
    { "label": "OS", "value": "macOS 15.2" },
    { "label": "Browser", "value": "Chrome 140" },
    { "label": "Page", "value": "https://example.com/settings" },
    { "label": "DOM", "value": "#settings-form > button.save" }, // Only when an element is selected.
    { "label": "Viewport", "value": "1440×900" },
    { "label": "Captured", "value": "Jan 1, 2026, 9:00:00 AM GMT+9" },
    { "label": "API Hosts", "value": "api.example.com" }
  ],
  "logSummary": "console 3 · network 1 · action 12", // Omitted when no logs are included.
  "media": [
    {
      "part": "screenshot-1.webp",     // Multipart part name.
      "filename": "screenshot-1.webp", // Display name; attachments retain their original name.
      "contentType": "image/webp",
      "kind": "image"                 // image | video | logs | attachment | inline
    }
  ],
  "bugshot": {
    "version": "1.7.42",
    "sentAt": 1767225600000,
    "idempotencyKey": "3f0c…"          // See section 4.
  }
}
```

`title`, `body`, `environment`, `media`, and `bugshot` are always present. `logSummary` is omitted when the report includes no logs.

Derived `environment` labels are fixed strings: `OS`, `Browser`, `Page`, `DOM`, `Viewport`, and `Captured`. Value formatting, including dates, and labels in subsequent custom rows follow the user's **issue body language**. **Look up rows by label rather than position.** Reports without a selected element omit `DOM`; reports without viewport information omit `Viewport`.

`logSummary` is a **single-line count summary**, not prose. It joins the included `console`, `network`, and `action` counts with ` · `. The body's log summary section contains the human-readable description.

### `cid:` references

Images and links in the body do not have hosted URLs yet: uploading files and creating the issue happen in the same request. The body therefore uses `cid:<part name>`. **The receiver must store the files and replace these references with its own URLs.**

```js
let body = payload.body;
for (const m of payload.media) {
  body = body.split(`cid:${m.part}`).join(savedUrlOf(m.part));
}
```

Without this replacement, the report text remains readable, but its media links will not resolve.

### Required response

```json
{ "key": "BUG-128", "url": "https://tracker.example.com/BUG-128" }
```

**Both fields are required.** If either is missing, BugShot treats submission as **failed and retains the original report** rather than recording an issue without a usable link. Returning 2xx with an empty body will appear to the user as a failed submission even if the server stored the report.

A few field aliases are accepted to support receivers that proxy an existing tracker API:

- `key`: `key`, `id`, `number`, or `iid`. Numeric values are converted to strings.
- `url`: `url`, `html_url`, `web_url`, or `link`. The value must be a string.

---

## 3. JSON template mode

Use this mode for **third-party hooks with a predefined schema**, such as Slack or Discord. Your template defines the request body.

```json
{ "text": "🐛 {{title}}\n{{url}}\n\n{{body}}" }
```

- The template must be **valid JSON** and is validated when saving.
- `{{...}}` substitution happens **only inside string values**. When a whole string consists of one placeholder, its value retains its type (`"{{media.count}}"` becomes `2`).
- **Captured media is not sent.** Embedding it would require base64, and video would typically exceed the body size limit.
- **The response body is not read.** Any 2xx succeeds, and **no entry is recorded in BugShot's issue list**.

### Available variables

| Path | Value |
|---|---|
| `{{title}}` | Report title |
| `{{body}}` | Markdown body. Media is replaced with a notice that it could not be embedded; the log summary retains only counts and does not refer to `logs.html`, since that file is not sent. |
| `{{url}}` | URL of the page where the bug occurred |
| `{{capturedAt}}` | Capture time in ISO 8601 format |
| `{{logSummary}}` | Single-line log summary |
| `{{env.os}}` `{{env.browser}}` `{{env.viewport}}` `{{env.selector}}` | Reproduction environment |
| `{{sections.<id>}}` | An individual body section |
| `{{media.count}}` | Number of captured files in the report — **these files are not sent in this mode** |
| `{{media.0.filename}}` `{{media.0.contentType}}` | Metadata for the file at index N. This describes what was captured, without sending the file. Referencing a nonexistent index causes submission to fail. |

Unlisted variable names are **rejected when saving**, so you can correct them before submitting a report.

---

## 4. Idempotency and duplicates

`payload.bugshot.idempotencyKey` identifies **one report**. Sending the same report again sends the same value. It is the issue record's ID, generated with `crypto.randomUUID`.

If a request times out or the extension's service worker stops during delivery, **BugShot cannot know whether the server received it**. A user retry can therefore deliver the same report twice.

```js
const seen = new Set(); // Use persistent storage in production.
const key = payload.bugshot.idempotencyKey;
if (seen.has(key)) return res.writeHead(200).end(JSON.stringify(prior[key]));
seen.add(key);
```

For a duplicate request, return **the same `{key, url}` as the first response**, rather than an error.

JSON template mode does not send an idempotency key or expose one as a template variable. Retrying after a timeout can create duplicates, so check whether the request arrived first. Multipart receivers must also implement deduplication using the key; the extension does not guarantee duplicate prevention.

---

## 5. Connection tests

In **multipart mode**, **Test connection** sends a small probe **instead of a report**:

```
POST <endpoint>
Content-Type: application/json
X-BugShot-Test: 1

{"bugshot":{"test":true,"sentAt":1767225600000}}
```

When `X-BugShot-Test: 1` is present, **return any 2xx without storing a report**. The probe has no `payload` or file parts. Its timeout is 8 seconds, compared with 30 seconds for a submission.

In **JSON template mode**, the button becomes **Send sample**. It fills the currently edited template with fixed sample data and POSTs the result. BugShot does not automatically add `X-BugShot-Test`. Because this uses the same JSON format as a real submission, **it can create a real message at the destination**. It uses no current capture data or media; the body matches the on-screen preview. Any 2xx succeeds. The timeout is 8 seconds and the body limit is 25MB, as for submissions. A timeout does not mean the sample failed to arrive; check before retrying.

---

## 6. Limits and rejection rules

| Rule | Behavior |
|---|---|
| Request timeout | 30 seconds; 8 seconds for connection tests and samples |
| Body size | 25MB; larger requests are rejected **before sending** |
| Redirects | **Not followed.** A 3xx is treated as a failure to prevent forwarding `Authorization` to another host. Configure the final endpoint URL directly. |
| Cookies | Not sent (`credentials: "omit"`) |
| Endpoint | `https` only, except that `http` is allowed for private destinations: loopback, RFC1918, link-local, IPv6 ULA, single-label hostnames, `.local`, and `.internal`. The settings form warns when using plaintext HTTP. |
| Error body | BugShot reads at most the first 8KB, removes control and directional characters, collapses whitespace, and appends the first 200 characters to the failure message as the receiver's response. Reflected **request header values and endpoint URL components** (the full path, query, and path segments of at least 20 characters) are masked with `***`, including tokens embedded in Slack or Discord endpoint paths. |

---

## 7. Reference receiver

This minimal example has no dependencies. Run it with `node server.mjs` and configure `http://localhost:8787/bugshot` as the endpoint. Plaintext HTTP is allowed for this local address.

```js
import { createServer } from "node:http";

const SECRET = process.env.BUGSHOT_SECRET ?? "dev-secret";
const seen = new Map(); // idempotencyKey → previous response. Use persistent storage in production.

createServer((req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  };
  if (req.headers.authorization !== `Bearer ${SECRET}`) return reply(401, { error: "unauthorized" });
  if (req.headers["x-bugshot-test"] === "1") return reply(200, { ok: true });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("binary");
    const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "")?.[1];
    if (!boundary) return reply(415, { error: "expected multipart" });

    // Extract only payload. Locate file parts by payload.media[].part to store them separately.
    const part = raw.split(`--${boundary}`).find((p) => p.includes('name="payload"'));
    const payloadText = part.slice(part.indexOf("\r\n\r\n") + 4).trim();
    const payload = JSON.parse(Buffer.from(payloadText, "binary").toString("utf8"));

    const key = payload.bugshot.idempotencyKey;
    if (seen.has(key)) return reply(200, seen.get(key)); // Return the original response for duplicates.
    const result = { key: `BUG-${seen.size + 1}`, url: `http://localhost:8787/r/${key}` };
    seen.set(key, result);

    console.log(payload.title, "·", payload.media.map((m) => m.part).join(", "));
    reply(201, result); // BugShot treats a response without {key, url} as a failure.
  });
}).listen(8787);
```

Use a multipart parser such as `busboy` to store the actual file parts. The string splitting above is only intended for the text `payload` part.
