import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/sidepanel/components/Section";
import { renderMarkdown } from "@/sidepanel/lib/renderMarkdown";
import { composePreviewLayout } from "@/sidepanel/lib/composePreviewLayout";
import { useCodeCollapse } from "@/sidepanel/hooks/useCodeCollapse";
import type { CodeCollapseLabels } from "@/sidepanel/lib/codeCollapseShell";
import "./doc-section-body.css";

export interface IssuePreviewViewSection {
  id: string;
  label: string;
  renderAs: "paragraph" | "orderedList";
  value: string; // inline 이미지가 dataURL로 미리 resolve된 본문
}

export interface IssuePreviewViewLabels {
  untitled: string;
  copyMarkdown: string;
  copied: string;
  emptyValue: string;
  envTitle: string;
  // 줄 수가 런타임 DOM에서 나오는데 이 컴포넌트는 i18n을 못 쓴다(키 네임스페이스가 표면마다
  // 달라 raw 키가 뜬다) → 셸의 라벨 묶음(expand는 템플릿 함수)을 그대로 받는다.
  code: CodeCollapseLabels;
}

export interface IssuePreviewViewProps {
  title: string;
  envRows: { label: string; value: string }[];
  sections: IssuePreviewViewSection[];
  labels: IssuePreviewViewLabels;
  onCopy?: () => void | Promise<void>;
  // media/logCards slot — PreviewPanel만 채움. Report 탭은 미전달.
  media?: React.ReactNode;
  logCards?: React.ReactNode;
  // 사용자 첨부 slot — 본문 모든 섹션 뒤 맨 하단. PreviewPanel만 채움(blob-db 의존 격리).
  attachments?: React.ReactNode;
  // 슬롯 위치를 포함한 순서 id 목록("media" 포함). PreviewPanel만 전달 —
  // 미지정이면 sections 순서를 그대로 쓴다(log-viewer Report 탭: 슬롯 없음).
  layoutSectionIds?: string[];
}

export function IssuePreviewView({
  title,
  envRows,
  sections,
  labels,
  onCopy,
  media,
  logCards,
  attachments,
  layoutSectionIds,
}: IssuePreviewViewProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const hasMedia = media != null;
  const hasLogCards = logCards != null;
  const layout = useMemo(
    () =>
      composePreviewLayout({
        sectionIds: layoutSectionIds ?? sections.map((s) => s.id),
        hasMedia,
        hasLogCards,
      }),
    [sections, layoutSectionIds, hasMedia, hasLogCards],
  );

  const handleCopy = async () => {
    if (!onCopy) return;
    await onCopy();
    setCopied(true);
  };

  return (
    <>
      <Section>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-tight">
            {title || (
              <span className="text-muted-foreground/70">{labels.untitled}</span>
            )}
          </h1>
          {onCopy ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopy()}
              className="shrink-0"
              aria-live="polite"
              data-testid="copy-markdown"
            >
              {copied ? <Check /> : <Copy />}
              {copied ? labels.copied : labels.copyMarkdown}
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title={labels.envTitle}>
        <div className="space-y-1 text-sm leading-relaxed">
          {envRows.map((r, i) => (
            <div
              key={`${r.label}-${i}`}
              className="flex gap-3"
              data-testid="env-row"
              data-env-label={r.label}
            >
              <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
              <span className="break-all">{r.value}</span>
            </div>
          ))}
        </div>
      </Section>

      {layout.map((entry) => {
        if (entry.kind === "media") return <React.Fragment key="__media">{media}</React.Fragment>;
        if (entry.kind === "logCards") return <React.Fragment key="__logCards">{logCards}</React.Fragment>;
        const sec = sections.find((s) => s.id === entry.id);
        if (!sec) return null;
        return (
          <Section key={sec.id} title={sec.label} testId={`preview-section-${sec.id}`}>
            <PreviewSectionBody
              section={sec}
              emptyValue={labels.emptyValue}
              codeLabels={labels.code}
            />
          </Section>
        );
      })}

      {attachments}
    </>
  );
}

function PreviewSectionBody({
  section,
  emptyValue,
  codeLabels,
}: {
  section: IssuePreviewViewSection;
  emptyValue: string;
  codeLabels: CodeCollapseLabels;
}) {
  if (section.renderAs === "orderedList") {
    const items = section.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground/70">{emptyValue}</p>;
    }
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        {items.map((it, idx) => (
          <li key={idx}>{it}</li>
        ))}
      </ol>
    );
  }
  if (!section.value.trim()) {
    return <p className="text-sm text-muted-foreground/70">{emptyValue}</p>;
  }
  return <PreviewMarkdownBody value={section.value} codeLabels={codeLabels} />;
}

function PreviewMarkdownBody({
  value,
  codeLabels,
}: {
  value: string;
  codeLabels: CodeCollapseLabels;
}) {
  // copied 토글(1.5초 타이머)마다 이 트리가 재렌더되므로 markdown-it 재실행을 막는다.
  // (셸 재생성 방지는 아니다 — html은 문자열이라 값이 같으면 [html] dep이 안 변한다.)
  const html = useMemo(() => renderMarkdown(value), [value]);
  const collapseRef = useCodeCollapse(html, codeLabels);
  return (
    <div
      ref={collapseRef}
      className="doc-section-body break-words text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
