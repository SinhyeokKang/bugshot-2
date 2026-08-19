// fake-indexeddb는 반드시 ../blob-db보다 먼저 — blob-db가 dbPromise에 백엔드를 캐시한다.
import "fake-indexeddb/auto";
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";

import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";

import {
  saveVideoBlob,
  getVideoBlob,
  deleteVideoBlob,
  getVideoBlobKeys,
  clearVideoBlobs,
  saveNetworkLog,
  getNetworkLog,
  deleteNetworkLog,
  getNetworkLogKeys,
  clearNetworkLogs,
  saveConsoleLog,
  getConsoleLog,
  deleteConsoleLog,
  getConsoleLogKeys,
  clearConsoleLogs,
  saveActionLog,
  getActionLog,
  deleteActionLog,
  getActionLogKeys,
  clearActionLogs,
  saveImageBlob,
  getImageBlobKeys,
  clearImageBlobs,
} from "../blob-db";

// 4패밀리를 하나의 순회로 돌리기 위한 어댑터. 시그니처가 동형이 아니다 —
// video는 (issueId, Blob), 로그 3종은 (key, NetworkLog|ConsoleLog|ActionLog)다.
// 값 팩토리(make)와 마커 판독(marker)을 패밀리별로 주입해 흡수한다.
interface Family {
  name: string;
  save: (key: string, value: never) => Promise<boolean>;
  get: (key: string) => Promise<unknown>;
  del: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
  make: (marker: string) => never;
  marker: (value: unknown) => Promise<string | null>;
}

const networkLog = (id: string): NetworkLog => ({
  id,
  startedAt: 1,
  endedAt: 2,
  totalSeen: 0,
  captured: 0,
  warnings: [],
  requests: [],
});

const consoleLog = (id: string): ConsoleLog => ({
  id,
  startedAt: 1,
  endedAt: 2,
  totalSeen: 0,
  captured: 0,
  entries: [],
});

const actionLog = (id: string): ActionLog => ({
  id,
  startedAt: 1,
  endedAt: 2,
  totalSeen: 0,
  captured: 0,
  entries: [],
});

const idMarker = async (value: unknown) =>
  value == null ? null : ((value as { id: string }).id ?? null);

const families: Family[] = [
  {
    name: "video",
    save: saveVideoBlob as Family["save"],
    get: getVideoBlob,
    del: deleteVideoBlob,
    keys: getVideoBlobKeys,
    clear: clearVideoBlobs,
    make: ((marker: string) => new Blob([marker], { type: "video/mp4" })) as Family["make"],
    marker: async (value) => (value == null ? null : await (value as Blob).text()),
  },
  {
    name: "network",
    save: saveNetworkLog as Family["save"],
    get: getNetworkLog,
    del: deleteNetworkLog,
    keys: getNetworkLogKeys,
    clear: clearNetworkLogs,
    make: networkLog as Family["make"],
    marker: idMarker,
  },
  {
    name: "console",
    save: saveConsoleLog as Family["save"],
    get: getConsoleLog,
    del: deleteConsoleLog,
    keys: getConsoleLogKeys,
    clear: clearConsoleLogs,
    make: consoleLog as Family["make"],
    marker: idMarker,
  },
  {
    name: "action",
    save: saveActionLog as Family["save"],
    get: getActionLog,
    del: deleteActionLog,
    keys: getActionLogKeys,
    clear: clearActionLogs,
    make: actionLog as Family["make"],
    marker: idMarker,
  },
];

const clearAll = async () => {
  for (const f of families) await f.clear();
};

beforeEach(async () => {
  await clearAll();
  await clearImageBlobs();
});

