import { Toaster as Sonner } from "sonner"
import { useSettingsUiStore } from "@/store/settings-ui-store"

type ToasterProps = Omit<React.ComponentProps<typeof Sonner>, "theme">

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSettingsUiStore((s) => s.theme);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
