import { useCallback, useEffect, useState } from "react";
import {
  initialGhFields,
  type GithubIssueFieldsValue,
} from "@/sidepanel/tabs/githubFields/GithubIssueFields";
import {
  initialLinearFields,
  type LinearIssueFieldsValue,
} from "@/sidepanel/tabs/linearFields/LinearIssueFields";
import {
  initialNotionFields,
  type NotionIssueFieldsValue,
} from "@/sidepanel/tabs/notionFields/NotionIssueFields";
import {
  initialGitlabFields,
  type GitlabIssueFieldsValue,
} from "@/sidepanel/tabs/gitlabFields/GitlabIssueFields";
import {
  initialAsanaFields,
  type AsanaIssueFieldsValue,
} from "@/sidepanel/tabs/asanaFields/AsanaIssueFields";

type GhFieldsInitInput = Parameters<typeof initialGhFields>[0];
type GhFieldsDefaults = Parameters<typeof initialGhFields>[1];
type LinearFieldsInitInput = Parameters<typeof initialLinearFields>[0];
type LinearFieldsDefaults = Parameters<typeof initialLinearFields>[1];
type NotionFieldsInitInput = Parameters<typeof initialNotionFields>[0];
type NotionFieldsDefaults = Parameters<typeof initialNotionFields>[1];
type GitlabFieldsInitInput = Parameters<typeof initialGitlabFields>[0];
type GitlabFieldsDefaults = Parameters<typeof initialGitlabFields>[1];
type AsanaFieldsInitInput = Parameters<typeof initialAsanaFields>[0];
type AsanaFieldsDefaults = Parameters<typeof initialAsanaFields>[1];

export interface UsePlatformFieldsInput {
  open: boolean;
  lastGhSubmit: GhFieldsInitInput;
  ghDefaults: GhFieldsDefaults;
  lastLinearSubmit: LinearFieldsInitInput;
  linearDefaults: LinearFieldsDefaults;
  lastNotionSubmit: NotionFieldsInitInput;
  notionDefaults: NotionFieldsDefaults;
  lastGitlabSubmit: GitlabFieldsInitInput;
  gitlabDefaults: GitlabFieldsDefaults;
  lastAsanaSubmit: AsanaFieldsInitInput;
  asanaDefaults: AsanaFieldsDefaults;
  // DraftDetailDialog가 draft 전환 시 idempotent reset 트리거하는 추가 deps.
  // IssueCreateModal은 미사용 (undefined로 두면 effect 동작은 동일).
  resetKey?: string;
}

export interface PlatformFieldsState {
  ghFields: GithubIssueFieldsValue;
  setGhFields: (patch: Partial<GithubIssueFieldsValue>) => void;
  linearFields: LinearIssueFieldsValue;
  setLinearFields: (patch: Partial<LinearIssueFieldsValue>) => void;
  notionFields: NotionIssueFieldsValue;
  setNotionFields: (patch: Partial<NotionIssueFieldsValue>) => void;
  gitlabFields: GitlabIssueFieldsValue;
  setGitlabFields: (patch: Partial<GitlabIssueFieldsValue>) => void;
  asanaFields: AsanaIssueFieldsValue;
  setAsanaFields: (patch: Partial<AsanaIssueFieldsValue>) => void;
}

export function usePlatformFields(input: UsePlatformFieldsInput): PlatformFieldsState {
  const [ghFields, setGhFieldsState] = useState<GithubIssueFieldsValue>(() =>
    initialGhFields(input.lastGhSubmit, input.ghDefaults),
  );
  const setGhFields = useCallback(
    (patch: Partial<GithubIssueFieldsValue>) =>
      setGhFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
  useEffect(() => {
    if (input.open) {
      setGhFieldsState(initialGhFields(input.lastGhSubmit, input.ghDefaults));
    }
  }, [input.open, input.lastGhSubmit, input.ghDefaults, input.resetKey]);

  const [linearFields, setLinearFieldsState] = useState<LinearIssueFieldsValue>(() =>
    initialLinearFields(input.lastLinearSubmit, input.linearDefaults),
  );
  const setLinearFields = useCallback(
    (patch: Partial<LinearIssueFieldsValue>) =>
      setLinearFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
  useEffect(() => {
    if (input.open) {
      setLinearFieldsState(initialLinearFields(input.lastLinearSubmit, input.linearDefaults));
    }
  }, [input.open, input.lastLinearSubmit, input.linearDefaults, input.resetKey]);

  const [notionFields, setNotionFieldsState] = useState<NotionIssueFieldsValue>(() =>
    initialNotionFields(input.lastNotionSubmit, input.notionDefaults),
  );
  const setNotionFields = useCallback(
    (patch: Partial<NotionIssueFieldsValue>) =>
      setNotionFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
  useEffect(() => {
    if (input.open) {
      setNotionFieldsState(initialNotionFields(input.lastNotionSubmit, input.notionDefaults));
    }
  }, [input.open, input.lastNotionSubmit, input.notionDefaults, input.resetKey]);

  const [gitlabFields, setGitlabFieldsState] = useState<GitlabIssueFieldsValue>(() =>
    initialGitlabFields(input.lastGitlabSubmit, input.gitlabDefaults),
  );
  const setGitlabFields = useCallback(
    (patch: Partial<GitlabIssueFieldsValue>) =>
      setGitlabFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
  useEffect(() => {
    if (input.open) {
      setGitlabFieldsState(initialGitlabFields(input.lastGitlabSubmit, input.gitlabDefaults));
    }
  }, [input.open, input.lastGitlabSubmit, input.gitlabDefaults, input.resetKey]);

  const [asanaFields, setAsanaFieldsState] = useState<AsanaIssueFieldsValue>(() =>
    initialAsanaFields(input.lastAsanaSubmit, input.asanaDefaults),
  );
  const setAsanaFields = useCallback(
    (patch: Partial<AsanaIssueFieldsValue>) =>
      setAsanaFieldsState((s) => ({ ...s, ...patch })),
    [],
  );
  useEffect(() => {
    if (input.open) {
      setAsanaFieldsState(initialAsanaFields(input.lastAsanaSubmit, input.asanaDefaults));
    }
  }, [input.open, input.lastAsanaSubmit, input.asanaDefaults, input.resetKey]);

  return {
    ghFields,
    setGhFields,
    linearFields,
    setLinearFields,
    notionFields,
    setNotionFields,
    gitlabFields,
    setGitlabFields,
    asanaFields,
    setAsanaFields,
  };
}
