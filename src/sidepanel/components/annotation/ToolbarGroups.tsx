import {
  Circle,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { TooltipIconButton } from "@/sidepanel/components/TooltipIconButton";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import {
  ANNOTATION_COLORS,
  THICKNESS_KEYS,
  TEXT_SIZE_KEYS,
  type AnnotationTool,
  type AnnotationToolMeta,
  type TextSizeKey,
  type ThicknessKey,
} from "./presets";

// 어노테이션 툴바의 재사용 그룹(툴/색/두께/텍스트크기). 이미지 어노테이션 툴바와
// 녹화 중 그리기 footer가 공유한다 — 팔레트·두께 등 스타일 단일 출처.

const TOOL_ICONS: Record<AnnotationTool, LucideIcon> = {
  select: MousePointer2,
  arrow: MoveUpRight,
  rect: Square,
  ellipse: Circle,
  pen: Pencil,
  text: Type,
  highlight: Highlighter,
};

const COLOR_LABEL_KEYS: TranslationKey[] = [
  "annotation.color.red",
  "annotation.color.yellow",
  "annotation.color.green",
  "annotation.color.blue",
  "annotation.color.black",
];

const THICKNESS_LABEL_KEYS: Record<ThicknessKey, TranslationKey> = {
  S: "annotation.thickness.S",
  M: "annotation.thickness.M",
  L: "annotation.thickness.L",
};

// 버튼 안 Minus 글리프의 시각 두께(32px 버튼 기준 — 실제 strokeWidth와 별개).
const THICKNESS_STROKE: Record<ThicknessKey, number> = { S: 1.5, M: 3.5, L: 6 };

const TEXTSIZE_LABEL_KEYS: Record<TextSizeKey, TranslationKey> = {
  S: "annotation.textSize.S",
  M: "annotation.textSize.M",
  L: "annotation.textSize.L",
};

// 버튼 안 "A" 글자의 시각 크기(32px 버튼 기준 — 실제 폰트 px와 별개).
const TEXTSIZE_ICON: Record<TextSizeKey, number> = { S: 11, M: 15, L: 20 };

export function ToolButton({
  meta,
  active,
  onSelect,
  testIdPrefix = "annotation-tool",
}: {
  meta: AnnotationToolMeta;
  active: boolean;
  onSelect: (tool: AnnotationTool) => void;
  testIdPrefix?: string;
}) {
  const t = useT();
  const Icon = TOOL_ICONS[meta.key];
  return (
    <TooltipIconButton
      label={t(meta.labelKey)}
      active={active}
      testId={`${testIdPrefix}-${meta.key}`}
      onClick={() => onSelect(meta.key)}
    >
      <Icon />
    </TooltipIconButton>
  );
}

export function ToolButtons({
  tools,
  value,
  onChange,
  className,
  testIdPrefix,
}: {
  tools: readonly AnnotationToolMeta[];
  value: AnnotationTool | null;
  onChange: (tool: AnnotationTool) => void;
  className?: string;
  testIdPrefix?: string;
}) {
  return (
    <ButtonGroup className={cn("flex-nowrap", className)}>
      {tools.map((m) => (
        <ToolButton
          key={m.key}
          meta={m}
          active={value === m.key}
          onSelect={onChange}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </ButtonGroup>
  );
}

export function ColorSwatches({
  value,
  onChange,
  disabled,
  className,
  testIdPrefix = "annotation-color",
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  className?: string;
  testIdPrefix?: string;
}) {
  const t = useT();
  return (
    <ButtonGroup className={cn("flex-nowrap", className)}>
      {ANNOTATION_COLORS.map((c, i) => {
        const active = value === c;
        return (
          <TooltipIconButton
            key={c}
            label={t(COLOR_LABEL_KEYS[i])}
            active={active}
            disabled={disabled}
            testId={`${testIdPrefix}-${i}`}
            onClick={() => onChange(c)}
          >
            <span
              className="h-4 w-4 rounded-full border"
              style={{ backgroundColor: c }}
            />
          </TooltipIconButton>
        );
      })}
    </ButtonGroup>
  );
}

export function ThicknessButtons({
  value,
  onChange,
  disabled,
  className,
  testIdPrefix = "annotation-thickness",
}: {
  value: ThicknessKey;
  onChange: (key: ThicknessKey) => void;
  disabled?: boolean;
  className?: string;
  testIdPrefix?: string;
}) {
  const t = useT();
  return (
    <ButtonGroup className={cn("flex-nowrap", className)}>
      {THICKNESS_KEYS.map((key) => {
        const active = value === key;
        return (
          <TooltipIconButton
            key={key}
            label={t(THICKNESS_LABEL_KEYS[key])}
            active={active}
            disabled={disabled}
            testId={`${testIdPrefix}-${key}`}
            onClick={() => onChange(key)}
          >
            <Minus strokeWidth={THICKNESS_STROKE[key]} />
          </TooltipIconButton>
        );
      })}
    </ButtonGroup>
  );
}

export function TextSizeButtons({
  value,
  onChange,
  disabled,
  className,
  testIdPrefix = "annotation-textsize",
}: {
  value: TextSizeKey;
  onChange: (key: TextSizeKey) => void;
  disabled?: boolean;
  className?: string;
  testIdPrefix?: string;
}) {
  const t = useT();
  return (
    <ButtonGroup className={cn("flex-nowrap", className)}>
      {TEXT_SIZE_KEYS.map((key) => {
        const active = value === key;
        return (
          <TooltipIconButton
            key={key}
            label={t(TEXTSIZE_LABEL_KEYS[key])}
            active={active}
            disabled={disabled}
            testId={`${testIdPrefix}-${key}`}
            onClick={() => onChange(key)}
          >
            <span
              className="font-semibold leading-none"
              style={{ fontSize: TEXTSIZE_ICON[key] }}
            >
              A
            </span>
          </TooltipIconButton>
        );
      })}
    </ButtonGroup>
  );
}
