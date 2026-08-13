import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  clearActionRecorder,
  clearConsoleRecorder,
  clearNetworkRecorder,
} from "../recorder-control";

const sendMessage = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  sendMessage.mockClear();
  vi.stubGlobal("chrome", { tabs: { sendMessage } });
});

// MAIN world는 "패널 로그도 함께 비워졌는가"를 알 수 없다 — 아는 건 보내는 쪽이다. 그래서
// clear가 의도를 싣고, MAIN 핸들러는 그 플래그일 때만 진입 항목 래치를 내린다.
// 무조건 내리면 prepareRecorders(activate→clear 순서) 뒤의 재arm에서 유령 항목이 생긴다.
describe("clearActionRecorder — 진입 항목 보충 의도", () => {
  it("기본값이면 플래그가 와이어에 실리지 않는다", () => {
    void clearActionRecorder(7);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "actionRecorder.clear" });
  });

  it("resupplyEntryNav를 주면 그대로 실어 보낸다", () => {
    void clearActionRecorder(7, { resupplyEntryNav: true });
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "actionRecorder.clear",
      resupplyEntryNav: true,
    });
  });

  // 실제 "보충 안 함" 동작은 MAIN 핸들러에 있고 유닛 불가다 — 여기선 값이 그대로 실리는지만 본다.
  it("false를 명시하면 false가 실린다", () => {
    void clearActionRecorder(7, { resupplyEntryNav: false });
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "actionRecorder.clear",
      resupplyEntryNav: false,
    });
  });
});

// 진입 항목 합성은 액션 로그에만 있는 개념이라 나머지 둘은 의도 축이 없다.
describe("clearNetworkRecorder / clearConsoleRecorder", () => {
  it("network는 의도 필드 없이 그대로 보낸다", () => {
    void clearNetworkRecorder(3);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: "networkRecorder.clear" });
  });

  it("console은 의도 필드 없이 그대로 보낸다", () => {
    void clearConsoleRecorder(3);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: "consoleRecorder.clear" });
  });
});
