import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";

const rehydrate = vi.fn(() => Promise.resolve());
const shouldSync = vi.fn((_c?: chrome.storage.StorageChange): boolean => true);

vi.mock("@/store/issues-store", async () => {
  const actual = await vi.importActual<typeof import("@/store/issues-store")>(
    "@/store/issues-store",
  );
  return {
    ...actual,
    rehydrateIssuesFromExternalWrite: () => rehydrate(),
    shouldSyncIssuesChange: (c: chrome.storage.StorageChange | undefined) => shouldSync(c),
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
    vi.clearAllMocks();
    shouldSync.mockReturnValue(true);
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
    dispose = installIssuesSync();
  });

  afterEach(() => {
    dispose();
    vi.unstubAllGlobals();
  });

  const fire = (changes: Record<string, chrome.storage.StorageChange>, area = "local") => {
    for (const fn of listeners) fn(changes, area);
  };

  it("리스너를 실제로 등록한다", () => {
    expect(listeners).toHaveLength(1);
  });

  // throttle을 두면 그 대기 구간에 로컬 뮤테이션이 끼어들어 원격 삭제를 못 읽은 배열이
  // storage를 덮고, 뒤늦은 rehydrate가 이미 덮인 storage를 읽어 지워진 레코드를 되살린다.
  it("변경을 즉시 rehydrate한다 (지연 없음)", () => {
    fire(change("a", "b"));
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it("연속 변경을 삼키지 않는다", () => {
    fire(change("a", "b"));
    fire(change("b", "c"));
    expect(rehydrate).toHaveBeenCalledTimes(2);
  });

  it("local이 아닌 area는 무시한다 (판정 자체를 안 태운다)", () => {
    fire(change("a", "b"), "sync");
    expect(shouldSync).not.toHaveBeenCalled();
    expect(rehydrate).not.toHaveBeenCalled();
  });

  // 다른 키의 변경이 issues 판정으로 새면 무관한 write마다 전체 blob을 다시 읽는다.
  it("issues 키의 변경만 판정에 넘긴다", () => {
    fire({ "bugshot-settings": { oldValue: "a", newValue: "b" } });
    expect(shouldSync).toHaveBeenCalledWith(undefined);
  });

  // 에코·자기 write 판정은 store가 토큰을 소비하며 내린다 — 여기선 그 답을 따르기만 한다.
  it("판정이 false면 rehydrate하지 않는다", () => {
    shouldSync.mockReturnValue(false);
    fire(change("a", "b"));
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it("dispose가 리스너를 뗀다", () => {
    dispose();
    fire(change("a", "b"));

    expect(removed).toHaveLength(1);
  });
});
