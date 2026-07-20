import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// 문구가 바뀌면 이전 문구는 위로 이탈(fade+slide-up), 새 문구는 아래에서 진입(fade+slide-up).
// 두 문구를 grid로 겹쳐 동시에 애니메이션한다 — 둘 다 중앙정렬이라 폭이 달라도 중심은 고정.
export function AiLoadingText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [current, setCurrent] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);

  useEffect(() => {
    if (text === current) return;
    setPrev(current);
    setCurrent(text);
  }, [text, current]);

  // 이탈 문구는 애니메이션이 끝난 뒤 제거. 타이머는 prev 변화에만 걸어
  // setCurrent 재렌더의 cleanup에 휩쓸리지 않게 한다.
  useEffect(() => {
    if (prev === null) return;
    const id = window.setTimeout(() => setPrev(null), 800);
    return () => window.clearTimeout(id);
  }, [prev]);

  return (
    <div className="relative grid place-items-center">
      {prev !== null && (
        <span
          key={`out-${prev}`}
          className={cn(
            "col-start-1 row-start-1 text-center animate-out fade-out slide-out-to-top-5 fill-mode-forwards duration-700 motion-reduce:hidden",
            className,
          )}
        >
          {prev}
        </span>
      )}
      <span
        key={`in-${current}`}
        className={cn(
          "col-start-1 row-start-1 text-center animate-in fade-in slide-in-from-bottom-5 duration-700 motion-reduce:animate-none",
          className,
        )}
      >
        {current}
      </span>
    </div>
  );
}
