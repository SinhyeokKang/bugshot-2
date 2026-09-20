import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { InlineLink } from "@/sidepanel/components/InlineLink";
import { sendBg } from "@/lib/bg-client";
import { normalizeWebhookUrl } from "@/lib/webhook-url-policy";
import { renderWebhookTemplate, SAMPLE_TEMPLATE_VARS } from "@/sidepanel/lib/webhookTemplate";
import { useSettingsStore } from "@/store/settings-store";
import type { TranslationKey } from "@/i18n/ko";
import type { WebhookAccount, WebhookFormat, WebhookHeader } from "@/types/webhook";
import { hasAdvancedValues, validateWebhookForm, type WebhookFormIssue } from "./webhookFormGate";

const URL_REASON_KEYS: Record<string, TranslationKey> = {
  invalid: "webhook.invalid.urlInvalid",
  scheme: "webhook.invalid.urlScheme",
  "insecure-public": "webhook.invalid.urlInsecure",
  credentials: "webhook.invalid.urlCredentials",
};

export function WebhookConnectedBody() {
  return (
    <>
      <WebhookSummary />
    </>
  );
}

function WebhookSummary() {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.webhook);
  if (!account) return null;
  let host = account.auth.url;
  try {
    host = new URL(account.auth.url).host;
  } catch {
    /* keep raw */
  }
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-medium text-foreground">{host}</span>
          <span className="truncate text-sm text-muted-foreground">{account.auth.url}</span>
        </div>
        <ConnectedBadge>
          {t(account.auth.format === "json" ? "webhook.format.json" : "webhook.format.multipart")}
        </ConnectedBadge>
      </CardContent>
    </Card>
  );
}

