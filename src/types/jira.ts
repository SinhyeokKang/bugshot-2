export interface JiraConfigPayload {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraMyself {
  accountId: string;
  emailAddress: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
  hierarchyLevel?: number;
  subtask?: boolean;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype?: { name: string; iconUrl?: string };
  };
}
