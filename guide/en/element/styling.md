# Styling

Once an element is selected, the style panel opens. Change a value and it's **applied to the page right away**, so you can fine-tune while watching the fix on the real screen.

## Style panel sections

From top to bottom, the panel is organized into these sections (labels show in English on screen).

1. **Class** — Edit the element's class list.
2. **Layout** — display, position, flex alignment, margin, padding, gap.
3. **Container** — background, opacity, border, border radius.
4. **Size** — width, height, and min/max.
5. **Overflow** — overflow, white-space, text-overflow.
6. **Text** — Edit the element's text content (shown only for elements with text).
7. **Typography** — font size, weight, line height, letter spacing, align, color.
8. **Effects** — shadow, filter, blend.
9. **Transition** — transition property, duration, easing.

![Style panel sections](../assets/element-styling-1.jpg)

## Live preview and reverting

- Changing a value applies it to the page **immediately**.
- Don't like it? **Reset changes** rolls back every edit to the original values in one go.
- Each section can revert just its inline changes, and there are buttons to revert Class or Text to the original — so feel free to experiment.

## AI Styling

With an AI (LLM) connected, an **AI Styling** banner appears in the panel. When touching values by hand feels like a chore, just **describe what you want**.

- "Make the button rounder"
- "Add more spacing"
- "Bigger, bolder text"

AI finds the right style/class changes and applies them to the page instantly. Without an AI connected, this banner doesn't appear.

> See [AI LLM Connection](../settings/ai.md) for how to connect. AI slips up now and then, so give the applied result a quick look.

![AI Styling banner](../assets/element-styling-2.jpg)

## More than one element in one issue

Bugs rarely sit in just one spot. Sometimes you want to bundle several elements — "the button color + the label alignment next to it + the card padding" — into a single issue.

Fixed element A? Click **Pick another element** (top right) and grab the next one (B). A's changes **stay on the page** instead of disappearing, and they ride along into the issue too. Keep going for A, B, C… as many as you like — before/after is recorded per element.

> There's no separate screen yet to pull out a buffered element or manage them as a list. Whatever you've collected clears when you cancel the draft, finish submitting, or hit **Reset changes**.

## Next step

When you're done editing, click **Next** to move to the issue draft. The before and after are captured as a comparison.

> **Next** is enabled once at least one style has changed (if you've already buffered an element, you can move on without changing the current one). To include an element as-is (without style changes), use [Capture element](../screenshot/capture.md) instead.

---

🌐 [한국어](https://bugshot.gitbook.io/ko/element/styling)
