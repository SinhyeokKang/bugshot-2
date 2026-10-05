import type { Page } from "@playwright/test";
import { expect, test } from "./extension";
import type { SubmissionRecoveryMeta } from "../../src/types/attachment";

export type Extension = Parameters<Parameters<typeof test>[2]>[0]["ext"];
export type Provider = "github" | "jira" | "clickup" | "asana" | "slack" | "webhook" | "notion";
export type Rpc = { type: string; payload?: Record<string, any>; files?: any[]; attachment?: any; [key: string]: any };
export const PDF = "%PDF-1.4\nrecovery 原本\n%%EOF";
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
export const KEYS = ["bugshot-settings", "bugshot-app-settings", "bugshot-issues"];
export const REMOTE = "https://example.com/issues/42";
export const createType: Record<Provider, string> = { github: "github.submitIssue", jira: "jira.createIssue", clickup: "clickup.submitIssue", asana: "asana.submitIssue", slack: "slack.postMessage", webhook: "webhook.submit", notion: "notion.submitPage" };
export const creates = (calls: Rpc[], provider: Provider) => calls.filter((m) => m.type === createType[provider] && !m.payload?.threadTs);

export async function openRecoveryPanel(ext: Extension, tabId: number) {
  const panel = await ext.context.newPage();
  await panel.addInitScript(() => {
    const target = window as any;
    if (target.__recoveryRpcInstalled) return;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: Rpc, callback?: (response: unknown) => void) => {
      if (/^(github|jira|linear|notion|gitlab|asana|clickup|slack|webhook|analytics)\./.test(message.type ?? "")) {
        callback?.({ ok: true, result: [] });
        return;
      }
      return original(message as never, callback as never);
    }) as typeof chrome.runtime.sendMessage;
  });
  await panel.goto(`chrome-extension://${ext.extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
  return panel;
}

export async function installRpc(panel: Page, provider: Provider, options: { failIds?: string[]; rejectUpload?: boolean; pending?: "create" | "upload"; slackFailure?: "thread" | "permalink" } = {}, calls: Rpc[] = []) {
  await panel.exposeFunction("__recoveryRecord", (message: Rpc) => calls.push(message));
  const install = ({ provider, options, remote }: { provider: Provider; options: { failIds?: string[]; rejectUpload?: boolean; pending?: "create" | "upload"; slackFailure?: "thread" | "permalink" }; remote: string }) => {
    (window as any).__recoveryRpcInstalled = true;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: Rpc, callback?: (response: unknown) => void) => {
      if (!msg.type?.startsWith(`${provider}.`) && msg.type !== "analytics.capture") {
        if (/^(github|jira|linear|notion|gitlab|asana|clickup|slack|webhook|analytics)\./.test(msg.type ?? "")) return callback?.({ ok: true, result: [] });
        return original(msg as never, callback as never);
      }
      const success = (result: unknown) => callback?.({ ok: true, result });
      const failure = () => callback?.({ ok: false, error: "deterministic upload rejection", status: 403 });
      void (window as any).__recoveryRecord(msg).then(() => {
        if (msg.type === "analytics.capture") return success(undefined);
        const create = /\.(submitIssue|createIssue|submit|submitPage)$/.test(msg.type) || (msg.type === "slack.postMessage" && !msg.payload?.threadTs);
        if (create) {
          if (options.pending === "create") return;
          if (provider === "notion") return success({ pageId: "page-42", url: remote, attachedFileIds: msg.payload?.attachments?.map((f: any) => f.fileId) ?? [] });
          if (provider === "github") return success({ number: 42, url: remote });
          if (provider === "jira") return success({ key: "BUG-42", url: remote, siteId: "site" });
          if (provider === "asana") return success({ gid: "42", permalinkUrl: remote });
          if (provider === "clickup") return success({ id: "42", url: remote });
          if (provider === "slack") return success({ ts: "42.1" });
          return success({ key: "42", url: remote });
        }
        if (msg.type === "slack.postMessage") return options.slackFailure === "thread" ? failure() : success({ ts: "42.2" });
        if (msg.type === "slack.getPermalink") return options.slackFailure === "permalink" ? failure() : success({ permalink: remote });
        if (msg.type === "slack.requestFileUpload") {
          if (options.pending === "upload") return;
          if (options.rejectUpload || options.failIds?.some((id) => msg.fileId === id || msg.fileId?.startsWith(id))) return failure();
          return success({ fileId: `remote-${msg.fileId}`, uploadUrl: "https://files.slack.com/upload/v1/e2e" });
        }
        if (msg.type === "slack.sendFileUpload" || msg.type === "slack.completeFileUploads") return success({ ok: true });
        if (/\.(uploadFiles|uploadAttachment)$/.test(msg.type)) {
          if (options.pending === "upload") return;
          if (options.rejectUpload) return failure();
          const files = msg.files ?? [msg.attachment];
          const result = files.map((f: any) => options.failIds?.some((id) => f.fileId === id || f.fileId?.startsWith(id))
            ? { fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } }
            : { fileId: f.fileId, filename: f.filename, ok: true, href: `https://example.com/files/${encodeURIComponent(f.fileId)}`, gid: `gid-${f.fileId}`, file: { kind: "external", url: `https://example.com/files/${encodeURIComponent(f.fileId)}` } });
          return success(msg.attachment ? result[0] : result);
        }
        if (msg.type === "notion.getDatabaseSchema") return success({ titlePropertyName: "Name", statusProperty: null, selectProperties: [] });
        if (msg.type === "notion.uploadFile") return options.failIds?.includes(msg.fileId) ? failure() : success({ fileId: msg.fileId, fileUploadId: "upload-42" });
        if (msg.type === "jira.listProjects") return success([{ id: "1", key: "BUG", name: "Bug" }]);
        if (msg.type === "jira.listIssueTypes") return success([{ id: "1", name: "Bug" }]);
        if (/\.(getIssue|getTask|getIssueStatus|getTaskStatus)$/.test(msg.type)) return success({ title: "Recovery acceptance", status: "Open", url: remote });
        if (/\.(update|createAttachment)/.test(msg.type)) return success({ ok: true });
        return success([]);
      });
    }) as typeof chrome.runtime.sendMessage;
  };
  const args = { provider, options, remote: REMOTE };
  await panel.addInitScript(install, args);
  await panel.evaluate(install, args);
  return calls;
}

