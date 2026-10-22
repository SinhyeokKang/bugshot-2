import { useRef, type RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Square } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { aiLoadingPhraseKey, type AiLoadingSurface } from "../lib/aiLoadingPhrases";
import { AiLoadingText } from "./AiLoadingText";

const AI_OVERLAY_STYLE: Record<
  AiLoadingSurface,
  { tint: string; ripple: string; text: string; button: string }
> = {
  styling: {
    tint: "bg-teal-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(45,212,191,0.1)_46%,transparent_141%)]",
    text: "text-teal-700 dark:text-teal-300",
    button:
      "bg-teal-500/20 text-teal-700 hover:bg-teal-500/30 hover:text-teal-800 dark:bg-teal-400/20 dark:text-teal-300 dark:hover:bg-teal-400/30 dark:hover:text-teal-200",
  },
  draft: {
    tint: "bg-purple-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(192,132,252,0.1)_46%,transparent_141%)]",
    text: "text-purple-700 dark:text-purple-300",
    button:
      "bg-purple-500/20 text-purple-700 hover:bg-purple-500/30 hover:text-purple-800 dark:bg-purple-400/20 dark:text-purple-300 dark:hover:bg-purple-400/30 dark:hover:text-purple-200",
  },
  repro: {
    tint: "bg-amber-500/5",
    ripple: "bg-[radial-gradient(circle,transparent_0%,rgba(251,191,36,0.1)_46%,transparent_141%)]",
    text: "text-amber-700 dark:text-amber-300",
    button:
      "bg-amber-500/20 text-amber-700 hover:bg-amber-500/30 hover:text-amber-800 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30 dark:hover:text-amber-200",
  },
};

export function AiLoadingOverlay({
  surface, step, onCancel, fallbackFocusRef,
}: {
  surface: AiLoadingSurface;
  step: number;
  onCancel: () => void;
  fallbackFocusRef: RefObject<HTMLButtonElement>;
}) {
  const t = useT();
  const previousFocus = useRef(document.activeElement);

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-modal="true"
          data-testid="ai-loading-overlay"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = previousFocus.current;
            if (
              previous instanceof HTMLElement && previous.isConnected && previous !== document.body &&
              !previous.closest('[role="dialog"][data-state="closed"]')
            ) {
              previous.focus();
            }
            if (document.activeElement === document.body) fallbackFocusRef.current?.focus();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-[2px] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{t(aiLoadingPhraseKey(surface, 0))}</DialogPrimitive.Title>
          <div className={cn("absolute inset-0", AI_OVERLAY_STYLE[surface].tint)} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              key={step}
              className={cn(
                "h-[240vh] w-[240vh] animate-ai-ripple rounded-full blur-3xl motion-reduce:animate-none",
                AI_OVERLAY_STYLE[surface].ripple,
              )}
            />
          </div>
          <div className="relative z-10 flex animate-text-breathe items-center justify-center px-6 motion-reduce:animate-none">
            <AiLoadingText
              text={t(aiLoadingPhraseKey(surface, step))}
              className={cn("text-xl font-semibold", AI_OVERLAY_STYLE[surface].text)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid="ai-loading-stop"
            className={cn(
              "absolute bottom-8 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full shadow-sm [&_svg]:size-3.5",
              AI_OVERLAY_STYLE[surface].button,
            )}
          >
            <Square className="fill-current" />
            {t("ai.stop")}
          </Button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
