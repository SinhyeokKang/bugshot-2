import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("Custom Webhook reference receiver", () => {
  it("preserves UTF-8 titles in the documented multipart receiver", async () => {
    const doc = readFileSync(new URL("../webhook-contract.md", import.meta.url), "utf8");
    const example = doc.match(/```js\n(import \{ createServer \}[\s\S]*?)\n```/)![1];
    const log = vi.fn();
    let receive!: (req: EventEmitter, res: unknown) => void;
    runInNewContext(example.replace('import { createServer } from "node:http";', ""), {
      createServer: (handler: typeof receive) => {
        receive = handler;
        return { listen: vi.fn() };
      },
      process: { env: { BUGSHOT_SECRET: "test-secret" } },
      Buffer,
      console: { log },
    });
    const title = "버튼 오류 — café 🐛";
    const form = new FormData();
    form.append("payload", JSON.stringify({
      title, body: "저장이 안 됩니다", media: [], bugshot: { idempotencyKey: "utf8-report" },
    }));
    const wire = new Response(form);
    const req = Object.assign(new EventEmitter(), {
      headers: {
        authorization: "Bearer test-secret",
        "content-type": wire.headers.get("content-type"),
      },
    });
    const res = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() };
    receive(req, res);
    req.emit("data", Buffer.from(await wire.arrayBuffer()));
    req.emit("end");
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.anything());
    expect(log).toHaveBeenCalledWith(title, "·", "");
  });
});
