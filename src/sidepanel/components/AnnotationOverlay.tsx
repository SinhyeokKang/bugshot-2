import { useEffect, useRef } from "react";
import * as markerjs2 from "markerjs2";
import { Button } from "@/components/ui/button";

interface AnnotationOverlayProps {
  imageUrl: string;
  onComplete: (annotatedUrl: string) => void;
  onCancel: () => void;
}

export function AnnotationOverlay({
  imageUrl,
  onComplete,
  onCancel,
}: AnnotationOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maRef = useRef<markerjs2.MarkerArea | null>(null);
  const stateRef = useRef<markerjs2.MarkerAreaState | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const ma = new markerjs2.MarkerArea(img);
    ma.targetRoot = container;
    ma.uiStyleSettings.zIndex = "9999";
    ma.uiStyleSettings.resultButtonBlockVisible = false;
    ma.renderAtNaturalSize = true;
    ma.renderImageType = "image/png";

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

    return () => {
      maRef.current = null;
      try {
        ma.close();
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
      onComplete(canvas.toDataURL("image/png"));
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
          취소
        </Button>
        <Button size="lg" onClick={handleComplete}>주석 완료</Button>
      </div>
    </div>
  );
}
