export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

export function PageScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-5">
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function PageFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 flex flex-col gap-2 border-t border-border/60 bg-background px-4 py-3">
      {children}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
      <div className="px-4">
        {title || action ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            {title ? (
              <h3 className="text-base font-semibold">{title}</h3>
            ) : (
              <span />
            )}
            {action}
          </div>
        ) : null}
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </section>
  );
}
