import { describe, expect, it, vi } from "vitest";
import { bindSubmissionFiles, deliveryResults, submitCreation } from "../submissionAdapter";
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

describe("creation rejection classification", () => {
  it("only treats definite client rejection as safe to resubmit", async () => {
    const { submitCreation } = await import("../submissionAdapter");
    for (const status of [400, 401, 403, 404, 413, 422, 429]) {
      await expect(submitCreation(undefined, async () => { throw Object.assign(new Error("private raw body"), { status }); })).rejects.toMatchObject({ name: "SubmissionCreationRejectedError" });
    }
    for (const status of [408, 500, 502, 504, undefined]) {
      const error = Object.assign(new Error("ambiguous"), { status });
      await expect(submitCreation(undefined, async () => { throw error; })).rejects.toBe(error);
    }
  });
});

it.each(["channel_not_found", "invalid_auth", "not_in_channel", "ratelimited"])("classifies positive Slack %s creation rejection across RPC", async (code) => {
  const { postMessage } = await import("@/background/slack-api");
  const { serializePlatformError } = await import("@/background/platformErrors");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: code }), { status: 200 })));
  await expect(submitCreation(undefined, async () => {
    try { return await postMessage({ accessToken: "dummy" } as never, { channelId: "C", text: "title" }); }
    catch (e) { throw Object.assign(new Error("RPC error"), serializePlatformError(e)); }
  })).rejects.toMatchObject({ name: "SubmissionCreationRejectedError" });
  vi.unstubAllGlobals();
});

it.each([{ ok: false, error: "unknown_error" }, { error: "channel_not_found" }, {}])("keeps malformed or unknown Slack replies ambiguous: %j", async (body) => {
  const { postMessage } = await import("@/background/slack-api");
  const { serializePlatformError } = await import("@/background/platformErrors");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  await expect(submitCreation(undefined, async () => {
    try { return await postMessage({ accessToken: "dummy" } as never, { channelId: "C", text: "title" }); }
    catch (e) { throw Object.assign(new Error("RPC error"), serializePlatformError(e)); }
  })).rejects.not.toMatchObject({ name: "SubmissionCreationRejectedError" });
  vi.unstubAllGlobals();
});
