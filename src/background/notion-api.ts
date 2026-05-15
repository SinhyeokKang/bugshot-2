import { t } from "@/i18n";
import type {
  NotionAuth,
  NotionCreatePagePayload,
  NotionCreatePageResult,
  NotionDatabase,
  NotionDatabaseSchema,
  NotionFileUploadResult,
  NotionMyself,
  NotionPageStatus,
  NotionPropertySchema,
} from "@/types/notion";
import { OAuthError } from "./oauth";

export class NotionError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "NotionError";
  }
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export function buildNotionAuthHeader(auth: NotionAuth): string {
  const token = auth.kind === "apiKey" ? auth.token : auth.accessToken;
  return `Bearer ${token}`;
}

export function messageForNotionStatus(status: number): string {
  if (status === 401) return t("notion.error.401");
  if (status === 403) return t("notion.error.403");
  if (status === 404) return t("notion.error.404");
  if (status === 429) return t("notion.error.429");
  if (status >= 500) return t("notion.error.5xx");
  return t("notion.error.generic", { status });
}

interface NotionFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function notionFetch<T>(
  auth: NotionAuth,
  path: string,
  opts: NotionFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: buildNotionAuthHeader(auth),
    "Notion-Version": NOTION_VERSION,
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body =
      typeof opts.body === "string" || opts.body instanceof FormData
        ? (opts.body as BodyInit)
        : JSON.stringify(opts.body);
  }
  const res = await fetch(`${NOTION_API}${path}`, init);
  if (res.status === 401) {
    // Notion 공개 통합은 토큰이 만료되지 않지만 권한 박탈/revoke 시 401.
    // refresh가 없으므로 즉시 재인증으로 안내.
    throw new OAuthError(t("notion.oauthExpired"), {
      platform: "notion",
    });
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new NotionError(res.status, messageForNotionStatus(res.status), body);
  }
  return (await res.json()) as T;
}

interface NotionUserResponse {
  type: "person" | "bot";
  name?: string;
  bot?: {
    workspace_name?: string;
    owner?: {
      type: "user" | "workspace";
      user?: {
        name?: string;
        person?: { email?: string };
      };
    };
  };
}

export async function getMyself(auth: NotionAuth): Promise<NotionMyself> {
  const data = await notionFetch<NotionUserResponse>(auth, "/users/me");
  return {
    botName: data.name ?? "Notion bot",
    workspaceName: data.bot?.workspace_name,
    ownerUserName: data.bot?.owner?.user?.name,
    ownerUserEmail: data.bot?.owner?.user?.person?.email,
  };
}

interface NotionRichText {
  plain_text?: string;
}

interface NotionDatabaseRaw {
  id: string;
  title?: NotionRichText[];
  icon?: { type: "emoji"; emoji?: string } | null;
  properties?: Record<string, NotionPropertyRaw>;
}

interface NotionPropertyRaw {
  id: string;
  name: string;
  type: NotionPropertySchema["type"];
  select?: { options?: Array<{ id: string; name: string; color: string }> };
  multi_select?: {
    options?: Array<{ id: string; name: string; color: string }>;
  };
  status?: { options?: Array<{ id: string; name: string; color: string }> };
}

function joinRichText(rt?: NotionRichText[]): string {
  if (!rt) return "";
  return rt.map((r) => r.plain_text ?? "").join("");
}

export async function searchDatabases(
  auth: NotionAuth,
  query: string,
): Promise<NotionDatabase[]> {
  const data = await notionFetch<{ results: NotionDatabaseRaw[] }>(
    auth,
    "/search",
    {
      method: "POST",
      body: {
        query,
        filter: { value: "database", property: "object" },
        page_size: 20,
      },
    },
  );
  return data.results.map((r) => ({
    id: r.id,
    title: joinRichText(r.title) || t("notion.field.databaseUntitled"),
    iconEmoji: r.icon?.type === "emoji" ? r.icon.emoji : undefined,
  }));
}

export function parseDatabaseSchema(
  raw: NotionDatabaseRaw,
): NotionDatabaseSchema {
  const props = raw.properties ?? {};
  let titlePropertyName = "Name";
  let statusProperty: NotionPropertySchema | undefined;
  const selectProperties: NotionPropertySchema[] = [];

  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p.type === "title") {
      titlePropertyName = p.name;
      continue;
    }
    if (p.type === "status") {
      statusProperty = {
        id: p.id,
        name: p.name,
        type: "status",
        options: p.status?.options ?? [],
      };
      continue;
    }
    if (p.type === "select") {
      selectProperties.push({
        id: p.id,
        name: p.name,
        type: "select",
        options: p.select?.options ?? [],
      });
      continue;
    }
    if (p.type === "multi_select") {
      selectProperties.push({
        id: p.id,
        name: p.name,
        type: "multi_select",
        options: p.multi_select?.options ?? [],
      });
      continue;
    }
  }

  return {
    id: raw.id,
    title: joinRichText(raw.title) || t("notion.field.databaseUntitled"),
    titlePropertyName,
    statusProperty,
    selectProperties,
  };
}

