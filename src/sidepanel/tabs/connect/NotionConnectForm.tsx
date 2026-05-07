import { useEffect, useRef, useState } from "react";
import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { SiNotion } from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { isOAuthCancelled, sendBg } from "@/types/messages";
import { PageFooter, PageScroll, Section } from "../../components/Section";
import { DatabaseCombobox } from "../notionFields/DatabaseCombobox";
import { PropertiesFieldset } from "../notionFields/PropertiesFieldset";
import { StatusSelect } from "../notionFields/StatusSelect";
import { reconcileNotionFields } from "../notionFields/reconcileNotionFields";

export function NotionConnectForm() {
  const t = useT();
  const notionAccount = useSettingsStore((s) => s.accounts.notion);
  const connected = !!notionAccount;

  if (!connected) {
    return <NotionOnboarding />;
  }

  return (
    <>
      <PageScroll>
        <Section title={t("notion.section.connection")}>
          <NotionSummary />
        </Section>
        <Section title={t("common.settings")}>
          <NotionDefaultsBlock />
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex justify-between">
          <DisconnectButton />
        </div>
      </PageFooter>
    </>
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
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {t("notion.field.database")}
        </label>
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
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {schema?.statusProperty ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {t("notion.field.status")}
          </label>
          <StatusSelect
            schema={schema.statusProperty}
            value={account.defaults.statusOption}
            onChange={(next) =>
              updateNotionAccount({
                defaults: { ...account.defaults, statusOption: next },
              })
            }
          />
        </div>
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

function NotionOnboarding() {
  const t = useT();
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);

  const setAccount = useSettingsStore((s) => s.setAccount);

  useEffect(() => {
    let cancelled = false;
    sendBg<{ available: boolean }>({ type: "notion.oauth.available" })
      .then((res) => !cancelled && setOauthAvailable(res.available))
      .catch(() => !cancelled && setOauthAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function startOAuth() {
    setOauthError(null);
    setConnecting(true);
    try {
      const auth = await sendBg<NotionOAuthAuth>({ type: "notion.startOAuth" });
      const next: NotionAccount = {
        platform: "notion",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      };
      setAccount("notion", next);
    } catch (err) {
      if (!isOAuthCancelled(err)) {
        setOauthError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <SiNotion className="h-6 w-6 dark:invert" color="default" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("notion.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("notion.onboarding.body")}
        </p>

        <div className="mt-5 flex gap-2">
          {oauthAvailable !== false ? (
            <Button
              onClick={() => void startOAuth()}
              disabled={connecting || oauthAvailable === null}
              className="relative"
            >
              {connecting && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
              <span className={`inline-flex items-center gap-2 ${connecting ? "opacity-0" : ""}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                {t("notion.connect.button")}
              </span>
            </Button>
          ) : null}

          <Button
            variant="outline"
            onClick={() => setTokenOpen(true)}
            disabled={connecting}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t("notion.internalToken.button")}
          </Button>
        </div>

        {oauthAvailable === false ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("notion.oauth.notConfigured")}
          </p>
        ) : null}
        {oauthError ? (
          <Alert variant="destructive" className="mt-3 text-xs">
            <AlertDescription>{oauthError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <InternalTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </>
  );
}

function InternalTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const setAccount = useSettingsStore((s) => s.setAccount);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const trimmed = token.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    setError(null);
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
      setToken("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("notion.internalToken.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("notion.internalToken.dialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="notion-internal-token"
                className="text-xs text-muted-foreground"
              >
                {t("notion.internalToken.label")}
              </label>
              <a
                href="https://www.notion.so/profile/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
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
          </div>

          {error ? (
            <Alert variant="destructive" className="text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleValidate}
            disabled={!canValidate}
            className="relative"
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
  const botName = account.auth.botName || "Notion bot";
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
          <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
            <CircleCheck className="h-3 w-3" />
            {kindLabel}
          </Badge>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("platform.connected", { platform: t("platform.tab.notion") })}
      </p>
    </div>
  );
}

function DisconnectButton() {
  const t = useT();
  const removeAccount = useSettingsStore((s) => s.removeAccount);
  const platform = t("platform.tab.notion");

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          {t("platform.disconnect")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("platform.disconnect.title", { platform })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("platform.disconnect.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => removeAccount("notion")}>
            {t("platform.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
