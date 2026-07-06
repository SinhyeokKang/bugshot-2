import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";

export function OrderedListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const t = useT();
  const items = value.length === 0 ? [""] : value.split(/\r?\n/);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndexRef.current == null) return;
    const idx = focusIndexRef.current;
    focusIndexRef.current = null;
    const el = inputsRef.current[idx];
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [value]);

  const commit = (next: string[], focusIdx?: number) => {
    if (focusIdx != null) focusIndexRef.current = focusIdx;
    onChange(next.join("\n"));
  };

  const updateItem = (idx: number, text: string) => {
    const next = [...items];
    next[idx] = text;
    commit(next);
  };

  const addAfter = (idx: number) => {
    const next = [...items];
    next.splice(idx + 1, 0, "");
    commit(next, idx + 1);
  };

  const removeAt = (idx: number) => {
    if (items.length <= 1) return;
    const next = items.filter((_, i) => i !== idx);
    commit(next, Math.max(0, idx - 1));
  };

  return (
    <ol className="flex list-none flex-col gap-1.5">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="h-5 w-5 shrink-0 justify-center rounded-full p-0 tabular-nums"
          >
            {idx + 1}
          </Badge>
          <div className="flex flex-1 items-center gap-1">
            <Input
              ref={(el) => {
                inputsRef.current[idx] = el;
              }}
              value={item}
              onChange={(e) => updateItem(idx, e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(idx);
                } else if (
                  e.key === "Backspace" &&
                  item === "" &&
                  items.length > 1
                ) {
                  e.preventDefault();
                  removeAt(idx);
                }
              }}
              placeholder={idx === 0 ? placeholder : undefined}
              className="text-sm"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0 hover:text-destructive"
              disabled={items.length <= 1}
              onClick={() => removeAt(idx)}
              title={t("common.delete")}
            >
              <Trash2 />
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}
