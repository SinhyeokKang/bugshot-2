import { Fragment, useState, useMemo } from "react";
import { Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useT, type TranslationFn } from "@/i18n";
import type { NetworkRequest, NetworkRequestBody } from "@/types/network";
import { networkLogPath } from "../lib/buildIssueMarkdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NetworkLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: NetworkRequest[];
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET": return "text-blue-600 dark:text-blue-400";
    case "POST": return "text-green-600 dark:text-green-400";
    case "PUT": return "text-amber-600 dark:text-amber-400";
    case "PATCH": return "text-amber-600 dark:text-amber-400";
    case "DELETE": return "text-red-600 dark:text-red-400";
    default: return "text-foreground";
  }
}

function isError(status: number): boolean {
  return status >= 400;
}

function formatBody(body: NetworkRequestBody | undefined): string {
  if (body === undefined) return "";
  if (typeof body !== "string") {
    return `[${body.kind}]`;
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function bodyLabel(body: NetworkRequestBody | undefined, t: TranslationFn): string | null {
  if (body === undefined) return null;
  if (typeof body === "string") return null;
  switch (body.kind) {
    case "truncated": return "Truncated (>1MB)";
    case "binary": return t("networkLog.display.binary").replace("{type}", "").replace("{size}", "");
    case "stream": return t("networkLog.display.stream").replace("{type}", "");
    case "omitted": return "Omitted (memory cap)";
    default: return null;
  }
}

function buildCurl(req: NetworkRequest): string {
  const parts: string[] = [`curl '${req.url}'`];
  parts.push(`  -X ${req.method}`);
  for (const [k, v] of Object.entries(req.requestHeaders)) {
    if (v.startsWith("***")) {
      parts.push(`  # -H '${k}: [masked by BugShot]'`);
    } else {
      parts.push(`  -H '${k}: ${v}'`);
    }
  }
  if (req.requestBody && typeof req.requestBody === "string") {
    parts.push(`  --data-raw '${req.requestBody.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(" \\\n");
}

export function NetworkLogPreviewDialog({
  open,
  onOpenChange,
  requests,
}: NetworkLogPreviewDialogProps) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);

  const errors = useMemo(() => requests.filter((r) => isError(r.status)), [requests]);
  const others = useMemo(() => requests.filter((r) => !isError(r.status)), [requests]);
  const activeReq = useMemo(() => requests.find((r) => r.id === activeId) ?? null, [requests, activeId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("networkLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
          {/* LNB */}
          <ScrollArea className="w-[220px] shrink-0 border-r">
            <div className="p-2">
              {errors.length > 0 && (
                <>
                  <div className="mb-1 px-2 text-xs font-medium text-destructive">{t("networkLog.dialog.errors")}</div>
                  {errors.map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      active={activeId === r.id}
                      onClick={() => setActiveId(r.id)}
                    />
                  ))}
                </>
              )}
              {others.length > 0 && (
                <>
                  <div className="mb-1 mt-2 px-2 text-xs font-medium text-muted-foreground">{t("networkLog.dialog.other")}</div>
                  {others.map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      active={activeId === r.id}
                      onClick={() => setActiveId(r.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </ScrollArea>

          {/* Detail */}
          <ScrollArea className="min-w-0 flex-1">
            {activeReq ? (
              <RequestDetail req={activeReq} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("networkLog.dialog.selectRequest")}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({
  req,
  active,
  onClick,
}: {
  req: NetworkRequest;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs ${active ? "bg-accent" : "hover:bg-accent/50"}`}
      onClick={onClick}
    >
      <span className={`font-mono font-medium ${methodColor(req.method)}`}>
        {req.method}
      </span>
      <span className="min-w-0 flex-1 truncate" title={req.url}>
        {networkLogPath(req.url)}
      </span>
      <Badge
        variant={isError(req.status) ? "destructive" : "secondary"}
        className="h-4 px-1 text-[10px]"
      >
        {req.status}
      </Badge>
      <span className="shrink-0 text-muted-foreground">{req.durationMs}ms</span>
    </div>
  );
}

function RequestDetail({ req }: { req: NetworkRequest }) {
  const t = useT();

  return (
    <div className="space-y-3 p-4 text-xs">
      {/* General */}
      <div>
        <div className="mb-1 font-medium">{t("networkLog.detail.general")}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">URL</dt>
          <dd className="break-all">{req.url}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd>{req.method}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Badge variant={isError(req.status) ? "destructive" : "secondary"} className="h-4 px-1 text-[10px]">
              {req.status} {req.statusText}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{req.durationMs}ms</dd>
          <dt className="text-muted-foreground">Content-Type</dt>
          <dd>{req.contentType || "—"}</dd>
        </dl>
      </div>

      {/* Request Headers */}
      <CollapsibleSection title={t("networkLog.detail.requestHeaders")}>
        <HeadersTable headers={req.requestHeaders} />
      </CollapsibleSection>

      {/* Request Body */}
      {req.requestBody !== undefined && (
        <CollapsibleSection title={t("networkLog.detail.requestBody")}>
          <BodyBlock body={req.requestBody} t={t} />
        </CollapsibleSection>
      )}

      {/* Response Headers */}
      <CollapsibleSection title={t("networkLog.detail.responseHeaders")}>
        <HeadersTable headers={req.responseHeaders} />
      </CollapsibleSection>

      {/* Response Body */}
      {req.responseBody !== undefined && (
        <CollapsibleSection title={t("networkLog.detail.responseBody")}>
          <BodyBlock body={req.responseBody} t={t} />
        </CollapsibleSection>
      )}

      {/* curl copy */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          void navigator.clipboard.writeText(buildCurl(req));
        }}
      >
        <Copy className="h-3.5 w-3.5" />
        {t("networkLog.detail.copyCurl")}
      </Button>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-medium hover:underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="font-mono text-muted-foreground">{k}</dt>
          <dd className="break-all font-mono">
            {v.startsWith("***") ? (
              <span className="italic text-muted-foreground">{v}</span>
            ) : (
              v
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function BodyBlock({ body, t }: { body: NetworkRequestBody; t: TranslationFn }) {
  const label = bodyLabel(body, t);
  if (label) {
    return <div className="italic text-muted-foreground">{label}</div>;
  }
  return (
    <pre className="max-h-[200px] overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
      {formatBody(body)}
    </pre>
  );
}

