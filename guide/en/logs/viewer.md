# Log Viewer

This page is from the angle of the **developer who receives and works the bug**. Issues filed with BugShot may carry a log report file (`logs.html`). Open it and you can view the video and the logs lined up by time on one screen. If the issue was filed in screenshot mode, the captured screenshot shows on the left instead of a video — it's static, with no playback or timeline, so you can glance at "what the screen looked like" while reading the logs.

## How to open it

Download the `logs.html` attached to the issue and open it in a browser. It's a single HTML file, so it opens right away with nothing to install — easy.

![Log viewer screen](../assets/logs-viewer-1.jpg)

## Timeline markers

The screen has a timeline alongside the video, with logs plotted on it as markers. There are three kinds.

- **Console** — Console output and errors.
- **Network** — Network requests.
- **Action** — User actions like clicks, input, and navigation. (Navigation shows up as a kind of action marker.)

![Timeline markers](../assets/logs-viewer-2.jpg)

## Video and logs in sync

- Play the video and follow the logs at that point in time.
- **Click a marker and the video jumps to that moment** — see "what the screen looked like when this error fired" right away.
- Logs and video share one time axis, making it easy to follow the repro from start to finish.

![Jump to a moment by clicking a marker](../assets/logs-viewer-3.jpg)

---

🌐 [한국어](https://bugshot.gitbook.io/ko/logs/viewer)
