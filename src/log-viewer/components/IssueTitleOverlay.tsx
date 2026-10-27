import { safeExternalHref } from "@/lib/external-url";

interface IssueTitleOverlayProps {
  variant?: "overlay" | "static";
  issueTitle?: string;
  issueKey?: string;
  issueUrl?: string;
}

// 상단 제목 오버레이 — 부모의 .group 호버 시 dim + 텍스트 노출. VideoPlayer·ImageViewer 공용.
export function IssueTitleOverlay({ variant = "overlay", issueTitle, issueKey, issueUrl }: IssueTitleOverlayProps) {
  if (!issueTitle) return null;

  if (variant === "static") {
    return (
      <div data-testid="static-issue-header" className="shrink-0 border-b bg-background px-6 py-4">
        <h1 className="truncate text-[20px] font-bold leading-snug">{issueTitle}</h1>
        {issueKey && (
          <a href={safeExternalHref(issueUrl)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block max-w-full truncate text-[14px] font-medium text-muted-foreground hover:text-foreground">
            {issueKey}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 z-10 px-6 pb-8 pt-6" style={{ pointerEvents: "none" }}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <h1 className="relative truncate text-[20px] font-bold leading-snug text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">{issueTitle}</h1>
      {issueKey && (
        <a
          href={safeExternalHref(issueUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="relative mt-1 inline-block text-[14px] font-medium text-white/60 opacity-0 transition-opacity duration-300 hover:text-white/80 group-hover:opacity-100"
          style={{ pointerEvents: "auto" }}
        >
          {issueKey}
        </a>
      )}
    </div>
  );
}
