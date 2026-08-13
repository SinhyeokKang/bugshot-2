import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";

import {
  saveAttachmentBlob,
  getAttachmentBlob,
  deleteAttachmentBlob,
  deleteAttachmentBlobs,
  getAttachmentBlobKeys,
  clearAttachmentBlobs,
  rekeyAttachmentBlobs,
  saveImageBlob,
  getImageBlob,
  deleteImageBlobs,
  getImageBlobKeys,
} from "../blob-db";

const blob = (text: string) => new Blob([text], { type: "image/png" });
const textOf = (b: Blob | null) => (b ? b.text() : Promise.resolve(null));

beforeEach(async () => {
  await clearAttachmentBlobs();
  await deleteImageBlobs("issue-1");
  await deleteImageBlobs("issue-2");
});

describe("attachment blobs — owner 스코프", () => {
  it("saveAttachmentBlob → getAttachmentBlob 왕복(내용 보존)", async () => {
    expect(await saveAttachmentBlob("pending:7", "file-a", blob("hello"))).toBe(true);
    expect(await textOf(await getAttachmentBlob("pending:7", "file-a"))).toBe("hello");
  });

  it("owner가 다르면 같은 id라도 서로 다른 파일이다", async () => {
    await saveAttachmentBlob("pending:7", "file-a", blob("from-tab"));
    await saveAttachmentBlob("issue-9", "file-a", blob("from-issue"));
    expect(await textOf(await getAttachmentBlob("pending:7", "file-a"))).toBe("from-tab");
    expect(await textOf(await getAttachmentBlob("issue-9", "file-a"))).toBe("from-issue");
  });

  it("없는 키는 null (throw 아님)", async () => {
    expect(await getAttachmentBlob("pending:7", "nope")).toBeNull();
  });

  it("deleteAttachmentBlob은 그 파일 하나만 지운다", async () => {
    await saveAttachmentBlob("pending:7", "a", blob("a"));
    await saveAttachmentBlob("pending:7", "b", blob("b"));
    await deleteAttachmentBlob("pending:7", "a");
    expect(await getAttachmentBlob("pending:7", "a")).toBeNull();
    expect(await textOf(await getAttachmentBlob("pending:7", "b"))).toBe("b");
  });

  it("deleteAttachmentBlobs는 그 owner의 파일만 전부 지운다", async () => {
    await saveAttachmentBlob("pending:7", "a", blob("a"));
    await saveAttachmentBlob("pending:7", "b", blob("b"));
    await saveAttachmentBlob("issue-9", "c", blob("c"));
    await deleteAttachmentBlobs("pending:7");
    expect(await getAttachmentBlobKeys()).toEqual(["issue-9:c"]);
  });

  // 키가 `${owner}:${id}` 평문 연결이라 owner 정리는 문자열 접두사 매치로 돈다. 구분자 `:`를
  // 빼고 매치하면 tab 1을 닫을 때 tab 12·17의 첨부까지 쓸려나간다 — 사용자가 다른 탭에서
  // 작성 중이던 초안의 파일이 조용히 사라지는 형태다.
  it("owner 접두사가 겹치는 다른 owner(pending:1 vs pending:12)를 건드리지 않는다", async () => {
    await saveAttachmentBlob("pending:1", "a", blob("tab1"));
    await saveAttachmentBlob("pending:12", "a", blob("tab12"));
    await deleteAttachmentBlobs("pending:1");
    expect(await getAttachmentBlob("pending:1", "a")).toBeNull();
    expect(await textOf(await getAttachmentBlob("pending:12", "a"))).toBe("tab12");
  });
});

describe("rekeyAttachmentBlobs — pending:tabId → issueId 이동", () => {
  it("지정한 id를 새 owner로 옮기고 원본을 지운다", async () => {
    await saveAttachmentBlob("pending:7", "a", blob("a"));
    await saveAttachmentBlob("pending:7", "b", blob("b"));

    expect(await rekeyAttachmentBlobs("pending:7", "issue-9", ["a", "b"])).toBe(true);

    expect(await textOf(await getAttachmentBlob("issue-9", "a"))).toBe("a");
    expect(await textOf(await getAttachmentBlob("issue-9", "b"))).toBe("b");
    expect(await getAttachmentBlob("pending:7", "a")).toBeNull();
    expect(await getAttachmentBlob("pending:7", "b")).toBeNull();
  });

  it("목록에 없는 id는 원래 owner에 남는다", async () => {
    await saveAttachmentBlob("pending:7", "a", blob("a"));
    await saveAttachmentBlob("pending:7", "keep", blob("keep"));

    await rekeyAttachmentBlobs("pending:7", "issue-9", ["a"]);

    expect(await textOf(await getAttachmentBlob("pending:7", "keep"))).toBe("keep");
    expect(await getAttachmentBlob("issue-9", "keep")).toBeNull();
  });

  // 이슈 확정 시점에 원본이 이미 없는 경우(다른 탭이 정리했거나 사용자가 지웠거나)까지
  // 실패로 보면 제출이 통째로 막힌다. 없는 건 건너뛰고 있는 것만 옮긴다.
  it("원본이 없는 id는 건너뛰고 나머지를 옮긴다", async () => {
    await saveAttachmentBlob("pending:7", "a", blob("a"));

    expect(
      await rekeyAttachmentBlobs("pending:7", "issue-9", ["missing", "a"]),
    ).toBe(true);

    expect(await textOf(await getAttachmentBlob("issue-9", "a"))).toBe("a");
    expect(await getAttachmentBlob("issue-9", "missing")).toBeNull();
  });

  it("옮길 게 없으면 아무것도 만들지 않는다", async () => {
    expect(await rekeyAttachmentBlobs("pending:7", "issue-9", ["a"])).toBe(true);
    expect(await getAttachmentBlobKeys()).toEqual([]);
  });
});

describe("image blobs — slot 스코프", () => {
  it("slot별로 따로 저장·조회된다", async () => {
    await saveImageBlob("issue-1", "before", blob("B"));
    await saveImageBlob("issue-1", "after", blob("A"));
    expect(await textOf(await getImageBlob("issue-1", "before"))).toBe("B");
    expect(await textOf(await getImageBlob("issue-1", "after"))).toBe("A");
  });

  // 복수 element 버퍼는 b0-before / b1-after 처럼 슬롯 이름이 동적으로 늘어난다. 정리가
  // before/after만 훑으면 그 버퍼 슬롯이 고아로 남는다.
  it("deleteImageBlobs는 b${n}-* 버퍼 슬롯까지 지우고 다른 이슈는 남긴다", async () => {
    await saveImageBlob("issue-1", "before", blob("B"));
    await saveImageBlob("issue-1", "b0-after", blob("b0"));
    await saveImageBlob("issue-1", "b12-before", blob("b12"));
    await saveImageBlob("issue-2", "before", blob("other"));

    await deleteImageBlobs("issue-1");

    expect(await getImageBlobKeys()).toEqual(["issue-2:before"]);
  });
});
