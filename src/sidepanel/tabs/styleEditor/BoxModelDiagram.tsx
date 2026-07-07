import { cn } from "@/lib/utils";
import type { BoxModel, BoxSides } from "./boxModel";

// DevTools 관례색(margin 주황·border 노랑·padding 초록·content 파랑). 색만으로
// 구분되지 않게 각 영역에 라벨 텍스트 + aria-label을 함께 둔다.
function Layer({
  label,
  sides,
  className,
  children,
}: {
  label: string;
  sides: BoxSides;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-sm border px-7 py-6 text-center text-[10px] leading-none tabular-nums",
        className,
      )}
      aria-label={`${label} top ${sides.top}px right ${sides.right}px bottom ${sides.bottom}px left ${sides.left}px`}
    >
      <span className="absolute left-1 top-0.5 text-[8px] font-medium uppercase opacity-60">
        {label}
      </span>
      <span className="absolute left-1/2 top-1 -translate-x-1/2">{sides.top}</span>
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{sides.bottom}</span>
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2">{sides.left}</span>
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{sides.right}</span>
      {children}
    </div>
  );
}

export function BoxModelDiagram({ box }: { box: BoxModel }) {
  return (
    <div
      data-testid="box-model-diagram"
      className="max-h-56 overflow-hidden px-4 pt-3 text-foreground"
    >
      <Layer
        label="margin"
        sides={box.margin}
        className="border-orange-300 bg-orange-100/70 dark:border-orange-800 dark:bg-orange-950/40"
      >
        <Layer
          label="border"
          sides={box.border}
          className="border-yellow-300 bg-yellow-100/70 dark:border-yellow-800 dark:bg-yellow-950/40"
        >
          <Layer
            label="padding"
            sides={box.padding}
            className="border-green-300 bg-green-100/70 dark:border-green-800 dark:bg-green-950/40"
          >
            <div
              className="rounded-sm border border-blue-300 bg-blue-100/70 py-3 text-[10px] leading-none tabular-nums dark:border-blue-800 dark:bg-blue-950/40"
              aria-label={`content ${box.contentLabel}`}
            >
              {box.contentLabel}
            </div>
          </Layer>
        </Layer>
      </Layer>
    </div>
  );
}
