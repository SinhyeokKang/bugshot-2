import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { GithubUser } from "@/types/github";
import { sendBg } from "@/lib/bg-client";

interface Props {
  owner: string | undefined;
  repo: string | undefined;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

export function AssigneeCombobox({ owner, repo, value, onChange }: Props) {
  const t = useT();
  const ready = !!owner && !!repo;
  const load = useCallback(
    () =>
      sendBg<GithubUser[]>({
        type: "github.searchAssignees",
        owner: owner!,
        repo: repo!,
      }),
    [owner, repo],
  );

  const triggerLabel = (() => {
    if (!ready) return t("github.field.requireRepo");
    if (!value) return t("github.field.assignee.placeholder");
    return value;
  })();

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(u) => u.login}
      getName={(u) => u.login}
      renderItem={(u) => (
        <>
          {u.avatarUrl ? (
            <img src={u.avatarUrl} alt="" className="mr-2 h-4 w-4 rounded-full" />
          ) : null}
          <span className="truncate">{u.login}</span>
        </>
      )}
      selectedKey={value ?? null}
      onSelect={(u) => onChange(u ? u.login : undefined)}
      triggerLabel={triggerLabel}
      searchPlaceholder={t("github.field.assignee.search")}
      emptyLabel={t("github.field.assignee.empty")}
    />
  );
}
