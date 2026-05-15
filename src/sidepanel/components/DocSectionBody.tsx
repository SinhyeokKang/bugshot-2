import { useState, useEffect, useRef, useMemo } from "react";
import { useT } from "@/i18n";
import type { IssueSection } from "@/store/settings-ui-store";
import { getInlineImage } from "@/store/blob-db";
import {
  extractInlineRefs,
  replaceInlineRefs,
} from "@/sidepanel/lib/resolveInlineImages";
import { renderMarkdown } from "@/sidepanel/lib/renderMarkdown";
import "./doc-section-body.css";

export function DocSectionBody({
  section,
  value,
  emptyVariant = "muted",
}: {
  section: IssueSection;
  value: string;
  emptyVariant?: "muted" | "hide";
}) {
  const t = useT();
  if (section.renderAs === "orderedList") {
    const items = value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      if (emptyVariant === "hide") return null;
      return (
        <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>
      );
    }
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        {items.map((it, idx) => (
          <li key={idx}>{it}</li>
        ))}
      </ol>
    );
  }
  if (!value.trim()) {
    if (emptyVariant === "hide") return null;
    return <p className="text-sm text-muted-foreground/70">{t("common.empty")}</p>;
  }
  return <MarkdownBody value={value} />;
}

function MarkdownBody({ value }: { value: string }) {
  const [resolvedValue, setResolvedValue] = useState(value);
  const prevBlobUrls = useRef<string[]>([]);

  useEffect(() => {
    const refs = extractInlineRefs(value);
    if (refs.length === 0) {
      for (const url of prevBlobUrls.current) URL.revokeObjectURL(url);
      prevBlobUrls.current = [];
      setResolvedValue(value);
      return;
    }

    let cancelled = false;
    const newBlobUrls: string[] = [];

    (async () => {
      const refToUrl = new Map<string, string>();
      await Promise.all(
        refs.map(async (refId) => {
          const blob = await getInlineImage(refId);
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          newBlobUrls.push(url);
          refToUrl.set(refId, url);
        }),
      );
      if (cancelled) {
        for (const url of newBlobUrls) URL.revokeObjectURL(url);
        return;
      }
      for (const url of prevBlobUrls.current) URL.revokeObjectURL(url);
      prevBlobUrls.current = newBlobUrls;
      setResolvedValue(replaceInlineRefs(value, refToUrl));
    })();

    return () => {
      cancelled = true;
    };
  }, [value]);

  useEffect(() => {
    return () => {
      for (const url of prevBlobUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  const html = useMemo(() => renderMarkdown(resolvedValue), [resolvedValue]);

  return (
    <div
      className="doc-section-body break-words text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
