import { useState } from "react";
import { t } from "../i18n";

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

      {/* Issue title — top overlay, dim + text visible on hover */}
      {issueTitle && (
        <div className="absolute inset-x-0 top-0 z-10 px-6 pb-8 pt-6" style={{ pointerEvents: "none" }}>
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <h1 className="relative truncate text-[20px] font-bold leading-snug text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">{issueTitle}</h1>
          {issueKey && (
            <a
              href={issueUrl && /^https?:\/\//.test(issueUrl) ? issueUrl : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="relative mt-1 inline-block text-[14px] font-medium text-white/60 opacity-0 transition-opacity duration-300 hover:text-white/80 group-hover:opacity-100"
              style={{ pointerEvents: "auto" }}
            >
              {issueKey}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
