import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from "react";
import { ArrowDown, ArrowDownUp, ArrowLeftRight, ArrowUp, ChevronDown, ChevronRight, Code, File, FileText, Globe, Image, MousePointerClick, Paintbrush, Search, Type, X } from "lucide-react";
import { useT, type TranslationFn } from "@/i18n";
import type { NetworkRequest, NetworkRequestBody, WebSocketFrame } from "@/types/network";
import { formatBytes } from "@/sidepanel/lib/formatBytes";
import { networkLogPath } from "@/lib/network-log-path";
import { isStatusHidden } from "@/lib/network-status";
import { requestMatchesQuery } from "@/lib/network-search";
import { useDebouncedValue } from "@/sidepanel/lib/useDebouncedValue";
import { JsonTreeViewer } from "./JsonTreeViewer";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { distinctOriginKeys, originKey, originCounts } from "@/sidepanel/lib/logOrigin";
import { OriginFilterBar } from "./OriginFilterBar";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { findActiveIndex } from "@/log-viewer/timeline";
import { formatRelativeTime, syncRowClass } from "@/sidepanel/lib/logRow";
import { useScrollToEntry } from "@/sidepanel/lib/useScrollToEntry";
import { LogSeekChip } from "./LogSeekChip";

type RequestFilter = "all" | "ws" | "json" | "js" | "css" | "img" | "font" | "doc" | "other";

const REQUEST_FILTERS: RequestFilter[] = ["all", "ws", "json", "js", "css", "img", "font", "doc", "other"];

interface NetworkLogContentProps {
  requests: NetworkRequest[];
  flush?: boolean;
  // 영상 동기화(log-viewer 전용, optional). 미공급 시 라이브 서브탭과 동일 동작.
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  activeTs?: number;
  scrollToEntryId?: string | null;
  onScrollComplete?: () => void;
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
      ? "bg-red-200 dark:bg-red-950/70"
      : "bg-red-100 hover:bg-red-200/70 dark:bg-red-950/50 dark:hover:bg-red-950/70";
  }
  if (isPending(req)) {
    return active
      ? "bg-amber-200 dark:bg-amber-950/70"
      : "bg-amber-100 hover:bg-amber-200/70 dark:bg-amber-950/50 dark:hover:bg-amber-950/70";
  }
  return active ? "bg-accent" : "hover:bg-accent/50";
}

