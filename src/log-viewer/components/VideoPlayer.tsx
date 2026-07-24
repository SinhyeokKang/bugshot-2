import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";
import type { TimelineMarker } from "@/log-viewer/markers";
import { formatPlayerTime } from "@/log-viewer/timeline";
import { ProgressBar } from "./ProgressBar";
import { IssueTitleOverlay } from "./IssueTitleOverlay";
import { Button } from "@/components/ui/button";
import { t } from "@/log-viewer/i18n";

export interface VideoPlayerHandle {
  seekToSec: (timeSec: number) => void;
}

interface VideoPlayerProps {
  src: string;
  poster?: string;
  markers: TimelineMarker[];
  issueTitle?: string;
  issueKey?: string;
  issueUrl?: string;
  onMarkerClick: (marker: TimelineMarker) => void;
  onDurationChange: (durationSec: number) => void;
  onTimeUpdate?: (sec: number) => void; // playhead 구독(타임라인 패널 동기화). 미공급 시 기존 동작 불변.
  onError: () => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ src, poster, markers, issueTitle, issueKey, issueUrl, onMarkerClick, onDurationChange, onTimeUpdate, onError }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [pauseFlash, setPauseFlash] = useState(false);
    const pauseFlashTimer = useRef<ReturnType<typeof setTimeout>>();
    const [currentTimeSec, setCurrentTimeSec] = useState(0);
    const [durationSec, setDurationSec] = useState(0);

    useEffect(() => () => clearTimeout(pauseFlashTimer.current), []);

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

    const handleDownload = useCallback(() => {
      const a = document.createElement("a");
      a.href = src;
      a.download = "recording.mp4";
      a.click();
    }, [src]);

    const handleSeek = useCallback((pct: number) => {
      const el = videoRef.current;
      if (!el || !durationSec) return;
      el.currentTime = (durationSec * pct) / 100;
    }, [durationSec]);

    const currentPct = durationSec > 0 ? (currentTimeSec / durationSec) * 100 : 0;

    return (
      <div className="group relative h-full">
        {/* Video area */}
        <div
          className="flex h-full cursor-pointer items-center justify-center bg-black"
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
            onPlay={() => {
              setIsPlaying(true);
              setPauseFlash(true);
              clearTimeout(pauseFlashTimer.current);
              pauseFlashTimer.current = setTimeout(() => setPauseFlash(false), 1500);
            }}
            onPause={() => {
              setIsPlaying(false);
              setPauseFlash(false);
              clearTimeout(pauseFlashTimer.current);
            }}
            onEnded={() => setIsPlaying(false)}
            onError={onError}
          />
        </div>

        {/* Center play button — visible on hover when paused */}
        {!isPlaying && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
              <Play className="h-10 w-10 fill-white text-white" />
            </div>
          </div>
        )}

        {/* Center pause flash — briefly visible after play starts */}
        {isPlaying && (
          <div className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-500 ${pauseFlash ? "opacity-100" : "opacity-0"}`}>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
              <Pause className="h-10 w-10 fill-white text-white" />
            </div>
          </div>
        )}

        <IssueTitleOverlay issueTitle={issueTitle} issueKey={issueKey} issueUrl={issueUrl} />

        {/* Controls — bottom overlay */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col bg-gradient-to-b from-transparent to-black/80 pt-8">
          <div className="px-4">
            <ProgressBar
              currentPct={currentPct}
              durationSec={durationSec}
              markers={markers}
              onSeek={handleSeek}
              onMarkerClick={onMarkerClick}
            />
          </div>

          <div className="flex items-center gap-1 px-4 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white hover:text-white/70 hover:bg-transparent"
              onClick={togglePlay}
              aria-label={isPlaying ? t("logViewer.player.pause") : t("logViewer.player.play")}
            >
              {isPlaying ? <Pause className="!h-5 !w-5 fill-current" /> : <Play className="!h-5 !w-5 fill-current" />}
            </Button>

            <span className="text-sm text-white">
              {formatPlayerTime(currentTimeSec)} / {formatPlayerTime(durationSec)}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-12 w-12 text-white hover:text-white/70 hover:bg-transparent"
              onClick={handleDownload}
              aria-label={t("logViewer.player.download")}
            >
              <Download className="!h-5 !w-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
