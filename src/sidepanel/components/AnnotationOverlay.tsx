import { useEffect, useRef } from "react";
import type * as markerjs2 from "markerjs2";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

interface AnnotationOverlayProps {
  imageUrl: string;
  onComplete: (annotatedUrl: string) => void;
  onCancel: () => void;
}

export default function AnnotationOverlay({
  imageUrl,
  onComplete,
  onCancel,
}: AnnotationOverlayProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maRef = useRef<markerjs2.MarkerArea | null>(null);
  const stateRef = useRef<markerjs2.MarkerAreaState | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    let ma: markerjs2.MarkerArea | null = null;
    let cancelled = false;

    void import("markerjs2").then((mod) => {
      if (cancelled) return;
      ma = new mod.MarkerArea(img);
      ma.targetRoot = container;
      ma.uiStyleSettings.zIndex = "9999";
      ma.uiStyleSettings.resultButtonBlockVisible = false;
      ma.renderAtNaturalSize = true;
      ma.renderImageType = "image/webp";
      ma.renderImageQuality = 0.92;

      ma.addEventListener("render", (event) => {
        img.src = event.dataUrl;
        stateRef.current = event.state;
      });

      ma.addEventListener("close", () => {
        if (maRef.current && stateRef.current) {
          maRef.current.show();
          maRef.current.restoreState(stateRef.current);
        }
      });

      maRef.current = ma;
      ma.show();
    });

    return () => {
      cancelled = true;
      maRef.current = null;
      try {
        ma?.close();
      } catch {}
    };
  }, []);

  const handleComplete = () => {
    const ma = maRef.current;
    const img = imgRef.current;
    if (ma) {
      ma.startRenderAndClose();
    }
    setTimeout(() => {
      if (!img) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      onComplete(canvas.toDataURL("image/webp", 0.92));
    }, 300);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        ref={containerRef}
        className="relative flex flex-col items-center gap-6"
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          className="max-h-[70vh] max-w-[90%] object-contain"
        />
      </div>
      <div className="absolute inset-x-0 bottom-6 z-[10000] flex items-center justify-center gap-2">
        <Button size="lg" variant="secondary" onClick={onCancel}>
          {t("annotation.cancel")}
        </Button>
        <Button size="lg" onClick={handleComplete}>{t("annotation.done")}</Button>
      </div>
    </div>
  );
}
