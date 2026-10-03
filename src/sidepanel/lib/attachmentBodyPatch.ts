import type { AttachmentBodyPlan } from "@/types/attachment";

// Three-way body patch for an already-created remote issue. The initial submission records, per
// unfinished file, the exact units (lines / top-level ADF nodes) it wrote at that file's place plus
// unique surrounding context and what a successful upload renders there. A retry touches only
// those validated places in the latest remote body; anything else is a conflict, never a guess.

type Replacement = AttachmentBodyPlan["replacements"][number];
interface Hunk { start: number; end: number; insert: string[]; members: Set<string> }
interface Anchored extends Hunk { pre: string[]; post: string[] }

const MAX_CONTEXT = 8;
const MAX_VERIFIED_GROUPS = 4;
const MAX_DIFF_CELLS = 4_000_000;
const SLOT_RE = /BUGSHOTSLOT([0-9a-f]+)Z/g;
// Non-global twin for `.test`, which would otherwise carry lastIndex between calls.
const HAS_SLOT = /BUGSHOTSLOT[0-9a-f]+Z/;
const NOOP = "[]";

const hex = (value: string) => [...new TextEncoder().encode(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (value: string) => value.length % 2 ? "" : new TextDecoder().decode(new Uint8Array((value.match(/../g) ?? []).map((b) => parseInt(b, 16))));

// Stands in for a URL/id inside a rendered body; alphanumeric so no renderer escapes it.
export function bodySlotToken(fileId: string): string {
  return `BUGSHOTSLOT${hex(fileId)}Z`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "localId") continue;
    const next = canonical((value as Record<string, unknown>)[key]);
    if ((key === "attrs" && next && typeof next === "object" && !Object.keys(next).length) || (key === "marks" && Array.isArray(next) && !next.length)) continue;
    out[key] = next;
  }
  return out;
}
// Provider-normalized comparison key of one top-level ADF node.
export const adfNodeKey = (node: unknown) => JSON.stringify(canonical(node));
const nodeKey = adfNodeKey;
function adfContent(body: string): unknown[] | null {
  try {
    const doc = JSON.parse(body) as { content?: unknown };
    return Array.isArray(doc?.content) ? doc.content : null;
  } catch { return null; }
}
const lineKeys = (body: string) => body.split("\n").map((line) => line.replace(/\r$/, ""));

function diff(a: string[], b: string[]): Array<{ start: number; end: number; insert: string[] }> {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const am = a.slice(prefix, a.length - suffix);
  const bm = b.slice(prefix, b.length - suffix);
  if (!am.length && !bm.length) return [];
  if (am.length * bm.length > MAX_DIFF_CELLS) return [{ start: prefix, end: prefix + am.length, insert: bm }];
  const n = am.length;
  const m = bm.length;
  const lcs = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = am[i] === bm[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const hunks: Array<{ start: number; end: number; insert: string[] }> = [];
  let open: { start: number; end: number; insert: string[] } | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      if (open) { hunks.push(open); open = null; }
      i++; j++;
    } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
      open ??= { start: prefix + i, end: prefix + i, insert: [] };
      open.insert.push(bm[j++]);
    } else {
      open ??= { start: prefix + i, end: prefix + i, insert: [] };
      open.end = prefix + ++i;
    }
  }
  if (open) hunks.push(open);
  return hunks;
}

function occurrences(hay: readonly string[], pattern: readonly string[]): number[] {
  const found: number[] = [];
  for (let i = 0; i + pattern.length <= hay.length; i++) {
    let k = 0;
    while (k < pattern.length && hay[i + k] === pattern[k]) k++;
    if (k === pattern.length) found.push(i);
  }
  return found;
}

function anchor(base: string[], hunk: Hunk): Anchored | null {
  for (let k = 1; k <= MAX_CONTEXT; k++) {
    const pre = base.slice(Math.max(0, hunk.start - k), hunk.start);
    const post = base.slice(hunk.end, hunk.end + k);
    if (occurrences(base, [...pre, ...base.slice(hunk.start, hunk.end), ...post]).length === 1) return { ...hunk, pre, post };
  }
  return null;
}

// A hunk must not change units another hunk relies on as context; such hunks become one.
function touches(a: Hunk, b: Anchored): boolean {
  const from = b.start - b.pre.length;
  const to = b.end + b.post.length;
  return a.end > a.start ? a.start < to && a.end > from : from < a.start && a.start < to;
}

