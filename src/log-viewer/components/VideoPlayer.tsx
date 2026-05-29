import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { TimelineMarker } from "../markers";
import { formatPlayerTime } from "../timeline";
import { ProgressBar } from "./ProgressBar";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";

export interface VideoPlayerHandle {
  seekToSec: (timeSec: number) => void;
}

interface VideoPlayerProps {
  src: string;
  poster?: string;
  markers: TimelineMarker[];
  onMarkerClick: (marker: TimelineMarker) => void;
  onTimeUpdate?: (currentTimeSec: number) => void;
  onDurationChange: (durationSec: number) => void;
  onError: () => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ src, poster, markers, onMarkerClick, onTimeUpdate, onDurationChange, onError }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTimeSec, setCurrentTimeSec] = useState(0);
    const [durationSec, setDurationSec] = useState(0);

    useImperativeHandle(ref, () => ({
      seekToSec(timeSec: number) {
        const el = videoRef.current;
        if (!el) return;
        el.currentTime = timeSec;
      },
    }), []);

    const togglePlay = useCallback(() => {
      const el = videoRef.current;
      if (!el) return;
      if (el.paused) void el.play();
      else el.pause();
    }, []);

    const handleTimeUpdate = useCallback(() => {
      const el = videoRef.current;
      if (!el) return;
      setCurrentTimeSec(el.currentTime);
      onTimeUpdate?.(el.currentTime);
    }, [onTimeUpdate]);

    const handleDurationChange = useCallback(() => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      setDurationSec(el.duration);
      onDurationChange(el.duration);
    }, [onDurationChange]);

    const handleSeek = useCallback((pct: number) => {
      const el = videoRef.current;
      if (!el || !durationSec) return;
      el.currentTime = (durationSec * pct) / 100;
    }, [durationSec]);

    const currentPct = durationSec > 0 ? (currentTimeSec / durationSec) * 100 : 0;

    return (
      <div className="flex h-full flex-col">
        {/* Video area */}
        <div
          className="flex min-h-0 flex-1 cursor-pointer items-center justify-center bg-black"
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            poster={poster}
            src={src}
            className="h-full w-full object-contain"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleDurationChange}
            onDurationChange={handleDurationChange}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={onError}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 border-t bg-muted px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={togglePlay}
            aria-label={isPlaying ? t("logViewer.player.pause") : t("logViewer.player.play")}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>

          <ProgressBar
            currentPct={currentPct}
            markers={markers}
            onSeek={handleSeek}
            onMarkerClick={onMarkerClick}
          />

          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {formatPlayerTime(currentTimeSec)} / {formatPlayerTime(durationSec)}
          </span>
        </div>
      </div>
    );
  },
);
