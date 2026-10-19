import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import type { JiraIssueType } from "@/types/jira";
import { sendBg } from "@/lib/bg-client";
import { FieldCombobox } from "./FieldCombobox";

export function IssueTypeField({
  value,
  fallbackLabel,
  projectKey,
  open,
  onOpenChange: setOpen,
  onChange,
}: {
  value?: string;
  // 목록은 콤보를 열어야 받으므로 그 전의 라벨은 값과 쌍으로 저장된 이름이다.
  fallbackLabel?: string;
  projectKey?: string;
  // 프로젝트를 바꾸면 이슈타입이 비면서 제출 버튼이 잠기는데, 그 유일한 단서가 이 콤보를
  // 대신 열어주는 것이라 열림 상태는 부모가 쥔다.
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChange: (id: string, name?: string, hierarchyLevel?: number) => void;
}) {
  const t = useT();
  const jiraAccount = useSettingsStore((s) => s.accounts.jira);
  const [items, setItems] = useState<JiraIssueType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | undefined>(undefined);

  // 캐시 무효화는 프로젝트가 바뀔 때뿐이다. loadedFor를 함께 비우지 않으면, 응답 전에 A→B→A로
  // 되돌아왔을 때 취소된 B의 .then/.finally가 둘 다 no-op이라 loadedFor는 "A"로 남고 loading은
  // true로 굳는다 — 그 상태로 아래 가드가 재조회까지 막아 콤보가 영구 로딩이 된다.
  useEffect(() => {
    setItems([]);
    setError(null);
    loadedFor.current = undefined;
  }, [projectKey]);

  // 계정 기본 이슈타입은 계정 기본 프로젝트의 것이다 — 다른 프로젝트에서 적용하면 대상 프로젝트에
  // 없는 이슈타입으로 제출해 400이 난다. 주입 경로가 둘(아래 effect의 값 주입 + effectiveValue가
  // 먹이는 라벨·체크마크)이라 소스에서 함께 끊는다. effect만 막으면 화면엔 골라진 것처럼 보이는데
  // 값은 비어 create.requiredMissing으로 죽는다.
  const isDefaultProject = !!projectKey && projectKey === jiraAccount?.projectKey;
  const defaultId = isDefaultProject ? jiraAccount?.issueTypeId : undefined;
  const defaultName = isDefaultProject ? jiraAccount?.issueTypeName : undefined;
  const effectiveValue = value ?? defaultId;
  // 계정 기본 이름은 값이 계정 기본 id일 때만 빌린다 — 직전 제출값(다른 id)이 복원됐는데 기본
  // 이름을 보이면 화면과 제출이 다른 타입을 가리킨다.
  const fallbackName = value ? fallbackLabel ?? (value === defaultId ? defaultName : undefined) : defaultName;
  // 이름 없이 값만 복원된 경우(업데이트 이전 lastSubmitFields)엔 라벨을 댈 데가 목록뿐이라 열기 전에 받는다.
  const needsList = open || (!!value && !fallbackName);

  // 재조회 가드를 items.length가 아니라 "어느 프로젝트로 받은 목록인가"로 잡는다. items.length를
  // 쓰면 (a) deps에 넣을 경우 setItems → 리렌더 → cleanup(cancelled=true) → 재실행이 .finally보다
  // 먼저 끼어 setLoading(false)가 영영 안 불리고(로딩 고착), (b) deps에서 빼면 위 reset effect가
  // 예약만 된 시점의 옛 목록을 보고 조기 반환해 프로젝트를 바꿔도 재조회가 안 나간다.
  useEffect(() => {
    if (!needsList || !jiraAccount || !projectKey) return;
    if (loadedFor.current === projectKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sendBg<JiraIssueType[]>({
      type: "jira.listIssueTypes",
      projectKey,
    })
      .then((list) => {
        if (cancelled) return;
        loadedFor.current = projectKey;
        setItems(list);
      })
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [needsList, jiraAccount, projectKey]);

  const selected = items.find((i) => i.id === effectiveValue);

  useEffect(() => {
    if (!value && defaultId) onChange(defaultId, defaultName);
  }, [value, defaultId, defaultName, onChange]);

  return (
    <FieldCombobox
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      error={error}
      placeholder={t("field.issueType.select")}
      searchPlaceholder={t("field.issueType.search")}
      emptyMessage={t("field.issueType.empty")}
      label={selected?.name ?? (effectiveValue ? fallbackName : undefined)}
      testId="jira-issue-type-combobox"
    >
      {items.map((it) => (
        <CommandItem
          key={it.id}
          value={it.name}
          onSelect={() => {
            onChange(it.id, it.name, it.hierarchyLevel);
            setOpen(false);
          }}
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4",
              effectiveValue === it.id ? "opacity-100" : "opacity-0",
            )}
          />
          {it.iconUrl ? (
            <img src={it.iconUrl} alt="" className="mr-2 h-4 w-4" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
        </CommandItem>
      ))}
    </FieldCombobox>
  );
}
