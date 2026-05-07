import { useT } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotionPropertySchema } from "@/types/notion";

interface Props {
  schema: NotionPropertySchema;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

const NONE = "__none__";

export function StatusSelect({ schema, value, onChange }: Props) {
  const t = useT();
  const options = schema.options ?? [];

  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("notion.field.status.empty")}
      </p>
    );
  }

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("notion.field.status.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("notion.field.status.none")}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.name}>
            {opt.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
