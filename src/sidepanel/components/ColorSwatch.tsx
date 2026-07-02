import { cn } from "@/lib/utils";

// 색 표기 정규화 — bare hex(GitHub API 포맷)에만 `#`를 부여하고,
// CSS 색 표현(rgb()/var()/색이름/# 포함 hex)은 그대로 통과.
export function normalizeSwatchColor(color: string): string {
  return /^[0-9a-f]{3,8}$/i.test(color) ? `#${color}` : color;
}

// 색상/이미지 미리보기 사각형. 스타일은 picker 인스펙터 툴팁(.pl-swatch:
// 12px, radius 3px, 1px solid border)과 맞춘다. content script(overlay.ts)는
// raw HTML이라 컴포넌트를 공유할 수 없어 시각만 통일한다.
// shape="round"는 라벨 색 dot(콤보박스) 용.
export function ColorSwatch({
  color,
  image,
  shape = "square",
  className,
}: {
  color?: string;
  image?: string;
  shape?: "square" | "round";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "h-3 w-3 shrink-0 border border-border",
        shape === "round" ? "rounded-full" : "rounded-[3px]",
        className,
      )}
      style={
        image
          ? { backgroundImage: image, backgroundSize: "cover" }
          : { backgroundColor: color == null ? color : normalizeSwatchColor(color) }
      }
    />
  );
}