export async function getDatabaseSchema(
  auth: NotionAuth,
  databaseId: string,
): Promise<NotionDatabaseSchema> {
  const data = await notionFetch<NotionDatabaseRaw>(
    auth,
    `/databases/${databaseId}`,
  );
  return parseDatabaseSchema(data);
}

interface NotionFileUploadCreateResponse {
  id: string;
  upload_url: string;
  expiry_time: string;
}

export async function createFileUpload(
  auth: NotionAuth,
  filename: string,
  contentType: string,
): Promise<{ id: string; uploadUrl: string; expiresAt: number }> {
  const data = await notionFetch<NotionFileUploadCreateResponse>(
    auth,
    "/file_uploads",
    {
      method: "POST",
      body: { filename, content_type: contentType },
    },
  );
  return {
    id: data.id,
    uploadUrl: data.upload_url,
    expiresAt: Date.parse(data.expiry_time),
  };
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } {
  const match = /^data:([^;,]+)(?:;([^,]*))?,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("invalid dataUrl");
  const contentType = match[1] || "application/octet-stream";
  const meta = match[2] ?? "";
  const payload = match[3];
  const isBase64 = meta.split(";").includes("base64");
  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    const decoded = decodeURIComponent(payload);
    bytes = new TextEncoder().encode(decoded);
  }
  return {
    blob: new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: contentType }),
    contentType,
  };
}

export async function sendFileUpload(
  auth: NotionAuth,
  uploadUrl: string,
  filename: string,
  dataUrl: string,
): Promise<void> {
  const { blob, contentType } = dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: contentType }));
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: buildNotionAuthHeader(auth),
      "Notion-Version": NOTION_VERSION,
    },
    body: form,
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new NotionError(
      res.status,
      messageForNotionStatus(res.status),
      body,
    );
  }
}

export async function uploadFile(
  auth: NotionAuth,
  filename: string,
  contentType: string,
  dataUrl: string,
): Promise<NotionFileUploadResult> {
  const created = await createFileUpload(auth, filename, contentType);
  await sendFileUpload(auth, created.uploadUrl, filename, dataUrl);
  return { fileUploadId: created.id, expiresAt: created.expiresAt };
}

interface NotionRichTextInput {
  type: "text";
  text: { content: string };
}

function richText(content: string): NotionRichTextInput[] {
  if (!content) return [];
  return [{ type: "text", text: { content } }];
}

function expandRichText(
  items: import("@/types/notion").NotionRichText[],
): object[] {
  return items.map((rt) => {
    const entry: Record<string, unknown> = {
      type: "text",
      text: { content: rt.text.content, link: rt.text.link ?? null },
    };
    if (rt.annotations) entry.annotations = rt.annotations;
    return entry;
  });
}

interface NotionBlockObject {
  object: "block";
  type: string;
  [k: string]: unknown;
}

function expandBlock(
  block: NotionCreatePagePayload["blocks"][number],
  attachmentMap: Map<string, { fileUploadId: string; filename: string }>,
): NotionBlockObject | null {
  switch (block.type) {
    case "heading_2":
      return {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText(block.text) },
      };
    case "heading_3":
      return {
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: richText(block.text) },
      };
    case "paragraph":
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(block.text) },
      };
    case "code":
      return {
        object: "block",
        type: "code",
        code: {
          rich_text: richText(block.text),
          language: block.language || "plain text",
        },
      };
    case "bulleted_list_item":
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(block.text) },
      };
    case "image": {
      const att = attachmentMap.get(block.placeholderId);
      if (!att) return null;
      return {
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id: att.fileUploadId } },
      };
    }
    case "video": {
      const att = attachmentMap.get(block.placeholderId);
      if (!att) return null;
      return {
        object: "block",
        type: "video",
        video: { type: "file_upload", file_upload: { id: att.fileUploadId } },
      };
    }
    case "table": {
      const tableWidth = block.rows[0]?.length ?? 0;
      if (tableWidth === 0) return null;
      const children = block.rows.map((row) => ({
        object: "block",
        type: "table_row",
        table_row: {
          cells: row.map((cell) => richText(cell)),
        },
      }));
      return {
        object: "block",
        type: "table",
        table: {
          table_width: tableWidth,
          has_column_header: true,
          has_row_header: false,
          children,
        },
      };
    }
    case "rich_paragraph":
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: expandRichText(block.richText) },
      };
    case "rich_bulleted_list_item":
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: expandRichText(block.richText) },
      };
    case "rich_numbered_list_item":
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: expandRichText(block.richText) },
      };
    case "divider":
      return {
        object: "block",
        type: "divider",
        divider: {},
      };
    default:
      return null;
  }
}

