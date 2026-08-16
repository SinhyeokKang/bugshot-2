import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
vi.stubGlobal("chrome", { tabs: { sendMessage: (...a: unknown[]) => sendMessage(...a) } });

import { sendToTabAllFrames } from "../sendToTabAllFrames";

const MSG = { type: "annotation.show" } as const;

beforeEach(() => {
  sendMessage.mockReset();
});

describe("sendToTabAllFrames", () => {
  it("tabId와 메시지를 그대로 chrome.tabs.sendMessage에 넘긴다", async () => {
    sendMessage.mockResolvedValue(undefined);

    await sendToTabAllFrames(7, MSG);

    expect(sendMessage).toHaveBeenCalledWith(7, MSG);
  });

  // 탭이 닫혔거나 content script가 안 깔린 경우가 정상 경로다 — 여기서 throw하면
  // 레코더 정리·오버레이 숨김 같은 뒷정리가 중간에 끊긴다.
  it("전송이 실패해도 삼키고 정상 종료한다", async () => {
    sendMessage.mockRejectedValue(new Error("Receiving end does not exist"));

    await expect(sendToTabAllFrames(7, MSG)).resolves.toBeUndefined();
  });

  // 위 케이스만으로는 "실패를 삼킨다"와 "애초에 안 보낸다"가 구별되지 않는다.
  it("실패 케이스에서도 전송 자체는 시도한다", async () => {
    sendMessage.mockRejectedValue(new Error("nope"));

    await sendToTabAllFrames(7, MSG);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
