import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { GitlabMember } from "@/types/gitlab";
import { sendBg } from "@/types/messages";

export interface AssigneeValue {
  id: number;
  username: string;
}

interface Props {
  projectId: number | undefined;
  value: AssigneeValue | null;
  onChange: (next: AssigneeValue | null) => void;
}

export function AssigneeCombobox({ projectId, value, onChange }: Props) {
  const t = useT();
  const ready = !!projectId;
  const load = useCallback(
    () =>
      sendBg<GitlabMember[]>({
        type: "gitlab.searchAssignees",
        projectId: projectId!,
      }),
    [projectId],
  );

  const triggerLabel = (() => {
    if (!ready) return t("gitlab.field.requireProject");
    if (!value) return t("gitlab.field.assignee.placeholder");
    return value.username;
  })();

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      // 멤버 id는 number라 selectedKey(string)와 맞추려면 양쪽을 함께 문자열화해야 한다.
      getKey={(u) => String(u.id)}
      getName={(u) => u.username}
      renderItem={(u) => (
        <>
          {u.avatarUrl ? (
            <img src={u.avatarUrl} alt="" className="mr-2 h-4 w-4 rounded-full" />
          ) : null}
          <span className="truncate">{u.username}</span>
        </>
      )}
      selectedKey={value ? String(value.id) : null}
      onSelect={(u) => onChange(u ? { id: u.id, username: u.username } : null)}
      triggerLabel={triggerLabel}
      searchPlaceholder={t("gitlab.field.assignee.search")}
      emptyLabel={t("gitlab.field.assignee.empty")}
    />
  );
}
