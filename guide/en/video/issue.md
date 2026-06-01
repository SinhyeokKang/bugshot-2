# Write an Issue (recording mode)

When recording finishes, the issue draft opens. Just fill it in top to bottom and submit. Recording mode is the one that bundles **the richest logs alongside the video**.

## 1. Title

Your configured title prefix (e.g. `[QA] `) is pre-filled. Type the rest of the title after it.

## 2. Environment

OS, browser, page URL, viewport size, and capture time fill in **on their own** (read-only). Want to add more context? Just drop in a variable row yourself.

![Environment](../assets/dummy.jpg)

## 3. Media — video

The media in recording mode is the **video**. The clip you just recorded (or pulled in via 30s replay) is attached to the issue.

![Video attached](../assets/dummy.jpg)

## 4. Body sections

Sections appear per your body composition — Description, Steps to reproduce, Expected result, Notes (only the ones you've turned on). Steps to reproduce is an ordered list.

**AI Draft** — With an AI connected, a "Let AI write your draft" banner appears. AI fills the body sections for you, based on a summary of the console, network, and action logs. Without an AI connected, the banner doesn't appear.

> AI slips up now and then, so give the generated body a quick look. See [AI LLM Connection](../settings/ai.md) for how to connect.

![Writing the body](../assets/dummy.jpg)

## 5. Log attachments — recording-mode policy

On top of the video, recording mode bundles three kinds of logs. **All three toggles are on by default**, so they're captured richly without you lifting a finger.

- **Console logs** — Console output and errors during the recording.
- **Network logs** — Network requests made during the recording.
- **Action logs** — A record of user actions like clicks, input, and navigation. **Action logs are only captured in recording mode.**

The video timeline and the logs are linked by time, so the reader can walk through "what happened at this moment" in the [Log Viewer](../logs/viewer.md).

![Recording-mode log policy](../assets/dummy.jpg)

## 6. Preview

Give the body a look in the preview before submitting. **Copy markdown** copies it as-is to paste elsewhere.

## 7. Submit

Fill in the connected platform's fields (project, assignee, labels, etc.) and hit **Submit issue**. A link to the created issue appears when it's done.

![Issue submitted](../assets/dummy.jpg)

---

🌐 [한국어](https://bugshot.gitbook.io/bugshot/)
