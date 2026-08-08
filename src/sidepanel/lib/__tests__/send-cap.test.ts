import { describe, expect, it, vi } from "vitest";
import { withSendCap } from "../send-cap";

// content 리스너는 페이지 메인 스레드에서 디스패치된다 — 대상 탭이 alert()·동기 무한루프에
// 걸려 있으면(BugShot이 겨냥하는 바로 그 페이지) chrome.tabs.sendMessage가 영영 settle되지
// 않는다. 그 await를 감싼 전이는 finally에 도달 못 해 busy가 굳고, 세그먼트가 스피너를 문 채
// 패널 세션 내내 잠긴다.
describe("withSendCap", () => {
  it("제때 오면 그 값을 그대로 돌려준다", async () => {
    await expect(withSendCap(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("상한을 넘기면 undefined로 접는다", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = withSendCap(never, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(raced).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  // 상한 전에 거절되면 그 거절이 호출부 catch로 가야 한다 — 삼켜서 undefined로 접으면
  // "리시버 없음"과 "페이지 정지"가 한 값으로 뭉개진다.
  it("거절은 삼키지 않는다", async () => {
    await expect(withSendCap(Promise.reject(new Error("no receiver")), 50)).rejects.toThrow(
      "no receiver",
    );
  });

  // 상한에 걸려도 타이머가 남으면 fake timer 테스트·SW 수명 내내 핸들이 쌓인다.
  it("제때 온 경우 타이머를 남기지 않는다", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await withSendCap(Promise.resolve(1), 500);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
    vi.useRealTimers();
  });
});
