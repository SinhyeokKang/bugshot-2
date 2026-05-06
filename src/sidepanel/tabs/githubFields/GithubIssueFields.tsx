import { useT } from "@/i18n";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect";
import { LabelMultiSelect } from "./LabelMultiSelect";
import { RepoCombobox, type RepoValue } from "./RepoCombobox";
import { FieldRow } from "../IssueCreateModal";

export interface GithubIssueFieldsValue {
  owner?: string;
  repo?: string;
  labels: string[];
  assignees: string[];
}

export function initialGhFields(
  last: { owner?: string; repo?: string; labels?: string[]; assignees?: string[] } | undefined,
  defaults: { owner?: string; repo?: string; labels?: string[]; assignees?: string[] } | undefined,
): GithubIssueFieldsValue {
  const src = last?.owner && last.repo ? last : defaults;
  return {
    owner: src?.owner,
    repo: src?.repo,
    labels: src?.labels ?? [],
    assignees: src?.assignees ?? [],
  };
}

interface Props {
  value: GithubIssueFieldsValue;
  onChange: (patch: Partial<GithubIssueFieldsValue>) => void;
}

export function GithubIssueFields({ value, onChange }: Props) {
  const t = useT();
  const repoValue: RepoValue | null =
    value.owner && value.repo ? { owner: value.owner, repo: value.repo } : null;

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("github.field.repo")} required>
        <RepoCombobox
          value={repoValue}
          onChange={(next) =>
            onChange(
              next
                ? { owner: next.owner, repo: next.repo, labels: [], assignees: [] }
                : { owner: undefined, repo: undefined, labels: [], assignees: [] },
            )
          }
        />
      </FieldRow>
      <FieldRow label={t("github.field.labels")}>
        <LabelMultiSelect
          owner={value.owner}
          repo={value.repo}
          value={value.labels}
          onChange={(labels) => onChange({ labels })}
        />
      </FieldRow>
      <FieldRow label={t("github.field.assignees")}>
        <AssigneeMultiSelect
          owner={value.owner}
          repo={value.repo}
          value={value.assignees}
          onChange={(assignees) => onChange({ assignees })}
        />
      </FieldRow>
    </div>
  );
}

