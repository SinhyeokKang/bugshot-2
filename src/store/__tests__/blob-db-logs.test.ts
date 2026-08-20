// fake-indexeddb는 반드시 ../blob-db보다 먼저 — blob-db가 dbPromise에 백엔드를 캐시한다.
import "fake-indexeddb/auto";
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";

import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { pendingKey } from "@/lib/session-keys";

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
// 값 팩토리를 save 안으로 접어 캐스트 없이 흡수한다 — 팩토리를 따로 들면 타입 인자를
// `never`로 뭉개야 하고, 그러면 network 행에 consoleLog 팩토리를 꽂아도 컴파일이 통과한다.
interface Family {
  name: string;
  save: (key: string, marker: string) => Promise<boolean>;
  get: (key: string) => Promise<unknown>;
  del: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
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
    save: (key, marker) => saveVideoBlob(key, new Blob([marker], { type: "video/mp4" })),
    get: getVideoBlob,
    del: deleteVideoBlob,
    keys: getVideoBlobKeys,
    clear: clearVideoBlobs,
    marker: async (value) => (value == null ? null : await (value as Blob).text()),
  },
  {
    name: "network",
    save: (key, marker) => saveNetworkLog(key, networkLog(marker)),
    get: getNetworkLog,
    del: deleteNetworkLog,
    keys: getNetworkLogKeys,
    clear: clearNetworkLogs,
    marker: idMarker,
  },
  {
    name: "console",
    save: (key, marker) => saveConsoleLog(key, consoleLog(marker)),
    get: getConsoleLog,
    del: deleteConsoleLog,
    keys: getConsoleLogKeys,
    clear: clearConsoleLogs,
    marker: idMarker,
  },
  {
    name: "action",
    save: (key, marker) => saveActionLog(key, actionLog(marker)),
    get: getActionLog,
    del: deleteActionLog,
    keys: getActionLogKeys,
    clear: clearActionLogs,
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
    expect(await family.save("issue-1", "payload-a")).toBe(true);
    expect(await family.marker(await family.get("issue-1"))).toBe("payload-a");
  });

  it("같은 키에 다시 save하면 덮어쓴다", async () => {
    await family.save("issue-1", "old");
    await family.save("issue-1", "new");
    expect(await family.marker(await family.get("issue-1"))).toBe("new");
    expect(await family.keys()).toEqual(["issue-1"]);
  });

  it("미존재 키 → null (throw 아님)", async () => {
    expect(await family.get("no-such-key")).toBeNull();
  });

  it("delete 후 get은 null, keys에서도 빠진다", async () => {
    await family.save("issue-1", "payload-a");
    await family.save("issue-2", "payload-b");
    await family.del("issue-1");
    expect(await family.get("issue-1")).toBeNull();
    expect(await family.keys()).toEqual(["issue-2"]);
  });

  it("미존재 키 delete는 no-op", async () => {
    await family.save("issue-1", "payload-a");
    await family.del("no-such-key");
    expect(await family.keys()).toEqual(["issue-1"]);
  });

  it("keys — 빈 스토어는 []", async () => {
    expect(await family.keys()).toEqual([]);
  });

  it("keys — 저장한 키를 전부 돌려준다", async () => {
    await family.save("issue-1", "a");
    await family.save("issue-2", "b");
    await family.save("pending:7", "c");
    expect([...(await family.keys())].sort()).toEqual(["issue-1", "issue-2", "pending:7"]);
  });

  it("clear — 스토어를 비운다", async () => {
    await family.save("issue-1", "a");
    await family.save("pending:7", "b");
    await family.clear();
    expect(await family.keys()).toEqual([]);
    expect(await family.get("issue-1")).toBeNull();
    expect(await family.get("pending:7")).toBeNull();
  });

  // 비대칭 2: 키 스코프. video는 issueId 단일이지만 로그 3종은 issueId(editor-store)와
  // pendingKey(tabId)(apply-trim·use-30s-replay) 2네임스페이스가 한 스토어에 섞인다.
  // blob-db 자신은 키를 불투명 문자열로 넘길 뿐이라 격리는 IndexedDB가 준다 — 여기서
  // 실제로 잠그는 건 **pendingKey가 issueId와 충돌하지 않는 접두사를 만든다**는 계약이다
  // (그래서 리터럴이 아니라 pendingKey를 태운다). 호출부가 이 빌더를 안 쓰고 raw tabId를
  // 넘기는 회귀는 여기가 아니라 `apply-trim.test.ts`가 잡는다.
  it("issueId와 pendingKey(tabId) 두 네임스페이스가 서로를 오염시키지 않는다", async () => {
    const tabKey = pendingKey(7);
    expect(tabKey).not.toBe("7");

    await family.save("issue-1", "from-issue");
    await family.save(tabKey, "from-tab");
    expect(await family.marker(await family.get("issue-1"))).toBe("from-issue");
    expect(await family.marker(await family.get(tabKey))).toBe("from-tab");

    await family.del(tabKey);
    expect(await family.marker(await family.get("issue-1"))).toBe("from-issue");
    expect(await family.get(tabKey)).toBeNull();
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
    expect(await family.save("issue-1", "a")).toBe(false);
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
