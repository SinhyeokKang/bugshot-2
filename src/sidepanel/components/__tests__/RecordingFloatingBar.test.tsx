import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

const stopRecording = vi.fn();
const cancelRecording = vi.fn();
let elapsedSec = 45;

vi.mock("@/sidepanel/video-recorder", () => ({
  stopRecording: () => stopRecording(),
  cancelRecording: () => cancelRecording(),
}));
vi.mock("@/sidepanel/hooks/useRecordingElapsed", () => ({
  useRecordingElapsed: () => ({ elapsedSec, maxSec: 120 }),
}));
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { useEditorStore } from "@/store/editor-store";
import { RecordingFloatingBar } from "../RecordingFloatingBar";

describe("RecordingFloatingBar", () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    stopRecording.mockClear();
    cancelRecording.mockClear();
    elapsedSec = 45;
  });

  it("루트에 theme-inverse 클래스가 있다", () => {
    render(<RecordingFloatingBar />);
    expect(screen.getByTestId("recording-bar").classList.contains("theme-inverse")).toBe(true);
  });

  it("source tab → barLabelTab, region aria-label도 같은 값", () => {
    useEditorStore.setState({ recordingSource: "tab" });
    render(<RecordingFloatingBar />);
    const bar = screen.getByTestId("recording-bar");
    expect(bar.getAttribute("role")).toBe("region");
    expect(bar.getAttribute("aria-label")).toBe("issue.recording.barLabelTab");
    expect(screen.getByText("issue.recording.barLabelTab")).toBeTruthy();
  });

  it("source screen → barLabelScreen, region aria-label도 같은 값", () => {
    useEditorStore.setState({ recordingSource: "screen" });
    render(<RecordingFloatingBar />);
    const bar = screen.getByTestId("recording-bar");
    expect(bar.getAttribute("aria-label")).toBe("issue.recording.barLabelScreen");
    expect(screen.getByText("issue.recording.barLabelScreen")).toBeTruthy();
  });

  it("경과 시간을 M:SS로 보이고 최대 시간(/ 2:00)은 없다", () => {
    const { rerender } = render(<RecordingFloatingBar />);
    expect(screen.getByText("0:45")).toBeTruthy();
    expect(screen.queryByText(/2:00/)).toBeNull();

    elapsedSec = 0;
    rerender(<RecordingFloatingBar />);
    expect(screen.getByText("0:00")).toBeTruthy();
    expect(screen.queryByText(/2:00/)).toBeNull();
  });

  it("recording-bar-stop(barStop) 클릭 → stopRecording 1회", async () => {
    render(<RecordingFloatingBar />);
    const stop = screen.getByTestId("recording-bar-stop");
    expect(stop.textContent).toBe("issue.recording.barStop");
    await userEvent.click(stop);
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(cancelRecording).not.toHaveBeenCalled();
  });

  it("recording-bar-cancel의 aria-label이 common.cancel이고 클릭 → cancelRecording 1회", async () => {
    render(<RecordingFloatingBar />);
    const cancel = screen.getByTestId("recording-bar-cancel");
    expect(cancel.getAttribute("aria-label")).toBe("common.cancel");
    await userEvent.click(cancel);
    expect(cancelRecording).toHaveBeenCalledTimes(1);
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it("취소 클릭 시 포커스가 속한 tabpanel의 labelledby 트리거로 돌아간다", async () => {
    render(
      <div>
        <button id="trig">trigger</button>
        <div role="tabpanel" aria-labelledby="trig">
          <RecordingFloatingBar />
        </div>
      </div>,
    );
    await userEvent.click(screen.getByTestId("recording-bar-cancel"));
    expect(document.activeElement).toBe(document.getElementById("trig"));
    expect(cancelRecording).toHaveBeenCalledTimes(1);
  });

  it("tabpanel 밖에서 취소해도 throw하지 않고 cancelRecording이 호출된다", async () => {
    render(<RecordingFloatingBar />);
    await userEvent.click(screen.getByTestId("recording-bar-cancel"));
    expect(cancelRecording).toHaveBeenCalledTimes(1);
  });
});

// 반전 스코프(.theme-inverse) 안에서 Tailwind dark variant는 조상 .dark에 매칭돼 반전이 깨진다.
// 바 자식(Button·TooltipIconButton)까지 같은 스캔으로 잠근다.
describe("반전 스코프 dark variant 금지 (소스 스캔)", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const FILES = [
    "sidepanel/components/RecordingFloatingBar.tsx",
    "components/ui/button.tsx",
    "sidepanel/components/TooltipIconButton.tsx",
  ];

  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(FILES)("%s — 주석을 걷어낸 본문에 dark:<class> 0건", (rel) => {
    const body = stripComments(readFileSync(join(ROOT, rel), "utf8"));
    expect(body.match(/\bdark:[a-z]/g)).toBeNull();
  });

  it("스캔 자체가 공허하지 않다 — dark:class가 있는 샘플은 걸리고 주석 속 경고 문구는 걷힌다", () => {
    expect(stripComments("a // dark:bg-x\nb").match(/\bdark:[a-z]/g)).toBeNull();
    expect(stripComments("/* dark:bg-x */ c").match(/\bdark:[a-z]/g)).toBeNull();
    expect(stripComments('className="dark:bg-x"').match(/\bdark:[a-z]/g)).not.toBeNull();
  });
});
