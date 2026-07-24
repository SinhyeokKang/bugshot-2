import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ConsoleEntry, ConsoleLevel } from "@/types/console";
import type { NetworkRequest, NetworkRequestPhase } from "@/types/network";
import type { ActionEntry } from "@/types/action";
import { TimelineRow } from "../TimelineRow";
import type { TimelineItem } from "../../timeline-merge";

function consoleItem(level: ConsoleLevel, args = "boom", stack?: string): TimelineItem {
  const entry: ConsoleEntry = { id: "c1", level, timestamp: 1000, args, pageUrl: "https://x.test/", ...(stack ? { stack } : {}) };
  return { kind: "console", id: entry.id, absTs: entry.timestamp, entry };
}

function networkItem(opts: Partial<Pick<NetworkRequest, "status" | "phase" | "method" | "url">> = {}): TimelineItem {
  const phase: NetworkRequestPhase = opts.phase ?? "complete";
  const req: NetworkRequest = {
    id: "n1", url: opts.url ?? "https://api.test/orders", method: opts.method ?? "GET",
    status: opts.status ?? 200, statusText: "", startTime: 2000, durationMs: 42,
    requestHeaders: {}, responseHeaders: {}, pageUrl: "https://x.test/",
    requestBodySize: 0, responseBodySize: 0, contentType: "application/json", phase,
  };
  return { kind: "network", id: req.id, absTs: req.startTime, req };
}

function actionItem(): TimelineItem {
  const entry: ActionEntry = { id: "a1", kind: "click", timestamp: 3000, pageUrl: "https://x.test/", target: "Save" };
  return { kind: "action", id: entry.id, absTs: entry.timestamp, entry };
}

const noop = () => {};

describe("TimelineRow — 카테고리별 렌더", () => {
  it("action 행: data-kind=action, 면색 없음", () => {
    render(<TimelineRow item={actionItem()} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.dataset.kind).toBe("action");
    expect(row.className).not.toContain("bg-red-100");
    expect(row.className).not.toContain("bg-blue-100");
  });

  it("console error 행: red 면색 + 스택 chevron", () => {
    render(<TimelineRow item={consoleItem("error", "boom", "at foo")} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.dataset.kind).toBe("console");
    expect(row.className).toContain("bg-red-100");
    expect(screen.getByTestId("timeline-row-expand")).toBeTruthy();
  });

  it("console info 행: blue 면색 (우측 탭과 sync)", () => {
    render(<TimelineRow item={consoleItem("info")} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    expect(screen.getByTestId("timeline-row").className).toContain("bg-blue-100");
  });

  it("console log 행: 면색·chevron 없음(스택 없는 log)", () => {
    render(<TimelineRow item={consoleItem("log")} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    expect(screen.getByTestId("timeline-row").className).not.toContain("bg-");
    expect(screen.queryByTestId("timeline-row-expand")).toBeNull();
  });

  it("network 행: METHOD·경로·상세 링크", () => {
    render(<TimelineRow item={networkItem({ method: "POST", url: "https://api.test/orders" })} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    expect(screen.getByText("POST")).toBeTruthy();
    expect(screen.getByText("/orders")).toBeTruthy();
    expect(screen.getByTestId("timeline-row-detail")).toBeTruthy();
  });
});

describe("TimelineRow — active 강조", () => {
  it("active면 border-l-primary + aria-current", () => {
    render(<TimelineRow item={actionItem()} isActive videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.className).toContain("border-l-primary");
    expect(row.getAttribute("aria-current")).toBe("true");
  });

  it("비active면 border-l-muted", () => {
    render(<TimelineRow item={actionItem()} isActive={false} videoStartedAt={0} onSeek={noop} onOpenNetworkDetail={noop} />);
    expect(screen.getByTestId("timeline-row").className).toContain("border-l-muted");
  });
});

describe("TimelineRow — 클릭 라우팅", () => {
  it("행 클릭 → onSeek(absTs)", async () => {
    const onSeek = vi.fn();
    render(<TimelineRow item={networkItem()} isActive={false} videoStartedAt={0} onSeek={onSeek} onOpenNetworkDetail={noop} />);
    await userEvent.click(screen.getByText("/orders"));
    expect(onSeek).toHaveBeenCalledWith(2000);
  });

  it("'상세' 클릭 → onOpenNetworkDetail, onSeek 미호출(stopPropagation)", async () => {
    const onSeek = vi.fn();
    const onOpen = vi.fn();
    render(<TimelineRow item={networkItem()} isActive={false} videoStartedAt={0} onSeek={onSeek} onOpenNetworkDetail={onOpen} />);
    await userEvent.click(screen.getByTestId("timeline-row-detail"));
    expect(onOpen).toHaveBeenCalledWith("n1");
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("chevron 클릭 → 스택 확장, onSeek 미호출", async () => {
    const onSeek = vi.fn();
    render(<TimelineRow item={consoleItem("error", "boom", "at foo:1")} isActive={false} videoStartedAt={0} onSeek={onSeek} onOpenNetworkDetail={noop} />);
    expect(screen.queryByText("at foo:1")).toBeNull();
    await userEvent.click(screen.getByTestId("timeline-row-expand"));
    expect(screen.getByText("at foo:1")).toBeTruthy();
    expect(onSeek).not.toHaveBeenCalled();
  });
});
