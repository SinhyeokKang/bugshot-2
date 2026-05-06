import { useT } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRIORITIES = [
  { value: "0", key: "linear.field.priority.none" },
  { value: "1", key: "linear.field.priority.urgent" },
  { value: "2", key: "linear.field.priority.high" },
  { value: "3", key: "linear.field.priority.medium" },
  { value: "4", key: "linear.field.priority.low" },
] as const;

interface Props {
  value: number | undefined;
  onChange: (priority: number | undefined) => void;
}

export function PrioritySelect({ value, onChange }: Props) {
  const t = useT();
  const current = value?.toString() ?? "0";

  return (
    <Select
      value={current}
      onValueChange={(v) => {
        const n = Number(v);
        onChange(n === 0 ? undefined : n);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("linear.field.priority.select")} />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {t(p.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
