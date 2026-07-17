import { useCallback, useMemo, useRef, useState } from "react";
import { Download, Terminal, ArrowLeftRight, ExternalLink, MousePointerClick, FileText } from "lucide-react";
import type { LogViewerData } from "@/types/log-viewer";
import { NetworkLogContent } from "@/sidepanel/components/NetworkLogContent";
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";
import { ActionLogContent } from "@/sidepanel/components/ActionLogContent";
import { IssuePreviewView } from "@/sidepanel/components/IssuePreviewView";
import { buildHar } from "@/sidepanel/lib/buildHar";
import { buildConsoleLogJson } from "@/sidepanel/lib/buildConsoleLogJson";
import { buildActionLogJson } from "@/sidepanel/lib/buildActionLogJson";
import { Tabs, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { toVideoSeconds } from "./timeline";
import { buildMarkers } from "./markers";
import type { TimelineMarker } from "./markers";
import { VideoPlayer, type VideoPlayerHandle } from "./components/VideoPlayer";
import { ImageViewer } from "./components/ImageViewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { t } from "./i18n";

interface AppProps {
  data: LogViewerData | null;
}

function downloadJson(obj: object, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type LogTab = "report" | "console" | "network" | "action";

export function App({ data }: AppProps) {
  const hasNetwork = !!data?.networkLog;
  const hasConsole = !!data?.consoleLog;
  const hasAction = !!data?.actionLog;
  const hasReport = !!data?.report;
  // Report는 보조 탭이라 기본 선택에서 제외(의도) — console→network→action 순.
  const defaultTab: LogTab = hasConsole ? "console" : hasNetwork ? "network" : "action";
  const [activeTab, setActiveTab] = useState<LogTab>(defaultTab);

  const copyReport = useCallback(async () => {
    const report = data?.report;
    if (!report) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([report.copy.markdown], { type: "text/plain" }),
          "text/html": new Blob([report.copy.html], { type: "text/html" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(report.copy.markdown);
    }
  }, [data]);

  const video = data?.video ?? null;
  const screenshot = data?.screenshot ?? null;
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [scrollToEntryId, setScrollToEntryId] = useState<string | null>(null);

  const seekTo = useCallback((absTs: number) => {
    if (!video) return;
    playerRef.current?.seekToSec(toVideoSeconds(absTs, video.startedAt));
  }, [video]);

  const markers = useMemo(() => {
    if (!data || !video || videoError || videoDurationSec <= 0) return [];
    // Report 탭은 타임라인 마커가 없다(본문 프리뷰라 시간축 매핑 대상 아님).
    if (activeTab === "report") return [];
    return buildMarkers(data, activeTab, videoDurationSec, video.startedAt);
  }, [data, video, videoError, videoDurationSec, activeTab]);

  const handleMarkerClick = useCallback((marker: TimelineMarker) => {
    if (!video) return;
    playerRef.current?.seekToSec(toVideoSeconds(marker.absTs, video.startedAt));
    setScrollToEntryId(marker.id);
  }, [video]);

  const handleScrollComplete = useCallback(() => {
    setScrollToEntryId(null);
  }, []);

  // 영상·앵커가 살아있을 때만 세 로그 탭에 동기화 props 공급. 부재/에러 시 라이브 서브탭과 동일 동작.
  const sync = video && !videoError
    ? { syncBaseMs: video.startedAt, onSeek: seekTo }
    : {};

  const scrollProps = video && !videoError
    ? { scrollToEntryId, onScrollComplete: handleScrollComplete }
    : {};

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        {t("logViewer.noData")}
      </div>
    );
  }

  const tabsPanel = (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LogTab)} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-4">
        <CollapsingTabsList className="grid h-9 w-full grid-cols-4">
          <TabsTrigger value="report" disabled={!hasReport} className="min-w-0 gap-1.5" data-testid="logview-tab-report">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("logViewer.tab.report")}</TabLabel>
          </TabsTrigger>
          <TabsTrigger value="console" disabled={!hasConsole} className="min-w-0 gap-1.5" data-testid="logview-tab-console">
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("logViewer.tab.console")}</TabLabel>
            {hasConsole && (
              <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {data.consoleLog!.entries.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="network" disabled={!hasNetwork} className="min-w-0 gap-1.5" data-testid="logview-tab-network">
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("logViewer.tab.network")}</TabLabel>
            {hasNetwork && (
              <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {data.networkLog!.requests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="action" disabled={!hasAction} className="min-w-0 gap-1.5" data-testid="logview-tab-action">
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("logViewer.tab.action")}</TabLabel>
            {hasAction && (
              <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {data.actionLog!.entries.length}
              </Badge>
            )}
          </TabsTrigger>
        </CollapsingTabsList>
      </div>

      <TabsContent value="report" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        {hasReport ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col">
              <IssuePreviewView
                title={data.report!.title}
                envRows={data.report!.env}
                sections={data.report!.sections}
                labels={{
                  untitled: t("logViewer.report.untitled"),
                  copyMarkdown: t("logViewer.report.copyMarkdown"),
                  copied: t("logViewer.report.copied"),
                  emptyValue: t("logViewer.report.empty"),
                  envTitle: data.report!.envTitle ?? t("logViewer.report.env"),
                  expandCode: (lines) => t("codeBlock.expand", { count: lines }),
                  collapseCode: t("codeBlock.collapse"),
                }}
                onCopy={copyReport}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("logViewer.noReport")}
          </div>
        )}
      </TabsContent>

      <TabsContent value="console" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        {hasConsole ? (
          <ConsoleLogContent
            entries={data.consoleLog!.entries}
            startedAt={data.consoleLog!.startedAt}
            flush
            {...sync}
            {...scrollProps}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("logViewer.noConsole")}
          </div>
        )}
      </TabsContent>

      <TabsContent value="network" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        {hasNetwork ? (
          <NetworkLogContent requests={data.networkLog!.requests} flush {...sync} {...scrollProps} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("logViewer.noNetwork")}
          </div>
        )}
      </TabsContent>

      <TabsContent value="action" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        {hasAction ? (
          <ActionLogContent
            entries={data.actionLog!.entries}
            startedAt={data.actionLog!.startedAt}
            flush
            {...sync}
            {...scrollProps}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("logViewer.noAction")}
          </div>
        )}
      </TabsContent>

      {/* h-[68px] 고정(=Button h-9 + py-4): 탭/이슈버튼 유무로 버튼이 안 뜰 때 높이가 줄어 레이아웃이 점프하는 걸 막는다 */}
      <div className="flex h-[68px] shrink-0 items-center gap-2 border-t border-border bg-muted/50 px-4">
        {data.meta.issueUrl ? (
          <Button variant="outline" asChild>
            <a href={data.meta.issueUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {t("logViewer.footer.issueLink")}
            </a>
          </Button>
        ) : (
          <div />
        )}
        <div className="ml-auto">
          {activeTab === "console" && hasConsole && (
            <Button
              className="gap-1"
              data-testid="download-console-json"
              onClick={() => downloadJson(buildConsoleLogJson(data.consoleLog!, data.meta.version), "Console-log.json")}
            >
              <Download className="h-4 w-4" />
              Console-log.json
            </Button>
          )}
          {activeTab === "network" && hasNetwork && (
            <Button
              className="gap-1"
              data-testid="download-network-har"
              onClick={() => downloadJson(buildHar(data.networkLog!, data.meta.version), "Network-log.har")}
            >
              <Download className="h-4 w-4" />
              Network-log.har
            </Button>
          )}
          {activeTab === "action" && hasAction && (
            <Button
              className="gap-1"
              data-testid="download-action-json"
              onClick={() => downloadJson(buildActionLogJson(data.actionLog!, data.meta.version), "Action-log.json")}
            >
              <Download className="h-4 w-4" />
              Action-log.json
            </Button>
          )}
        </div>
      </div>
    </Tabs>
  );

  if (!video && !screenshot) {
    return <div className="flex h-screen flex-col">{tabsPanel}</div>;
  }

  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={60} className="flex min-w-0 flex-col">
          {video ? (
            videoError ? (
              <div className="flex h-full items-center justify-center bg-black">
                <span className="text-sm text-muted-foreground">{t("logViewer.video.error")}</span>
              </div>
            ) : (
              <VideoPlayer
                ref={playerRef}
                src={video.dataUrl}
                poster={video.thumbnail}
                markers={markers}
                issueTitle={data.meta.issueTitle}
                issueKey={data.meta.issueKey}
                issueUrl={data.meta.issueUrl}
                onMarkerClick={handleMarkerClick}
                onDurationChange={setVideoDurationSec}
                onError={() => setVideoError(true)}
              />
            )
          ) : (
            <ImageViewer
              src={screenshot!.dataUrl}
              issueTitle={data.meta.issueTitle}
              issueKey={data.meta.issueKey}
              issueUrl={data.meta.issueUrl}
            />
          )}
        </ResizablePanel>
        <ResizableHandle className="bg-border hover:bg-blue-300 hover:shadow-[-1px_0_0_0_theme(colors.blue.300),1px_0_0_0_theme(colors.blue.300)] dark:hover:bg-blue-700 dark:hover:shadow-[-1px_0_0_0_theme(colors.blue.700),1px_0_0_0_theme(colors.blue.700)]" />
        <ResizablePanel defaultSize={40} className="flex min-w-0 flex-col">
          {tabsPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
