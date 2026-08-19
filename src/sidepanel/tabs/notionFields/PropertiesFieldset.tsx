import { FieldRow } from "@/sidepanel/components/FieldRow";
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
    <div className="flex flex-col gap-4">
      {schema.selectProperties.map((p) => {
        const cur = values.find((v) => v.propertyName === p.name);
        const propType: "select" | "multi_select" =
          p.type === "multi_select" ? "multi_select" : "select";
        return (
          <FieldRow key={p.id} label={p.name}>
            <PropertySelectCombobox
              schema={p}
              ariaLabel={p.name}
              value={cur?.options ?? []}
              onChange={(next) => setValueFor(p.name, propType, next)}
            />
          </FieldRow>
        );
      })}
    </div>
  );
}
