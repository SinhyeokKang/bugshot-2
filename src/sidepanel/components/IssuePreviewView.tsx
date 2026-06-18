import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/sidepanel/components/Section";
import { renderMarkdown } from "@/sidepanel/lib/renderMarkdown";
import { composePreviewLayout } from "@/sidepanel/lib/composePreviewLayout";
import "./doc-section-body.css";

const EMPTY_POST_MEDIA: Set<string> = new Set();

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
  postMediaSectionIds?: Set<string>;
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
  // 슬롯(media/logCards) 삽입 위치. log-viewer Report 탭은 슬롯이 없어 무관 → 기본 빈 set.
  // PreviewPanel은 POST_MEDIA_SECTION_IDS를 명시 전달(settings-ui-store 의존을 log-viewer 번들에서 격리).
  postMediaSectionIds = EMPTY_POST_MEDIA,
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
        sectionIds: sections.map((s) => s.id),
        postMediaSectionIds,
        hasMedia,
        hasLogCards,
      }),
    [sections, postMediaSectionIds, hasMedia, hasLogCards],
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
            <PreviewSectionBody section={sec} emptyValue={labels.emptyValue} />
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
}: {
  section: IssuePreviewViewSection;
  emptyValue: string;
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
  return (
    <div
      className="doc-section-body break-words text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(section.value) }}
    />
  );
}
