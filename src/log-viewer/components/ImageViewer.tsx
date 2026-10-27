import { useState } from "react";
import { t } from "@/log-viewer/i18n";
import { IssueTitleOverlay } from "./IssueTitleOverlay";

interface ImageViewerProps {
  src: string;
  stacked?: boolean;
  issueTitle?: string;
  issueKey?: string;
  issueUrl?: string;
}

export function ImageViewer({ src, stacked = false, issueTitle, issueKey, issueUrl }: ImageViewerProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className={stacked ? "flex min-h-32 items-center justify-center bg-black" : "flex h-full items-center justify-center bg-black"}>
        <span className="text-sm text-muted-foreground">{t("logViewer.image.error")}</span>
      </div>
    );
  }

  return (
    <div className={stacked ? "group relative" : "group relative h-full"}>
      {/* Image area */}
      <div className="flex h-full items-center justify-center bg-black">
        <img
          src={src}
          alt={issueTitle ?? ""}
          className={stacked ? "h-auto w-full object-contain" : "h-full w-full object-contain"}
          onError={() => setError(true)}
        />
      </div>

      {!stacked && <IssueTitleOverlay issueTitle={issueTitle} issueKey={issueKey} issueUrl={issueUrl} />}
    </div>
  );
}
