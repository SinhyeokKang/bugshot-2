import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { JiraProject } from "@/types/jira";
import { sendBg } from "@/types/messages";
import { FieldCombobox } from "./FieldCombobox";
import { useDebouncedSearch } from "./useDebouncedSearch";

// 연동 탭의 ProjectCombobox와 별개다 — 그쪽은 계정 설정을 직접 갱신하고, 이쪽은 이번 제출의
// 목적지를 value/onChange로 받는다. 서버 검색을 쓰는 이유는 searchProjects가 maxResults 50이라
// 클라이언트 필터만으로는 51번째 프로젝트에 도달할 수 없어서다.
export function ProjectField({
  value,
  fallbackLabel,
  onChange,
  onCloseAutoFocus,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (projectKey: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<JiraProject | null>(null);

  const fetchProjects = useCallback(
    (query: string) =>
      sendBg<JiraProject[]>({
        type: "jira.listProjects",
        query: query || undefined,
      }),
    [],
  );

  const { items, loading, error, search } = useDebouncedSearch(fetchProjects);

  useEffect(() => {
    if (open) return search("");
  }, [open, search]);

  // 서버 검색이라 검색어를 치면 선택된 프로젝트가 결과에서 빠진다 — 마지막으로 본 항목을 붙들지
  // 않으면 트리거 라벨이 `Web App (WEB)`에서 키만 남은 `WEB`로 퇴화한다(AssigneeField의 resolved 선례).
  const hit = items.find((p) => p.key === value);
  useEffect(() => {
    if (hit) setResolved(hit);
  }, [hit]);
  const selected = hit ?? (resolved?.key === value ? resolved : undefined);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("project.select")}
      searchPlaceholder={t("project.search")}
      emptyMessage={t("project.empty")}
      label={selected ? `${selected.name} (${selected.key})` : undefined}
      fallbackLabel={fallbackLabel}
      onSearch={search}
      ariaLabel={t("jira.project")}
      testId="jira-project-combobox"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {items.map((project) => (
        <CommandItem
          key={project.id}
          value={`${project.name} ${project.key}`}
          onSelect={() => {
            onChange(project.key);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4 shrink-0",
              value === project.key ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{project.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {project.key}
            </span>
          </span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
