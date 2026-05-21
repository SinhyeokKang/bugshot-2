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

type GhFieldsInitInput = Parameters<typeof initialGhFields>[0];
type GhFieldsDefaults = Parameters<typeof initialGhFields>[1];
type LinearFieldsInitInput = Parameters<typeof initialLinearFields>[0];
type LinearFieldsDefaults = Parameters<typeof initialLinearFields>[1];
type NotionFieldsInitInput = Parameters<typeof initialNotionFields>[0];
type NotionFieldsDefaults = Parameters<typeof initialNotionFields>[1];

export interface UsePlatformFieldsInput {
  open: boolean;
  lastGhSubmit: GhFieldsInitInput;
  ghDefaults: GhFieldsDefaults;
  lastLinearSubmit: LinearFieldsInitInput;
  linearDefaults: LinearFieldsDefaults;
  lastNotionSubmit: NotionFieldsInitInput;
  notionDefaults: NotionFieldsDefaults;
  // DraftDetailDialog가 draft 전환 시 idempotent reset 트리거하는 추가 deps.
  // IssueCreateModal은 미사용 (undefined로 두면 effect 동작은 동일).
  resetKey?: unknown;
}

export interface PlatformFieldsState {
  ghFields: GithubIssueFieldsValue;
  setGhFields: (patch: Partial<GithubIssueFieldsValue>) => void;
  linearFields: LinearIssueFieldsValue;
  setLinearFields: (patch: Partial<LinearIssueFieldsValue>) => void;
  notionFields: NotionIssueFieldsValue;
  setNotionFields: (patch: Partial<NotionIssueFieldsValue>) => void;
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

  return {
    ghFields,
    setGhFields,
    linearFields,
    setLinearFields,
    notionFields,
    setNotionFields,
  };
}
