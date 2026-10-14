import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings-store";
import { NotionConnectedBody } from "../connect/NotionConnectForm";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/bg-client", () => ({ sendBg: mocks.send }));
vi.mock("@/sidepanel/tabs/notionFields/DatabaseCombobox", () => ({ DatabaseCombobox: () => null }));
vi.mock("@/sidepanel/tabs/notionFields/PropertiesFieldset", () => ({ PropertiesFieldset: () => null }));
vi.mock("@/sidepanel/tabs/notionFields/StatusSelect", () => ({ StatusSelect: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("a schema response from the old account cannot reconcile replacement defaults for the same database ID", async () => {
  const account = { platform: "notion" as const, connectedAt: 1, auth: { kind: "apiKey" as const, token: "A", botName: "A" }, defaults: { databaseId: "same-db", statusOption: "keep" } };
  let raw: any = { version: 12, state: { accounts: { notion: account }, lastSubmitFields: {}, titlePrefix: "" } };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: object, run: () => unknown) => run() } });
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ "bugshot-settings": structuredClone(raw) }), set: async (data: any) => { raw = structuredClone(data["bugshot-settings"]); } } } });
  await useSettingsStore.persist.rehydrate();
  let finish!: (value: unknown) => void;
  mocks.send.mockImplementation(() => new Promise((resolve) => { finish ??= resolve; }));
  render(<NotionConnectedBody />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    useSettingsStore.getState().setAccount("notion", { ...account, auth: { kind: "apiKey", token: "B", botName: "B" } });
    await useSettingsStore.persist.flush();
    finish({ titleProperty: "Name", selectProperties: [], peopleProperties: [], statusProperty: null });
  });
  await useSettingsStore.persist.flush();
  expect(raw.state.accounts.notion.defaults.statusOption).toBe("keep");
});
