import { describe, expect, it } from "vitest";
import { bindSubmissionFiles, deliveryResults } from "../submissionAdapter";
import type { SubmissionFile } from "@/types/attachment";

const files: SubmissionFile[] = [
  { id: "capture:screenshot", kind: "capture", filename: "screenshot.jpg", contentType: "image/jpeg", dataUrl: "data:FROZEN" },
  { id: "logs", kind: "logs", filename: "logs.zip", contentType: "application/zip", dataUrl: "data:ZIP" },
  { id: "user:u", kind: "user", filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:USER" },
];
describe("prepared adapter files", () => {
  it("consumes frozen bytes and IDs while keeping category identity on filename collisions", () => {
    const result = bindSubmissionFiles({ images: [{ filename: "screenshot.webp", dataUrl: "old" }], logs: [{ filename: "logs.html", dataUrl: "old" }], attachments: [{ filename: "u__screenshot.webp", dataUrl: "old", displayName: "screenshot.webp" }], submissionFiles: files });
    expect(result.images?.[0]).toMatchObject({ fileId: "capture:screenshot", filename: "screenshot.jpg", dataUrl: "data:FROZEN" });
    expect(result.logs?.[0]).toMatchObject({ fileId: "logs", filename: "logs.zip", dataUrl: "data:ZIP" });
    expect(result.attachments?.[0]).toMatchObject({ fileId: "user:u", dataUrl: "data:USER", displayName: "screenshot.webp" });
  });
  it("never accepts a matching filename in place of a returned file ID", () => {
    const result = deliveryResults(files, [{ filename: "screenshot.jpg", ok: true, href: "https://host/a" }]);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.delivery === "unknown")).toBe(true);
  });
  it("does not let duplicate responses or a user success conceal missing capture evidence", () => {
    const result = deliveryResults(files, [{ fileId: "user:u", ok: true, href: "https://host/u" }, { fileId: "logs", ok: true, href: "https://host/l" }, { fileId: "logs", ok: true, href: "https://host/l" }]);
    expect(result.map((r) => r.delivery)).toEqual(["unknown", "unknown", "attached"]);
  });
});
