import { useCallback } from "react";
import { useT } from "@/i18n";
import { ColorSwatch } from "@/sidepanel/components/ColorSwatch";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { GitlabLabel } from "@/types/gitlab";
import { sendBg } from "@/lib/bg-client";

interface Props {
  projectId: number | undefined;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

export function LabelCombobox({ projectId, value, onChange }: Props) {
  const t = useT();
  const ready = !!projectId;
  const load = useCallback(
    () => sendBg<GitlabLabel[]>({ type: "gitlab.getLabels", projectId: projectId! }),
    [projectId],
  );

  return (
    <SingleLazyCombobox
      disabled={!ready}
      load={load}
      getKey={(l) => l.name}
      getName={(l) => l.name}
      renderItem={(l) => (
        <>
          <ColorSwatch shape="round" color={l.color} className="mr-2" />
          <span className="truncate">{l.name}</span>
        </>
      )}
      selectedKey={value ?? null}
      onSelect={(l) => onChange(l ? l.name : undefined)}
      triggerLabel={
        !ready
          ? t("gitlab.field.requireProject")
          : value ?? t("gitlab.field.labels.placeholder")
      }
      searchPlaceholder={t("gitlab.field.labels.search")}
      emptyLabel={t("gitlab.field.labels.empty")}
    />
  );
}
