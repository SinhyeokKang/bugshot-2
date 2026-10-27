import { Download, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { TooltipIconButton } from "./TooltipIconButton";

// 이미지 위 액션 그룹. 인라인 이미지(ProseMirror NodeView vanilla DOM)와 아이콘·순서를
// 맞추고 필요한 소비자만 다운로드·삭제를 제공한다. 노출 판정(hover/focus)은 부모가 한다 — 여기서 opacity로 숨기면 안 보이는
// 버튼이 탭 정지점으로 남는다.
export function ImageActions({
  onAnnotate,
  onReset,
  className,
  onDownload,
  onDelete,
  ariaDisabled,
  downloadDisabled,
  testIds,
}: {
  onAnnotate?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  ariaDisabled?: boolean;
  downloadDisabled?: boolean;
  testIds?: { reset?: string; annotate?: string; download?: string; delete?: string };
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
          testId={testIds?.reset ?? "diff-image-reset"}
          ariaDisabled={ariaDisabled}
          className={surface}
          onClick={onReset}
        >
          <RotateCcw />
        </TooltipIconButton>
      ) : null}
      {onAnnotate ? <TooltipIconButton
        label={onReset ? t("draft.editAnnotation") : t("draft.addAnnotation")}
        testId={testIds?.annotate ?? "diff-image-annotate"}
        ariaDisabled={ariaDisabled}
        className={surface}
        onClick={onAnnotate}
      >
        <Pencil />
      </TooltipIconButton> : null}
      {onDownload ? <TooltipIconButton label={t("common.download")}
        testId={testIds?.download ?? "download-media"} className={surface}
        ariaDisabled={ariaDisabled || downloadDisabled} onClick={onDownload}>
        <Download />
      </TooltipIconButton> : null}
      {onDelete ? <TooltipIconButton label={t("common.delete")}
        testId={testIds?.delete ?? "image-delete"} className={surface}
        ariaDisabled={ariaDisabled} onClick={onDelete}>
        <Trash2 />
      </TooltipIconButton> : null}
    </ButtonGroup>
  );
}
