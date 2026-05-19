import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import type {
  NotionDatabaseSchema,
  NotionDefaults,
} from "@/types/notion";
import { sendBg } from "@/types/messages";
import { FieldRow } from "@/sidepanel/tabs/IssueCreateModal";
import { DatabaseCombobox } from "./DatabaseCombobox";
import { PropertiesFieldset } from "./PropertiesFieldset";
import { StatusSelect } from "./StatusSelect";
import { reconcileNotionFields } from "./reconcileNotionFields";

export interface NotionSelectFieldValue {
  propertyName: string;
  type: "select" | "multi_select";
  options: string[];
}

export interface NotionIssueFieldsValue {
  databaseId?: string;
  databaseTitle?: string;
  statusOption?: string;
  selectValues: NotionSelectFieldValue[];
}

export function initialNotionFields(
  last: Partial<NotionIssueFieldsValue> | undefined,
  defaults: NotionDefaults | undefined,
): NotionIssueFieldsValue {
  if (last?.databaseId) {
    // 같은 DB일 때만 defaults를 fallback으로 사용 (DB 종속 옵션이라 다른 DB면 무효)
    const fb = last.databaseId === defaults?.databaseId ? defaults : undefined;
    return {
      databaseId: last.databaseId,
      databaseTitle: last.databaseTitle ?? fb?.databaseTitle,
      statusOption: last.statusOption ?? fb?.statusOption,
      selectValues: last.selectValues ?? fb?.selectValues ?? [],
    };
  }
  if (defaults?.databaseId) {
    return {
      databaseId: defaults.databaseId,
      databaseTitle: defaults.databaseTitle,
      statusOption: defaults.statusOption,
      selectValues: defaults.selectValues ?? [],
    };
  }
  return { selectValues: [] };
}

interface Props {
  value: NotionIssueFieldsValue;
  onChange: (patch: Partial<NotionIssueFieldsValue>) => void;
  onSchemaResolved: (schema: NotionDatabaseSchema | null) => void;
}

export function NotionIssueFields({ value, onChange, onSchemaResolved }: Props) {
  const t = useT();
  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    setSchema(null);
    setSchemaError(null);
    onSchemaResolved(null);
    if (!value.databaseId) return;
    let cancelled = false;
    setLoadingSchema(true);
    sendBg<NotionDatabaseSchema>({
      type: "notion.getDatabaseSchema",
      databaseId: value.databaseId,
    })
      .then((s) => {
        if (cancelled) return;
        setSchema(s);
        onSchemaResolved(s);
        const reconciled = reconcileNotionFields(
          { statusOption: value.statusOption, selectValues: value.selectValues },
          s,
        );
        if (reconciled.changed) {
          onChange({
            statusOption: reconciled.statusOption,
            selectValues: reconciled.selectValues,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSchemaError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSchema(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.databaseId]);

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label={t("notion.field.database")} required>
        <DatabaseCombobox
          value={value.databaseId}
          valueTitle={value.databaseTitle}
          onChange={(id, title) =>
            onChange({
              databaseId: id,
              databaseTitle: title,
              statusOption: undefined,
              selectValues: [],
            })
          }
        />
      </FieldRow>

      {loadingSchema ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {schemaError ? (
        <p className="text-xs text-destructive">{schemaError}</p>
      ) : null}

      {schema?.statusProperty ? (
        <FieldRow label={t("notion.field.status")}>
          <StatusSelect
            schema={schema.statusProperty}
            value={value.statusOption}
            onChange={(next) => onChange({ statusOption: next })}
          />
        </FieldRow>
      ) : null}

      {schema && schema.selectProperties.length > 0 ? (
        <PropertiesFieldset
          schema={schema}
          values={value.selectValues}
          onChange={(next) => onChange({ selectValues: next })}
        />
      ) : null}
    </div>
  );
}
