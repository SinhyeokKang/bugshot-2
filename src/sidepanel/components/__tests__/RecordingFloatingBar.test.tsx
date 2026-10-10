import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

const stopRecording = vi.fn();
let focusAtCancel: Element | null = null;
const cancelRecording = vi.fn(() => {
  focusAtCancel = document.activeElement;
});
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
    focusAtCancel = null;
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

  // Radix TabsContent가 aria-labelledby로 트리거 id를 달아주는 계약에 기댄다 — 실제 Tabs로 잠근다.
  it("실제 Radix Tabs 안에서 취소하면 포커스가 cancelRecording 호출 전에 console 트리거로 돌아간다", async () => {
    render(
      <Tabs value="console">
        <TabsList>
          <TabsTrigger value="console" data-testid="subtab-console">
            console
          </TabsTrigger>
          <TabsTrigger value="network">network</TabsTrigger>
        </TabsList>
        <TabsContent value="console">
          <RecordingFloatingBar />
        </TabsContent>
      </Tabs>,
    );
    const trigger = screen.getByTestId("subtab-console");
    await userEvent.click(screen.getByTestId("recording-bar-cancel"));
    expect(cancelRecording).toHaveBeenCalledTimes(1);
    expect(focusAtCancel).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("바 루트·점·취소 버튼의 치수 계약 클래스(높이 68px 계산의 근거)", () => {
    render(<RecordingFloatingBar />);
    const bar = screen.getByTestId("recording-bar");
    const root = Array.from(bar.classList);
    for (const c of [
      "theme-inverse",
      "p-4",
      "inset-x-3",
      "bottom-3",
      "rounded-xl",
      "shadow-lg",
      "bg-background/90",
      "backdrop-blur-sm",
      "text-foreground",
    ]) {
      expect(root, c).toContain(c);
    }
    expect(root.filter((c) => /^ring/.test(c))).toEqual([]);

    const dot = bar.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(dot.classList.contains("animate-pulse")).toBe(true);
    expect(dot.classList.contains("motion-reduce:animate-none")).toBe(true);

    const cancel = screen.getByTestId("recording-bar-cancel");
    expect(cancel.classList.contains("h-9")).toBe(true);
    expect(cancel.classList.contains("w-9")).toBe(true);
    expect(cancel.classList.contains("h-8")).toBe(false);
    expect(cancel.classList.contains("w-8")).toBe(false);
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
    expect(body.match(/\bdark:[a-z[!]/g)).toBeNull();
  });

  it("스캔 자체가 공허하지 않다 — dark:class가 있는 샘플은 걸리고 주석 속 경고 문구는 걷힌다", () => {
    expect(stripComments("a // dark:bg-x\nb").match(/\bdark:[a-z[!]/g)).toBeNull();
    expect(stripComments("/* dark:bg-x */ c").match(/\bdark:[a-z[!]/g)).toBeNull();
    expect(stripComments('className="dark:bg-x"').match(/\bdark:[a-z[!]/g)).not.toBeNull();
    expect(stripComments('className="dark:[color:red]"').match(/\bdark:[a-z[!]/g)).not.toBeNull();
    expect(stripComments('className="dark:!bg-x"').match(/\bdark:[a-z[!]/g)).not.toBeNull();
  });
});
