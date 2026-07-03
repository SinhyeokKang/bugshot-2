import { t } from "@/i18n";
import type {
  LinearAuth,
  LinearCreateIssuePayload,
  LinearCreateIssueResult,
  LinearFileUploadResult,
  LinearIssueStatus,
  LinearLabel,
  LinearMyself,
  LinearProject,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
} from "@/types/linear";
import { createRefreshRunner } from "./lib/createRefreshRunner";

export class LinearError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "LinearError";
  }
}

const GRAPHQL_URL = "https://api.linear.app/graphql";

export function buildLinearAuthHeader(auth: LinearAuth): string {
  if (auth.kind === "apiKey") return auth.apiKey;
  return `Bearer ${auth.accessToken}`;
}

export function extractLinearErrors(
  errors: Array<{ message?: string; extensions?: unknown }>,
): string {
  return errors
    .map((e) => e.message ?? "Unknown GraphQL error")
    .join("\n");
}

export function messageForLinearStatus(status: number): string {
  if (status === 401) return t("linear.error.401");
  if (status === 403) return t("linear.error.403");
  if (status === 404) return t("linear.error.404");
  if (status === 429) return t("linear.error.429");
  if (status >= 500) return t("linear.error.5xx");
  return t("linear.error.generic", { status });
}

const refreshRunner = createRefreshRunner<LinearAuth>("linear");

export const setLinearRefreshHook = refreshRunner.setRefreshHook;

async function doFetch(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  return fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildLinearAuthHeader(auth),
    },
    body: JSON.stringify({ query, variables }),
  });
}

async function authedGraphQL(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  return refreshRunner.runWithAuthRetry(auth, (cur) =>
    doFetch(cur, query, variables),
  );
}

export async function linearGraphQL<T>(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await authedGraphQL(auth, query, variables);
  if (!res.ok) {
    throw new LinearError(
      res.status,
      messageForLinearStatus(res.status),
    );
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: unknown }>;
  };
  if (json.errors?.length) {
    throw new LinearError(200, extractLinearErrors(json.errors), json.errors);
  }
  return json.data as T;
}

export async function getMyself(auth: LinearAuth): Promise<LinearMyself> {
  const data = await linearGraphQL<{
    viewer: { id: string; name: string; email?: string; avatarUrl?: string };
  }>(auth, `{ viewer { id name email avatarUrl } }`);
  return data.viewer;
}

export async function getTeams(auth: LinearAuth): Promise<LinearTeam[]> {
  const data = await linearGraphQL<{
    teams: { nodes: LinearTeam[] };
  }>(auth, `{ teams { nodes { id name key } } }`);
  return data.teams.nodes;
}

export async function getProjects(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearProject[]> {
  const data = await linearGraphQL<{
    team: { projects: { nodes: LinearProject[] } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        projects {
          nodes { id name state }
        }
      }
    }`,
    { teamId },
  );
  return data.team.projects.nodes;
}

export async function getLabels(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearLabel[]> {
  const data = await linearGraphQL<{
    team: { labels: { nodes: LinearLabel[] } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        labels {
          nodes { id name color }
        }
      }
    }`,
    { teamId },
  );
  return data.team.labels.nodes;
}

export async function getMembers(
  auth: LinearAuth,
  teamId: string,
): Promise<LinearUser[]> {
  const data = await linearGraphQL<{
    team: { members: { nodes: Array<{ id: string; name: string; email?: string; avatarUrl?: string }> } };
  }>(
    auth,
    `query($teamId: String!) {
      team(id: $teamId) {
        members { nodes { id name email avatarUrl } }
      }
    }`,
    { teamId },
  );
  return data.team.members.nodes;
}

export async function createIssue(
  auth: LinearAuth,
  payload: LinearCreateIssuePayload,
): Promise<LinearCreateIssueResult> {
  const input: Record<string, unknown> = {
    teamId: payload.teamId,
    title: payload.title,
    description: payload.description,
  };
  if (payload.projectId) input.projectId = payload.projectId;
  if (payload.assigneeId) input.assigneeId = payload.assigneeId;
  if (payload.labelId) input.labelIds = [payload.labelId];
  if (payload.priority != null) input.priority = payload.priority;
  if (payload.subscriberIds?.length) input.subscriberIds = payload.subscriberIds;
  const data = await linearGraphQL<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    auth,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    { input },
  );
  return data.issueCreate.issue;
}

