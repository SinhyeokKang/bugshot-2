import { useState, useCallback, useRef, Fragment } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, Code, File, FileText, Image, MousePointerClick, Paintbrush, Type } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

interface NetworkLogPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: NetworkRequest[];
  attach?: boolean;
  onToggleAttach?: (attach: boolean) => void;
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

function rowBg(status: number, active: boolean): string {
  if (isError(status)) {
    return active
      ? "bg-red-100 dark:bg-red-950/50"
      : "bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30 dark:hover:bg-red-950/50";
  }
  return active ? "bg-accent" : "hover:bg-accent/50";
}

function ContentTypeIcon({ req }: { req: NetworkRequest }) {
  const base = "h-4 w-4 shrink-0";
  const ct = req.contentType.toLowerCase();
  const url = req.url.toLowerCase();

  if (ct.includes("json") || ct.includes("graphql")) return <ArrowLeftRight className={`${base} text-green-600 dark:text-green-400`} />;
  if (ct.includes("javascript") || url.match(/\.m?[jt]sx?(\?|$)/)) return <Code className={`${base} text-amber-600 dark:text-amber-400`} />;
  if (ct.includes("css") || url.match(/\.css(\?|$)/)) return <Paintbrush className={`${base} text-purple-600 dark:text-purple-400`} />;
  if (ct.includes("font") || url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/)) return <Type className={`${base} text-muted-foreground`} />;
  if (ct.includes("image") || url.match(/\.(png|jpe?g|gif|svg|webp|ico|avif)(\?|$)/)) return <Image className={`${base} text-teal-600 dark:text-teal-400`} />;
  if (ct.includes("html")) return <FileText className={`${base} text-blue-600 dark:text-blue-400`} />;
  return <File className={`${base} text-muted-foreground`} />;
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

type DetailTab = "headers" | "request" | "response";

export function NetworkLogPreviewDialog({
  open,
  onOpenChange,
  requests,
  attach,
  onToggleAttach,
}: NetworkLogPreviewDialogProps) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("headers");
  const [listWidth, setListWidth] = useState(260);
  const activeReq = requests.find((r) => r.id === activeId) ?? null;

  const handleSelect = (id: string) => {
    if (activeId === id) {
      setActiveId(null);
      return;
    }
    setActiveId(id);
    setDetailTab("headers");
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = listWidth;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const container = containerRef.current;
      if (!container) return;
      const maxW = container.clientWidth * 0.7;
      const newW = Math.max(160, Math.min(maxW, startW + ev.clientX - startX));
      setListWidth(newW);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [listWidth]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("networkLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
          <ScrollArea className="shrink-0 [&>div>div]:!block" style={{ width: listWidth }}>
            <div>
              {requests.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  active={activeId === req.id}
                  onClick={() => handleSelect(req.id)}
                />
              ))}
            </div>
          </ScrollArea>

          <div
            className="group/drag relative -mx-2 w-4 shrink-0"
            style={{ cursor: "col-resize", zIndex: 1 }}
            onMouseDown={onDragStart}
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover/drag:bg-blue-300 group-hover/drag:shadow-[-1px_0_0_0_theme(colors.blue.300),1px_0_0_0_theme(colors.blue.300)] dark:group-hover/drag:bg-blue-700 dark:group-hover/drag:shadow-[-1px_0_0_0_theme(colors.blue.700),1px_0_0_0_theme(colors.blue.700)]" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {activeReq ? (
              <Tabs
                value={detailTab}
                onValueChange={(v) => setDetailTab(v as DetailTab)}
                className="flex min-w-0 flex-1 flex-col"
              >
                <div className="flex items-center gap-2 border-b px-2 py-1.5">
                  <TabsList>
                    <TabsTrigger value="headers">{t("networkLog.tab.headers")}</TabsTrigger>
                    <TabsTrigger value="request">{t("networkLog.tab.request")}</TabsTrigger>
                    <TabsTrigger value="response">{t("networkLog.tab.response")}</TabsTrigger>
                  </TabsList>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(buildCurl(activeReq))}
                  >
                    {t("networkLog.detail.copyCurl")}
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <TabsContent value="headers" className="mt-0">
                    <HeadersPanel req={activeReq} />
                  </TabsContent>
                  <TabsContent value="request" className="mt-0">
                    <BodyPanel body={activeReq.requestBody} />
                  </TabsContent>
                  <TabsContent value="response" className="mt-0">
                    <BodyPanel body={activeReq.responseBody} />
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <div className="rounded-full bg-muted p-3">
                  <MousePointerClick className="h-6 w-6 text-muted-foreground" />
                </div>
                <span className="text-sm text-muted-foreground">{t("networkLog.dialog.selectRequest")}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {onToggleAttach && (
            <Button onClick={() => { onToggleAttach(!attach); onOpenChange(false); }}>
              {attach ? t("common.detach") : t("common.attach")}
            </Button>
          )}
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
      className={`flex cursor-pointer items-center gap-3 overflow-hidden px-3 py-2 text-[13px] ${rowBg(req.status, active)}`}
      onClick={onClick}
    >
      <ContentTypeIcon req={req} />
      <span className={`shrink-0 ${methodColor(req.method)}`}>{req.method}</span>
      <span className="min-w-0 flex-1 truncate">{networkLogPath(req.url)}</span>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <div className="flex items-center justify-between pl-4 pr-2 py-3">
        <span className="text-[14px] font-medium">{title}</span>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="icon" className="h-7 w-7 shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="ml-4 mr-2 mb-3 border-l-2 border-border pl-2 text-[13px]">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function HeadersPanel({ req }: { req: NetworkRequest }) {
  const t = useT();
  return (
    <div>
      <CollapsibleSection title={t("networkLog.detail.general")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t("networkLog.detail.url")}</dt>
          <dd className="break-all">{req.url}</dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.method")}</dt>
          <dd>{req.method}</dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.status")}</dt>
          <dd className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${isError(req.status) ? "bg-red-500" : "bg-green-500"}`} />
            {req.status} {req.statusText}
          </dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.time")}</dt>
          <dd>{req.durationMs}ms</dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.contentType")}</dt>
          <dd>{req.contentType || "—"}</dd>
        </dl>
      </CollapsibleSection>

      {Object.keys(req.responseHeaders).length > 0 && (
        <CollapsibleSection title={t("networkLog.detail.responseHeaders")}>
          <HeadersTable headers={req.responseHeaders} />
        </CollapsibleSection>
      )}

      {Object.keys(req.requestHeaders).length > 0 && (
        <CollapsibleSection title={t("networkLog.detail.requestHeaders")}>
          <HeadersTable headers={req.requestHeaders} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function BodyPanel({ body }: { body: NetworkRequestBody | undefined }) {
  const t = useT();
  const label = body === undefined ? t("networkLog.detail.noBody") : bodyLabel(body, t);
  if (label) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3">
        <div className="rounded-full bg-muted p-3">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    );
  }
  return (
    <div className="p-4 text-[12px]">
      <BodyBlock body={body!} />
    </div>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-muted-foreground">{"—"}</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">
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

function BodyBlock({ body }: { body: NetworkRequestBody }) {
  return (
    <pre className="max-h-[400px] overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
      {formatBody(body)}
    </pre>
  );
}