// 2열 브랜드 그리드 밖에 단독으로 선다 — OAuth도 토큰 발급 페이지도 없어 PlatformConnectFlow의
// 수단 선택·재연동 확인 관용구가 전부 비어 버린다.
export function WebhookConnectEntry({ onConnected }: { onConnected: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              data-testid="webhook-connect-entry"
              className="w-full max-w-[336px] justify-center gap-2"
              onClick={() => setOpen(true)}
            >
              <Webhook className="h-4 w-4" />
              <span className="truncate">{t("webhook.entry.label")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px]">{t("webhook.entry.tooltip")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
          {/* 닫히면 언마운트되므로 폼은 열 때마다 저장된 계정에서 다시 채워진다. */}
          <WebhookDialogBody
            onDone={() => {
              onConnected();
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function WebhookDialogBody({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const account = useSettingsStore((s) => s.accounts.webhook);
  const setAccount = useSettingsStore((s) => s.setAccount);

  const [url, setUrl] = useState(account?.auth.url ?? "");
  const [secret, setSecret] = useState(account?.auth.secret ?? "");
  const [headers, setHeaders] = useState<WebhookHeader[]>(
    account?.auth.headers.length ? account.auth.headers : [{ name: "", value: "" }],
  );
  const [format, setFormat] = useState<WebhookFormat>(account?.auth.format ?? "multipart");
  const [template, setTemplate] = useState(account?.auth.template ?? "");
  // 고급 값을 든 계정을 닫힌 채로 열면 설정이 사라진 것처럼 보인다.
  const [advanced, setAdvanced] = useState(() => hasAdvancedValues(account?.auth));
  const [issues, setIssues] = useState<WebhookFormIssue[]>([]);
  const [testing, setTesting] = useState(false);

  const plaintext = useMemo(() => {
    try {
      return normalizeWebhookUrl(url).plaintext;
    } catch {
      return false;
    }
  }, [url]);

  const draft = { url, secret, headers, format, template };

  function handleSave() {
    const verdict = validateWebhookForm(draft);
    if (!verdict.ok) {
      setIssues(verdict.issues);
      return;
    }
    setIssues([]);
    const next: WebhookAccount = {
      platform: "webhook",
      connectedAt: Date.now(),
      auth: verdict.auth,
    };
    setAccount("webhook", next);
    onDone();
  }

  async function handleTest() {
    if (testing) return;
    const verdict = validateWebhookForm(draft);
    if (!verdict.ok) {
      setIssues(verdict.issues);
      return;
    }
    setIssues([]);
    setTesting(true);
    try {
      await sendBg({
        type: "webhook.test",
        auth: verdict.auth,
        ...(verdict.auth.format === "json"
          ? { sampleBody: renderWebhookTemplate(verdict.auth.template!, SAMPLE_TEMPLATE_VARS) }
          : {}),
      });
      toast.success(t("webhook.test.success"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  function patchHeader(idx: number, patch: Partial<WebhookHeader>) {
    setHeaders(headers.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">{t("webhook.dialog.title")}</DialogTitle>
        <DialogDescription>
          {t("webhook.dialog.body")}{" "}
          <InlineLink href="https://github.com/SinhyeokKang/bugshot-2/blob/main/docs/webhook-contract.md">
            {t("webhook.contract.link")}
          </InlineLink>
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <FieldRow label={t("webhook.url.label")} htmlFor="webhook-url" required>
          <Input
            id="webhook-url"
            data-testid="webhook-url"
            placeholder={t("webhook.url.placeholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </FieldRow>
        {plaintext && (
          <p
            data-testid="webhook-plaintext-warning"
            className="flex items-start gap-1.5 text-xs text-foreground/70"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("webhook.plaintext.warning")}
          </p>
        )}

        <FieldRow label={t("webhook.secret.label")} htmlFor="webhook-secret">
          <Input
            id="webhook-secret"
            data-testid="webhook-secret"
            placeholder={t("webhook.secret.placeholder")}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </FieldRow>
        <p className="text-xs text-muted-foreground">{t("webhook.secret.help")}</p>

        {/* 접으면 children이 언마운트되지만 값은 이 컴포넌트가 들고 있다 — 고급 안에 상태를
            두면 접는 순간 사라진다(POSTMORTEM 2026-07-16). */}
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="webhook-advanced-toggle"
              className="-ml-2 h-8 gap-1 self-start text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? "rotate-180" : ""}`} />
              {t("webhook.advanced.label")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-2">
            <FieldRow label={t("webhook.format.label")}>
              <Select value={format} onValueChange={(v) => setFormat(v as WebhookFormat)}>
                <SelectTrigger
                  className="w-full"
                  data-testid="webhook-format"
                  aria-label={t("webhook.format.label")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multipart">{t("webhook.format.multipart")}</SelectItem>
                  <SelectItem value="json">{t("webhook.format.json")}</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <p className="text-xs text-muted-foreground">
              {t(format === "json" ? "webhook.format.json.help" : "webhook.format.multipart.help")}
            </p>

            <FieldRow label={t("webhook.headers.label")}>
              <div className="flex flex-col gap-2">
                {headers.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-1" data-testid="webhook-header-row">
                    <Input
                      className="w-24 shrink-0 text-sm"
                      placeholder={t("webhook.headers.namePlaceholder")}
                      value={row.name}
                      onChange={(e) => patchHeader(idx, { name: e.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Input
                      className="min-w-0 flex-1 text-sm"
                      placeholder={t("webhook.headers.valuePlaceholder")}
                      value={row.value}
                      onChange={(e) => patchHeader(idx, { value: e.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 shrink-0 hover:text-destructive"
                      data-testid="webhook-header-delete"
                      title={t("common.delete")}
                      aria-label={`${row.name || t("webhook.headers.namePlaceholder")}: ${t("common.delete")}`}
                      onClick={() => {
                        const next = headers.filter((_, i) => i !== idx);
                        setHeaders(next.length ? next : [{ name: "", value: "" }]);
                      }}
                    >
                      <Trash2 />
                    </Button>
                    {idx === headers.length - 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 shrink-0"
                        data-testid="webhook-header-add"
                        title={t("webhook.headers.add")}
                        aria-label={t("webhook.headers.add")}
                        onClick={() => setHeaders([...headers, { name: "", value: "" }])}
                      >
                        <Plus />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </FieldRow>

            {format === "json" && (
              <FieldRow label={t("webhook.template.label")} htmlFor="webhook-template">
                <Textarea
                  id="webhook-template"
                  data-testid="webhook-template"
                  className="min-h-24 font-mono text-xs"
                  placeholder={'{"text": "{{title}}"}'}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">{t("webhook.template.help")}</p>
                <TemplatePreview template={template} label={t("webhook.template.preview")} />
              </FieldRow>
            )}
          </CollapsibleContent>
        </Collapsible>

        {issues.length > 0 && (
          <ul data-testid="webhook-form-error" className="flex flex-col gap-1 text-xs text-destructive">
            {issues.map((issue, i) => (
              <li key={i}>{issueText(issue, t)}</li>
            ))}
          </ul>
        )}
        {format === "json" && (
          <p className="text-xs text-muted-foreground">{t("webhook.test.json.help")}</p>
        )}
      </div>

      <DialogFooter className="flex-row justify-end">
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="outline"
          data-testid="webhook-test"
          onClick={() => void handleTest()}
          aria-disabled={testing}
          className="relative aria-disabled:cursor-not-allowed"
        >
          {testing && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          )}
          <span className={testing ? "opacity-0" : undefined}>
            {t(format === "json" ? "webhook.test.json.button" : "webhook.test.button")}
          </span>
        </Button>
        <Button data-testid="webhook-save" onClick={handleSave}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

// 저장 게이트가 "이 변수는 못 쓴다"까지는 말하지만 "무엇이 나가는지"는 못 보여준다.
// 실데이터가 없는 화면이라 고정 샘플로 그린다 — 입력 중에는 JSON이 깨져 있는 게 정상이고,
// 그 구간엔 아무것도 그리지 않는다(입력할 때마다 빨간 에러가 깜빡이면 방해만 된다).
function TemplatePreview({ template, label }: { template: string; label: string }) {
  const rendered = useMemo(() => {
    if (!template.trim()) return null;
    try {
      return JSON.stringify(renderWebhookTemplate(template, SAMPLE_TEMPLATE_VARS), null, 2);
    } catch {
      return null;
    }
  }, [template]);
  if (!rendered) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <pre
        data-testid="webhook-template-preview"
        className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] text-foreground/70"
      >
        {rendered}
      </pre>
    </div>
  );
}

function issueText(issue: WebhookFormIssue, t: ReturnType<typeof useT>): string {
  switch (issue.kind) {
    case "url":
      return t(URL_REASON_KEYS[issue.reason] ?? "webhook.invalid.urlInvalid");
    case "header-name":
      return t("webhook.invalid.headerName", { name: issue.name });
    case "header-value":
      return t("webhook.invalid.headerValue", { name: issue.name });
    case "header-duplicate":
      return t("webhook.invalid.headerDuplicate", { name: issue.name });
    case "template-empty":
      return t("webhook.error.templateMissing");
    case "template":
      return issue.issue.kind === "unknown-var"
        ? t("webhook.invalid.templateVar", { name: issue.issue.name })
        : t("webhook.invalid.templateJson", { message: issue.issue.message });
  }
}
