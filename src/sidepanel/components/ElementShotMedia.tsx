import { Download, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { downloadImageDataUrl } from "@/sidepanel/lib/downloadCapture";

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
  return <div className="flex flex-col gap-3" aria-busy={busy}>
    {items.map((item, index) => <div key={item.id} data-testid="element-shot-item" data-shot-id={item.id}
      className="min-h-12 overflow-hidden rounded-lg border bg-background">
      <div className="flex justify-end gap-1 bg-background p-2">
        {onEdit && <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"
          aria-label={t("draft.editAnnotation")} aria-disabled={busy}
          data-testid="annotation-edit" onClick={() => { if (!busy) onEdit(item.id); }}><Pencil /></Button>}
        {item.annotated && onReset && <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"
          aria-label={t("draft.removeAnnotation")} aria-disabled={busy}
          data-testid="annotation-remove" onClick={() => { if (!busy) onReset(item.id); }}><RotateCcw /></Button>}
        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={t("common.download")}
          aria-disabled={busy || !item.url} data-testid="download-media"
          onClick={() => { if (!busy && item.url) downloadImageDataUrl(item.url, `screenshot-${index + 1}`); }}><Download /></Button>
        {onDelete && items.length > 1 && <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"
          aria-label={t("common.delete")} aria-disabled={busy} data-testid="element-shot-delete"
          onClick={(event) => {
            if (busy) return;
            const list = event.currentTarget.closest('[data-testid="element-shot-item"]')?.parentElement;
            const next = list?.children[index + 1] ?? list?.children[index - 1];
            onDelete(item.id);
            next?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
          }}><Trash2 /></Button>}
      </div>
      {item.url ? <img src={item.url} alt={t("alt.capturedImage")} className="block h-auto w-full"
        data-testid="media-preview-img" /> : <p className="p-3 text-sm text-muted-foreground">{t("recovery.localMissing")}</p>}
    </div>)}
  </div>;
}
