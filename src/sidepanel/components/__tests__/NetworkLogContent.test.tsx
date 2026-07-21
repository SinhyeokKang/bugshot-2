import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NetworkLogContent } from "../NetworkLogContent";
import type { NetworkRequest } from "@/types/network";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

function makeRequest(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "r1",
    url: "https://api.example.com/api/orders/1",
    method: "POST",
    status: 200,
    statusText: "OK",
    startTime: 1000,
    durationMs: 5,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com/",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    ...over,
  };
}

const REQUESTS = [makeRequest(), makeRequest({ id: "r2", url: "https://api.example.com/api/x" })];

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-entry-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not found`);
  return el as HTMLElement;
}

describe("NetworkLogContent — onActiveChange", () => {
  it("행 클릭이 선택 id를 통지한다", async () => {
    const onActiveChange = vi.fn();
    render(<NetworkLogContent requests={REQUESTS} onActiveChange={onActiveChange} />);
    onActiveChange.mockClear();

    await userEvent.click(row("r1"));

    expect(onActiveChange).toHaveBeenCalledWith("r1");
  });

  it("같은 행 재클릭은 선택 해제라 null을 통지한다", async () => {
    const onActiveChange = vi.fn();
    render(<NetworkLogContent requests={REQUESTS} onActiveChange={onActiveChange} />);
    await userEvent.click(row("r1"));
    onActiveChange.mockClear();

    await userEvent.click(row("r1"));

    expect(onActiveChange).toHaveBeenCalledWith(null);
  });

  it("콜백 미공급이어도 선택이 동작한다", async () => {
    render(<NetworkLogContent requests={REQUESTS} />);

    await userEvent.click(row("r1"));

    expect(row("r1").className).toContain("bg-accent");
  });
});

const WS_REQUEST = makeRequest({
  id: "ws1",
  method: "WS",
  status: 101,
  url: "wss://example.com/socket",
  contentType: "",
  webSocket: {
    protocol: "",
    framesTotal: 1,
    frames: [
      { seq: 0, direction: "send", ts: 1000, data: "------WebKitFormBoundary\r\nplain", size: 30 },
    ],
  },
});

describe("NetworkLogContent — WS 프레임 mono", () => {
  it("접힌 프레임 프리뷰 span이 font-mono다", async () => {
    render(<NetworkLogContent requests={[WS_REQUEST]} />);
    await userEvent.click(row("ws1"));

    const preview = document.querySelector('[data-frame-direction="send"] .truncate') as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.className).toContain("font-mono");
  });

  it("펼친 non-JSON 프레임 본문 pre가 font-mono다(font-sans 역전)", async () => {
    render(<NetworkLogContent requests={[WS_REQUEST]} />);
    await userEvent.click(row("ws1"));
    const frameHeader = document.querySelector('[data-frame-direction="send"] > div') as HTMLElement;
    await userEvent.click(frameHeader);

    const pre = document.querySelector('[data-frame-direction="send"] pre') as HTMLElement;
    expect(pre).toBeTruthy();
    expect(pre.className).toContain("font-mono");
    expect(pre.className).not.toContain("font-sans");
  });
});

describe("NetworkLogContent — 영상 seek 동기화(onSeek 공급)", () => {
  it("행 클릭이 상세 선택과 함께 onSeek(startTime)을 발화한다", async () => {
    const onSeek = vi.fn();
    const onActiveChange = vi.fn();
    render(<NetworkLogContent requests={REQUESTS} syncBaseMs={0} onSeek={onSeek} onActiveChange={onActiveChange} />);
    onActiveChange.mockClear();

    await userEvent.click(row("r1"));

    expect(onSeek).toHaveBeenCalledWith(1000);
    expect(onActiveChange).toHaveBeenCalledWith("r1");
  });

  it("mm:ss 칩 클릭은 stopPropagation으로 onSeek을 한 번만 발화(행 이중발화 없음)", async () => {
    const onSeek = vi.fn();
    const onActiveChange = vi.fn();
    render(<NetworkLogContent requests={REQUESTS} syncBaseMs={0} onSeek={onSeek} onActiveChange={onActiveChange} />);
    onActiveChange.mockClear();

    const chip = row("r1").querySelector('[data-testid="log-rel-time"]') as HTMLElement;
    await userEvent.click(chip);

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(1000);
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it("onSeek 미공급 시 mm:ss는 button이 아니라 span(seek UI 없음)", () => {
    render(<NetworkLogContent requests={REQUESTS} syncBaseMs={0} />);
    const chip = row("r1").querySelector('[data-testid="log-rel-time"]') as HTMLElement;
    expect(chip.tagName).toBe("SPAN");
  });
});
