# Write an Issue (recording mode)

When recording finishes, the issue draft opens. Just fill it in top to bottom and submit. Recording mode is the one that bundles **the richest logs alongside the video**.

## 1. Title

Your configured title prefix (e.g. `[QA] `) is pre-filled. Type the rest of the title after it.

## 2. Environment

![Environment](../assets/video-issue-1.jpg)

OS, browser, page URL, viewport size, and capture time fill in **on their own** (read-only). Want to add more context? Just drop in a variable row yourself.

## 3. Media — video

![Video attached](../assets/video-issue-2.jpg)

The media in recording mode is the **video**. The clip you just recorded (or pulled in via 30s replay) is attached to the issue. The **Download** button on the right of the Media section also lets you save this video as a file.

## 4. Body sections

![Writing the body](../assets/video-issue-3.jpg)

Sections appear per your body composition — Description, Steps to reproduce, Expected result, Notes (only the ones you've turned on). Steps to reproduce is an ordered list. Fill them in by hand, or let AI Draft below do it in one shot.

**Steps to reproduce fills itself in.** The moment you land here after recording, AI reads the action log it just captured and **writes the reproduction steps for you automatically** (only when an AI model is connected — with no AI available, it's left empty). While it's working, an overlay covers the screen for a moment, and the filled-in steps appear when it's done. Don't want to wait it out? Hit **Stop** at the bottom of the overlay — the steps are left empty for you to write yourself. Not quite right? Hit the **trash (Clear all)** button at the top-right of the Steps to reproduce section to wipe them in one click and write your own.

> If this auto-fill isn't for you, turn it off under **Settings > Issue settings > AI settings > Fill steps to reproduce**.

### Pulling the log that matters into the body

Sections you write as prose — Description, Expected result, Notes — have an **Add log** button on the right of their header (Steps to reproduce is an ordered list, so it doesn't). Instead of describing the response in words, drop the log itself into the body.

The button opens the **Add log** dialog. **Console** and **Network** tabs each show a count badge, and you search and filter exactly as you would in the log tabs. Click the entry you're after, read it in the detail pane, then hit **Add**.

- **Network** — carries the request path and status code plus the **request and response bodies**. Perfect for the "200, but the response says it failed" case the status code alone can't show.
- **Console** — carries the message the page printed, and the stack trace when it's an error.

What lands is a code block, but it's **just text** — trim it or edit it however you like. It's separate from the attached `logs.html`: the attachment only shows up once the reader downloads and opens the file, while a log you add this way is **right there in the issue body**.

Long logs are nothing to worry about. Any code block over 15 lines lands **collapsed**, so a single response never swallows the panel. Hover the block and a pill appears at the bottom center — **Expand (38 lines)**, where the number is that block's full line count. Click it to see the whole thing, **Collapse** to fold it back, and preview behaves the same way. Start editing inside a collapsed block and it opens up on its own, so type away. Folding is purely for comfortable reading — **the issue you file always carries the full log**.

> A log in the body is visible to everyone who can see the issue, and console logs go in verbatim with no masking. If the screen prints anything sensitive, give it a look in the detail pane before you add it.

### Annotating an image in the body

Prose sections like Description can hold images too — paste a screenshot, drag a file in, or use the **Add image** button on the section header. **Hover** an image that's in the body and a small toolbar appears at its top-right. **Annotate** opens the same editor as screenshot annotation, so you can point an arrow at the problem or cover something sensitive and have it applied right in place. Once you've annotated at least once, a **Restore** button joins it — one click brings back the pre-edit original. Drop an image you don't need with **Delete**.

> Editing a body image used to mean deleting it, fixing it elsewhere, and dropping it back in — now you touch it up right where it sits. Both the annotated version and the pre-annotation original live only in your browser, and what goes out with the issue is always the image you see now (annotated, if you annotated it).

## ✨ AI Draft

![AI Draft banner and input box](../assets/video-issue-4.jpg)

If filling in each line by hand feels tedious, this is where AI earns its keep. With an AI connected, a purple **"Let AI write your draft"** banner shows up right below the body sections.

Click **AI Draft** on the right and a small input box opens. Describe the bug in a line or two, hit **Generate**, and AI fills in **both the title and the body sections** at once. Only the sections you've turned on get filled, and your title prefix stays put. If you've already jotted down a title or body, AI takes that in as context too — and any images you placed in the body stay put, with only the text refreshed.

In recording mode, AI works from a **summary of the console, network, and action logs**, weaving what actually happened during the recording into the draft. With the richest logs of any mode, this is where AI Draft is most accurate.

If error logs were captured, AI does one more thing — it picks the ones directly tied to the bug and drops the **actual log, verbatim, as a code block right under the description**. The log text never comes from the AI itself, so there's no made-up stack trace to worry about. If nothing's relevant, nothing gets added — that's normal. Log blocks you inserted yourself survive a regenerate, and you can always delete a block you don't need.

> AI slips up now and then, so give the generated draft a quick look. The banner only shows when an AI is connected — see [AI LLM Connection](../settings/ai.md) for how.

## 5. Log attachments — recording-mode policy

![Recording-mode log policy](../assets/video-issue-5.jpg)

On top of the video, recording mode bundles three kinds of logs. The log section shows a **single `logs.html` card** with its switch **on by default** — that one switch attaches or drops all three logs **together** (there's no per-log toggle).

- **Console Logs** — Console output and errors during the recording.
- **Network Logs** — Network requests made during the recording.
- **Action Logs** — A record of user actions: clicks, text input, and navigation, plus **keyboard shortcuts and special keys (Enter, Esc, ⌘K, and the like), checkbox and radio toggles, dropdown selections, and drag-and-drop**. For shortcuts it captures which key you pressed, not every character you type.

Click the card and it opens a window split into **Console, Network, and Action tabs** so you can check what each log holds, with **Detach** at the bottom to leave them out.

Logs keep collecting the whole time the side panel is open, so whatever happened *before* you hit record is already in there.

> Values you type into fields and pick from dropdowns are recorded **as-is**, unless they look sensitive. Knowing which value broke things is usually the whole point of a repro. See the [Log Viewer](../logs/viewer.md) for the exact rules and what to watch out for.

The video timeline and the logs are linked by time, so the reader can walk through "what happened at this moment" in the [Log Viewer](../logs/viewer.md).

The **Download** button on the right of the Log attachments section lets you grab the same log report (`logs.html`) that gets attached to the issue — before you submit. The video is bundled right in, so you can open it straight in the [Log Viewer](../logs/viewer.md).

## 6. Preview

Give the body a look in the preview before submitting. **Copy** copies it as-is to paste elsewhere.

## 7. Submit

![Issue submitted](../assets/video-issue-6.jpg)

Fill in the connected platform's fields (project, assignee, labels, etc.) and hit **Submit issue**. A link to the created issue appears when it's done.

At the bottom of the fields sits a **CC** field. Pick the folks who should be in the loop on this bug (reviewers, designers, PMs) and they land as a `cc @name` mention at the bottom of the created issue, each getting a notification on the platform. Select several at once and search by name to find them fast. Whoever you pick is pre-filled on your next issue too, so you don't have to reselect every time.

> CC unlocks once you've picked the parent item first — repo, team, project, or workspace. Notion is the one exception: its connected integration needs the "read user information" permission to load the member list, so if it comes up empty, reconnect Notion in Settings.