function classifyRequest(req: NetworkRequest): Exclude<RequestFilter, "all"> {
  if (req.webSocket) return "ws";
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
  if (req.webSocket) return <ArrowDownUp className={`${base} text-violet-600 dark:text-violet-400`} />;
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
      return t("networkLog.display.bodyTruncated", {
        size: formatBytes(body.size),
        limit: formatBytes(body.limit),
      });
    case "binary":
      return t("networkLog.display.binary", {
        type: body.contentType || "—",
        size: formatBytes(body.size),
      });
    case "stream":
      return t("networkLog.display.stream", { type: body.contentType || "—" });
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

type DetailTab = "headers" | "request" | "response" | "messages";

export function NetworkLogContent({ requests, flush, syncBaseMs, onSeek, activeTs, scrollToEntryId, onScrollComplete }: NetworkLogContentProps) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("headers");
  const [listWidth, setListWidth] = useState(0);
  const [filter, setFilter] = useState<RequestFilter>("all");
  const [originFilter, setOriginFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const filterLabel: Record<RequestFilter, string> = {
    all: t("networkLog.filter.all"), ws: t("networkLog.filter.ws"), json: t("networkLog.filter.json"),
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
  const originKeys = useMemo(() => distinctOriginKeys(requests.map((r) => r.pageUrl)), [requests]);
  const originCountMap = useMemo(() => originCounts(requests.map((r) => r.pageUrl)), [requests]);
  useEffect(() => {
    if (originFilter !== null && !originKeys.includes(originFilter)) setOriginFilter(null);
  }, [originKeys, originFilter]);
  const activeReq = requests.find((r) => r.id === activeId) ?? null;
  const filteredRequests = useMemo(() => {
    let result = filter === "all" ? requests : requests.filter((r) => classifyRequest(r) === filter);
    if (originFilter !== null) result = result.filter((r) => originKey(r.pageUrl) === originFilter);
    if (debouncedQuery) {
      const lower = debouncedQuery.toLowerCase();
      result = result.filter((r) => requestMatchesQuery(r, lower));
    }
    return result;
  }, [requests, filter, originFilter, debouncedQuery]);

  const syncActiveId = useMemo(() => {
    if (activeTs == null) return null;
    const idx = findActiveIndex(filteredRequests.map((r) => r.startTime), activeTs);
    return idx >= 0 ? filteredRequests[idx].id : null;
  }, [filteredRequests, activeTs]);

  const handleSelect = (id: string) => {
    if (activeId === id) {
      setActiveId(null);
      return;
    }
    setActiveId(id);
    const req = requests.find((r) => r.id === id);
    setDetailTab(req?.webSocket ? "messages" : "headers");
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setListWidth(Math.round(containerRef.current.clientWidth * 0.3));
  }, []);

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

  useScrollToEntry({
    scrollToEntryId,
    getListViewport,
    filteredItems: filteredRequests,
    searchSettled: query === debouncedQuery,
    resetFilters: useCallback(() => { setFilter("all"); setOriginFilter(null); setQuery(""); }, []),
    onScrollComplete,
    onFound: useCallback(() => { if (scrollToEntryId) setActiveId(scrollToEntryId); }, [scrollToEntryId]),
  });

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
        <div className={`flex items-center gap-3${originKeys.length >= 2 ? "" : " border-b"}${flush ? " px-4 py-4" : " p-2"}`}>
          <div className="min-w-0 overflow-x-auto">
            <TabsList>
              {availableFilters.map((f) => (
                <TabsTrigger key={f} value={f} data-testid={`network-filter-${f}`}>
                  {filterLabel[f]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="relative ml-auto w-full max-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="network-search"
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
      <OriginFilterBar originKeys={originKeys} counts={originCountMap} value={originFilter} onChange={setOriginFilter} flush={flush} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <ScrollArea ref={listScrollRef} className="shrink-0 [&>div>div]:!block" style={{ width: listWidth }}>
        <div>
          {filteredRequests.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              active={activeId === req.id}
              syncActive={req.id === syncActiveId}
              syncBaseMs={syncBaseMs}
              onSeek={onSeek}
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
                <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="headers" data-testid="detail-tab-headers">{t("networkLog.tab.headers")}</TabsTrigger>
                {activeReq.webSocket ? (
                  <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="messages" data-testid="detail-tab-messages">{t("networkLog.tab.messages")}</TabsTrigger>
                ) : (
                  <>
                    <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="request">{t("networkLog.tab.request")}</TabsTrigger>
                    <TabsTrigger className="rounded-none border-b-2 border-transparent px-2 pb-2.5 pt-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="response">{t("networkLog.tab.response")}</TabsTrigger>
                  </>
                )}
              </TabsList>
              <div className="flex-1" />
              {!activeReq.webSocket && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard.writeText(buildCurl(activeReq))}
                >
                  {t("networkLog.detail.copyCurl")}
                </Button>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1 [&>div>div]:!block">
              <TabsContent value="headers" className="mt-0 data-[state=inactive]:hidden">
                <HeadersPanel req={activeReq} />
              </TabsContent>
              {activeReq.webSocket ? (
                <TabsContent value="messages" className="mt-0 data-[state=inactive]:hidden">
                  <MessagesPanel req={activeReq} syncBaseMs={syncBaseMs} onSeek={onSeek} />
                </TabsContent>
              ) : (
                <>
                  <TabsContent value="request" className="mt-0 data-[state=inactive]:hidden">
                    <BodyPanel body={activeReq.requestBody} />
                  </TabsContent>
                  <TabsContent value="response" className="mt-0 data-[state=inactive]:hidden">
                    <BodyPanel body={activeReq.responseBody} />
                  </TabsContent>
                </>
              )}
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
  syncActive,
  syncBaseMs,
  onSeek,
  onClick,
}: {
  req: NetworkRequest;
  active: boolean;
  syncActive?: boolean;
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  onClick: () => void;
}) {
  return (
    <div
      data-entry-id={req.id}
      data-ws={req.webSocket ? "true" : undefined}
      className={`flex cursor-pointer items-center gap-3 overflow-hidden px-2.5 py-2 text-[13px] ${syncRowClass(syncBaseMs != null, !!syncActive, rowBg(req, active))}`}
      aria-current={syncActive ? "true" : undefined}
      onClick={onClick}
    >
      {syncBaseMs != null && (
        <LogSeekChip ts={req.startTime} label={formatRelativeTime(req.startTime, syncBaseMs)} onSeek={onSeek} />
      )}
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
        <span className="text-sm font-medium">{title}</span>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={title}>
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
          <dd className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                isPending(req) ? "bg-amber-500" : isError(req) ? "bg-red-500" : "bg-green-500"
              }`} />
              {isPending(req)
                ? t("networkLog.display.pending")
                : isStatusHidden(req)
                  ? t("networkLog.display.blocked")
                  : `${req.status} ${req.statusText}`}
            </span>
            {isStatusHidden(req) && (
              <span className="text-xs text-muted-foreground">{t("networkLog.display.blockedHint")}</span>
            )}
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
    <div className="py-2 text-xs">
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

type WsDirFilter = "all" | "send" | "receive";

function MessagesPanel({
  req,
  syncBaseMs,
  onSeek,
}: {
  req: NetworkRequest;
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
}) {
  const t = useT();
  const meta = req.webSocket!;
  const [dir, setDir] = useState<WsDirFilter>("all");
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  const dropped = meta.framesTotal - meta.frames.length;
  // open/close 이벤트 행은 필터와 무관하게 항상 표시 — 연결 수명 컨텍스트.
  const visible = meta.frames.filter(
    (frame) =>
      frame.direction === "open" || frame.direction === "close" || dir === "all" || frame.direction === dir,
  );

  const dirLabel: Record<WsDirFilter, string> = {
    all: t("networkLog.ws.all"),
    send: t("networkLog.ws.send"),
    receive: t("networkLog.ws.receive"),
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ButtonGroup>
          {(["all", "send", "receive"] as WsDirFilter[]).map((d) => (
            <Button
              key={d}
              size="sm"
              variant="outline"
              className={`shrink-0 h-7 px-2.5 text-[13px] font-normal${dir === d ? " bg-muted hover:bg-muted hover:brightness-95" : ""}`}
              onClick={() => setDir(d)}
              data-testid="ws-dir-filter"
              data-dir={d}
              data-active={dir === d || undefined}
            >
              {dirLabel[d]}
            </Button>
          ))}
        </ButtonGroup>
        <span className="ml-auto text-xs text-muted-foreground">
          {t("networkLog.ws.framesCount", { n: meta.frames.length })}
          {dropped > 0 ? ` · ${t("networkLog.ws.dropped", { n: dropped })}` : ""}
        </span>
      </div>
      {meta.frames.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <ArrowDownUp className="h-6 w-6 text-muted-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">{t("networkLog.ws.empty")}</span>
        </div>
      ) : (
        <div className="py-1">
          {visible.map((frame) => (
            <FrameRow
              key={frame.seq}
              frame={frame}
              baseTs={req.startTime}
              syncBaseMs={syncBaseMs}
              onSeek={onSeek}
              expanded={expandedSeq === frame.seq}
              onToggle={() => setExpandedSeq(expandedSeq === frame.seq ? null : frame.seq)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FrameDirectionIcon({ direction }: { direction: WebSocketFrame["direction"] }) {
  const base = "h-3.5 w-3.5 shrink-0";
  if (direction === "send") return <ArrowUp className={`${base} text-blue-600 dark:text-blue-400`} />;
  if (direction === "receive") return <ArrowDown className={`${base} text-green-600 dark:text-green-400`} />;
  return <ArrowDownUp className={`${base} text-muted-foreground`} />;
}

function frameText(frame: WebSocketFrame, t: TranslationFn): string {
  if (frame.direction === "open") return t("networkLog.ws.opened");
  if (frame.direction === "close") return t("networkLog.ws.closed", { code: frame.code ?? 0 });
  if (typeof frame.data === "string") return frame.data;
  if (frame.data && frame.data.kind === "truncated") {
    return t("networkLog.display.bodyTruncated", {
      size: formatBytes(frame.data.size),
      limit: formatBytes(frame.data.limit),
    });
  }
  return "";
}

function FrameRow({
  frame,
  baseTs,
  syncBaseMs,
  onSeek,
  expanded,
  onToggle,
}: {
  frame: WebSocketFrame;
  baseTs: number;
  syncBaseMs?: number;
  onSeek?: (absTs: number) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const isData = frame.direction === "send" || frame.direction === "receive";
  const text = typeof frame.data === "string" ? frame.data : null;
  const canExpand = isData && text !== null;
  return (
    <div data-frame-direction={frame.direction}>
      <div
        className={`flex items-center gap-2 px-3 py-1 text-[13px] ${canExpand ? "cursor-pointer hover:bg-accent/50" : ""}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <FrameDirectionIcon direction={frame.direction} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{frameText(frame, t)}</span>
        {isData && <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(frame.size)}</span>}
        {syncBaseMs != null ? (
          <LogSeekChip ts={frame.ts} label={formatRelativeTime(frame.ts, syncBaseMs)} onSeek={onSeek} />
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(frame.ts, baseTs)}</span>
        )}
      </div>
      {expanded && text !== null && (
        <div className="px-3 pb-2 text-xs">
          <FrameBody text={text} />
        </div>
      )}
    </div>
  );
}

function FrameBody({ text }: { text: string }) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      return <JsonTreeViewer data={parsed} />;
    }
  } catch { /* fall through */ }
  return (
    <pre className="max-h-[300px] overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{text}</pre>
  );
}
