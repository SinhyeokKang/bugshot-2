import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { TabsList } from "./tabs";
import { cn } from "@/lib/utils";

const CollapsedContext = createContext(false);

// 라벨을 펼친 폭이 그리드 셀을 넘치면 모든 탭 라벨을 한꺼번에 감춰 아이콘(+배지)만 남긴다.
// 측정은 data-measuring을 잠깐 켜서 라벨을 강제로 펼친 뒤(아래 group 변형) 각 트리거의
// scrollWidth > clientWidth 여부로 판단한다. ResizeObserver(폭 변화) + MutationObserver
// (탭 수·배지·라벨 변화)로 재측정한다.
export function CollapsingTabsList({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsList>) {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    let raf = 0;
    const measure = () => {
      const items = Array.from(list.children) as HTMLElement[];
      list.setAttribute("data-measuring", "true");
      // 셀 너비를 먼저 잡고, 트리거를 max-content로 만들어 콘텐츠 자연 너비를 따로 잰다.
      // (scrollWidth는 콘텐츠가 들어가면 clientWidth로 클램프돼 여유분을 못 준다.)
      const avail = items.map((el) => el.clientWidth);
      items.forEach((el) => (el.style.width = "max-content"));
      const natural = items.map((el) => el.scrollWidth);
      items.forEach((el) => (el.style.width = ""));
      list.removeAttribute("data-measuring");
      // 콘텐츠가 셀을 8px 넘길 때 라벨을 접는다(음수 보정 = 조금 늦게 접힘).
      const overflow = items.some((_, i) => natural[i] - 8 > avail[i]);
      setCollapsed(overflow);
    };
    measure();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(list);
    const mo = new MutationObserver(schedule);
    mo.observe(list, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <CollapsedContext.Provider value={collapsed}>
      <TabsList ref={ref} className={cn("group/tabs", className)} {...props}>
        {children}
      </TabsList>
    </CollapsedContext.Provider>
  );
}

// 접힘 상태에서 숨길 라벨. 측정 중에는 group-data로 강제 노출돼 폭이 잡힌다.
export function TabLabel({ children, className }: { children: ReactNode; className?: string }) {
  const collapsed = useContext(CollapsedContext);
  return (
    <span className={cn(collapsed && "hidden", "group-data-[measuring]/tabs:inline", className)}>
      {children}
    </span>
  );
}
