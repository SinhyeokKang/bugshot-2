# Live Logs

The **Debug** tab has Console and Network sub-tabs, so you can watch the logs happening on the current page right inside the side panel. Logs are collected on their own in real time, so there's no need to refresh.

Both Console and Network also capture logs coming from **other origins embedded in the page** (iframes — say a payment widget or an embed). When logs from several origins are mixed in, an **origin filter** appears above the list. Click an origin button to see only its logs, and click it again to go back to everything (no selection means all). Logs without a clear origin are grouped under **(unknown)**. Handy when you want to see only the logs from the page you're actually on.

## Console

Collects the page's console output and errors.

- **Filter / search** — Filter by level or find by keyword.
- **Detail** — Expand an entry to see the full contents.
- **Clear Log** — Empty the collected logs.

![Console sub-tab](../assets/logs-live-1.jpg)

## Network

See the network requests made by the page.

- **Filter / search** — Filter or find a request.
- **Detail** — Expand to see request and response contents.
- **Copy as cURL** — Copy a request as a cURL command to reproduce it in your terminal.
- **Clear Log** — Empty the collected logs.

![Network sub-tab](../assets/logs-live-2.jpg)

## File an issue from logs alone (freeform)

You can also **file an issue with logs only**, no capture (element, screenshot, or video). While viewing the console or network, click **Write issue** to skip the capture step and go straight to the issue draft. Attach the console and network logs and submit.

> The issue flow (title, body, preview, submit) is the same as the other modes. See the common steps in [Write an Issue (screenshot)](../screenshot/issue.md).

![Filing a logs-only issue](../assets/logs-live-3.jpg)

---

🌐 [한국어](https://bugshot.gitbook.io/ko/logs/live)
