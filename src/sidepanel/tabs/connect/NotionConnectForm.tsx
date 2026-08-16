import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiNotion } from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings-store";
import type {
  NotionAccount,
  NotionDatabaseSchema,
  NotionMyself,
  NotionOAuthAuth,
  NotionSelectFieldValue,
} from "@/types/notion";
import { sendBg } from "@/lib/bg-client";
import { DatabaseCombobox } from "@/sidepanel/tabs/notionFields/DatabaseCombobox";
import { PropertiesFieldset } from "@/sidepanel/tabs/notionFields/PropertiesFieldset";
import { StatusSelect } from "@/sidepanel/tabs/notionFields/StatusSelect";
import { reconcileNotionFields } from "@/sidepanel/tabs/notionFields/reconcileNotionFields";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { PlatformConnectFlow } from "./PlatformConnectFlow";

export function NotionConnectedBody() {
  return (
    <>
      <NotionSummary />
      <NotionDefaultsBlock />
    </>
  );
}

export function NotionConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  return (
    <PlatformConnectFlow
      connected={connected}
      onConnected={onConnected}
      platform="notion"
      icon={<SiNotion className="h-4 w-4 dark:invert" color="default" />}
      tokenLabelKey="notion.internalToken.button"
      availableRequest={{ type: "notion.oauth.available" }}
      startOAuthRequest={{ type: "notion.startOAuth" }}
      buildAccount={(auth: NotionOAuthAuth): NotionAccount => ({
        platform: "notion",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      })}
      renderTokenDialog={({ open, onOpenChange }) => (
        <InternalTokenDialog open={open} onOpenChange={onOpenChange} onConnected={onConnected} />
      )}
    />
  );
}

function NotionDefaultsBlock() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.notion);
  const updateNotionAccount = useSettingsStore((s) => s.updateNotionAccount);
  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 같은 DB에 대해 schema는 한 번만 fetch. DB 변경 시 reqIdRef로 in-flight 결과 무시.
  const reqIdRef = useRef(0);

  const databaseId = account?.defaults.databaseId;

  useEffect(() => {
    setSchema(null);
    setError(null);
    if (!databaseId) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    sendBg<NotionDatabaseSchema>({
      type: "notion.getDatabaseSchema",
      databaseId,
    })
      .then((s) => {
        if (myReq !== reqIdRef.current) return;
        setSchema(s);
        const cur = useSettingsStore.getState().accounts.notion;
        if (!cur) return;
        const reconciled = reconcileNotionFields(
          {
            statusOption: cur.defaults.statusOption,
            selectValues: cur.defaults.selectValues ?? [],
          },
          s,
        );
        if (reconciled.changed) {
          useSettingsStore.getState().updateNotionAccount({
            defaults: {
              ...cur.defaults,
              statusOption: reconciled.statusOption,
              selectValues: reconciled.selectValues.length
                ? reconciled.selectValues
                : undefined,
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (myReq !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (myReq !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [databaseId]);

  if (!account) return null;

  return (
    <div className="flex flex-col gap-3">
      <FieldRow label={t("notion.field.database")}>
        <DatabaseCombobox
          value={account.defaults.databaseId}
          valueTitle={account.defaults.databaseTitle}
          onChange={(nextId, nextTitle) =>
            updateNotionAccount({
              // DB 바뀌면 status/select default도 모두 리셋 (DB 종속 옵션이라 다른 DB에서 무효)
              defaults: {
                databaseId: nextId,
                databaseTitle: nextTitle,
                statusOption: undefined,
                selectValues: undefined,
              },
            })
          }
        />
      </FieldRow>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {schema?.statusProperty ? (
        <FieldRow label={t("notion.field.status")}>
          <StatusSelect
            schema={schema.statusProperty}
            value={account.defaults.statusOption}
            onChange={(next) =>
              updateNotionAccount({
                defaults: { ...account.defaults, statusOption: next },
              })
            }
          />
        </FieldRow>
      ) : null}

      {schema && schema.selectProperties.length > 0 ? (
        <PropertiesFieldset
          schema={schema}
          values={account.defaults.selectValues ?? []}
          onChange={(next: NotionSelectFieldValue[]) =>
            updateNotionAccount({
              defaults: {
                ...account.defaults,
                selectValues: next.length ? next : undefined,
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function InternalTokenDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [token, setToken] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = token.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    if (validating) return;
    setValidating(true);
    try {
      const me = await sendBg<NotionMyself>({
        type: "notion.testToken",
        token: trimmed,
      });
      const next: NotionAccount = {
        platform: "notion",
        connectedAt: Date.now(),
        auth: {
          kind: "apiKey",
          token: trimmed,
          botName: me.botName,
          workspaceName: me.workspaceName,
        },
        defaults: {},
      };
      setAccount("notion", next);
      onConnected();
      setToken("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("notion.internalToken.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("notion.internalToken.dialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldRow
            label={t("notion.internalToken.label")}
            htmlFor="notion-internal-token"
            labelAction={
              <a
                href="https://www.notion.so/profile/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <Input
              id="notion-internal-token"
              placeholder={t("notion.internalToken.placeholder")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("notion.internalToken.shareNotice")}
            </p>
          </FieldRow>

        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleValidate}
            disabled={!canValidate && !validating}
            aria-disabled={validating}
            className="relative aria-disabled:cursor-not-allowed"
          >
            {validating && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={validating ? "opacity-0" : undefined}>
              {t("common.verify")}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotionSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.notion);
  if (!account) return null;
  const kindLabel =
    account.auth.kind === "oauth"
      ? t("notion.auth.kind.oauth")
      : t("notion.auth.kind.internalToken");
  const workspaceName =
    account.auth.kind === "oauth"
      ? account.auth.workspaceName
      : account.auth.workspaceName ?? "";
  const botName = account.auth.botName || t("notion.auth.defaultBotName");
  const ownerEmail =
    account.auth.kind === "oauth" ? account.auth.ownerUserEmail : undefined;
  const ownerName =
    account.auth.kind === "oauth" ? account.auth.ownerUserName : undefined;
  const subtitle = ownerEmail || ownerName || "notion.so";

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">
              {workspaceName || botName}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {subtitle}
            </span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
