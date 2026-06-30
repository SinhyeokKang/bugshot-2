import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  // 멀티 thumb일 때 각 thumb의 aria-label (순서대로).
  thumbAriaLabels?: string[]
  // 트랙/범위/thumb 스타일 슬롯 (cn=twMerge로 기본값 위에 머지·override).
  trackClassName?: string
  rangeClassName?: string
  thumbClassName?: string
  thumbContent?: React.ReactNode | ((index: number) => React.ReactNode) // thumb 내부 렌더(인덱스별 가능)
  onThumbClick?: (index: number) => void // thumb 클릭(드래그 아님) — 예: 해당 핸들로 seek
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, thumbAriaLabels, trackClassName, rangeClassName, thumbClassName, thumbContent, onThumbClick, ...props }, ref) => {
  const thumbCount = Array.isArray(props.value)
    ? props.value.length
    : Array.isArray(props.defaultValue)
      ? props.defaultValue.length
      : 1
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className={cn("relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20", trackClassName)}>
        <SliderPrimitive.Range className={cn("absolute h-full bg-primary", rangeClassName)} />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={thumbAriaLabels?.[i]}
          onClick={onThumbClick ? () => onThumbClick(i) : undefined}
          className={cn(
            "pointer-events-auto block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
            thumbClassName
          )}
        >
          {typeof thumbContent === "function" ? thumbContent(i) : thumbContent}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
