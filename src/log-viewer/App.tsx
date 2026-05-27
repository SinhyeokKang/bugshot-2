import { useState } from "react";
import { Download, Terminal, ArrowLeftRight, ExternalLink, MousePointerClick } from "lucide-react";
import type { LogViewerData } from "@/types/log-viewer";
import { NetworkLogContent } from "@/sidepanel/components/NetworkLogContent";
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";
import { ActionLogContent } from "@/sidepanel/components/ActionLogContent";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

type LogTab = "console" | "network" | "action";

export function App({ data }: AppProps) {
  const hasNetwork = !!data?.networkLog;
  const hasConsole = !!data?.consoleLog;
  const hasAction = !!data?.actionLog;
  const defaultTab: LogTab = hasConsole ? "console" : hasNetwork ? "network" : "action";
  const [activeTab, setActiveTab] = useState<LogTab>(defaultTab);

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        No log data found.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LogTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-4">
          <TabsList className="grid h-9 w-full grid-cols-3">
            <TabsTrigger value="console" disabled={!hasConsole} className="gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              Console Log
              {hasConsole && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">
                  {data.consoleLog!.entries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="network" disabled={!hasNetwork} className="gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Network Log
              {hasNetwork && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">
                  {data.networkLog!.requests.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="action" disabled={!hasAction} className="gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5" />
              Actions
              {hasAction && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">
                  {data.actionLog!.entries.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="console" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {hasConsole ? (
            <ConsoleLogContent
              entries={data.consoleLog!.entries}
              startedAt={data.consoleLog!.startedAt}
              flush
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No console data
            </div>
          )}
        </TabsContent>

        <TabsContent value="network" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {hasNetwork ? (
            <NetworkLogContent requests={data.networkLog!.requests} flush />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No network data
            </div>
          )}
        </TabsContent>

        <TabsContent value="action" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {hasAction ? (
            <ActionLogContent
              entries={data.actionLog!.entries}
              startedAt={data.actionLog!.startedAt}
              flush
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No action data
            </div>
          )}
        </TabsContent>

        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/50 p-4">
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
            {activeTab === "console" && data.consoleLogJson && (
              <Button
                className="gap-1"
                onClick={() => downloadJson(data.consoleLogJson!, "Console-log.json")}
              >
                <Download className="h-4 w-4" />
                Console-log.json
              </Button>
            )}
            {activeTab === "network" && data.har && (
              <Button
                className="gap-1"
                onClick={() => downloadJson(data.har!, "Network-log.har")}
              >
                <Download className="h-4 w-4" />
                Network-log.har
              </Button>
            )}
            {activeTab === "action" && data.actionLogJson && (
              <Button
                className="gap-1"
                onClick={() => downloadJson(data.actionLogJson!, "Action-log.json")}
              >
                <Download className="h-4 w-4" />
                Action-log.json
              </Button>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
}
