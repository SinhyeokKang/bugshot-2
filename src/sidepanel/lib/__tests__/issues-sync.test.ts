import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";

const rehydrate = vi.fn(() => Promise.resolve());
const lastWritten = vi.fn((): string | null => null);

vi.mock("@/store/issues-store", async () => {
  const actual = await vi.importActual<typeof import("@/store/issues-store")>(
    "@/store/issues-store",
  );
  return {
    ...actual,
    rehydrateIssuesFromExternalWrite: () => rehydrate(),
    lastWrittenIssuesValue: () => lastWritten(),
  };
});

import { installIssuesSync } from "../issues-sync";

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

describe("installIssuesSync", () => {
  let listeners: Listener[];
  let removed: Listener[];
  let dispose: () => void;

  const change = (oldValue: string | undefined, newValue: string | undefined) => ({
    [ISSUES_PERSIST_KEY]: { oldValue, newValue } as chrome.storage.StorageChange,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastWritten.mockReturnValue(null);
    listeners = [];
    removed = [];
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: (fn: Listener) => listeners.push(fn),
          removeListener: (fn: Listener) => removed.push(fn),
        },
      },
    });
    dispose = installIssuesSync(300);
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fire = (changes: Record<string, chrome.storage.StorageChange>, area = "local") => {
    for (const fn of listeners) fn(changes, area);
  };

  it("리스너를 실제로 등록한다", () => {
    expect(listeners).toHaveLength(1);
  });

  it("값이 바뀌면 throttle 간격 뒤에 rehydrate한다", () => {
    fire(change("a", "b"));
    expect(rehydrate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  // 다른 인스턴스의 배지 버스트가 전체 blob get+parse+merge를 N번 태우면 안 된다.
  it("연속 변경을 1회로 접는다", () => {
    fire(change("a", "b"));
    fire(change("b", "c"));
    fire(change("c", "d"));

    vi.advanceTimersByTime(300);
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it("local이 아닌 area는 무시한다", () => {
    fire(change("a", "b"), "sync");
    vi.advanceTimersByTime(300);
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it("다른 키의 변경은 무시한다", () => {
    fire({ "bugshot-settings": { oldValue: "a", newValue: "b" } });
    vi.advanceTimersByTime(300);
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it("동일 값 에코는 무시한다", () => {
    fire(change("a", "a"));
    vi.advanceTimersByTime(300);
    expect(rehydrate).not.toHaveBeenCalled();
  });

  // 모든 뮤테이터가 updatedAt을 올려 값 비교로는 자기 write가 안 걸러진다. 안 거르면 배지
  // 버스트가 읽기를 증폭시키고, 그 rehydrate의 getItem 중 로컬 삭제가 merge로 되살아난다.
  it("자기가 마지막으로 쓴 값은 무시한다", () => {
    lastWritten.mockReturnValue("mine");
    fire(change("old", "mine"));
    vi.advanceTimersByTime(300);
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it("자기 write 이후 들어온 다른 값은 동기화한다", () => {
    lastWritten.mockReturnValue("mine");
    fire(change("mine", "theirs"));
    vi.advanceTimersByTime(300);
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it("dispose가 리스너를 떼고 대기 중인 rehydrate를 취소한다", () => {
    fire(change("a", "b"));
    dispose();
    vi.advanceTimersByTime(300);

    expect(rehydrate).not.toHaveBeenCalled();
    expect(removed).toHaveLength(1);
  });
});
