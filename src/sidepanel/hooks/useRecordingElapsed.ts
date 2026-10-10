import { useEffect, useRef, useState } from "react";
import * as videoRecorder from "@/sidepanel/video-recorder";

// 정지 처리 구간(onstop이 state=null 후 썸네일·settle을 await)엔 getElapsedSec()가 0으로 떨어지므로,
// 직전 값이 0보다 크면 그 값을 유지한다. 녹화마다 새로 마운트돼 이전 녹화 값은 새지 않는다.
export function useRecordingElapsed(): { elapsedSec: number; maxSec: number } {
  const [elapsedSec, setElapsedSec] = useState(0);
  const lastRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const next = videoRecorder.getElapsedSec();
      if (next > 0 || lastRef.current === 0) {
        lastRef.current = next;
        setElapsedSec(next);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  return { elapsedSec, maxSec: videoRecorder.getMaxDuration() };
}
