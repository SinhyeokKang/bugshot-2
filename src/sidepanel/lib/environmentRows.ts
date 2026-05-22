import type { EnvironmentRow } from "@/types/environment";
import { formatTimestamp } from "./formatTimestamp";

export type { EnvironmentRow };

const CHROME_VERSION_RE = /(?<!\w)Chrome\/(\d[\d.]+)/;

export function parseChromeVersion(ua: string): string | null {
  const m = CHROME_VERSION_RE.exec(ua);
  return m ? `Chrome ${m[1]}` : null;
}

// label·value 둘 다 trim 후 비어있지 않은 row만 남긴다.
// value의 개행은 공백으로 치환 (마크다운 본문에서 새 불릿/문단으로 깨지는 것 방지).
export function filterEnvironmentRows(rows: EnvironmentRow[]): EnvironmentRow[] {
  return rows
    .map((r) => ({
      label: r.label.trim(),
      value: r.value.replace(/\r?\n/g, " ").trim(),
    }))
    .filter((r) => r.label !== "" && r.value !== "");
}

export interface ReadonlyEnvInput {
  browser?: string | null;
  url: string;
  selector?: string | null;
  viewport?: { w: number; h: number } | null;
  capturedAt?: number | null;
}

// 모드별 readonly 메타를 Page→DOM→Viewport→Captured 순으로 파생.
export function deriveReadonlyEnvRows(
  input: ReadonlyEnvInput,
): EnvironmentRow[] {
  const rows: EnvironmentRow[] = [];
  if (input.browser) {
    rows.push({ label: "Browser", value: input.browser });
  }
  rows.push({ label: "Page", value: input.url || "-" });
  if (input.selector) {
    rows.push({ label: "DOM", value: input.selector });
  }
  if (input.viewport) {
    rows.push({
      label: "Viewport",
      value: `${input.viewport.w}×${input.viewport.h}`,
    });
  }
  if (input.capturedAt != null) {
    rows.push({ label: "Captured", value: formatTimestamp(input.capturedAt) });
  }
  return rows;
}
