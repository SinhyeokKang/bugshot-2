import type { NotionDatabaseSchema } from "@/types/notion";
import { PropertySelectCombobox } from "./PropertySelectCombobox";

interface SelectFieldValue {
  propertyName: string;
  type: "select" | "multi_select";
  options: string[];
}

interface Props {
  schema: NotionDatabaseSchema;
  values: SelectFieldValue[];
  onChange: (next: SelectFieldValue[]) => void;
}

export function PropertiesFieldset({ schema, values, onChange }: Props) {
  if (schema.selectProperties.length === 0) return null;

  function setValueFor(name: string, type: "select" | "multi_select", opts: string[]): void {
    const without = values.filter((v) => v.propertyName !== name);
    if (opts.length === 0) {
      onChange(without);
      return;
    }
    onChange([...without, { propertyName: name, type, options: opts }]);
  }

  return (
    <div className="flex flex-col gap-3">
      {schema.selectProperties.map((p) => {
        const cur = values.find((v) => v.propertyName === p.name);
        const propType: "select" | "multi_select" =
          p.type === "multi_select" ? "multi_select" : "select";
        return (
          <div key={p.id} className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">{p.name}</label>
            <PropertySelectCombobox
              schema={p}
              value={cur?.options ?? []}
              onChange={(next) => setValueFor(p.name, propType, next)}
            />
          </div>
        );
      })}
    </div>
  );
}
