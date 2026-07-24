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
    render(<TimelineRow item={actionItem()} isActive={false} videoStartedAt={0} onActivate={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.dataset.kind).toBe("action");
    expect(row.className).not.toContain("bg-red-100");
    expect(row.className).not.toContain("bg-blue-100");
  });

  it("console error 행: red 면색 + 스택 chevron", () => {
    render(<TimelineRow item={consoleItem("error", "boom", "at foo")} isActive={false} videoStartedAt={0} onActivate={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.dataset.kind).toBe("console");
    expect(row.className).toContain("bg-red-100");
    expect(screen.getByTestId("timeline-row-expand")).toBeTruthy();
  });

  it("console info 행: blue 면색 (우측 탭과 sync)", () => {
    render(<TimelineRow item={consoleItem("info")} isActive={false} videoStartedAt={0} onActivate={noop} />);
    expect(screen.getByTestId("timeline-row").className).toContain("bg-blue-100");
  });

  it("console log 행: 면색·chevron 없음(스택 없는 log)", () => {
    render(<TimelineRow item={consoleItem("log")} isActive={false} videoStartedAt={0} onActivate={noop} />);
    expect(screen.getByTestId("timeline-row").className).not.toContain("bg-");
    expect(screen.queryByTestId("timeline-row-expand")).toBeNull();
  });

  it("network 행: 자연어 동사 문장(좌) + method/status/time 메타(우), 상세 버튼 없음", () => {
    render(<TimelineRow item={networkItem({ method: "POST", url: "https://api.test/orders" })} isActive={false} videoStartedAt={0} onActivate={noop} />);
    // 좌측 문장: POST → "Posted" 자연어 동사 + 경로 슬롯.
    expect(screen.getByText("Posted", { exact: false })).toBeTruthy();
    expect(screen.getByText("/orders")).toBeTruthy();
    // 우측 메타: raw method·status·time.
    expect(screen.getByTestId("timeline-net-meta").textContent).toContain("POST");
    expect(screen.getByText("42ms")).toBeTruthy();
    expect(screen.queryByTestId("timeline-row-detail")).toBeNull();
  });
});

describe("TimelineRow — active/spine", () => {
  it("active면 border-l-primary + aria-current", () => {
    render(<TimelineRow item={actionItem()} isActive videoStartedAt={0} onActivate={noop} />);
    const row = screen.getByTestId("timeline-row");
    expect(row.className).toContain("border-l-primary");
    expect(row.getAttribute("aria-current")).toBe("true");
  });

  it("비active면 border-l-border (상시 rail 가시)", () => {
    render(<TimelineRow item={actionItem()} isActive={false} videoStartedAt={0} onActivate={noop} />);
    expect(screen.getByTestId("timeline-row").className).toContain("border-l-border");
  });
});

describe("TimelineRow — 타이포: console/action처럼 mono 본문, 요청 메타는 sans", () => {
  it("액션 본문은 mono", () => {
    render(<TimelineRow item={actionItem()} isActive={false} videoStartedAt={0} onActivate={noop} />);
    expect(screen.getByText("Clicked", { exact: false }).className).toContain("font-mono");
  });

  it("네트워크 좌측 문장 본문은 mono (console/action과 동일)", () => {
    render(<TimelineRow item={networkItem({ url: "https://api.test/orders" })} isActive={false} videoStartedAt={0} onActivate={noop} />);
    // 경로는 링크 span, mono는 부모 문장 컨테이너에.
    expect(screen.getByText("/orders").parentElement!.className).toContain("font-mono");
  });

  it("네트워크 경로는 action log URL처럼 파랑+밑줄 링크 표현(단, <a> 아님)", () => {
    render(<TimelineRow item={networkItem({ url: "https://api.test/orders" })} isActive={false} videoStartedAt={0} onActivate={noop} />);
    const path = screen.getByText("/orders");
    expect(path.className).toContain("underline");
    expect(path.className).toContain("text-blue");
    expect(path.tagName).not.toBe("A"); // URL 이동 아님 — 행 activation
  });

  it("네트워크 우측 메타는 sans", () => {
    render(<TimelineRow item={networkItem({ method: "POST" })} isActive={false} videoStartedAt={0} onActivate={noop} />);
    expect(screen.getByTestId("timeline-net-meta").className).not.toContain("font-mono");
  });

  it("raw method는 좌측 문장에 안 쓰이고 우측 메타에만 (색도 메타에만)", () => {
    render(<TimelineRow item={networkItem({ method: "POST" })} isActive={false} videoStartedAt={0} onActivate={noop} />);
    const posts = screen.getAllByText("POST");
    expect(posts).toHaveLength(1); // 좌측은 자연어 동사(Sent)라 raw "POST"는 메타 1곳뿐
    expect(posts[0].closest('[data-testid="timeline-net-meta"]')).toBeTruthy();
    expect(posts[0].className).toContain("text-green"); // methodColor(POST)
  });
});

describe("TimelineRow — 클릭 = seek + 탭 조회 동시 발화", () => {
  it("행 클릭 → onActivate(item)", async () => {
    const onActivate = vi.fn();
    const item = networkItem();
    render(<TimelineRow item={item} isActive={false} videoStartedAt={0} onActivate={onActivate} />);
    await userEvent.click(screen.getByText("/orders"));
    expect(onActivate).toHaveBeenCalledWith(item);
  });

  it("chevron 클릭 → 스택 확장, onActivate 미호출(stopPropagation)", async () => {
    const onActivate = vi.fn();
    render(<TimelineRow item={consoleItem("error", "boom", "at foo:1")} isActive={false} videoStartedAt={0} onActivate={onActivate} />);
    expect(screen.queryByText("at foo:1")).toBeNull();
    await userEvent.click(screen.getByTestId("timeline-row-expand"));
    expect(screen.getByText("at foo:1")).toBeTruthy();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
