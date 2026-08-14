import { ChevronDown, ChevronRight } from "lucide-react";

// JsonTreeViewer(JSON 본문)와 DomTreeDialog(DOM 트리)의 펼침 chevron이 className까지 같은
// 쌍둥이라 여기로 모은다. raw <button>을 유지하는 건 Button size="icon"의 최소 크기(h-8/h-9)가
// h-4 슬롯에 안 들어가서다(DESIGN §10이 인정한 예외 계열).
// 라벨은 호출부가 주입한다 — DOM 트리는 dom.* 도메인 문구를 유지한다.
export function TreeChevronButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/15"
      onClick={onToggle}
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}
