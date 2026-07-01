import { Toaster as Sonner, toast } from "sonner"
import { useSettingsUiStore } from "@/store/settings-ui-store"

type ToasterProps = Omit<React.ComponentProps<typeof Sonner>, "theme">

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSettingsUiStore((s) => s.theme);

  return (
    // 토스트를 클릭하면 즉시 닫는다(capture). sonner는 호출 옵션에 onClick이 없어 DOM에서 가로챈다.
    // 동시 노출 토스트가 보통 1개라 dismiss() 전체로 충분. 호버 커서는 classNames.toast의 cursor-pointer.
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("[data-sonner-toast]")) toast.dismiss();
      }}
    >
      <Sonner
        theme={theme}
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              "group toast cursor-pointer group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl",
            description: "group-[.toast]:text-muted-foreground",
            actionButton:
              "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton:
              "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          },
        }}
        {...props}
      />
    </div>
  )
}

export { Toaster }
