import { cn } from "@/lib/utils";

// 색상/이미지 미리보기 사각형. 스타일은 picker 인스펙터 툴팁(.pl-swatch:
// 12px, radius 3px, 1px solid border)과 맞춘다. content script(overlay.ts)는
// raw HTML이라 컴포넌트를 공유할 수 없어 시각만 통일한다.
export function ColorSwatch({
  color,
  image,
  className,
}: {
  color?: string;
  image?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "h-3 w-3 shrink-0 rounded-[3px] border border-border",
        className,
      )}
      style={
        image
          ? { backgroundImage: image, backgroundSize: "cover" }
          : { backgroundColor: color }
      }
    />
  );
}
