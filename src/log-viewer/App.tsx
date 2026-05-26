import { useState, useCallback } from "react";
import { Download, Moon, Sun } from "lucide-react";
import type { LogViewerData } from "@/types/log-viewer";
import { NetworkLogContent } from "@/sidepanel/components/NetworkLogContent";
import { ConsoleLogContent } from "@/sidepanel/components/ConsoleLogContent";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

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

export function App({ data }: AppProps) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  const toggleTheme = useCallback(() => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }, [dark]);

  const hasNetwork = !!data?.networkLog;
  const hasConsole = !!data?.consoleLog;
  const defaultTab = hasNetwork ? "network" : "console";

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        No log data found.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="shrink-0 text-sm font-semibold">BugShot Logs</span>
        {data.meta.pageUrl && (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={data.meta.pageUrl}>
            {data.meta.pageUrl}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleTheme}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!data.har}
            onClick={() => data.har && downloadJson(data.har, "network-log.har")}
          >
            <Download className="h-3.5 w-3.5" />
            HAR
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!data.consoleLogJson}
            onClick={() => data.consoleLogJson && downloadJson(data.consoleLogJson, "console-log.json")}
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-screen-xl flex-1 flex-col">
        <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-2 w-fit">
            <TabsTrigger value="network" disabled={!hasNetwork}>Network</TabsTrigger>
            <TabsTrigger value="console" disabled={!hasConsole}>Console</TabsTrigger>
          </TabsList>

          <TabsContent value="network" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {hasNetwork ? (
              <NetworkLogContent requests={data.networkLog!.requests} flush />
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
                No network data
              </div>
            )}
          </TabsContent>

          <TabsContent value="console" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {hasConsole ? (
              <ConsoleLogContent
                entries={data.consoleLog!.entries}
                startedAt={data.consoleLog!.startedAt}
                flush
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
                No console data
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
