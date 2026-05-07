import type {
  NotionDatabaseSchema,
  NotionSelectFieldValue,
} from "@/types/notion";

export interface ReconcilableFields {
  statusOption?: string;
  selectValues: NotionSelectFieldValue[];
}

export interface ReconcileResult extends ReconcilableFields {
  changed: boolean;
}

// schema에서 사라진 필드/옵션은 fields에서 제거.
// - statusOption: schema.statusProperty.options에 없으면 undefined
// - selectValues: 각 항목의 propertyName이 schema.selectProperties에 없으면 제거,
//   options 중 schema의 그 property options에 없는 것은 제거,
//   결과적으로 options가 비면 항목 통째로 제거
export function reconcileNotionFields(
  fields: ReconcilableFields,
  schema: NotionDatabaseSchema,
): ReconcileResult {
  let changed = false;

  let statusOption = fields.statusOption;
  if (statusOption) {
    const exists = schema.statusProperty?.options?.some(
      (o) => o.name === statusOption,
    );
    if (!exists) {
      statusOption = undefined;
      changed = true;
    }
  }

  const selectIndex = new Map<
    string,
    { type: "select" | "multi_select"; options: Set<string> }
  >();
  for (const p of schema.selectProperties) {
    selectIndex.set(p.name, {
      type: p.type === "multi_select" ? "multi_select" : "select",
      options: new Set((p.options ?? []).map((o) => o.name)),
    });
  }

  const selectValues: NotionSelectFieldValue[] = [];
  for (const sv of fields.selectValues) {
    const def = selectIndex.get(sv.propertyName);
    if (!def) {
      changed = true;
      continue;
    }
    const validOptions = sv.options.filter((o) => def.options.has(o));
    if (validOptions.length !== sv.options.length) changed = true;
    if (def.type !== sv.type) changed = true;
    if (validOptions.length === 0) {
      changed = true;
      continue;
    }
    selectValues.push({
      propertyName: sv.propertyName,
      type: def.type,
      options: validOptions,
    });
  }

  return { statusOption, selectValues, changed };
}
