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

  it("콜백 미공급이어도 렌더·선택이 깨지지 않는다", async () => {
    render(<NetworkLogContent requests={REQUESTS} />);

    await userEvent.click(row("r1"));

    expect(row("r1")).toBeTruthy();
  });
});
