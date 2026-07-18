# FAQ

When you're new to BugShot, a few "wait, how do I do this?" moments are bound to come up. We've gathered the questions we hear most — just jump to whatever you're wondering about.

### What is BugShot?

It's a Chrome side panel extension that lets you capture a bug right where you spot it and file it as an issue — bundling the environment, screenshots, video, and logs in one shot. Instead of typing out "the color of this button looks off," a few clicks give you a report a developer can act on right away.

### Is it paid?

Nope — it's free to use, and there's no sign-up or BugShot account required either. Just install it and you get the core features as-is: capturing, logs, video, and issue filing. So go ahead and give it a try, no strings attached.

### Which issue trackers can I send to?

Seven trackers — Jira, GitHub, Linear, Notion, GitLab, Asana, and ClickUp — plus **Slack** now too, for a quick share to a channel or DM. Whatever your team uses, there's no need to switch: file issues straight into your usual tracker, or give your team a heads-up on Slack before filing. You only have to connect it once, over in [Integrations](integrations/README.md).

### Do I need to be a developer to use it?

Not at all. The reproduction environment (OS, browser, URL, viewport, and more) fills in automatically, and AI can draft the title and body for you. Jot the bug down in a single line and you'll get a tidy report — so PMs, designers, and QA can all use it with peace of mind.

### Can I go beyond reporting a bug and actually propose "fix it like this"?

Yes — that's what BugShot is all about. Pick an element on the page and tweak its styles (color, spacing, border, font, and so on) right there; the change applies to the page instantly, and the **before and after are captured side by side** in the issue. Instead of saying "round this off a bit," you show the fixed result — and you can bundle several elements into one issue.

It even recognizes the **design tokens (CSS variables)** modern sites rely on. If a color is set via a token like `--color-primary`, BugShot surfaces the other tokens in the same family (`--color-danger`, `--color-success`, and so on) so you can pick one directly. That way you're proposing changes **within the design system your team already uses**, not throwing in arbitrary values. See [Styling](element/styling.md) for more.

### Are console and network logs included too?

Yes — and so is a **user-action log**. All three are collected automatically. They keep gathering the whole time the side panel is open, so errors that fired before you started capturing are already in there, and it even picks up errors from embedded widgets and payment frames (cross-origin iframes) that barely show on screen. All three attach by default to every capture mode except element style editing, and you can turn any of them off before submitting. See [Logs](logs/README.md) for details.

### Do recipients need to install a tool to open the attached logs?

No. Console, network, and user-action logs are attached to the issue as a single log report file, and the recipient just opens it in a browser. They can dig into the logs — laid out in chronological order — right away, with nothing to install, which makes tracking down the cause much easier for developers. It's covered in [Log Viewer](logs/viewer.md).

### Do I have to pay or add a key to use the AI features?

Not necessarily. Connect your own LLM key (OpenAI, Anthropic, and the like) and it uses that model; with nothing connected, it automatically falls back to Chrome's built-in AI. If neither is available, only the AI draft feature stays hidden — capturing, logs, and issue filing all keep working. Set it up in [AI LLM Connection](settings/ai.md).

### Won't the AI make up logs?

No worries — it's structurally impossible. When AI Draft adds a log to the body, the AI's only job is to **pick which log is relevant**. The full log text never passes through the AI: BugShot pastes in the **captured original, verbatim**. So a stack trace that never happened, or a response body that got reworded, simply can't end up in your issue. If the AI decides nothing's relevant, nothing gets added — and that's by design.

### Can I edit a saved draft later?

Absolutely. Maybe you captured something in a hurry and want to finish it later, or you'd like to polish what you already wrote — no worries. Open the **Issues** tab and click a saved draft to bring up the **Review draft** view. Hit the pencil-shaped **Edit** button next to the title or any body section (what happened, steps to reproduce, expected result, and so on) and a small window opens to edit just that field; press **Save** and it shows up in the list and the details right away. Steps to reproduce stay a numbered list and the body keeps any images you pasted in, so it works just like it did when you first wrote it.

### Can I attach a video?

Yes. You can record the current tab or your screen live and attach it, and there's also 30s Replay — which rewinds the **last 30 seconds** into a clip even if you didn't hit record beforehand. No more "oh, I can't reproduce that again…" moments. It's covered in [Recording](video/README.md).

### Are there pages where it won't work?

It works on regular web pages (`http`, `https`) and local files (`file`). It can't run on pages where the browser blocks extension access, like the Chrome Web Store or `chrome://` settings pages. The panel simply won't activate there, so use it on a regular web page instead.

### Where is my data stored?

What you capture, your in-progress drafts, and your settings all stay **only inside your browser (locally)** until you submit an issue. Issues are sent solely to the platforms you've connected yourself, and only at the moment you submit. Those connections happen only through official OAuth or a token you enter — so you can use it with no privacy worries, with peace of mind.
