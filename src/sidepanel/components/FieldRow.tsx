import type { ReactNode } from "react";

export function FieldRow({
  label,
  required,
  // 라벨 hover 툴팁 — 스타일 인스펙터가 이 행에 값의 출처(source)를 실어 보낸다.
  labelTitle,
  htmlFor,
  // 라벨 우측에 나란히 놓는 보조 조작 — connect 폼의 "토큰 발급" 링크가 유일한 소비처다.
  labelAction,
  children,
}: {
  label: string;
  required?: boolean;
  labelTitle?: string;
  htmlFor?: string;
  labelAction?: ReactNode;
  children: ReactNode;
}) {
  const labelEl = (
    <label
      className="text-xs text-muted-foreground"
      title={labelTitle}
      htmlFor={htmlFor}
    >
      {label}
      {required ? <span className="ml-0.5 text-destructive">*</span> : null}
    </label>
  );

  return (
    <div className="grid gap-1.5">
      {labelAction ? (
        <div className="flex items-center justify-between">
          {labelEl}
          {labelAction}
        </div>
      ) : (
        labelEl
      )}
      {children}
    </div>
  );
}