function anchorAll(base: string[], input: Hunk[]): { hunks: Anchored[]; unanchored: Set<string> } {
  let hunks = [...input].sort((x, y) => x.start - y.start);
  const unanchored = new Set<string>();
  for (;;) {
    const anchored = hunks.map((h) => anchor(base, h));
    let merged = false;
    outer: for (let x = 0; x < hunks.length; x++) {
      for (let y = 0; y < hunks.length; y++) {
        const target = anchored[y];
        if (x === y || !target || !touches(hunks[x], target)) continue;
        const [a, b] = x < y ? [hunks[x], hunks[y]] : [hunks[y], hunks[x]];
        const combined: Hunk = { start: a.start, end: Math.max(a.end, b.end), insert: [...a.insert, ...base.slice(a.end, b.start), ...b.insert], members: new Set([...a.members, ...b.members]) };
        hunks = hunks.filter((h) => h !== a && h !== b).concat(combined).sort((p, q) => p.start - q.start);
        merged = true;
        break outer;
      }
    }
    if (merged) continue;
    const result: Anchored[] = [];
    anchored.forEach((h, i) => { if (h) result.push(h); else for (const id of hunks[i].members) unanchored.add(id); });
    return { hunks: result, unanchored };
  }
}

function groupsOf(hunks: Hunk[]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => { const p = parent.get(id) ?? id; if (p === id) return id; const root = find(p); parent.set(id, root); return root; };
  for (const h of hunks) {
    const [first, ...rest] = [...h.members];
    if (!parent.has(first)) parent.set(first, first);
    for (const id of rest) { if (!parent.has(id)) parent.set(id, id); parent.set(find(id), find(first)); }
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()];
}

function applyHunks(base: string[], hunks: Hunk[]): string[] {
  const out = [...base];
  for (const h of [...hunks].sort((a, b) => b.start - a.start)) out.splice(h.start, h.end - h.start, ...h.insert);
  return out;
}

function emit(hunks: Array<Anchored & { base: string[] }>, groups: string[][], noops: readonly string[], excluded: Set<string>): Replacement[] {
  const replacements: Replacement[] = [];
  const grouped = new Set<string>();
  for (const group of groups) {
    if (group.some((id) => excluded.has(id))) { for (const id of group) excluded.add(id); continue; }
    for (const h of hunks.filter((h) => group.some((id) => h.members.has(id)))) {
      for (const fileId of group) replacements.push({ fileId, anchor: JSON.stringify(h.pre), before: JSON.stringify(h.base), after: JSON.stringify(h.post), renderTemplate: JSON.stringify(h.insert) });
    }
    for (const id of group) grouped.add(id);
  }
  for (const id of noops) if (!grouped.has(id) && !excluded.has(id)) replacements.push({ fileId: id, anchor: NOOP, before: NOOP, after: NOOP, renderTemplate: NOOP });
  return replacements;
}

// `render(success)` renders the body as if exactly those pending files had succeeded, each URL/id
// replaced by bodySlotToken(fileId). Interacting renders are grouped and only applied together.
export function buildBodyReplacements(input: {
  format: "markdown" | "asana-html";
  base: string;
  pending: readonly string[];
  render: (success: ReadonlySet<string>) => string;
  // The body is the file's only path (GitHub/GitLab): an unreferenced file gets no slot, so a
  // retry offers its download instead of reporting it complete.
  bodyOnly?: boolean;
}): Replacement[] {
  const pending = [...new Set(input.pending)];
  if (!pending.length) return [];
  const base = lineKeys(input.base);
  const all = diff(base, lineKeys(input.render(new Set(pending))));
  const singles = new Map(pending.map((id) => [id, diff(base, lineKeys(input.render(new Set([id]))))]));
  const hunks: Hunk[] = all.map((h) => {
    const members = new Set(pending.filter((id) => h.insert.some((line) => line.includes(bodySlotToken(id)))
      || singles.get(id)!.some((s) => s.start <= h.end && h.start <= s.end)));
    return { ...h, members: members.size ? members : new Set(pending) };
  });
  const { hunks: anchored, unanchored } = anchorAll(base, hunks);
  let groups = groupsOf(anchored);
  const additive = (): boolean => {
    if (groups.length > MAX_VERIFIED_GROUPS) return false;
    for (let mask = 1; mask < (1 << groups.length) - 1; mask++) {
      const files = groups.filter((_, i) => mask & (1 << i)).flat();
      const chosen = anchored.filter((h) => files.some((id) => h.members.has(id)));
      if (JSON.stringify(applyHunks(base, chosen)) !== JSON.stringify(lineKeys(input.render(new Set(files))))) return false;
    }
    return true;
  };
  if (groups.length > 1 && !additive()) groups = [groups.flat()];
  return emit(anchored.map((h) => ({ ...h, base: base.slice(h.start, h.end) })), groups, input.bodyOnly ? [] : pending, unanchored);
}

