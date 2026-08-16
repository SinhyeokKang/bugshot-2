import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiClickup } from "@icons-pack/react-simple-icons";
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
import type { ClickupAccount, ClickupMyself, ClickupOAuthAuth } from "@/types/clickup";
import { sendBg } from "@/lib/bg-client";
import { AssigneeCombobox, type AssigneeValue as ClickupAssigneeValue } from "@/sidepanel/tabs/clickupFields/AssigneeCombobox";
import { ListCombobox, type ListValue } from "@/sidepanel/tabs/clickupFields/ListCombobox";
import { SpaceCombobox, type SpaceValue } from "@/sidepanel/tabs/clickupFields/SpaceCombobox";
import { WorkspaceCombobox, type WorkspaceValue } from "@/sidepanel/tabs/clickupFields/WorkspaceCombobox";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { PlatformConnectFlow } from "./PlatformConnectFlow";

const CLICKUP_TOKEN_SETTINGS = "https://app.clickup.com/settings/apps";

export function ClickupConnectedBody() {
  return (
    <>
      <ClickupSummary />
      <DefaultWorkspaceField />
      <DefaultSpaceField />
      <DefaultListField />
      <DefaultAssigneeField />
    </>
  );
}

export function ClickupConnectFlow({ connected, onConnected }: ConnectFlowProps) {
  return (
    <PlatformConnectFlow
      connected={connected}
      onConnected={onConnected}
      platform="clickup"
      icon={<SiClickup className="h-4 w-4" color="default" />}
      tokenLabelKey="clickup.patButton"
      availableRequest={{ type: "clickup.oauth.available" }}
      startOAuthRequest={{ type: "clickup.startOAuth" }}
      buildAccount={(auth: ClickupOAuthAuth): ClickupAccount => ({
        platform: "clickup",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      })}
      renderTokenDialog={({ open, onOpenChange }) => (
        <PatDialog open={open} onOpenChange={onOpenChange} onConnected={onConnected} />
      )}
    />
  );
}

function DefaultWorkspaceField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: WorkspaceValue | null =
    account.defaults.workspaceId && account.defaults.workspaceName
      ? {
          workspaceId: account.defaults.workspaceId,
          workspaceName: account.defaults.workspaceName,
        }
      : null;
  return (
    <FieldRow label={t("clickup.section.workspace")}>
      <WorkspaceCombobox
        value={value}
        onChange={(next) =>
          // space·list·assignee는 workspace 하위 값이라 workspace가 바뀌면 함께 비운다.
          updateClickupAccount({
            defaults: {
              ...account.defaults,
              workspaceId: next?.workspaceId,
              workspaceName: next?.workspaceName,
              spaceId: undefined,
              spaceName: undefined,
              listId: undefined,
              listName: undefined,
              assigneeId: undefined,
              assigneeName: undefined,
            },
          })
        }
      />
    </FieldRow>
  );
}

function DefaultSpaceField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: SpaceValue | null =
    account.defaults.spaceId && account.defaults.spaceName
      ? { spaceId: account.defaults.spaceId, spaceName: account.defaults.spaceName }
      : null;
  return (
    <FieldRow label={t("clickup.section.space")}>
      <SpaceCombobox
        workspaceId={account.defaults.workspaceId}
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: next
              ? { ...account.defaults, spaceId: next.spaceId, spaceName: next.spaceName, listId: undefined, listName: undefined }
              : { ...account.defaults, spaceId: undefined, spaceName: undefined, listId: undefined, listName: undefined },
          })
        }
      />
    </FieldRow>
  );
}

function DefaultListField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: ListValue | null =
    account.defaults.listId && account.defaults.listName
      ? { listId: account.defaults.listId, listName: account.defaults.listName }
      : null;
  return (
    <FieldRow label={t("clickup.section.list")}>
      <ListCombobox
        spaceId={account.defaults.spaceId}
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: next
              ? { ...account.defaults, listId: next.listId, listName: next.listName }
              : { ...account.defaults, listId: undefined, listName: undefined },
          })
        }
      />
    </FieldRow>
  );
}

function DefaultAssigneeField() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  const updateClickupAccount = useSettingsStore((s) => s.updateClickupAccount);
  if (!account) return null;
  const value: ClickupAssigneeValue | null =
    account.defaults.assigneeId && account.defaults.assigneeName
      ? { id: account.defaults.assigneeId, name: account.defaults.assigneeName }
      : null;
  return (
    <FieldRow label={t("clickup.field.assignee")}>
      <AssigneeCombobox
        workspaceId={account.defaults.workspaceId}
        value={value}
        onChange={(next) =>
          updateClickupAccount({
            defaults: {
              ...account.defaults,
              assigneeId: next?.id,
              assigneeName: next?.name,
            },
          })
        }
      />
    </FieldRow>
  );
}

function PatDialog({
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
  const [pat, setPat] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = pat.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    if (validating) return;
    setValidating(true);
    try {
      const me = await sendBg<ClickupMyself>({
        type: "clickup.testPat",
        pat: trimmed,
      });
      const next: ClickupAccount = {
        platform: "clickup",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          viewerId: me.id,
          viewerName: me.name,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      setAccount("clickup", next);
      onConnected();
      setPat("");
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
          <DialogTitle className="text-xl">{t("clickup.patDialog.title")}</DialogTitle>
          <DialogDescription>{t("clickup.patDialog.body")}</DialogDescription>
        </DialogHeader>

        <FieldRow
          label={t("clickup.patLabel")}
          htmlFor="clickup-pat"
          labelAction={
            <a
              href={CLICKUP_TOKEN_SETTINGS}
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
            id="clickup-pat"
            placeholder={t("clickup.patPlaceholder")}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </FieldRow>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleValidate} disabled={!canValidate && !validating} aria-disabled={validating} className="relative aria-disabled:cursor-not-allowed">
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

function ClickupSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.clickup);
  if (!account) return null;
  const kindLabel =
    account.auth.kind === "oauth"
      ? t("clickup.auth.kind.oauth")
      : t("clickup.auth.kind.pat");
  const name = account.auth.viewerName || t("clickup.viewerName");

  return (
    <div className="flex flex-col gap-1.5">
      <Card>
        <CardContent className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-foreground">{name}</span>
            <span className="truncate text-sm text-muted-foreground">
              {account.auth.viewerEmail || t("platform.tab.clickup")}
            </span>
          </div>
          <ConnectedBadge>{kindLabel}</ConnectedBadge>
        </CardContent>
      </Card>
    </div>
  );
}
