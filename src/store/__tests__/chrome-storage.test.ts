import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chromeLocalStorage, failClosedLocalStorage } from "../chrome-storage";
import { onStateSaveFailed } from "@/types/messages";

const get = vi.fn();
const set = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("chrome", { storage: { local: { get, set, remove } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chromeLocalStorage — 삼킴이 의도인 쪽", () => {
  it("저장분을 그대로 돌려준다", async () => {
    get.mockResolvedValue({ k: '{"a":1}' });
    expect(await chromeLocalStorage.getItem("k")).toBe('{"a":1}');
  });

  it("키가 없으면 null", async () => {
    get.mockResolvedValue({});
    expect(await chromeLocalStorage.getItem("k")).toBeNull();
  });

  // settings 계열은 실패해도 기본값으로 떠야 한다 — 전파하면 onFinishHydration이 영영
  // 발화하지 않아 App의 렌더 게이트에서 패널이 빈 화면으로 굳는다(POSTMORTEM 2026-07-26).
  it("조회 실패를 삼켜 null을 준다 (렌더 게이트 보호)", async () => {
    get.mockRejectedValue(new Error("io"));
    expect(await chromeLocalStorage.getItem("k")).toBeNull();
  });

  it("removeItem 실패는 삼킨다", async () => {
    remove.mockRejectedValue(new Error("io"));
    await expect(chromeLocalStorage.removeItem("k")).resolves.toBeUndefined();
  });
});

// A-12: 쓰기 실패를 통째로 삼키면 confirmDraft가 true를 반환해 "초안 저장됨" 토스트가 뜨는데
// 레코드는 없다. rethrow 대신 blob 쪽(onBlobSaveFailed)과 대칭인 이벤트로 올린다.
describe("chromeLocalStorage.setItem — 실패 알림", () => {
  it("성공하면 알림이 없다", async () => {
    set.mockResolvedValue(undefined);
    const seen = vi.fn();
    const unsub = onStateSaveFailed.subscribe(seen);

    await chromeLocalStorage.setItem("k", "v");

    expect(set).toHaveBeenCalledWith({ k: "v" });
    expect(seen).not.toHaveBeenCalled();
    unsub();
  });

  it("실패하면 throw하지 않고 onStateSaveFailed를 발화한다", async () => {
    set.mockRejectedValue(new Error("QUOTA_BYTES quota exceeded"));
    const seen = vi.fn();
    const unsub = onStateSaveFailed.subscribe(seen);

    await expect(chromeLocalStorage.setItem("k", "v")).resolves.toBeUndefined();

    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });
});

// issues-store 전용. 조회 실패를 null로 뭉개면 참조 집합이 비어 보여 살아있는 blob이
// 전부 고아로 판정된다 — 실패를 전파해 zustand 에러 경로를 태우고 prune을 건너뛴다.
describe("failClosedLocalStorage", () => {
  it("정상 조회는 chromeLocalStorage와 같다", async () => {
    get.mockResolvedValue({ k: "v" });
    expect(await failClosedLocalStorage.getItem("k")).toBe("v");
  });

  it("조회 실패를 전파한다 (삼키지 않는다)", async () => {
    get.mockRejectedValue(new Error("io"));
    await expect(failClosedLocalStorage.getItem("k")).rejects.toThrow("io");
  });

  it("setItem/removeItem은 공용 어댑터를 그대로 쓴다", async () => {
    set.mockResolvedValue(undefined);
    await failClosedLocalStorage.setItem("k", "v");
    expect(set).toHaveBeenCalledWith({ k: "v" });
  });
});
