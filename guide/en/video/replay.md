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

- **Pick the range** — Drag the **start** and **end** handles at the ends of the timeline to set what to keep. As you move a handle the video follows to that spot so you can check the edge frame, and the selected length ("17s / 30s") shows up top.
- **Play / pause** — Scrub through the video to find the bug. The timeline marks **where errors occurred** in the console and network, which helps you decide what to keep.
- **Log preview** — Use the **Console**, **Network**, and **Actions** buttons up top to preview the full captured logs (handy reference while choosing the range).
- **Undo / redo** — Moved a handle by mistake? No worries — undo or redo it.

When you're happy, hit **Apply**. The video is rebuilt to keep only the selected range, and the attached console, network, and action logs get narrowed to match. Leave the handles untouched and hit **Apply** to keep the full 30 seconds.

> The trim screen shows up **just once** right after capture, and the original is cleared once you apply. Don't need to trim? Just hit **Apply** as is. To drop this capture entirely, hit **Discard** — you'll confirm and return to the start screen.

![Trimming the replay clip](../assets/video-replay-3.jpg)

> Once you apply, you move to the issue draft. Continue with [Write an Issue](issue.md).

---

🌐 [한국어](https://bugshot.gitbook.io/ko/video/replay)
