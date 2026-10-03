import { describe, expect, it } from "vitest";
import type { AttachmentBodyPlan } from "@/types/attachment";
import {
  bodySlotToken,
  buildAdfBodyReplacements,
  buildBodyReplacements,
  planAttachmentBodyPatch,
} from "../attachmentBodyPatch";

// A tiny renderer standing in for a platform body builder: each successful file renders its link,
// a failed one renders the same localized "dropped" line — repeated captions are the hard case.
const FILES = ["capture:before-0", "capture:after-0", "logs"];
function render(urls: Record<string, string | undefined>): string {
  return [
    "## Environment",
    "- Page: https://example.com",
    "",
    "## Style changes",
    "### Before",
    urls["capture:before-0"] ? `![before-0.webp](${urls["capture:before-0"]})` : "(attachment dropped)",
    "### After",
    urls["capture:after-0"] ? `![after-0.webp](${urls["capture:after-0"]})` : "(attachment dropped)",
    "",
    "## Logs",
    urls.logs ? `[logs.html](${urls.logs})` : "logs.html: (attachment dropped)",
    "",
    "---",
    "Reported via BugShot",
  ].join("\n");
}
const slotted = (success: ReadonlySet<string>) => render(Object.fromEntries([...success].map((id) => [id, bodySlotToken(id)])));
const HREF: Record<string, string> = {
  "capture:before-0": "https://github.com/user-attachments/files/1/before-0.webp",
  "capture:after-0": "https://github.com/user-attachments/files/2/after-0.webp",
  logs: "https://github.com/user-attachments/files/3/logs.html",
};
const base = render({});
const plan = (): AttachmentBodyPlan => ({
  format: "markdown",
  lastWritten: base,
  replacements: buildBodyReplacements({ format: "markdown", base, pending: FILES, render: slotted }),
});
const ready = (...ids: string[]) => new Map(ids.map((id) => [id, HREF[id]]));

describe("markdown three-way body patch", () => {
  it("fills every validated slot when all pending files are ready", () => {
    const result = planAttachmentBodyPatch(plan(), base, ready(...FILES), FILES);
    expect(result.body).toBe(render(HREF));
    expect([...result.written].sort()).toEqual([...FILES].sort());
    expect(result.conflict).toEqual([]);
  });

  it("never leaks a slot token for a file that is not ready", () => {
    const result = planAttachmentBodyPatch(plan(), base, ready("logs"), FILES);
    expect(result.body ?? "").not.toContain(bodySlotToken("capture:before-0"));
    expect(result.body ?? "").not.toMatch(/BUGSHOTSLOT/);
    expect(result.written).toEqual(["logs"]);
    expect(result.body).toBe(render({ logs: HREF.logs }));
  });

  it("tells repeated identical captions apart by their recorded position", () => {
    const result = planAttachmentBodyPatch(plan(), base, ready("capture:after-0"), ["capture:after-0"]);
    expect(result.body).toBe(render({ "capture:after-0": HREF["capture:after-0"] }));
  });

  it("preserves prose another person added around and between the slots", () => {
    const remote = base
      .replace("## Environment", "Triage note: reproduced on staging\n\n## Environment")
      .replace("## Logs", "Assignee comment kept in the body\n\n## Logs");
    const result = planAttachmentBodyPatch(plan(), remote, ready(...FILES), FILES);
    const expected = render(HREF)
      .replace("## Environment", "Triage note: reproduced on staging\n\n## Environment")
      .replace("## Logs", "Assignee comment kept in the body\n\n## Logs");
    expect(result.body).toBe(expected);
  });

  it("keeps CRLF line endings of a remote body edited on the web", () => {
    const remote = base.split("\n").join("\r\n");
    const result = planAttachmentBodyPatch(plan(), remote, ready("logs"), ["logs"]);
    expect(result.body).toBe(render({ logs: HREF.logs }).split("\n").join("\r\n"));
  });

  it("reports a conflict and writes nothing when our slot was edited", () => {
    const remote = base.replace("logs.html: (attachment dropped)", "logs.html: see Slack thread");
    const result = planAttachmentBodyPatch(plan(), remote, ready("logs"), ["logs"]);
    expect(result).toMatchObject({ body: null, written: [], conflict: ["logs"] });
  });

  it("reports a conflict when the slot with its context became ambiguous", () => {
    const remote = `${base}\n\n## Logs\nlogs.html: (attachment dropped)\n`;
    const result = planAttachmentBodyPatch(plan(), remote, ready("logs"), ["logs"]);
    expect(result.body).toBeNull();
    expect(result.conflict).toEqual(["logs"]);
  });

  it("reconciles an intended link that is already present as success without a write", () => {
    const remote = render({ logs: HREF.logs });
    const result = planAttachmentBodyPatch(plan(), remote, ready("logs"), ["logs"]);
    expect(result).toMatchObject({ body: null, present: ["logs"], written: [], conflict: [] });
  });

  it("treats a file without a recorded slot as a conflict instead of guessing", () => {
    const legacy: AttachmentBodyPlan = { format: "markdown", lastWritten: base, replacements: [] };
    const result = planAttachmentBodyPatch(legacy, base, ready("logs"), ["logs"]);
    expect(result).toMatchObject({ body: null, conflict: ["logs"] });
  });

  it("waits for every file of a slot group whose rendering is not independent", () => {
    // A shared header appears once any file of the group succeeds.
    const grouped = (success: ReadonlySet<string>) => [
      "intro",
      ...(success.size ? ["## Attachments", ...[...success].sort().map((id) => `- ${bodySlotToken(id)}`)] : ["(no attachments)"]),
      "outro",
    ].join("\n");
    const groupBase = grouped(new Set());
    const replacements = buildBodyReplacements({ format: "markdown", base: groupBase, pending: ["a", "b"], render: grouped });
    const groupPlan: AttachmentBodyPlan = { format: "markdown", lastWritten: groupBase, replacements };
    const partial = planAttachmentBodyPatch(groupPlan, groupBase, new Map([["a", "A"]]), ["a", "b"]);
    if (partial.body !== null) expect(partial.body).toBe(grouped(new Set(["a"])).replace(bodySlotToken("a"), "A"));
    const full = planAttachmentBodyPatch(groupPlan, groupBase, new Map([["a", "A"], ["b", "B"]]), ["a", "b"]);
    expect(full.body).toBe("intro\n## Attachments\n- A\n- B\noutro");
  });
});

