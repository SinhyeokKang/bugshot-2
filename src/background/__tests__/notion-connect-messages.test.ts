import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BgRequest, BgResponse } from "@/types/messages";
import type { NotionAuth } from "@/types/notion";
import { onOAuthExpired } from "@/lib/app-events";
import { BgError, sendBg } from "@/lib/bg-client";

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

const stored = vi.hoisted(() => ({ auth: null as NotionAuth | null }));
vi.mock("@/lib/settings-storage", async (original) => ({
  ...(await original<object>()),
  readStoredNotionAuth: vi.fn(async () => stored.auth),
}));
vi.mock("@/i18n/bg-init", () => ({ initBgLocale: vi.fn() }));
vi.mock("@/lib/pending-log-prune", () => ({ pruneOrphanPendingLogsOncePerSession: vi.fn() }));
vi.mock("../tab-bindings", () => ({ setupTabBindings: vi.fn() }));

const storedAuth: NotionAuth = { kind: "apiKey", token: "stored-token", botName: "Existing bot" };
let listener: (request: BgRequest, sender: chrome.runtime.MessageSender, respond: (response: BgResponse) => void) => boolean | undefined;
let responses: BgResponse[];
const expired = vi.fn();
let unsubscribe: () => void;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: event(), onStartup: event(), onConnect: event(),
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
      sendMessage: (request: BgRequest, callback: (response: BgResponse) => void) => {
        const keepAlive = listener(request, {}, (response) => {
          const wire: BgResponse = JSON.parse(JSON.stringify(response));
          responses.push(wire);
          callback(wire);
        });
        expect(keepAlive).toBe(true);
      },
    },
    contextMenus: { onClicked: event() },
    webNavigation: { onBeforeNavigate: event(), onCommitted: event() },
  });
  await import("../index");
});

beforeEach(() => {
  responses = [];
  stored.auth = null;
  expired.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  unsubscribe = onOAuthExpired.subscribe(expired);
});
afterEach(() => { unsubscribe(); });
afterAll(() => { vi.unstubAllGlobals(); });

describe("Notion connection errors through the background message boundary", () => {
  it.each([false, true])("rejects an invalid new token without global expiration (existing connection: %s)", async (connected) => {
    stored.auth = connected ? storedAuth : null;
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    const error = await sendBg({ type: "notion.testToken", token: "invalid-new-token" }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BgError);
    expect(expired).not.toHaveBeenCalled();
    expect(responses).toEqual([{
      ok: false, error: "notion.oauthExpired", status: 400, body: { platform: "notion" },
    }]);
    expect(error).toMatchObject({ message: "notion.oauthExpired", status: 400, body: { platform: "notion" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.notion.com/v1/users/me", {
      method: "GET", headers: { Authorization: "Bearer invalid-new-token", "Notion-Version": "2022-06-28" },
    });
    expect(stored.auth).toBe(connected ? storedAuth : null);
  });

  it.each<NotionAuth>([
    storedAuth,
    { kind: "oauth", accessToken: "stored-token", botId: "bot", workspaceId: "ws", workspaceName: "Workspace", botName: "Existing bot", grantedAt: 1 },
  ])("preserves global expiration for stored $kind authentication", async (auth) => {
    stored.auth = auth;
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    await expect(sendBg({ type: "notion.getMyself" })).rejects.toMatchObject({
      status: 401, body: { oauthRefreshFailed: true, platform: "notion" },
    });

    expect(responses).toEqual([{
      ok: false, error: "notion.oauthExpired", status: 401, body: { oauthRefreshFailed: true, platform: "notion" },
    }]);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith("notion");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.notion.com/v1/users/me", {
      method: "GET", headers: { Authorization: "Bearer stored-token", "Notion-Version": "2022-06-28" },
    });
  });

  it("returns the new token profile without replacing stored authentication", async () => {
    stored.auth = storedAuth;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ type: "bot", name: "New bot", bot: { workspace_name: "New workspace" } })));

    await expect(sendBg({ type: "notion.testToken", token: "valid-new-token" })).resolves.toEqual({
      botName: "New bot", workspaceName: "New workspace",
    });

    expect(responses).toEqual([{ ok: true, result: { botName: "New bot", workspaceName: "New workspace" } }]);
    expect(expired).not.toHaveBeenCalled();
    expect(stored.auth).toBe(storedAuth);
  });
});
