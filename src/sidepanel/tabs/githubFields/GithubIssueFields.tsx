import { useT } from "@/i18n";
import { Label } from "@/components/ui/label";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect";
import { LabelMultiSelect } from "./LabelMultiSelect";
import { RepoCombobox, type RepoValue } from "./RepoCombobox";

export interface GithubIssueFieldsValue {
  owner?: string;
  repo?: string;
  labels: string[];
  assignees: string[];
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

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
