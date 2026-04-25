import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export function CancelConfirmDialog({ onConfirm }: { onConfirm: () => void }) {
  const t = useT();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="lg" variant="outline" className="text-destructive">
          {t("cancelConfirm.trigger")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cancelConfirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("cancelConfirm.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("cancelConfirm.trigger")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