export async function getIssueStatus(
  auth: LinearAuth,
  issueId: string,
): Promise<LinearIssueStatus> {
  const data = await linearGraphQL<{
    issue: {
      id: string;
      identifier: string;
      title: string;
      state: { name: string; type: string };
      url: string;
      labels: { nodes: Array<{ name: string; color: string }> };
    };
  }>(
    auth,
    `query($issueId: String!) {
      issue(id: $issueId) {
        id identifier title url
        state { name type }
        labels { nodes { name color } }
      }
    }`,
    { issueId },
  );
  return {
    id: data.issue.id,
    identifier: data.issue.identifier,
    title: data.issue.title,
    state: data.issue.state,
    url: data.issue.url,
    labels: data.issue.labels.nodes,
  };
}

const WORKFLOW_STATE_ORDER: Record<string, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  cancelled: 5,
};

export function sortWorkflowStates(
  states: LinearWorkflowState[],
): LinearWorkflowState[] {
  const fallback = Object.keys(WORKFLOW_STATE_ORDER).length;
  return [...states].sort(
    (a, b) =>
      (WORKFLOW_STATE_ORDER[a.type] ?? fallback) -
      (WORKFLOW_STATE_ORDER[b.type] ?? fallback),
  );
}

export async function getWorkflowStates(
  auth: LinearAuth,
  issueIdentifier: string,
): Promise<LinearWorkflowState[]> {
  const data = await linearGraphQL<{
    issue: {
      team: {
        states: {
          nodes: Array<{ id: string; name: string; type: string; color: string }>;
        };
      };
    };
  }>(
    auth,
    `query($id: String!) {
      issue(id: $id) {
        team {
          states { nodes { id name type color } }
        }
      }
    }`,
    { id: issueIdentifier },
  );
  return sortWorkflowStates(data.issue.team.states.nodes);
}

export async function updateIssueState(
  auth: LinearAuth,
  issueId: string,
  stateId: string,
): Promise<LinearIssueStatus> {
  const data = await linearGraphQL<{
    issueUpdate: {
      success: boolean;
      issue: {
        id: string;
        identifier: string;
        title: string;
        state: { name: string; type: string };
        url: string;
        labels: { nodes: Array<{ name: string; color: string }> };
      };
    };
  }>(
    auth,
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue {
          id identifier title url
          state { name type }
          labels { nodes { name color } }
        }
      }
    }`,
    { id: issueId, stateId },
  );
  const issue = data.issueUpdate.issue;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    labels: issue.labels.nodes,
  };
}

export async function updateIssueDescription(
  auth: LinearAuth,
  issueId: string,
  description: string,
): Promise<void> {
  await linearGraphQL<{ issueUpdate: { success: boolean } }>(
    auth,
    `mutation($id: String!, $description: String!) {
      issueUpdate(id: $id, input: { description: $description }) {
        success
      }
    }`,
    { id: issueId, description },
  );
}

export async function requestFileUpload(
  auth: LinearAuth,
  filename: string,
  contentType: string,
  size: number,
): Promise<LinearFileUploadResult> {
  const data = await linearGraphQL<{
    fileUpload: {
      uploadFile: {
        assetUrl: string;
        uploadUrl: string;
        headers: { key: string; value: string }[];
      };
    };
  }>(
    auth,
    `mutation($filename: String!, $contentType: String!, $size: Int!) {
      fileUpload(filename: $filename, contentType: $contentType, size: $size) {
        uploadFile {
          assetUrl
          uploadUrl
          headers { key value }
        }
      }
    }`,
    { filename, contentType, size },
  );
  return data.fileUpload.uploadFile;
}

export async function uploadFileToLinear(
  auth: LinearAuth,
  filename: string,
  contentType: string,
  blob: Blob,
): Promise<string> {
  const { assetUrl, uploadUrl, headers } = await requestFileUpload(
    auth,
    filename,
    contentType,
    blob.size,
  );
  const headerMap: Record<string, string> = {};
  for (const h of headers) headerMap[h.key] = h.value;
  headerMap["Content-Type"] = contentType;
  headerMap["Cache-Control"] = "public, max-age=31536000";

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: headerMap,
    body: blob,
  });
  if (!putRes.ok) {
    throw new LinearError(putRes.status, t("linear.error.uploadFailed", { status: putRes.statusText }));
  }
  return assetUrl;
}

export async function createAttachment(
  auth: LinearAuth,
  issueId: string,
  title: string,
  url: string,
): Promise<void> {
  await linearGraphQL(
    auth,
    `mutation($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
      }
    }`,
    { input: { issueId, title, url } },
  );
}
