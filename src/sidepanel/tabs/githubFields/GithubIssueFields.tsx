import { useT } from "@/i18n";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { CcCombobox } from "./CcCombobox";
import { LabelCombobox } from "./LabelCombobox";
import { RepoCombobox, type RepoValue } from "./RepoCombobox";
import { FieldRow } from "@/sidepanel/components/FieldRow";

export interface GithubIssueFieldsValue {
  owner?: string;
  repo?: string;
  label?: string;
  assignee?: string;
  cc?: string[];
}

export function initialGhFields(
  last:
    | { owner?: string; repo?: string; label?: string; assignee?: string; cc?: string[] }
    | undefined,
  defaults: { owner?: string; repo?: string; label?: string; assignee?: string } | undefined,
): GithubIssueFieldsValue {
  const src = last?.owner && last.repo ? last : defaults;
  return {
    owner: src?.owner,
    repo: src?.repo,
    label: src?.label,
    assignee: src?.assignee,
    cc: last?.owner && last.repo ? last.cc : undefined,
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
                ? { owner: next.owner, repo: next.repo, label: undefined, assignee: undefined, cc: undefined }
                : { owner: undefined, repo: undefined, label: undefined, assignee: undefined, cc: undefined },
            )
          }
        />
      </FieldRow>
      <FieldRow label={t("github.field.labels")}>
        <LabelCombobox
          owner={value.owner}
          repo={value.repo}
          value={value.label}
          onChange={(label) => onChange({ label })}
        />
      </FieldRow>
      <FieldRow label={t("github.field.assignee")}>
        <AssigneeCombobox
          owner={value.owner}
          repo={value.repo}
          value={value.assignee}
          onChange={(assignee) => onChange({ assignee })}
        />
      </FieldRow>
      <FieldRow label={t("field.cc.label")}>
        <CcCombobox
          owner={value.owner}
          repo={value.repo}
          value={value.cc ?? []}
          onChange={(cc) => onChange({ cc })}
        />
      </FieldRow>
    </div>
  );
}

