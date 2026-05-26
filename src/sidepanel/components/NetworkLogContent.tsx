import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, Code, File, FileText, Globe, Image, MousePointerClick, Paintbrush, Search, Type, X } from "lucide-react";
import { useT, type TranslationFn } from "@/i18n";
import type { NetworkRequest, NetworkRequestBody } from "@/types/network";
import { formatBytes } from "@/sidepanel/lib/formatBytes";
import { networkLogPath } from "@/sidepanel/lib/buildIssueMarkdown";
import { JsonTreeViewer } from "./JsonTreeViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

type RequestFilter = "all" | "json" | "js" | "css" | "img" | "font" | "doc" | "other";

const REQUEST_FILTERS: RequestFilter[] = ["all", "json", "js", "css", "img", "font", "doc", "other"];

interface NetworkLogContentProps {
  requests: NetworkRequest[];
  flush?: boolean;
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

function isError(req: NetworkRequest): boolean {
  if (req.phase === "error") return true;
  if (req.phase === "pending") return false;
  return req.status >= 400;
}

function isPending(req: NetworkRequest): boolean {
  return req.phase === "pending";
}

function rowBg(req: NetworkRequest, active: boolean): string {
  if (isError(req)) {
    return active
      ? "bg-red-100 dark:bg-red-950/50"
      : "bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30 dark:hover:bg-red-950/50";
  }
  if (isPending(req)) {
    return active
      ? "bg-amber-100 dark:bg-amber-950/50"
      : "bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50";
  }
  return active ? "bg-accent" : "hover:bg-accent/50";
}

function classifyRequest(req: NetworkRequest): Exclude<RequestFilter, "all"> {
  const ct = req.contentType.toLowerCase();
  const url = req.url.toLowerCase();
  if (ct.includes("json") || ct.includes("graphql")) return "json";
  if (ct.includes("javascript") || url.match(/\.m?[jt]sx?(\?|$)/)) return "js";
  if (ct.includes("css") || url.match(/\.css(\?|$)/)) return "css";
  if (ct.includes("image") || url.match(/\.(png|jpe?g|gif|svg|webp|ico|avif)(\?|$)/)) return "img";
  if (ct.includes("font") || url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/)) return "font";
  if (ct.includes("html")) return "doc";
  return "other";
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
    case "truncated":
      return t("networkLog.display.bodyTruncated")
        .replace("{size}", formatBytes(body.size))
        .replace("{limit}", formatBytes(body.limit));
    case "binary":
      return t("networkLog.display.binary")
        .replace("{type}", body.contentType || "—")
        .replace("{size}", formatBytes(body.size));
    case "stream":
      return t("networkLog.display.stream").replace("{type}", body.contentType || "—");
    case "omitted":
      return t("networkLog.display.bodyOmitted");
    default:
      return null;
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

export function NetworkLogContent({ requests, flush }: NetworkLogContentProps) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("headers");
  const [listWidth, setListWidth] = useState(260);
  const [filter, setFilter] = useState<RequestFilter>("all");
  const [query, setQuery] = useState("");
  const filterLabel: Record<RequestFilter, string> = {
    all: t("networkLog.filter.all"), json: t("networkLog.filter.json"),
    js: t("networkLog.filter.js"), css: t("networkLog.filter.css"),
    img: t("networkLog.filter.img"), font: t("networkLog.filter.font"),
    doc: t("networkLog.filter.doc"), other: t("networkLog.filter.other"),
  };
  const availableFilters = useMemo<RequestFilter[]>(() => {
    const present: Set<string> = new Set(requests.map(classifyRequest));
    return ["all" as const, ...REQUEST_FILTERS.filter((f): f is Exclude<RequestFilter, "all"> => f !== "all" && present.has(f))];
  }, [requests]);
  useEffect(() => {
    if (filter !== "all" && !availableFilters.includes(filter)) setFilter("all");
  }, [availableFilters, filter]);
  const activeReq = requests.find((r) => r.id === activeId) ?? null;
  const filteredRequests = useMemo(() => {
    let result = filter === "all" ? requests : requests.filter((r) => classifyRequest(r) === filter);
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter((r) => r.url.toLowerCase().includes(lower));
    }
    return result;
  }, [requests, filter, query]);

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

  // 신규 로그 tail: 사용자가 바닥 근처(<24px)에 있을 때만 새 항목에 맞춰 자동 스크롤. 위로 올려
  // 살펴보는 중이면 끌어내리지 않는다.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const getListViewport = useCallback(
    () => listScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null,
    [],
  );
  useEffect(() => {
    const vp = getListViewport();
    if (!vp) return;
    const onScroll = () => {
      pinnedRef.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 24;
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [getListViewport]);
  useEffect(() => {
    if (!pinnedRef.current) return;
    const vp = getListViewport();
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [filteredRequests.length, getListViewport]);

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
    <div ref={containerRef} className={`flex min-h-0 flex-1 flex-col overflow-hidden${flush ? "" : " rounded-lg border"}`}>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as RequestFilter)}>
        <div className={`flex items-center gap-3 border-b${flush ? " px-4 py-4" : " p-2"}`}>
          <TabsList>
            {availableFilters.map((f) => (
              <TabsTrigger key={f} value={f}>
                {filterLabel[f]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative ml-auto w-full max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("networkLog.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`h-9 pl-8 text-sm ${query ? "pr-8" : ""}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </Tabs>
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <ScrollArea ref={listScrollRef} className="shrink-0 [&>div>div]:!block" style={{ width: listWidth }}>
        <div>
          {filteredRequests.map((req) => (
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {requests.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <Globe className="h-6 w-6 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">{t("debug.network.empty")}</span>
          </div>
        ) : activeReq ? (
          <Tabs
            value={detailTab}
            onValueChange={(v) => setDetailTab(v as DetailTab)}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="flex items-center gap-2 border-b px-2">
              <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="headers">{t("networkLog.tab.headers")}</TabsTrigger>
                <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="request">{t("networkLog.tab.request")}</TabsTrigger>
                <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="response">{t("networkLog.tab.response")}</TabsTrigger>
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
            <ScrollArea className="min-h-0 flex-1 [&>div>div]:!block">
              <TabsContent value="headers" className="mt-0 data-[state=inactive]:hidden">
                <HeadersPanel req={activeReq} />
              </TabsContent>
              <TabsContent value="request" className="mt-0 data-[state=inactive]:hidden">
                <BodyPanel body={activeReq.requestBody} />
              </TabsContent>
              <TabsContent value="response" className="mt-0 data-[state=inactive]:hidden">
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
    </div>
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
      className={`flex cursor-pointer items-center gap-3 overflow-hidden px-3 py-2 text-[13px] ${rowBg(req, active)}`}
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
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
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
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t("networkLog.detail.url")}</dt>
          <dd className="break-all">{req.url}</dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.method")}</dt>
          <dd>{req.method}</dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.status")}</dt>
          <dd className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${
              isPending(req) ? "bg-amber-500" : isError(req) ? "bg-red-500" : "bg-green-500"
            }`} />
            {isPending(req) ? t("networkLog.display.pending") : `${req.status} ${req.statusText}`}
          </dd>
          <dt className="text-muted-foreground">{t("networkLog.detail.time")}</dt>
          <dd>{isPending(req) ? "—" : `${req.durationMs}ms`}</dd>
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
    <div className="py-2 text-[12px]">
      <BodyBlock body={body!} />
    </div>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-muted-foreground">{"—"}</span>;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
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
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null) {
        return <JsonTreeViewer data={parsed} />;
      }
    } catch { /* fall through */ }
  }
  return (
    <pre className="max-h-[400px] overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
      {formatBody(body)}
    </pre>
  );
}