export async function setup(ext: Extension, id: string, provider: Provider, options: { kinds?: ("capture" | "video" | "inline" | "user" | "logs")[]; missing?: string; locale?: "en" | "ko" | "fr"; theme?: "light" | "dark"; logsOff?: boolean; title?: string; webp?: boolean; filename?: string; description?: string } = {}) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const kinds = options.kinds ?? ["user"];
  const title = options.title ?? "Recovery acceptance";
  const issue = {
    id, status: "draft", platform: provider, title, createdAt: Date.now(), updatedAt: Date.now(), pageUrl: fixture.url(),
    captureMode: kinds.includes("video") ? "video" : kinds.includes("capture") ? "screenshot" : "freeform",
    draft: { title, sections: { description: options.description ?? (kinds.includes("inline") ? "![inline](inline:recover-image)" : "Broken page") } },
    snapshot: { before: kinds.includes("capture"), after: false },
    ...(kinds.includes("video") ? { videoBlobKey: id } : {}),
    ...(kinds.includes("logs") ? { consoleLogBlobKey: id } : {}),
    logsAttached: !options.logsOff,
    ...(kinds.includes("user") ? { attachments: [{ id: "pdf", filename: options.filename ?? "customer.pdf", contentType: "application/pdf", size: Buffer.byteLength(PDF) }] } : {}),
  };
  const defaults = { github: { owner: "owner", repo: "repo" }, jira: { projectKey: "BUG", issueTypeId: "1", siteId: "site" }, asana: { workspaceGid: "workspace", workspaceName: "Workspace" }, clickup: { workspaceId: "workspace", workspaceName: "Workspace", listId: "list", listName: "List" }, slack: { channelId: "channel", channelName: "bugs" }, webhook: {}, notion: { databaseId: "database", databaseTitle: "Database", selectValues: [] } };
  const account = { platform: provider, connectedAt: 1, defaults: {}, auth: provider === "webhook" ? { url: "https://example.com/hook", format: "multipart", headers: [] } : { kind: "oauth", accessToken: "dummy", cloudId: "site", grantedAt: Date.now() }, ...(provider === "jira" ? { projectKey: "BUG", issueTypeId: "1", issueTypeName: "Bug" } : {}) };
  await ext.evalInExt(async ({ issue, account, provider, defaults, options, kinds, png, pdf }) => {
    await chrome.storage.local.set({
      "bugshot-settings": JSON.stringify({ state: { accounts: { [provider]: account }, lastSubmitFields: defaults, titlePrefix: "" }, version: 12 }),
      "bugshot-app-settings": JSON.stringify({ state: { locale: options.locale ?? "en", theme: options.theme ?? "light", attachmentsEnabled: true, issueSections: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }] }, version: 11 }),
      "bugshot-issues": JSON.stringify({ state: { issues: [issue] }, version: 5 }),
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("bugshot-video", 9);
      req.onupgradeneeded = () => { for (const name of ["blobs", "images", "networkLogs", "consoleLogs", "actionLogs", "inlineImages", "inlineImageOrigins", "attachments", "submissionRecovery"]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    let image = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" });
    if (options.webp) {
      const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
      canvas.getContext("2d")!.fillRect(0, 0, 8, 8); image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/webp"));
    }
    const tx = db.transaction([...db.objectStoreNames], "readwrite");
    if (kinds.includes("capture") && options.missing !== "capture") tx.objectStore("images").put(image, `${issue.id}:before`);
    if (kinds.includes("video") && options.missing !== "video") tx.objectStore("blobs").put(new Blob(["video-bytes"], { type: "video/webm" }), issue.id);
    if (kinds.includes("inline") && options.missing !== "inline") tx.objectStore("inlineImages").put(image, "recover-image");
    if (kinds.includes("user") && options.missing !== "user") tx.objectStore("attachments").put(new Blob([pdf], { type: "application/pdf" }), `${issue.id}:pdf`);
    if (kinds.includes("logs") && options.missing !== "logs") tx.objectStore("consoleLogs").put({ entries: [{ id: "entry", level: "error", args: ["failure"], timestamp: Date.now() }], captured: 1, dropped: 0, startedAt: Date.now() }, issue.id);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { issue, account, provider, defaults, options, kinds, png: PNG, pdf: PDF });
  const panel = await openRecoveryPanel(ext, tabId);
  await expect(panel.getByTestId("tab-issue-list")).toBeVisible();
  const sourcePresence = await panel.evaluate(async ({ id, kinds }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video", 9); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const sourceKeys = { capture: ["images", `${id}:before`], video: ["blobs", id], inline: ["inlineImages", "recover-image"], user: ["attachments", `${id}:pdf`], logs: ["consoleLogs", id] };
    const found = await Promise.all(kinds.map(async (kind) => {
      const [store, key] = sourceKeys[kind];
      const value = await new Promise<unknown>((resolve, reject) => { const req = db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      return { kind, present: kind === "logs" ? value != null : value instanceof Blob && value.size > 0 };
    }));
    db.close(); return found;
  }, { id, kinds });
  expect(sourcePresence).toEqual(kinds.map((kind) => ({ kind, present: options.missing !== kind })));
  return { panel, fixture, tabId, id };
}

export async function state(panel: Page, id: string) {
  return panel.evaluate(async (id) => {
    const raw = (await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"];
    const issue = raw ? JSON.parse(raw).state.issues.find((i: any) => i.id === id) : undefined;
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const get = (store: string, key: string) => new Promise<any>((resolve, reject) => { const req = db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const journal: SubmissionRecoveryMeta | undefined = await get("submissionRecovery", `attempt:${id}`);
    const sources = await Promise.all((journal?.files ?? []).map(async (f) => { const blob = await get(f.source.kind === "original" ? f.source.store : "submissionRecovery", f.source.key); return { id: f.id, type: blob?.type, bytes: blob instanceof Blob ? [...new Uint8Array(await blob.arrayBuffer())] : null }; }));
    db.close();
    return { issue, journal, sources };
  }, id);
}

export async function openSavedSubmit(panel: Page) {
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("issue-row")).toBeVisible();
  await panel.getByTestId("issue-row").click();
  await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
  await panel.getByTestId("detail-submit-open").click();
  await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
}
export async function submitSaved(panel: Page) { await openSavedSubmit(panel); await panel.getByTestId("submit-issue-confirm").click(); }
export async function openRecovery(panel: Page) {
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
  await panel.getByTestId("recovery-detail-open").click();
  await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
  await expect(panel.getByTestId("detail-submit-open")).toHaveCount(0);
  await expect(panel.getByTestId("submit-issue-confirm")).toHaveCount(0);
}
export async function cleanup(ext: Extension, pages: Page[], ids: string[]) {
  for (const page of pages) if (!page.isClosed()) await page.close();
  await ext.evalInExt(async ({ ids, keys }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction([...db.objectStoreNames], "readwrite");
    for (const name of db.objectStoreNames) {
      const store = tx.objectStore(name); const req = store.openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return;
        if (name === "submissionRecovery" && ids.includes(c.value?.issueId)) { for (const f of c.value.files) if (f.source.kind === "generated") store.delete(f.source.key); c.delete(); }
        else if (typeof c.key === "string" && (c.key === "recover-image" || ids.some((id) => c.key === id || String(c.key).startsWith(`${id}:`)))) c.delete();
        c.continue();
      };
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    await chrome.storage.local.remove(keys);
  }, { ids, keys: KEYS });
}

export type RemoteConfig = {
  // Per-file upload rejections (HTTP 403 inside a successful batch) and a whole-batch rejection.
  failIds?: string[]; rejectUpload?: boolean;
  // The per-file failure failIds answer with (default: HTTP 403).
  failure?: { stage: "upload"; code: string; httpStatus?: number };
  // A held upload never answers: the retry stays running.
  hangUpload?: boolean;
  // GitHub/ClickUp body write.
  bodyWrite?: "ok" | "reject";
  // Status of the existing-issue read every retry starts with (401/403/404).
  readStatus?: number;
  // Account lookup: the submitting account, another account, or a lookup that cannot be answered.
  identity?: "self" | "other" | "network";
  slackComplete?: "ok" | "ambiguous";
  // Webhook creation answered with this HTTP status.
  createStatus?: number;
};

// A stateful remote for the phase-two flows: it remembers the issue body the create message sent,
// serves it back to the existing-issue reads, and applies body writes, so a retry is judged by what
// it sends to a remote that changed meanwhile. The page owns the state; use setRemote/setRemoteBody.
export async function installRemote(panel: Page, provider: Provider, config: RemoteConfig = {}, calls: Rpc[] = []) {
  await panel.exposeFunction("__recoveryRecord", (message: Rpc) => calls.push(message));
  const install = ({ provider, config, remote }: { provider: Provider; config: RemoteConfig; remote: string }) => {
    const w = window as any;
    w.__recoveryRpcInstalled = true;
    w.__remote = { config: { ...config }, body: null as string | null };
    const state = w.__remote as { config: RemoteConfig; body: string | null };
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: Rpc, callback?: (response: unknown) => void) => {
      if (!msg.type?.startsWith(`${provider}.`) && msg.type !== "analytics.capture") {
        if (/^(github|jira|linear|notion|gitlab|asana|clickup|slack|webhook|analytics)\./.test(msg.type ?? "")) return callback?.({ ok: true, result: [] });
        return original(msg as never, callback as never);
      }
      const ok = (result: unknown) => callback?.({ ok: true, result });
      const fail = (status?: number, body?: unknown) => callback?.({ ok: false, error: "deterministic remote failure", ...(status ? { status } : {}), ...(body ? { body } : {}) });
      const rejection = () => state.config.failure ?? { stage: "upload", code: "permission", httpStatus: 403 };
      const rejected = (id: string) => state.config.failIds?.some((f) => id === f || id?.startsWith(f));
      void w.__recoveryRecord(msg).then(async () => {
        const type: string = msg.type;
        if (type === "analytics.capture") return ok(undefined);
        if (type === `${provider}.getAccountIdentity`) {
          const raw = (await chrome.storage.local.get("bugshot-settings"))["bugshot-settings"];
          if (!raw || !JSON.parse(raw).state.accounts?.[provider]) return fail(401, { code: "not_connected" });
          if (state.config.identity === "network") return fail();
          return ok({ identity: JSON.stringify([provider, state.config.identity === "other" ? "someone-else" : "e2e-account"]) });
        }
        const create = /\.(submitIssue|createIssue|submit|submitPage)$/.test(type) || (type === "slack.postMessage" && !msg.payload?.threadTs);
        if (create) {
          if (provider === "webhook" && state.config.createStatus) return fail(state.config.createStatus);
          if (provider === "notion") {
            const blocks = msg.payload?.blocks?.length ?? 0;
            const attachments: any[] = msg.payload?.attachments ?? [];
            // The page holds 100 blocks: body blocks first, then the attachment heading and file blocks.
            const attachedFileIds = attachments.filter((a, n) => a.category === "image" || a.category === "video" || blocks + 1 + n < 100).map((a) => a.fileId);
            return ok({ pageId: "page-42", url: remote, attachedFileIds });
          }
          if (provider === "github") { state.body = msg.payload?.body ?? null; return ok({ number: 42, url: remote }); }
          if (provider === "clickup") { state.body = msg.payload?.markdownContent ?? null; return ok({ id: "42", url: remote }); }
          if (provider === "jira") return ok({ key: "BUG-42", url: remote, siteId: "site" });
          if (provider === "asana") return ok({ gid: "42", permalinkUrl: remote });
          if (provider === "slack") return ok({ ts: "42.1" });
          return ok({ key: "42", url: remote });
        }
        if (type === "slack.postMessage") return ok({ ts: "42.2" });
        if (type === "slack.getPermalink") return ok({ permalink: remote });
        if (type === "slack.requestFileUpload") {
          if (state.config.hangUpload) return;
          if (state.config.rejectUpload || rejected(msg.fileId)) return fail(403);
          return ok({ fileId: `remote-${msg.fileId}`, uploadUrl: "https://files.slack.com/upload/v1/e2e" });
        }
        if (type === "slack.sendFileUpload") return ok({ ok: true });
        if (type === "slack.completeFileUploads") return ok(state.config.slackComplete === "ambiguous" ? { ok: false, outcome: "ambiguous", failure: { stage: "link", code: "unknown" } } : { ok: true });
        if (/\.(uploadFiles|uploadFile|uploadAttachment)$/.test(type) && provider !== "notion") {
          if (state.config.hangUpload) return;
          if (state.config.rejectUpload) return fail(403);
          const files: any[] = msg.files ?? [msg.attachment];
          const result = files.map((f) => rejected(f.fileId)
            ? { fileId: f.fileId, filename: f.filename, ok: false, failure: rejection() }
            : { fileId: f.fileId, filename: f.filename, ok: true, href: `https://example.com/files/${encodeURIComponent(f.fileId)}`, gid: `gid-${f.fileId}`, file: { kind: "external", url: `https://example.com/files/${encodeURIComponent(f.fileId)}` } });
          return ok(msg.attachment ? result[0] : result);
        }
        if (type === "notion.getDatabaseSchema") return ok({ titlePropertyName: "Name", statusProperty: null, selectProperties: [] });
        if (type === "notion.uploadFile") {
          if (state.config.hangUpload) return;
          return state.config.rejectUpload || rejected(msg.fileId) ? fail(403) : ok({ fileId: msg.fileId, fileUploadId: "upload-42" });
        }
        if (type === "jira.listProjects") return ok([{ id: "1", key: "BUG", name: "Bug" }]);
        if (type === "jira.listIssueTypes") return ok([{ id: "1", name: "Bug" }]);
        // Existing-issue reads of the retry: the probe and the body.
        if (/\.(getIssueBody|getTaskAttachments|getBlockChildren|getIssueDescription|getIssueAttachments)$/.test(type)) {
          if (state.config.readStatus) return fail(state.config.readStatus);
          if (provider === "github") return ok({ body: state.body ?? "" });
          if (provider === "clickup") return ok({ markdown: state.body ?? "", attachments: [] });
          if (provider === "notion") return ok({ blocks: [] });
          return ok({});
        }
        if (type === "notion.getFileUpload") return ok({ status: "uploaded", expiresAt: null });
        if (type === "notion.appendBlockChildren") return ok({ blockIds: (msg.children as unknown[]).map((_, n) => `block-${n}`) });
        if (type === "github.updateIssueBody" || type === "clickup.updateTaskMarkdown") {
          if (state.config.bodyWrite === "reject") return fail(403);
          state.body = msg.body ?? msg.markdownContent ?? null;
          return ok({ ok: true });
        }
        // The list's status badge reads this shape; a wrong one makes the badge misrender.
        if (type === "clickup.getTaskStatus") return ok({ id: "42", name: "Recovery acceptance", completed: false, url: remote });
        if (/\.(getIssue|getTask|getIssueStatus|getTaskStatus)$/.test(type)) return ok({ title: "Recovery acceptance", status: "Open", url: remote });
        if (/\.(update|createAttachment)/.test(type)) return ok({ ok: true });
        return ok([]);
      });
    }) as typeof chrome.runtime.sendMessage;
  };
  const args = { provider, config, remote: REMOTE };
  await panel.addInitScript(install, args);
  await panel.evaluate(install, args);
  return calls;
}
export const setRemote = (panel: Page, patch: RemoteConfig) => panel.evaluate((p) => { Object.assign((window as any).__remote.config, p); }, patch);
export const remoteBody = (panel: Page) => panel.evaluate(() => (window as any).__remote.body as string | null);
export const setRemoteBody = (panel: Page, body: string) => panel.evaluate((b) => { (window as any).__remote.body = b; }, body);
