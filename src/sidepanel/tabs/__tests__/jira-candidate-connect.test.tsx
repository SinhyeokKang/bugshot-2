import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings-store";
import { JiraConnectFlow } from "../connect/JiraConnectForm";
vi.mock("@/i18n", async (original) => ({ ...await original<object>(), useT: () => (key: string) => key }));
vi.mock("../connect/ConnectMethodDialog", () => ({ ConnectMethodDialog: (props: any) => props.open ? <button onClick={props.onChooseOAuth}>OAuth</button> : null }));
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/bg-client", async (original) => ({ ...await original<object>(), sendBg: mocks.send }));
let raw: any;
beforeEach(async () => {
  raw = { version: 12, state: { accounts: {}, lastSubmitFields: {}, titlePrefix: "" } };
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ "bugshot-settings": structuredClone(raw) }), set: async (data: any) => { raw = structuredClone(data["bugshot-settings"]); } } } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: object, run: () => unknown) => run() } });
  await useSettingsStore.persist.rehydrate();
  mocks.send.mockReset();
  mocks.send.mockImplementation(async (request) => {
    if (request.type === "oauth.available") return { available: true };
    if (request.type === "oauth.start") return { sites: [{ id: "site-b", url: "https://b.atlassian.net", name: "B" }], accessToken: "B", refreshToken: "RB", expiresAt: 9e15 };
    if (request.type === "jira.myself") {
      expect(request.context).toBe("candidate");
      expect(request.config.grantId).toBeTruthy();
      return { profile: { emailAddress: "b@example.com" }, auth: { ...request.config, accessToken: "B2", refreshToken: "RB2" } };
    }
    throw Error(request.type);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([false, true])("Jira connect stores the refreshed candidate returned from its profile query (reconnect=%s)", async (connected) => {
  if (connected) { raw.state.accounts.jira = { platform: "jira", auth: { kind: "oauth", grantId: "old", accessToken: "A", cloudId: "site-a" } }; await useSettingsStore.persist.rehydrate(); }
  const done = vi.fn();
  render(<JiraConnectFlow connected={connected} onConnected={done} autoStart onAutoStartHandled={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "OAuth" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  await useSettingsStore.persist.flush();
  expect(raw.state.accounts.jira.auth).toMatchObject({ cloudId: "site-b", email: "b@example.com", accessToken: "B2", refreshToken: "RB2" });
  expect(raw.state.accounts.jira.auth.grantId).not.toBe("old");
});
import { GithubConnectFlow } from "../connect/GithubConnectForm";
import { GitlabConnectFlow } from "../connect/GitlabConnectForm";
import { LinearConnectFlow } from "../connect/LinearConnectForm";
import { AsanaConnectFlow } from "../connect/AsanaConnectForm";
it.each([["github", GithubConnectFlow], ["gitlab", GitlabConnectFlow], ["linear", LinearConnectFlow], ["asana", AsanaConnectFlow]] as const)("%s connect consumer stores exactly the final candidate credentials", async (platform, Flow) => {
  const refreshed = { kind: "oauth", grantId: "candidate", accessToken: "B2", refreshToken: "RB2", expiresAt: 9e15, grantedAt: 1 };
  mocks.send.mockImplementation(async (request) => request.type.endsWith(".oauth.available") ? { available: true } : JSON.parse(JSON.stringify(refreshed)));
  const done = vi.fn();
  render(<Flow connected onConnected={done} autoStart onAutoStartHandled={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "OAuth" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  await useSettingsStore.persist.flush();
  expect(raw.state.accounts[platform].auth).toEqual(refreshed);
});