interface NotionPageCreatedRaw {
  id: string;
  url: string;
}

export async function createPage(
  auth: NotionAuth,
  payload: NotionCreatePagePayload,
): Promise<NotionCreatePageResult> {
  const attachmentMap = new Map<
    string,
    { fileUploadId: string; filename: string; category: string }
  >();
  for (const a of payload.attachments) {
    attachmentMap.set(a.placeholderId, {
      fileUploadId: a.fileUploadId,
      filename: a.filename,
      category: a.category,
    });
  }

  const expanded: NotionBlockObject[] = [];
  for (const b of payload.blocks) {
    const out = expandBlock(b, attachmentMap);
    if (out) expanded.push(out);
  }

  // image와 video는 본문에 inline 블록으로 이미 emit됨 — 첨부 섹션 file 블록 중복 방지.
  // log/other 카테고리만 첨부 섹션으로 보냄.
  const nonInline = payload.attachments.filter(
    (a) => a.category !== "image" && a.category !== "video",
  );
  if (nonInline.length) {
    expanded.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: richText(t("notion.attachmentSection")) },
    });
    for (const a of nonInline) {
      expanded.push({
        object: "block",
        type: "file",
        file: {
          type: "file_upload",
          file_upload: { id: a.fileUploadId },
          name: a.filename,
        },
      });
    }
  }

  const properties: Record<string, unknown> = {
    [payload.titlePropertyName]: {
      title: richText(payload.title),
    },
  };
  if (payload.statusOption) {
    properties[payload.statusOption.propertyName] = {
      status: { name: payload.statusOption.optionName },
    };
  }
  for (const sv of payload.selectValues) {
    if (!sv.options.length) continue;
    if (sv.type === "select") {
      properties[sv.propertyName] = { select: { name: sv.options[0] } };
    } else {
      properties[sv.propertyName] = {
        multi_select: sv.options.map((name) => ({ name })),
      };
    }
  }

  // Notion API는 page create 시 children 100개 제한. 초과분은 별도 PATCH로 append할 수 있지만
  // 현재는 잘라서 보내고 경고만. (대용량 로그가 잘릴 수 있음)
  if (expanded.length > 100) {
    console.warn(
      `[bugshot] Notion page truncated: ${expanded.length} blocks → 100 (Notion API per-request limit)`,
    );
  }
  const data = await notionFetch<NotionPageCreatedRaw>(auth, "/pages", {
    method: "POST",
    body: {
      parent: { database_id: payload.databaseId },
      properties,
      children: expanded.slice(0, 100),
    },
  });
  return { pageId: data.id, url: data.url };
}

export interface NotionPageRaw {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, NotionPropertyValueRaw>;
}

interface NotionPropertyValueRaw {
  id: string;
  type: string;
  status?: { name: string; color: string } | null;
  title?: Array<{ plain_text?: string }>;
}

export function parsePageStatus(data: NotionPageRaw): NotionPageStatus {
  let statusOption: NotionPageStatus["statusOption"] | undefined;
  let title: string | undefined;
  for (const key of Object.keys(data.properties)) {
    const p = data.properties[key];
    if (!statusOption && p.type === "status" && p.status) {
      statusOption = { name: p.status.name, color: p.status.color };
    }
    if (!title && p.type === "title" && Array.isArray(p.title)) {
      const joined = p.title.map((t) => t.plain_text ?? "").join("").trim();
      if (joined) title = joined;
    }
  }
  return {
    pageId: data.id,
    url: data.url,
    title,
    statusOption,
    lastEditedTime: Date.parse(data.last_edited_time),
  };
}

export async function getPageStatus(
  auth: NotionAuth,
  pageId: string,
): Promise<NotionPageStatus> {
  const data = await notionFetch<NotionPageRaw>(auth, `/pages/${pageId}`);
  return parsePageStatus(data);
}

export async function updatePageStatus(
  auth: NotionAuth,
  pageId: string,
  propertyName: string,
  optionName: string,
): Promise<NotionPageStatus> {
  const data = await notionFetch<NotionPageRaw>(
    auth,
    `/pages/${pageId}`,
    {
      method: "PATCH",
      body: {
        properties: {
          [propertyName]: { status: { name: optionName } },
        },
      },
    },
  );
  return parsePageStatus(data);
}
