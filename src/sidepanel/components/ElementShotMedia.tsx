import { toast } from "sonner";
import { useRef } from "react";
import { ImageActions } from "./ImageActions";
import { useT } from "@/i18n";
import { downloadImageUrl } from "@/sidepanel/lib/downloadCapture";

export interface ElementShotMediaItem {
  id: string;
  url: string | null;
  annotated?: boolean;
}

export function ElementShotMedia({ items, busy, onEdit, onReset, onDelete }: {
  items: ElementShotMediaItem[];
  busy?: boolean;
  onEdit?: (id: string) => void;
  onReset?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  return <div ref={listRef} className="flex flex-col gap-3" aria-busy={busy}>
    {items.map((item, index) => <div key={item.id} data-testid="element-shot-item" data-shot-id={item.id}
      className="relative min-h-12 overflow-hidden rounded-lg border bg-background">
      <ImageActions className="absolute right-2 top-2"
        ariaDisabled={busy} downloadDisabled={!item.url}
        testIds={{ annotate: "annotation-edit", reset: "annotation-remove", download: "download-media", delete: "element-shot-delete" }}
        onAnnotate={onEdit ? () => onEdit(item.id) : undefined}
        onReset={item.annotated && onReset ? () => onReset(item.id) : undefined}
        onDownload={() => {
          if (item.url) void downloadImageUrl(item.url, `screenshot-${index + 1}`).catch(() => toast.error(t("recovery.localMissing")));
        }}
        onDelete={onDelete && items.length > 1 ? () => {
          const next = listRef.current?.children[index + 1] ?? listRef.current?.children[index - 1];
          onDelete(item.id);
          next?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        } : undefined}
      />
      {item.url ? <img src={item.url} alt={t("alt.capturedImage")} className="block h-auto w-full"
        data-testid="media-preview-img" /> : <p className="p-3 text-sm text-muted-foreground">{t("recovery.localMissing")}</p>}
    </div>)}
  </div>;
}