describe.each(families)("blob-db $name 패밀리 5함수", (family) => {
  it("save → get 왕복(값 보존)", async () => {
    expect(await family.save("issue-1", family.make("payload-a"))).toBe(true);
    expect(await family.marker(await family.get("issue-1"))).toBe("payload-a");
  });

  it("같은 키에 다시 save하면 덮어쓴다", async () => {
    await family.save("issue-1", family.make("old"));
    await family.save("issue-1", family.make("new"));
    expect(await family.marker(await family.get("issue-1"))).toBe("new");
    expect(await family.keys()).toEqual(["issue-1"]);
  });

  it("미존재 키 → null (throw 아님)", async () => {
    expect(await family.get("no-such-key")).toBeNull();
  });

  it("delete 후 get은 null, keys에서도 빠진다", async () => {
    await family.save("issue-1", family.make("payload-a"));
    await family.save("issue-2", family.make("payload-b"));
    await family.del("issue-1");
    expect(await family.get("issue-1")).toBeNull();
    expect(await family.keys()).toEqual(["issue-2"]);
  });

  it("미존재 키 delete는 no-op", async () => {
    await family.save("issue-1", family.make("payload-a"));
    await family.del("no-such-key");
    expect(await family.keys()).toEqual(["issue-1"]);
  });

  it("keys — 빈 스토어는 []", async () => {
    expect(await family.keys()).toEqual([]);
  });

  it("keys — 저장한 키를 전부 돌려준다", async () => {
    await family.save("issue-1", family.make("a"));
    await family.save("issue-2", family.make("b"));
    await family.save("pending:7", family.make("c"));
    expect([...(await family.keys())].sort()).toEqual(["issue-1", "issue-2", "pending:7"]);
  });

  it("clear — 스토어를 비운다", async () => {
    await family.save("issue-1", family.make("a"));
    await family.save("pending:7", family.make("b"));
    await family.clear();
    expect(await family.keys()).toEqual([]);
    expect(await family.get("issue-1")).toBeNull();
    expect(await family.get("pending:7")).toBeNull();
  });

  // 비대칭 2: 키 스코프. video는 issueId 단일이지만 로그 3종은 issueId(editor-store)와
  // pendingKey(tabId)(apply-trim·use-30s-replay) 2네임스페이스가 한 스토어에 섞인다.
  it("issueId와 pending:tabId 두 네임스페이스가 서로를 오염시키지 않는다", async () => {
    await family.save("issue-1", family.make("from-issue"));
    await family.save("pending:7", family.make("from-tab"));
    expect(await family.marker(await family.get("issue-1"))).toBe("from-issue");
    expect(await family.marker(await family.get("pending:7"))).toBe("from-tab");

    await family.del("pending:7");
    expect(await family.marker(await family.get("issue-1"))).toBe("from-issue");
    expect(await family.get("pending:7")).toBeNull();
    expect(await family.keys()).toEqual(["issue-1"]);
  });
});

describe("패밀리 간 스토어 격리", () => {
  it("같은 키를 4패밀리에 써도 각자 자기 값만 돌려준다", async () => {
    await saveVideoBlob("shared-key", new Blob(["v"], { type: "video/mp4" }));
    await saveNetworkLog("shared-key", networkLog("n"));
    await saveConsoleLog("shared-key", consoleLog("c"));
    await saveActionLog("shared-key", actionLog("a"));

    expect(await (await getVideoBlob("shared-key"))!.text()).toBe("v");
    expect((await getNetworkLog("shared-key"))!.id).toBe("n");
    expect((await getConsoleLog("shared-key"))!.id).toBe("c");
    expect((await getActionLog("shared-key"))!.id).toBe("a");
  });

  it("한 패밀리를 clear해도 나머지 3패밀리는 남는다", async () => {
    await saveVideoBlob("issue-1", new Blob(["v"], { type: "video/mp4" }));
    await saveNetworkLog("issue-1", networkLog("n"));
    await saveConsoleLog("issue-1", consoleLog("c"));
    await saveActionLog("issue-1", actionLog("a"));

    await clearConsoleLogs();

    expect(await getConsoleLogKeys()).toEqual([]);
    expect(await getVideoBlobKeys()).toEqual(["issue-1"]);
    expect(await getNetworkLogKeys()).toEqual(["issue-1"]);
    expect(await getActionLogKeys()).toEqual(["issue-1"]);
  });
});

