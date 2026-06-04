import { useState } from "react";
import { t } from "../i18n";
import { IssueTitleOverlay } from "./IssueTitleOverlay";

interface ImageViewerProps {
  src: string;
  issueTitle?: string;
  issueKey?: string;
  issueUrl?: string;
}

export function ImageViewer({ src, issueTitle, issueKey, issueUrl }: ImageViewerProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <span className="text-sm text-muted-foreground">{t("logViewer.image.error")}</span>
      </div>
    );
  }

  return (
    <div className="group relative h-full">
      {/* Image area */}
      <div className="flex h-full items-center justify-center bg-black">
        <img
          src={src}
          alt={issueTitle ?? ""}
          className="h-full w-full object-contain"
          onError={() => setError(true)}
        />
      </div>

      <IssueTitleOverlay issueTitle={issueTitle} issueKey={issueKey} issueUrl={issueUrl} />
    </div>
  );
}
