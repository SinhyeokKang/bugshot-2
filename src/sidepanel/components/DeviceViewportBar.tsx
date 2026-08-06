import { Loader2, Monitor } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUnsupportedTab } from "@/sidepanel/hooks/tab-support-context";
import { useDeviceViewport } from "@/sidepanel/hooks/useDeviceViewport";
import {
  confirmDeviceWarning,
  dismissDeviceWarning,
  useDeviceViewportStore,
} from "@/sidepanel/device-viewport-controller";
import { DEVICE_PRESETS, isPresetAvailable } from "@/sidepanel/lib/device-presets";

const FULL = "full";

// DESIGN.md §14의 잠금 표기 — disabled 속성을 못 쓰므로(툴팁이 죽는다) aria-disabled variant로
// 커서·투명도를 준다. IssueTab·DraftingPanel에도 같은 리터럴이 지역 상수로 있다.
const lockedClass = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * 뷰포트 폭 세그먼티드 컨트롤.
 *
 * **`<Tabs>` 래퍼를 반드시 자기가 들고 온다** — 이 행은 `DebugTab`의 `<Tabs value={sub}>`
 * 안쪽에 놓이므로 `TabsList`만 렌더하면 바깥 컨텍스트를 잡아, 세그먼트를 누르는 순간
 * `setSub("390")`이 돌아 존재하지 않는 서브탭으로 전환되고 화면이 빈다(에러 없는 조용한 오동작).
 *
 * 잠금은 `disabled`가 아니라 `aria-disabled`다 — shadcn base의 `disabled:pointer-events-none`이
 * hover·툴팁을 죽인다. Radix Tabs는 `aria-disabled`를 동작 가드로 해석하지 않으므로
 * `onValueChange`와 오케스트레이터 `select()` 양쪽에서 거부한다.
 */
export function DeviceViewportBar({ tabId }: { tabId: number | null }) {
  const t = useT();
  const unsupported = useUnsupportedTab();
  const { width, availableWidth, locked, busy, select } = useDeviceViewport(tabId);
  // 진입 경고는 사용자가 이 행을 눌러야 뜨므로 여기 둔다. 반면 루프 경고는 재수립 중에
  // 뜨는데 재수립은 이 행이 없는 phase에서도 돌므로 패널 루트(App.tsx)가 소유한다.
  const warningWidth = useDeviceViewportStore((s) => s.warningWidth);

  if (tabId == null || unsupported) return null;

  const value = width == null ? FULL : String(width);

  function isDisabled(preset: number | null): boolean {
    if (locked || busy) return true;
    return preset != null && !isPresetAvailable(preset, availableWidth);
  }

  // 잠금 사유는 "왜 못 누르는지"가 사용자에게 안 보이는 경우에만 붙인다 — busy는 스피너와
  // live status가 이미 말하고 있어서 툴팁을 겹치면 같은 말을 두 번 하는 셈이다.
  function reasonFor(preset: number | null): string | null {
    if (locked) return t("issue.device.tooltip.locked");
    if (busy) return null;
    if (preset != null && !isPresetAvailable(preset, availableWidth)) {
      return t("issue.device.tooltip.tooNarrow");
    }
    return null;
  }

  function handleValueChange(next: string): void {
    const preset = next === FULL ? null : Number(next);
    if (isDisabled(preset)) return;
    void select(preset);
  }

  function segment(
    key: string,
    preset: number | null,
    label: string,
    ariaLabel: string,
    Icon: typeof Monitor,
  ) {
    const disabled = isDisabled(preset);
    const reason = reasonFor(preset);
    const showSpinner = busy && value === key;
    const trigger = (
      <TabsTrigger
        value={key}
        data-testid={`device-preset-${key}`}
        aria-label={ariaLabel}
        // disabled 속성이 아니라 aria-disabled — shadcn base의 disabled:pointer-events-none이
        // hover·툴팁을 죽인다(DESIGN.md §14).
        aria-disabled={disabled ? true : undefined}
        // 스피너를 든 세그먼트는 흐리게 만들지 않는다 — 지금 무슨 일이 일어나는지 보여주는
        // 유일한 표시다(캡처 방식 툴바의 진행 중 버튼과 같은 예외).
        className={cn("min-w-0 gap-1.5", lockedClass, showSpinner && "aria-disabled:opacity-100")}
      >
        {showSpinner ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <TabLabel>{label}</TabLabel>
      </TabsTrigger>
    );
    // Tooltip 래퍼는 사유 유무와 무관하게 항상 있는다 — 조건부로 감싸면 사유가 생기고
    // 사라질 때마다 트리 모양이 바뀌어 버튼이 리마운트되고 포커스가 날아간다.
    // Radix Tooltip은 focus에서도 열려 키보드 사용자에게도 사유가 닿는다.
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent>{reason ?? label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tabs value={value} onValueChange={handleValueChange}>
          <div className="mt-2" data-testid="device-viewport-bar" aria-busy={busy || undefined}>
            <CollapsingTabsList className="grid h-9 w-full grid-cols-4">
              {segment(
                FULL,
                null,
                t("issue.device.full"),
                t("issue.device.aria.full"),
                Monitor,
              )}
              {DEVICE_PRESETS.map((preset) =>
                segment(
                  String(preset.width),
                  preset.width,
                  t(preset.labelKey),
                  t("issue.device.aria.width", { width: preset.width }),
                  preset.icon,
                ),
              )}
            </CollapsingTabsList>
            {/* XFO 사이트는 롤백까지 최대 3초라 무피드백 구간이 생긴다. */}
            {busy && (
              <span role="status" className="sr-only">
                {t("issue.device.status.switching")}
              </span>
            )}
          </div>
        </Tabs>
      </TooltipProvider>

      <AlertDialog
        open={warningWidth != null}
        onOpenChange={(open) => {
          if (!open) dismissDeviceWarning();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("issue.device.modeWarning.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("issue.device.modeWarning.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={dismissDeviceWarning}>
              {t("issue.device.modeWarning.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeviceWarning}>
              {t("issue.device.modeWarning.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