describe("비대칭 1 — getVideoBlob만 런타임 타입 가드가 있다", () => {
  it("video 스토어에 Blob이 아닌 값이 들어있으면 null을 돌려준다", async () => {
    await saveVideoBlob("issue-1", { notABlob: true } as unknown as Blob);
    expect(await getVideoBlobKeys()).toEqual(["issue-1"]);
    expect(await getVideoBlob("issue-1")).toBeNull();
  });

  it("로그 3종은 무검증 캐스트라 이물질을 그대로 돌려준다", async () => {
    await saveNetworkLog("issue-1", { notALog: true } as unknown as NetworkLog);
    await saveConsoleLog("issue-1", { notALog: true } as unknown as ConsoleLog);
    await saveActionLog("issue-1", { notALog: true } as unknown as ActionLog);
    expect(await getNetworkLog("issue-1")).toEqual({ notALog: true });
    expect(await getConsoleLog("issue-1")).toEqual({ notALog: true });
    expect(await getActionLog("issue-1")).toEqual({ notALog: true });
  });
});

describe("clearImageBlobs", () => {
  it("이미지 스토어 전체를 비운다(issueId 무관)", async () => {
    await saveImageBlob("issue-1", "before", new Blob(["a"], { type: "image/png" }));
    await saveImageBlob("issue-1", "after", new Blob(["b"], { type: "image/png" }));
    await saveImageBlob("issue-2", "b0-before", new Blob(["c"], { type: "image/png" }));
    expect([...(await getImageBlobKeys())].sort()).toEqual([
      "issue-1:after",
      "issue-1:before",
      "issue-2:b0-before",
    ]);

    await clearImageBlobs();
    expect(await getImageBlobKeys()).toEqual([]);
  });

  it("이미지 스토어를 비워도 로그·영상 패밀리는 남는다", async () => {
    await saveImageBlob("issue-1", "before", new Blob(["a"], { type: "image/png" }));
    await saveVideoBlob("issue-1", new Blob(["v"], { type: "video/mp4" }));
    await saveNetworkLog("issue-1", networkLog("n"));

    await clearImageBlobs();

    expect(await getImageBlobKeys()).toEqual([]);
    expect(await getVideoBlobKeys()).toEqual(["issue-1"]);
    expect(await getNetworkLogKeys()).toEqual(["issue-1"]);
  });
});

// **파일의 마지막 describe여야 한다.** DB를 지우고 indexedDB.open을 throw로 바꾸면
// blob-db의 모듈 전역 dbPromise가 거부된 채 캐시돼 이후 모든 호출이 catch로 떨어진다.
// vitest는 테스트 파일마다 모듈 레지스트리를 격리하므로 다른 파일엔 번지지 않는다.
describe("DB를 열 수 없을 때 — 20함수 전부 throw 대신 안전한 기본값", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("bugshot-video");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("indexedDB unavailable");
      },
    });
  });

  it.each(families)("$name — save는 false, get은 null, keys는 []", async (family) => {
    warn.mockClear();
    expect(await family.save("issue-1", family.make("a"))).toBe(false);
    expect(await family.get("issue-1")).toBeNull();
    expect(await family.keys()).toEqual([]);
    await expect(family.del("issue-1")).resolves.toBeUndefined();
    await expect(family.clear()).resolves.toBeUndefined();
    // 무음 통과(스텁 미적용) 방지 — 5함수가 전부 catch를 밟았는지 경고 호출로 확인한다.
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("이미지 패밀리도 같다", async () => {
    warn.mockClear();
    expect(await saveImageBlob("issue-1", "before", new Blob(["a"]))).toBe(false);
    expect(await getImageBlobKeys()).toEqual([]);
    await expect(clearImageBlobs()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
