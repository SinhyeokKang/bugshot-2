import type { ReactNode } from "react";

export function FieldRow({
  label,
  required,
  // 라벨 hover 툴팁 — 스타일 인스펙터가 이 행에 값의 출처(source)를 실어 보낸다.
  labelTitle,
  children,
}: {
  label: string;
  required?: boolean;
  labelTitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs text-muted-foreground" title={labelTitle}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  );
}
