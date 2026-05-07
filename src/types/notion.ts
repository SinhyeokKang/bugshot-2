import type { PlatformAccountBase } from "./platform";

export interface NotionApiKeyAuth {
  kind: "apiKey";
  token: string;
  workspaceName?: string;
  botName: string;
}

export interface NotionOAuthAuth {
  kind: "oauth";
  accessToken: string;
  botId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string;
  ownerUserName?: string;
  ownerUserEmail?: string;
  botName: string;
  grantedAt: number;
}

export type NotionAuth = NotionApiKeyAuth | NotionOAuthAuth;

export interface NotionDefaults {
  databaseId?: string;
  databaseTitle?: string;
  statusOption?: string;
  selectValues?: NotionSelectFieldValue[];
}

export interface NotionAccount extends PlatformAccountBase<"notion"> {
  auth: NotionAuth;
  defaults: NotionDefaults;
}

export interface NotionSelectOption {
  id: string;
  name: string;
  color: string;
}

export type NotionPropertyType =
  | "title"
  | "status"
  | "select"
  | "multi_select"
  | "rich_text"
  | "date"
  | "people"
  | "checkbox"
  | "number"
  | "url"
  | "email"
  | "phone_number"
  | "files"
  | "relation"
  | "formula"
  | "rollup"
  | "created_time"
  | "last_edited_time"
  | "created_by"
  | "last_edited_by";

export interface NotionPropertySchema {
  id: string;
  name: string;
  type: NotionPropertyType;
  options?: NotionSelectOption[];
}

export interface NotionDatabase {
  id: string;
  title: string;
  iconEmoji?: string;
}

export interface NotionDatabaseSchema {
  id: string;
  title: string;
  titlePropertyName: string;
  statusProperty?: NotionPropertySchema;
  selectProperties: NotionPropertySchema[];
}

export type NotionBlock =
  | { type: "heading_2"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string; text: string }
  | { type: "bulleted_list_item"; text: string }
  | { type: "image"; placeholderId: string }
  | { type: "table"; rows: string[][] };

export type NotionAttachmentCategory = "image" | "video" | "log" | "other";

export interface NotionAttachmentInput {
  placeholderId: string;
  filename: string;
  contentType: string;
  dataUrl: string;
  category: NotionAttachmentCategory;
}

export interface NotionSelectFieldValue {
  propertyName: string;
  type: "select" | "multi_select";
  options: string[];
}

export interface NotionCreatePagePayload {
  databaseId: string;
  title: string;
  titlePropertyName: string;
  statusOption?: { propertyName: string; optionName: string };
  selectValues: NotionSelectFieldValue[];
  blocks: NotionBlock[];
  attachments: { placeholderId: string; fileUploadId: string; filename: string; category: NotionAttachmentCategory }[];
}

export interface NotionCreatePageResult {
  pageId: string;
  url: string;
}

export interface NotionPageStatus {
  pageId: string;
  url: string;
  statusOption?: { name: string; color: string };
  lastEditedTime: number;
}

export interface NotionFileUploadResult {
  fileUploadId: string;
  expiresAt: number;
}

export interface NotionMyself {
  botName: string;
  workspaceName?: string;
  ownerUserName?: string;
  ownerUserEmail?: string;
}
