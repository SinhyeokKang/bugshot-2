import { useCallback } from "react";
import { useT } from "@/i18n";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { AsanaProject } from "@/types/asana";
import { sendBg } from "@/lib/bg-client";

export interface ProjectValue {
  projectGid: string;
  projectName: string;
}

interface Props {
  workspaceGid: string | undefined;
  value: ProjectValue | null;
  onChange: (next: ProjectValue | null) => void;
}

export function ProjectCombobox({ workspaceGid, value, onChange }: Props) {
  const t = useT();
  const ready = !!workspaceGid;
  // searchProjects는 서버 검색이 없어 워크스페이스 프로젝트를 1회 받아 클라이언트 필터.
  const load = useCallback(
    () =>
      sendBg<AsanaProject[]>({
        type: "asana.searchProjects",
        workspaceGid: workspaceGid!,
        query: "",
      }),
    [workspaceGid],
  );

  const triggerLabel = (() => {
    if (!ready) return t("asana.field.requireWorkspace");
    if (!value) return t("asana.field.project.select");
    return value.projectName;
  })();

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(p) => p.gid}
      getName={(p) => p.name}
      selectedKey={value?.projectGid ?? null}
      onSelect={(p) =>
        onChange(p ? { projectGid: p.gid, projectName: p.name } : null)
      }
      triggerLabel={triggerLabel}
      searchPlaceholder={t("asana.field.project.search")}
      emptyLabel={t("asana.field.project.empty")}
    />
  );
}
