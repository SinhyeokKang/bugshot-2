# Write an Issue (screenshot mode)

🌐 [한국어](https://bugshot.gitbook.io/ko/screenshot/issue)

When you finish annotating and click **Done**, the issue draft opens. Just fill it in top to bottom.

## 1. Title

Your configured title prefix (e.g. `[QA] `) is pre-filled. Type the rest of the title after it.

## 2. Environment

OS, browser, page URL, viewport size, and capture time fill in **on their own** (read-only). Want to add more context? Just drop in a variable row yourself.

![Environment](../assets/screenshot-issue-1.jpg)

## 3. Media — annotated screenshot

The media in screenshot mode is the **annotated screenshot**. The image you marked up with arrows and boxes is attached to the issue as-is. The **Download** button on the right of the Media section also lets you save this screenshot as an image file.

![Annotated screenshot attached](../assets/screenshot-issue-2.jpg)

## 4. Body sections

Sections appear per your body composition — Description, Steps to reproduce, Expected result, Notes (only the ones you've turned on). Steps to reproduce is an ordered list. Fill them in by hand, or let AI Draft below do it in one shot.

![Writing the body](../assets/screenshot-issue-3.jpg)

## ✨ AI Draft

If filling in each line by hand feels tedious, this is where AI earns its keep. With an AI connected, a purple **"Let AI write your draft"** banner shows up right below the body sections.

Click **AI Draft** on the right and a small input box opens. Describe the bug in a line or two, hit **Generate**, and AI fills in **both the title and the body sections** at once. Only the sections you've turned on get filled, and your title prefix stays put. If you've already jotted down a title or body, AI takes that in as context too — and any images you placed in the body stay put, with only the text refreshed.

In screenshot mode, AI reads the **annotated screenshot** you attached. A one-line description helps it pin down what's wrong on screen and reflect it in the draft.

> AI slips up now and then, so give the generated draft a quick look. The banner only shows when an AI is connected — see [AI LLM Connection](../settings/ai.md) for how.

![AI Draft banner and input box](../assets/screenshot-issue-4.jpg)

## 5. Log attachments

Screenshot mode can attach console and network logs. Both toggles are **on by default**, so they're included without any extra steps — turn one off if you don't need it.

The **Download** button on the right of the Log attachments section lets you grab the same log report (`logs.html`) that gets attached to the issue — right here, before you even submit.

> See [Live Logs](../logs/live.md) for how to read and work with logs.

## 6. Preview

Give the body a look in the preview before submitting. **Copy markdown** copies it as-is to paste elsewhere.

![Issue preview](../assets/screenshot-issue-5.jpg)

## 7. Submit

Fill in the connected platform's fields (project, assignee, labels, etc.) and hit **Submit issue**. A link to the created issue appears when it's done.

At the bottom of the fields sits a **CC** field. Pick the folks who should be in the loop on this bug (reviewers, designers, PMs) and they land as a `cc @name` mention at the bottom of the created issue, each getting a notification on the platform. Select several at once and search by name to find them fast. Whoever you pick is pre-filled on your next issue too, so you don't have to reselect every time.

> CC unlocks once you've picked the parent item first — repo, team, project, or workspace. Notion is the one exception: its connected integration needs the "read user information" permission to load the member list, so if it comes up empty, reconnect Notion in Settings.

![Issue submitted](../assets/screenshot-issue-6.jpg)
