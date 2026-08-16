import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { JiraSprint } from "@/types/jira";
import { sendBg } from "@/lib/bg-client";
import { FieldCombobox } from "./FieldCombobox";
import { useJiraConfig } from "./useJiraConfig";

// EpicField와 같은 골격이되 검색이 서버가 아니라 클라이언트다 — agile API에 스프린트 이름
// 검색이 없다. onSearch를 넘기지 않으면 FieldCombobox가 cmdk 기본 필터를 켠다.
export function SprintField({
  projectKey,
  value,
  fallbackLabel,
  onChange,
}: {
  projectKey: string;
  value?: number;
  fallbackLabel?: string;
  onChange: (id: number | undefined, name?: string) => void;
}) {
  const t = useT();
  const jira = useJiraConfig();
  const [open, setOpen] = useState(false);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [multiBoard, setMultiBoard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectKey || !jira) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<{ sprints: JiraSprint[]; multiBoard: boolean }>({
      type: "jira.listSprints",
      projectKey,
    })
      .then((res) => {
        if (cancelled) return;
        setSprints(res.sprints);
        setMultiBoard(res.multiBoard);
      })
      // 조회 실패 자체는 background가 "고를 게 없다"로 삼킨다. 여기 도달하는 건 메시지 경로가
      // 죽은 경우뿐이라 형제 필드들처럼 그대로 노출한다(빈 목록과 구별되게).
      .catch((err: unknown) => {
        if (cancelled) return;
        setSprints([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectKey, jira]);

  const selected = sprints.find((s) => s.id === value);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.sprint.select")}
      searchPlaceholder={t("field.sprint.search")}
      emptyMessage={t("field.sprint.empty")}
      label={selected?.name}
      fallbackLabel={fallbackLabel}
      clearable={value != null}
      onClear={() => onChange(undefined)}
      groupLabel={t("field.sprint.label")}
      ariaLabel={t("create.sprint")}
      testId="jira-sprint-combobox"
    >
      {sprints.map((sprint) => (
        <CommandItem
          key={sprint.id}
          // 검색 대상은 화면에 실제로 그린 텍스트만 — 안 보이는 보드명으로 매칭되면
          // 결과가 남은 이유가 사라진다.
          value={
            multiBoard && sprint.boardName
              ? `${sprint.name} ${sprint.boardName}`
              : sprint.name
          }
          onSelect={() => {
            onChange(sprint.id, sprint.name);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4 shrink-0",
              value === sprint.id ? "opacity-100" : "opacity-0",
            )}
          />
          {/* 보드가 하나뿐이면 보드명은 소음이다. 한 줄 접미사로는 폭이 안 나와 2줄로 쌓는다
              — 보드명은 Jira key와 달리 길이가 유계가 아니다. */}
          {multiBoard && sprint.boardName ? (
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{sprint.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {sprint.boardName}
              </span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{sprint.name}</span>
          )}
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
