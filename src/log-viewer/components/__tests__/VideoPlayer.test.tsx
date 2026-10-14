import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer } from "../VideoPlayer";
import { t } from "../../i18n";

afterEach(() => vi.restoreAllMocks());

function mount(src = "data:video/mp4;base64,AAAA") {
  const result = render(<VideoPlayer src={src} markers={[]} onMarkerClick={vi.fn()} onDurationChange={vi.fn()} onError={vi.fn()} />);
  return result.container.querySelector("video")!;
}

describe("VideoPlayer", () => {
  it.each([
    ["video/mp4", "recording.mp4"],
    ["video/webm", "recording.webm"],
    ["video/webm;codecs=vp9", "recording.webm"],
  ])("downloads %s with the matching extension", async (mime, filename) => {
    const src = `data:${mime};base64,AAAA`;
    let download: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { download = this; });
    mount(src);
    await userEvent.click(screen.getByRole("button", { name: t("logViewer.player.download") }));
    expect(download?.download).toBe(filename);
    expect(download?.getAttribute("href")).toBe(src);
  });

  it("seeks from the keyboard and updates the accessible playback time", async () => {
    const user = userEvent.setup();
    const video = mount();
    Object.defineProperty(video, "duration", { value: 120 });
    fireEvent.loadedMetadata(video);
    video.currentTime = 30;
    fireEvent.timeUpdate(video);
    const slider = screen.getByRole("slider", { name: t("logViewer.player.progressBar") });
    await user.tab();
    expect(document.activeElement).toBe(slider);
    expect(slider.getAttribute("aria-valuetext")).toBe("0:30 / 2:00");
    for (const [key, seconds] of [["ArrowRight", 35], ["ArrowUp", 40], ["ArrowLeft", 35], ["ArrowDown", 30], ["Home", 0], ["ArrowLeft", 0], ["End", 120], ["ArrowRight", 120]] as const) {
      await user.keyboard(`{${key}}`);
      expect(video.currentTime).toBe(seconds);
      fireEvent.timeUpdate(video);
      expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(seconds);
    }
    expect(slider.getAttribute("aria-valuemax")).toBe("120");
    expect(slider.getAttribute("aria-valuetext")).toBe("2:00 / 2:00");
    expect(slider.className).toContain("focus-visible:ring-2");
  });

  it("does not seek before duration is available or consume unrelated keys", () => {
    const video = mount();
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    expect(video.currentTime).toBe(0);
    expect(fireEvent.keyDown(slider, { key: "Tab" })).toBe(true);
  });
});
