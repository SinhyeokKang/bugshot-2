import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight, SquarePen, Terminal } from "lucide-react";
import { useT } from "@/i18n";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { Badge } from "@/components/ui/badge";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useUnsupportedTab } from "@/sidepanel/hooks/tab-support-context";
import { startFreeformDraft, syncNetworkRecorder, syncConsoleRecorder, syncActionRecorder } from "@/sidepanel/picker-control";
import { IssueTab } from "./IssueTab";
import { ConsoleSubTab } from "./ConsoleSubTab";
import { NetworkSubTab } from "./NetworkSubTab";

type DebugSubTab = "issue" | "console" | "network";

export function DebugTab({ activeMainTab }: { activeMainTab: string }) {
  const t = useT();
  const [sub, setSub] = useState<DebugSubTab>("issue");
  const tabId = useBoundTabId();
  const unsupported = useUnsupportedTab();
  const phase = useEditorStore((s) => s.phase);
  const consoleCount = useEditorStore((s) => s.consoleLog?.entries.length ?? 0);
  const networkCount = useEditorStore((s) => s.networkLog?.requests.length ?? 0);
  // 작성 플로우(styling/drafting/previewing/done)에선 하위 탭 바를 통째로 숨겨 작성 화면에 집중.
  // 녹화 완료는 로그 서브탭에서도 일어나므로 아래 layout effect가 sub를 issue로 되돌린다. 앱 전역 탭은 그대로 유지.
  const hideSubTabs =
    phase === "styling" ||
    phase === "drafting" ||
    phase === "previewing" ||
    phase === "done";
  // 미지원 페이지에서는 로그가 아예 쌓이지 않으므로 잠근다. 녹화 중엔 열고, 진행 중 버퍼 Clear는 서브탭 footer가 막는다.
  const logTabsLocked = unsupported;
  const recording = phase === "recording";
  // 녹화 중엔 로그 서브탭에서도 3종 레코더를 모두 동기화한다(콘솔 탭에 있어도 네트워크 배지가 오른다).
  // phase가 아니라 파생 불리언을 deps에 둬 무관한 phase 전이마다 interval이 재시작되지 않게 한다.
  const pollAll = sub === "issue" || recording;

  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  // 미지원 전이는 사용자 액션이 아니라 네비게이션으로 일어난다 — sub를 그대로 두면 잠긴
  // 트리거 뒤에서 이전 페이지 로그가 계속 렌더되고, 안내는 issue 서브탭에 있어서 보이지 않는다.
  // 그 서브탭들의 [이슈 작성] 버튼도 활성인 채 남아 미지원 다이얼로그를 띄운다.
  useEffect(() => {
    if (unsupported) setSub("issue");
  }, [unsupported]);

  // layout effect라 drafting 첫 페인트에 이전 서브탭이 한 프레임 그려지지 않는다.
  useLayoutEffect(() => {
    if (hideSubTabs) setSub("issue");
  }, [hideSubTabs]);

  useEffect(() => {
    if (activeMainTab !== "debug" || !pollAll || unsupported) return;
    if (tabIdRef.current == null) return;
    const sync = () => {
      if (tabIdRef.current == null) return;
      syncNetworkRecorder(tabIdRef.current).catch(() => {});
      syncConsoleRecorder(tabIdRef.current).catch(() => {});
      syncActionRecorder(tabIdRef.current).catch(() => {});
    };
    sync();
    const id = setInterval(sync, 1500);
    return () => clearInterval(id);
  }, [activeMainTab, pollAll, unsupported]);

  const handleStartFreeform = useCallback(() => {
    if (tabId == null) return;
    setSub("issue");
    void startFreeformDraft(tabId);
  }, [tabId]);

  return (
    <Tabs
      value={sub}
      onValueChange={(v) => setSub(v as DebugSubTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      {!hideSubTabs && (
        <div className="shrink-0 border-b border-border px-4 py-4">
          <CollapsingTabsList className="grid h-9 w-full grid-cols-3">
            <TabsTrigger value="issue" className="min-w-0 gap-1.5" data-testid="subtab-issue">
              <SquarePen className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.issue")}</TabLabel>
            </TabsTrigger>
            <TabsTrigger value="console" disabled={logTabsLocked} className="min-w-0 gap-1.5" data-testid="subtab-console">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.console")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {consoleCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="network" disabled={logTabsLocked} className="min-w-0 gap-1.5" data-testid="subtab-network">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
              <TabLabel>{t("debug.tab.network")}</TabLabel>
              <Badge className="ml-0.5 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                {networkCount}
              </Badge>
            </TabsTrigger>
          </CollapsingTabsList>
        </div>
      )}

      <TabsContent
        value="issue"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <IssueTab />
      </TabsContent>

      <TabsContent
        value="console"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <ConsoleSubTab active={sub === "console"} onStartFreeform={handleStartFreeform} />
      </TabsContent>

      <TabsContent
        value="network"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <NetworkSubTab active={sub === "network"} onStartFreeform={handleStartFreeform} />
      </TabsContent>
    </Tabs>
  );
}