describe("ADF three-way body patch (Jira)", () => {
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const template = { version: 1, type: "doc", content: [para("Environment"), para("__BUGSHOT_IMAGE__"), para("Steps"), para("__BUGSHOT_INLINE:r1__"), para("Footer")] };
  const written = { version: 1, type: "doc", content: [para("Environment"), para("Attachment dropped"), para("Steps"), para("Attachment dropped"), para("Footer")] };
  const replacements = buildAdfBodyReplacements({ written, template, slots: [{ index: 1, fileIds: ["capture:screenshot"] }, { index: 3, fileIds: ["inline:r1"] }] });
  const adfPlan: AttachmentBodyPlan = { format: "adf", lastWritten: JSON.stringify(written), replacements };

  it("restores only our slot nodes to their render templates and keeps other remote nodes", () => {
    const remote = { ...written, content: [para("Triage: P1"), ...written.content] };
    const result = planAttachmentBodyPatch(adfPlan, JSON.stringify(remote), new Map([["capture:screenshot", "media-1"]]), ["capture:screenshot"]);
    expect(result.written).toEqual(["capture:screenshot"]);
    expect(JSON.parse(result.body!).content).toEqual([para("Triage: P1"), para("Environment"), para("__BUGSHOT_IMAGE__"), para("Steps"), para("Attachment dropped"), para("Footer")]);
  });

  it("matches remote nodes that only gained provider attributes", () => {
    const remote = { ...written, content: written.content.map((n) => ({ ...n, attrs: { localId: "x" } })) };
    const result = planAttachmentBodyPatch(adfPlan, JSON.stringify(remote), new Map([["inline:r1", "media-2"]]), ["inline:r1"]);
    expect(result.written).toEqual(["inline:r1"]);
  });

  it("conflicts when the slot node was edited", () => {
    const remote = { ...written, content: written.content.map((n, i) => i === 1 ? para("Replaced by hand") : n) };
    const result = planAttachmentBodyPatch(adfPlan, JSON.stringify(remote), new Map([["capture:screenshot", "media-1"]]), ["capture:screenshot"]);
    expect(result).toMatchObject({ body: null, conflict: ["capture:screenshot"] });
  });

  it("treats a slot already holding our media id as present", () => {
    const media = { type: "mediaSingle", content: [{ type: "media", attrs: { id: "media-1", type: "file", collection: "" } }] };
    const remote = { ...written, content: written.content.map((n, i) => i === 1 ? media : n) };
    const result = planAttachmentBodyPatch(adfPlan, JSON.stringify(remote), new Map([["capture:screenshot", "media-1"]]), ["capture:screenshot"]);
    expect(result).toMatchObject({ body: null, present: ["capture:screenshot"], conflict: [] });
  });
});
