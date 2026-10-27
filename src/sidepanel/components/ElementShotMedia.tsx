import { toast } from "sonner";
import { useRef, useState } from "react";
import { ImageActions } from "./ImageActions";
import { useT } from "@/i18n";
import { downloadImageUrl } from "@/sidepanel/lib/downloadCapture";

export interface ElementShotMediaItem {
  id: string;
  url: string | null;
  annotated?: boolean;
}

type ElementShotMediaProps = {
  items: ElementShotMediaItem[];
  busy?: boolean;
  onEdit?: (id: string) => void;
  onReset?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export function ElementShotMedia({ items, busy, onEdit, onReset, onDelete }: ElementShotMediaProps) {
  const listRef = useRef<HTMLDivElement>(null);
  return <div ref={listRef} className="flex flex-col gap-3" aria-busy={busy}>
    {items.map((item, index) => <ElementShotCard key={item.id} item={item} index={index} busy={busy}
      onEdit={onEdit} onReset={onReset}
      onDelete={onDelete && items.length > 1 ? () => {
        const next = listRef.current?.children[index + 1] ?? listRef.current?.children[index - 1];
        onDelete(item.id);
        (next as HTMLElement | undefined)?.focus({ preventScroll: true });
      } : undefined} />)}
  </div>;
}

function ElementShotCard({ item, index, busy, onEdit, onReset, onDelete }: {
  item: ElementShotMediaItem;
  index: number;
  busy?: boolean;
  onEdit?: (id: string) => void;
  onReset?: (id: string) => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <div ref={cardRef} data-testid="element-shot-item" data-shot-id={item.id}
    className="relative min-h-12 overflow-hidden rounded-lg border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    role="group" aria-label={t("alt.capturedImage")} tabIndex={0}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}>
    {hovered || focused ? <ImageActions className="absolute right-2 top-2"
      ariaDisabled={busy} downloadDisabled={!item.url}
      testIds={{ annotate: "annotation-edit", reset: "annotation-remove", download: "download-media", delete: "element-shot-delete" }}
      onAnnotate={onEdit ? () => onEdit(item.id) : undefined}
      onReset={item.annotated && onReset ? () => {
        onReset(item.id);
        cardRef.current?.focus();
      } : undefined}
      onDownload={() => {
        if (item.url) void downloadImageUrl(item.url, `screenshot-${index + 1}`).catch(() => toast.error(t("recovery.localMissing")));
      }}
      onDelete={onDelete}
    /> : null}
    {item.url ? <img src={item.url} alt={t("alt.capturedImage")} className="block h-auto w-full"
      data-testid="media-preview-img" /> : <p className="p-3 text-sm text-muted-foreground">{t("recovery.localMissing")}</p>}
  </div>;
}
