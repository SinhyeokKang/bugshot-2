import { Pencil, RotateCcw } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { TooltipIconButton } from "./TooltipIconButton";

// diff table 이미지 위 액션 그룹. 인라인 이미지(ProseMirror NodeView vanilla DOM)와 아이콘·순서를
// 맞추되 [삭제]는 없다. 노출 판정(hover/focus)은 부모가 한다 — 여기서 opacity로 숨기면 안 보이는
// 버튼이 탭 정지점으로 남는다.
export function ImageActions({
  onAnnotate,
  onReset,
  className,
}: {
  onAnnotate: () => void;
  // 주석이 없으면 넘기지 않는다 — 조건부 렌더라 ButtonGroup 모서리 함정(hidden 속성)이 없다.
  onReset?: () => void;
  className?: string;
}) {
  const t = useT();
  // 표면 클래스는 그룹이 아니라 **버튼**에 준다 — outline variant의 불투명 `bg-background`가
  // 래퍼를 완전히 덮어 반투명·블러가 렌더되지 않는다(annotation 툴바 선례와 같은 이유).
  const surface = "bg-background/90 backdrop-blur-sm hover:bg-background hover:text-primary";
  return (
    <ButtonGroup className={cn("rounded-md shadow-md", className)}>
      {onReset ? (
        <TooltipIconButton
          label={t("draft.removeAnnotation")}
          testId="diff-image-reset"
          className={surface}
          onClick={onReset}
        >
          <RotateCcw />
        </TooltipIconButton>
      ) : null}
      <TooltipIconButton
        label={onReset ? t("draft.editAnnotation") : t("draft.addAnnotation")}
        testId="diff-image-annotate"
        className={surface}
        onClick={onAnnotate}
      >
        <Pencil />
      </TooltipIconButton>
    </ButtonGroup>
  );
}