// Jira: the safe ADF actually written keeps one top-level node per template node. A slot swaps our
// written node back to its template (placeholder) node; the background renders it with the upload.
export function buildAdfBodyReplacements(input: {
  written: { content: unknown[] };
  template: { content: unknown[] };
  slots: ReadonlyArray<{ index: number; fileIds: readonly string[] }>;
  // Pending files without a template node have nothing to restore (recorded as no-op slots).
  pending?: readonly string[];
}): Replacement[] {
  if (input.written.content.length !== input.template.content.length) return [];
  const base = input.written.content.map(nodeKey);
  const hunks: Hunk[] = input.slots.filter((s) => s.index >= 0 && s.index < base.length && s.fileIds.length)
    .map((s) => ({ start: s.index, end: s.index + 1, insert: [nodeKey(input.template.content[s.index])], members: new Set(s.fileIds) }));
  const { hunks: anchored, unanchored } = anchorAll(base, hunks);
  return emit(anchored.map((h) => ({ ...h, base: base.slice(h.start, h.end) })), groupsOf(anchored), input.pending ?? [], unanchored);
}

export interface BodyPatchResult {
  // Serialized body to write, or null when nothing needs writing.
  body: string | null;
  // Files whose slots `body` fills; done once that write succeeds.
  written: string[];
  // Files whose intended content is already in the remote body.
  present: string[];
  // Files whose slot is missing, edited, ambiguous or unrecorded.
  conflict: string[];
  // Files sharing a slot group with a file that is not ready yet.
  waiting: string[];
  // Every file of the groups `body` rewrites, including already finished members (a Jira style
  // table re-renders both of its snapshot images).
  slotFiles: string[];
}

interface Slot { members: string[]; pre: string[]; old: string[]; post: string[]; insert: string[] }

function parseUnits(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((u) => typeof u === "string") ? parsed : null;
  } catch { return null; }
}

