import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { uploadGithubFiles } from "../github-upload";

afterEach(() => vi.unstubAllGlobals());
describe("GitHub MAIN world upload identity", () => {
  it("round-trips colliding filenames after serializing the injection without module scope", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("policies")) return { ok: true, json: async () => ({ form: {}, upload_url: "https://upload.example/bytes", asset_upload_url: "/finalize", asset_upload_authenticity_token: "secret", asset: { href: "https://github.com/user-attachments/assets/file" } }) };
      return { ok: true, status: 200 };
    });
    vi.stubGlobal("chrome", { tabs: { create: async () => ({ id: 1 }), remove: async () => {}, onUpdated: { addListener: (fn: (id: number, info: { status: string }) => void) => queueMicrotask(() => fn(1, { status: "complete" })), removeListener: () => {} } }, scripting: { executeScript: async ({ func, args }: { func: Function; args: unknown[] }) => {
      const isolated = runInNewContext(`(${func.toString()})`, { fetch, atob, Blob, FormData, Uint8Array, URL, location: { origin: "https://github.com" } });
      return [{ result: await isolated(...args) }];
    } } });
    const files = ["capture:screenshot", "user:u"].map((fileId) => ({ fileId, filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:image/webp;base64,QQ==" }));
    const results = await uploadGithubFiles("o", "r", 1, files);
    expect(results.map((r) => [r.fileId, r.ok])).toEqual([["capture:screenshot", true], ["user:u", true]]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});

it.each([413, 401, 403, 429, 504])("serialized GitHub policy HTTP %s preserves safe status", async (status) => {
  const fetch = vi.fn(async () => ({ ok: false, status, text: async () => "private response" }));
  vi.stubGlobal("chrome", { tabs: { create: async () => ({ id: 1 }), remove: async () => {}, onUpdated: { addListener: (fn: (id: number, info: { status: string }) => void) => queueMicrotask(() => fn(1, { status: "complete" })), removeListener: () => {} } }, scripting: { executeScript: async ({ func, args }: { func: Function; args: unknown[] }) => [{ result: await runInNewContext(`(${func.toString()})`, { fetch, atob, Blob, FormData, Uint8Array, URL, location: { origin: "https://github.com" } })(...args) }] } });
  const results = await uploadGithubFiles("o", "r", 1, [{ fileId: "logs", filename: "logs.html", contentType: "text/html", dataUrl: "data:text/html;base64,QQ==" }]);
  expect(results[0]).toMatchObject({ fileId: "logs", ok: false, failure: { stage: "upload", httpStatus: status } });
  expect(JSON.stringify(results)).not.toContain("private");
});

// #252: a request that rejected before the finalize call left nothing on GitHub, so it is a definite failure.
describe("GitHub upload network rejection", () => {
  const run = (fetch: (url: string) => Promise<unknown>) => {
    vi.stubGlobal("chrome", { tabs: { create: async () => ({ id: 1 }), remove: async () => {}, onUpdated: { addListener: (fn: (id: number, info: { status: string }) => void) => queueMicrotask(() => fn(1, { status: "complete" })), removeListener: () => {} } }, scripting: { executeScript: async ({ func, args }: { func: Function; args: unknown[] }) => [{ result: await runInNewContext(`(${func.toString()})`, { fetch, atob, Blob, FormData, Uint8Array, URL, Error, TypeError, location: { origin: "https://github.com" } })(...args) }] } });
    return uploadGithubFiles("o", "r", 1, [{ fileId: "capture", filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:image/webp;base64,QQ==" }]);
  };
  const policy = { ok: true, json: async () => ({ form: {}, upload_url: "https://upload.example/bytes", asset_upload_url: "/finalize", asset_upload_authenticity_token: "t", asset: { href: "https://github.com/user-attachments/assets/file" } }) };

  it.each(["policy", "bytes"])("is not-sent when the %s request rejects", async (stage) => {
    const results = await run(async (url) => {
      if (url.includes("policies")) { if (stage === "policy") throw new TypeError("Failed to fetch"); return policy; }
      if (url.includes("upload.example")) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200 };
    });
    expect(results[0]).toMatchObject({ ok: false, failure: { stage: "upload", code: "not-sent" } });
  });

  it("stays a network result when the finalize request itself rejects", async () => {
    const results = await run(async (url) => {
      if (url.includes("policies")) return policy;
      if (url.includes("upload.example")) return { ok: true, status: 204 };
      throw new TypeError("Failed to fetch");
    });
    expect(results[0]).toMatchObject({ ok: false, failure: { stage: "upload", code: "network" } });
  });
});

it("is not-sent when the GitHub tab never became available", async () => {
  vi.stubGlobal("chrome", { tabs: { create: async () => { throw new Error("No tab"); }, remove: async () => {} }, scripting: { executeScript: vi.fn() } });
  const results = await uploadGithubFiles("o", "r", 1, [{ fileId: "capture", filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:image/webp;base64,QQ==" }]);
  expect(results[0]).toMatchObject({ ok: false, failure: { stage: "upload", code: "not-sent" } });
});
