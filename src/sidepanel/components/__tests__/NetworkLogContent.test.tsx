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

// BugShot이 만든 상태 라벨만 번역한다. 옛 저장 로그는 statusKind가 없어 영문 statusText로 남고,
// 그 비대칭이 의도임을 여기서 고정한다(HAR·이슈 본문·프롬프트도 같은 영문을 쓴다).
describe("NetworkLogContent — statusKind 상태 라벨", () => {
  async function statusText(over: Partial<NetworkRequest>): Promise<string> {
    const req = makeRequest({ id: "s1", status: 0, ...over });
    render(<NetworkLogContent requests={[req]} />);
    await userEvent.click(row("s1"));
    const dd = document.querySelectorAll("dd")[2] as HTMLElement;
    return dd.textContent ?? "";
  }

  it("queued는 번역 키로 렌더된다", async () => {
    expect(
      await statusText({ phase: "complete", statusText: "Queued", statusKind: "queued" }),
    ).toContain("networkLog.display.queued");
  });

  it("queueFull은 번역 키로 렌더된다", async () => {
    expect(
      await statusText({ phase: "error", statusText: "Queue Full", statusKind: "queueFull" }),
    ).toContain("networkLog.display.queueFull");
  });

  it("aborted는 번역 키로 렌더된다", async () => {
    expect(
      await statusText({ phase: "error", statusText: "Aborted", statusKind: "aborted" }),
    ).toContain("networkLog.display.aborted");
  });

  it("timeout은 번역 키로 렌더된다", async () => {
    expect(
      await statusText({ phase: "error", statusText: "Timeout", statusKind: "timeout" }),
    ).toContain("networkLog.display.timeout");
  });

  it("networkError는 라벨 대신 blocked 문구로 간다(isStatusHidden이 먼저 잡는다)", async () => {
    const out = await statusText({
      phase: "error",
      statusText: "Network Error",
      statusKind: "networkError",
    });
    expect(out).toContain("networkLog.display.blocked");
  });

  it("statusKind 없는 옛 로그는 영문 statusText 원문을 그대로 보여준다", async () => {
    expect(await statusText({ phase: "error", statusText: "Aborted" })).toContain("0 Aborted");
  });

  it("서버 유래 응답은 status + statusText 그대로다", async () => {
    expect(
      await statusText({ phase: "complete", status: 503, statusText: "Service Unavailable" }),
    ).toContain("503 Service Unavailable");
  });
});