// `ready` maps each file to what fills its slot (URL, gid; for ADF the media id or href that shows
// it is already there). Only `targets` are attempted.
export function planAttachmentBodyPatch(
  plan: AttachmentBodyPlan,
  remoteBody: string,
  ready: ReadonlyMap<string, string>,
  targets: readonly string[],
): BodyPatchResult {
  const result: BodyPatchResult = { body: null, written: [], present: [], conflict: [], waiting: [], slotFiles: [] };
  const wanted = new Set(targets);
  const adf = plan.format === "adf";
  const lineBased = plan.format === "markdown" || plan.format === "asana-html";
  const nodes = adf ? adfContent(remoteBody) : null;
  if ((!adf && !lineBased) || (adf && !nodes)) { result.conflict = [...wanted]; return result; }
  const keys = adf ? nodes!.map(nodeKey) : lineKeys(remoteBody);

  const slots = new Map<string, Slot>();
  for (const r of plan.replacements) {
    const pre = parseUnits(r.anchor), old = parseUnits(r.before), post = parseUnits(r.after ?? ""), insert = parseUnits(r.renderTemplate);
    if (!pre || !old || !post || !insert) continue;
    const noop = !pre.length && !old.length && !post.length && !insert.length;
    const key = noop ? `noop:${r.fileId}` : [r.anchor, r.before, r.after, r.renderTemplate].join("\u0000");
    const slot = slots.get(key) ?? { members: [], pre, old, post, insert };
    if (!slot.members.includes(r.fileId)) slot.members.push(r.fileId);
    slots.set(key, slot);
  }
  const groups = new Map<string, Slot[]>();
  for (const slot of slots.values()) {
    const id = [...slot.members].sort().join("\u0000");
    groups.set(id, [...(groups.get(id) ?? []), slot]);
  }
  const recorded = new Set([...slots.values()].flatMap((s) => s.members));
  result.conflict.push(...[...wanted].filter((id) => !recorded.has(id)));

  // Only our recorded templates are filled; one that cannot be filled completely is a conflict.
  const fill = (units: string[]): string[] | null => {
    let missing = false;
    const filled = units.map((u) => u.replace(SLOT_RE, (token, h: string) => ready.get(unhex(h)) ?? (missing = true, token)));
    return missing || filled.some((u) => HAS_SLOT.test(u)) ? null : filled;
  };
  const edits: Array<{ at: number; length: number; insert: string[]; group: string }> = [];
  const groupFiles = new Map<string, string[]>();
  for (const [id, group] of groups) {
    const members = group[0].members;
    if (!members.some((m) => wanted.has(m))) continue;
    groupFiles.set(id, members.filter((m) => wanted.has(m)));
    if (members.some((m) => !ready.has(m))) { result.waiting.push(...members.filter((m) => wanted.has(m))); continue; }
    const pending: typeof edits = [];
    let conflict = false;
    for (const slot of group) {
      if (!slot.pre.length && !slot.old.length && !slot.post.length && !slot.insert.length) continue;
      const insert = adf ? slot.insert : fill(slot.insert);
      if (!insert) { conflict = true; break; }
      const at = occurrences(keys, [...slot.pre, ...slot.old, ...slot.post]);
      if (at.length === 1) { pending.push({ at: at[0] + slot.pre.length, length: slot.old.length, insert, group: id }); continue; }
      if (!isPresent(keys, slot, adf, members.map((m) => ready.get(m)!), insert)) { conflict = true; break; }
    }
    if (conflict) result.conflict.push(...groupFiles.get(id)!);
    else if (pending.length) edits.push(...pending);
    else result.present.push(...groupFiles.get(id)!);
  }
  // Two groups must never claim overlapping units of the remote body.
  const sorted = [...edits].sort((a, b) => a.at - b.at);
  const clashing = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].at < sorted[i - 1].at + sorted[i - 1].length || (sorted[i].at === sorted[i - 1].at && sorted[i].group !== sorted[i - 1].group)) {
      clashing.add(sorted[i].group); clashing.add(sorted[i - 1].group);
    }
  }
  for (const id of clashing) result.conflict.push(...groupFiles.get(id)!);
  const applied = edits.filter((e) => !clashing.has(e.group));
  if (!applied.length) return result;
  const appliedGroups = [...new Set(applied.map((e) => e.group))];
  result.written = appliedGroups.flatMap((id) => groupFiles.get(id)!);
  result.slotFiles = appliedGroups.flatMap((id) => groups.get(id)![0].members);

  if (adf) {
    const content = [...nodes!];
    for (const e of [...applied].sort((a, b) => b.at - a.at)) content.splice(e.at, e.length, ...e.insert.map((u) => JSON.parse(u) as unknown));
    result.body = JSON.stringify({ ...(JSON.parse(remoteBody) as object), content });
  } else {
    const raw = remoteBody.split("\n");
    const crlf = remoteBody.includes("\r\n");
    for (const e of [...applied].sort((a, b) => b.at - a.at)) {
      const atEnd = e.at + e.length === raw.length;
      raw.splice(e.at, e.length, ...e.insert.map((line, i) => crlf && !(atEnd && i === e.insert.length - 1) ? `${line}\r` : line));
    }
    const body = raw.join("\n");
    result.body = body;
  }
  return result;
}

function isPresent(keys: string[], slot: Slot, adf: boolean, values: string[], filled: string[]): boolean {
  // A deletion leaves nothing to find, so "gone" needs context on both sides and no stray copy.
  if (!slot.insert.length) return !!slot.pre.length && !!slot.post.length
    && occurrences(keys, [...slot.pre, ...slot.post]).length === 1 && !occurrences(keys, slot.old).length;
  if (!adf) return occurrences(keys, [...slot.pre, ...filled, ...slot.post]).length === 1;
  const width = slot.insert.length;
  const found = occurrences(keys, slot.pre).filter((p) => {
    const middle = keys.slice(p + slot.pre.length, p + slot.pre.length + width);
    const after = keys.slice(p + slot.pre.length + width, p + slot.pre.length + width + slot.post.length);
    return middle.length === width && JSON.stringify(after) === JSON.stringify(slot.post) && values.every((v) => middle.some((m) => m.includes(v)));
  });
  return found.length === 1;
}
