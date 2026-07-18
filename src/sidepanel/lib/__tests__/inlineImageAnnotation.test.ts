import { describe, expect, it, vi, beforeEach } from "vitest";

// blob-db(IndexedDB)는 모킹하고 헬퍼의 분기 로직만 검증한다. dataUrlToBlob은 순수 파서라
// 실물을 흉내 낸 구현으로 대체(refId·blob 왕복만 확인하면 됨).
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 mock 객체도 vi.hoisted로 함께 끌어올린다.
const db = vi.hoisted(() => ({
  hasInlineOrigin: vi.fn<(refId: string) => Promise<boolean>>(),
  getInlineImage: vi.fn<(refId: string) => Promise<Blob | null>>(),
  getInlineOrigin: vi.fn<(refId: string) => Promise<Blob | null>>(),
  saveInlineOrigin: vi.fn<(refId: string, blob: Blob) => Promise<boolean>>(),
  saveInlineImage: vi.fn<(refId: string, blob: Blob) => Promise<boolean>>(),
  deleteInlineOrigins: vi.fn<(refIds: string[]) => Promise<void>>(),
}));

vi.mock("@/store/blob-db", () => ({
  ...db,
  dataUrlToBlob: (url: string) => new Blob([url], { type: "image/webp" }),
}));

import { annotateInlineImage, resetInlineImage } from "../inlineImageAnnotation";

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.saveInlineOrigin.mockResolvedValue(true);
  db.saveInlineImage.mockResolvedValue(true);
  db.deleteInlineOrigins.mockResolvedValue(undefined);
});

describe("annotateInlineImage", () => {
  it("최초 어노테이션: 현재 표시 blob을 origin에 백업하고 표시 blob을 교체", async () => {
    const original = new Blob(["orig"], { type: "image/png" });
    db.hasInlineOrigin.mockResolvedValue(false);
    db.getInlineImage.mockResolvedValue(original);

    const result = await annotateInlineImage("ref1", "data:image/webp;base64,AAAA");

    expect(db.saveInlineOrigin).toHaveBeenCalledWith("ref1", original);
    expect(db.saveInlineImage).toHaveBeenCalledTimes(1);
    // 교체된 표시 blob은 어노테이션 dataUrl에서 나온 것(= 반환값과 동일 참조)
    const [refArg, blobArg] = db.saveInlineImage.mock.calls[0];
    expect(refArg).toBe("ref1");
    expect(blobArg).toBe(result);
    expect(await result.text()).toBe("data:image/webp;base64,AAAA");
  });

  it("재어노테이션: origin이 이미 있으면 원본을 덮지 않는다", async () => {
    db.hasInlineOrigin.mockResolvedValue(true);
    db.getInlineImage.mockResolvedValue(new Blob(["annotated-v1"]));

    await annotateInlineImage("ref1", "data:image/webp;base64,BBBB");

    expect(db.saveInlineOrigin).not.toHaveBeenCalled();
    expect(db.saveInlineImage).toHaveBeenCalledTimes(1);
  });

  it("현재 표시 blob이 null(유실)이면 백업을 건너뛰고 표시 blob만 교체", async () => {
    db.hasInlineOrigin.mockResolvedValue(false);
    db.getInlineImage.mockResolvedValue(null);

    await annotateInlineImage("ref1", "data:image/webp;base64,CCCC");

    expect(db.saveInlineOrigin).not.toHaveBeenCalled();
    expect(db.saveInlineImage).toHaveBeenCalledTimes(1);
  });
});

describe("resetInlineImage", () => {
  it("origin이 있으면 표시 blob을 원본으로 복원하고 origin을 삭제, 원본 반환", async () => {
    const original = new Blob(["orig"], { type: "image/png" });
    db.getInlineOrigin.mockResolvedValue(original);

    const result = await resetInlineImage("ref1");

    expect(db.saveInlineImage).toHaveBeenCalledWith("ref1", original);
    expect(db.deleteInlineOrigins).toHaveBeenCalledWith(["ref1"]);
    expect(result).toBe(original);
  });

  it("origin이 없으면 null 반환 + 부작용 없음", async () => {
    db.getInlineOrigin.mockResolvedValue(null);

    const result = await resetInlineImage("ref1");

    expect(result).toBeNull();
    expect(db.saveInlineImage).not.toHaveBeenCalled();
    expect(db.deleteInlineOrigins).not.toHaveBeenCalled();
  });
});
