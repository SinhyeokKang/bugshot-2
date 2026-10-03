import { beforeEach, expect, it, vi } from "vitest";
const upload = vi.hoisted(() => vi.fn());
vi.mock("../gitlab-api", async (original) => ({ ...await original<object>(), uploadFile: upload }));
vi.mock("../asana-api", async (original) => ({ ...await original<object>(), uploadAttachment: upload }));
vi.mock("../clickup-api", async (original) => ({ ...await original<object>(), uploadAttachment: upload }));
vi.mock("@/lib/settings-storage", async (original) => ({ ...await original<object>(), ...Object.fromEntries(["Gitlab", "Asana", "Clickup"].map((name) => [`readStored${name}Auth`, vi.fn(async () => ({ accessToken: "dummy" }))])) }));
import { handleMessage } from "../messages";
beforeEach(() => upload.mockReset());
it.each(["gitlab", "asana", "clickup"])("%s upload producer retains only safe failure fields", async (platform) => {
  for (const [status, code] of [[413, "size-limit"], [401, "authentication"], [403, "permission"], [429, "rate-limit"], [504, "timeout"], [undefined, "network"]] as const) {
    upload.mockRejectedValueOnce(status === undefined ? new TypeError("private network payload") : Object.assign(new Error("secret API body"), { status }));
    const result = await handleMessage({ type: `${platform}.${platform === "clickup" ? "uploadFile" : "uploadFiles"}`, projectId: 1, parent: "p", taskId: "t", files: [{ fileId: "user:u", filename: "u.pdf", dataUrl: "data:application/pdf;base64,QQ==" }] } as never, {});
    expect(result).toEqual([{ fileId: "user:u", filename: "u.pdf", ok: false, failure: { stage: "upload", code, ...(status ? { httpStatus: status } : {}) } }]);
  }
});
