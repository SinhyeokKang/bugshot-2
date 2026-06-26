import type { ReactNode } from "react";

export function InlineLink({
  href,
  children,
  title,
  className,
  "data-testid": dataTestid,
}: {
  href: string;
  children?: ReactNode;
  title?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      data-testid={dataTestid}
      className={`text-blue-600 underline dark:text-blue-400${className ? ` ${className}` : ""}`}
    >
      {children ?? href}
    </a>
  );
}
