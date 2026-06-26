import { describe, expect, it } from "vitest";

import { clickupAuthHeader, flattenLists } from "../clickup-api";
import type { ClickupAuth } from "@/types/clickup";

describe("clickupAuthHeader — raw token (Bearer 없음)", () => {
  it("PAT은 Authorization에 pk_ 토큰을 그대로 (Bearer 접두사 없음)", () => {
    const auth: ClickupAuth = {
      kind: "pat",
      pat: "pk_123",
      viewerId: "u1",
      viewerName: "Me",
    };
    const headers = clickupAuthHeader(auth);
    expect(headers.Authorization).toBe("pk_123");
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("OAuth는 Authorization에 accessToken을 그대로 (Bearer 접두사 없음)", () => {
    const auth: ClickupAuth = {
      kind: "oauth",
      accessToken: "tok_abc",
      grantedAt: 1700000000000,
      viewerId: "u1",
      viewerName: "Me",
    };
    const headers = clickupAuthHeader(auth);
    expect(headers.Authorization).toBe("tok_abc");
    expect(headers.Authorization).not.toContain("Bearer");
  });
});

describe("flattenLists — folderless + folder list 평탄화", () => {
  it("folderless만 있으면 folderName 없이 반환", () => {
    const out = flattenLists(
      [
        { id: "l1", name: "List 1" },
        { id: "l2", name: "List 2" },
      ],
      [],
    );
    expect(out).toEqual([
      { id: "l1", name: "List 1" },
      { id: "l2", name: "List 2" },
    ]);
  });

  it("folder의 list는 folderName 라벨이 붙는다", () => {
    const out = flattenLists(
      [],
      [{ name: "Sprint", lists: [{ id: "l3", name: "List 3" }] }],
    );
    expect(out).toEqual([{ id: "l3", name: "List 3", folderName: "Sprint" }]);
  });

  it("folderless가 folder list보다 먼저 온다", () => {
    const out = flattenLists(
      [{ id: "l1", name: "Free" }],
      [{ name: "F", lists: [{ id: "l2", name: "InFolder" }] }],
    );
    expect(out.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(out[0].folderName).toBeUndefined();
    expect(out[1].folderName).toBe("F");
  });

  it("빈 lists를 가진 folder는 결과에 기여하지 않는다", () => {
    const out = flattenLists(
      [],
      [
        { name: "Empty", lists: [] },
        { name: "Has", lists: [{ id: "l9", name: "Nine" }] },
      ],
    );
    expect(out).toEqual([{ id: "l9", name: "Nine", folderName: "Has" }]);
  });

  it("입력이 모두 비면 빈 배열", () => {
    expect(flattenLists([], [])).toEqual([]);
  });
});
