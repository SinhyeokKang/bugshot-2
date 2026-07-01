# 30s Replay

Bugs never wait for you to hit record first, do they? 30s replay **always keeps the last 30 seconds** of your screen, so right after you spot a bug you can attach what just happened as a video in one click. It saves you from those "ugh, I should've been recording" moments.

## Prerequisite: setting

Replay only works once it's turned on ahead of time.

> First, in [Issue Settings](../settings/issue.md), **turn on the 30s replay toggle**. The last 30 seconds start getting kept from the moment you flip it on. There's no separate permission prompt — just turn the switch on.

On top of that, even if you **navigate to another page mid-task, the side panel stays open and your capture keeps going**. It applies whether or not you use replay, so reproducing a bug across pages feels a lot smoother.

![Enabling 30s replay](../assets/video-replay-1.jpg)

## Using it

Once it's ready, the **30s replay** button on the debug screen pulls the last 30 seconds into a video. A quick glance at the button tells you what's going on.

- **Disabled** — Not turned on in settings yet. (Click it to jump to **Issue settings**, where you can turn it on right there.)
- **Recording** — The screen is being recorded. You can grab the last 30 seconds anytime.
- **Encoding…** — Turning the grabbed 30 seconds into a video.
- **Ready** — The video is made and attached to the issue.

![30s replay button states](../assets/video-replay-2.jpg)

## Trimming the clip

The bug itself usually happens in just a moment of those 30 seconds. Once the video is made, a **trim screen** pops up over the issue draft so you can cut the unneeded parts and keep only the bug moment. It's simpler than it sounds — trim the ends to keep only what matters.

Up top, the trim screen has **Video**, **Console**, **Network**, and **Action** tabs. The Video tab plays your clip in the middle; switch to a log tab and that type of captured log opens up in the same spot (each tab shows a count of what it caught). No matter which tab you're on, the timeline handles and buttons like undo and apply stay right there, so you can trim while reading the logs.

- **Pick the range** — Drag the **Start** and **End** handles at the ends of the timeline to set what to keep. As you move a handle, the selected length ("17s / 30s") shows up top.
- **Play / pause** — Use the **Video** tab to scrub through the clip and find the bug (playback pauses for a moment when you switch to a log tab). The timeline marks **where errors occurred** (console/network) and **where the page navigated** to help you decide what to keep — click a mark to jump straight to that log tab.
- **Preview what gets cut** — As you move a handle, the logs that will be cut go **dimmed** in the log tabs. So before you apply, you can see at a glance exactly which logs are about to drop. It's distinct from the error and status colors, so there's no mixing them up.
- **Undo / redo** — Moved a handle by mistake? No worries — undo or redo it.

When you're happy, hit **Apply**. The video is rebuilt to keep only the selected range, and the attached console, network, and action logs get narrowed to match (the ones shown dimmed drop out). Leave the handles untouched and hit **Apply** to keep the full 30 seconds.

> The trim screen shows up **just once** right after capture, and the original is cleared once you apply. Don't need to trim? Just hit **Apply** as is. To drop this capture entirely, hit **Discard** — you'll confirm and return to the start screen.

![Trimming the replay clip](../assets/video-replay-3.jpg)

> Once you apply, you move to the issue draft. Continue with [Write an Issue](issue.md).

---

🌐 [한국어](https://bugshot.gitbook.io/ko/video/replay)
