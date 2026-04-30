import { useT } from "@/i18n";
import type { IssueSection } from "@/store/app-settings-store";

// 섹션 본문(저장된 markdown 평문)을 미리보기/검토 다이얼로그에 렌더링.
// renderAs="orderedList" → 줄별 trim·빈 줄 skip 후 ol/li.
// 그 외 → 원문 whitespace 보존 paragraph.
export function DocSectionBody({
  section,
  value,
  emptyVariant = "muted",
}: {
  section: IssueSection;
  value: string;
  emptyVariant?: "muted" | "hide";
}) {
  const t = useT();
  if (section.renderAs === "orderedList") {
    const items = value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      if (emptyVariant === "hide") return null;
      return (
        <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>
      );
    }
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        {items.map((it, idx) => (
          <li key={idx}>{it}</li>
        ))}
      </ol>
    );
  }
  if (!value.trim()) {
    if (emptyVariant === "hide") return null;
    return <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>;
  }
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {value}
    </div>
  );
}
