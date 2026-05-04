import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { t } from "@/i18n";

const ARRAY_CHUNK_SIZE = 100;
const STRING_TRUNCATE_LENGTH = 300;
const SEP = "\0";
const PREVIEW_MAX_ENTRIES = 5;

const VALUE_COLORS = {
  string: "text-red-700 dark:text-red-400",
  number: "text-blue-700 dark:text-blue-400",
  boolean: "text-blue-700 dark:text-blue-400",
  null: "text-muted-foreground italic",
  key: "text-purple-700 dark:text-purple-400",
} as const;

interface JsonTreeViewerProps {
  data: unknown;
  defaultExpandDepth?: number;
}

function buildInitialExpanded(data: unknown, maxDepth: number, path = "root", depth = 0): Set<string> {
  const set = new Set<string>();
  if (depth >= maxDepth) return set;
  if (data === null || typeof data !== "object") return set;

  set.add(path);
  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (value !== null && typeof value === "object") {
      const childPath = path + SEP + key;
      const childSet = buildInitialExpanded(value, maxDepth, childPath, depth + 1);
      for (const p of childSet) set.add(p);
    }
  }
  return set;
}

function inlinePreview(value: unknown, isArray: boolean): string {
  if (isArray) {
    const arr = value as unknown[];
    const parts = arr.slice(0, PREVIEW_MAX_ENTRIES).map(inlineValue);
    if (arr.length > PREVIEW_MAX_ENTRIES) parts.push("…");
    return `[${parts.join(", ")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const parts = keys.slice(0, PREVIEW_MAX_ENTRIES).map((k) => `${k}: ${inlineValue(obj[k])}`);
  if (keys.length > PREVIEW_MAX_ENTRIES) parts.push("…");
  return `{${parts.join(", ")}}`;
}

function inlineValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 30 ? `"${v.slice(0, 27)}…"` : `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") return `{…}`;
  return String(v);
}

export function JsonTreeViewer({ data, defaultExpandDepth = 1 }: JsonTreeViewerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    buildInitialExpanded(data, defaultExpandDepth)
  );

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <JsonNode value={data} path="root" depth={0} expanded={expanded} onToggle={toggle} isLast />
  );
}

function JsonNode({
  keyName,
  value,
  path,
  depth,
  expanded,
  onToggle,
  isLast,
}: {
  keyName?: string | number;
  value: unknown;
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  isLast: boolean;
}) {
  if (value === null) return <PrimitiveRow keyName={keyName} depth={depth} isLast={isLast} valueClass={VALUE_COLORS.null} display="null" />;
  if (typeof value === "string") return <StringRow keyName={keyName} value={value} depth={depth} isLast={isLast} />;
  if (typeof value === "number") return <PrimitiveRow keyName={keyName} depth={depth} isLast={isLast} valueClass={VALUE_COLORS.number} display={String(value)} />;
  if (typeof value === "boolean") return <PrimitiveRow keyName={keyName} depth={depth} isLast={isLast} valueClass={VALUE_COLORS.boolean} display={String(value)} />;

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as const)
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, v] as const);

  const isEmpty = entries.length === 0;
  const isOpen = expanded.has(path);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const comma = isLast ? "" : ",";
  const indent = depth * 12 + 4;

  if (isEmpty) {
    return (
      <div className="flex items-center gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: indent }}>
        <span className="inline-block h-4 w-4 shrink-0" />
        {keyName !== undefined && <KeyLabel keyName={keyName} />}
        <span className="text-muted-foreground">{openBracket}{closeBracket}{comma}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted"
        style={{ paddingLeft: indent }}
        onClick={() => onToggle(path)}
      >
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/15"
          onClick={(e) => { e.stopPropagation(); onToggle(path); }}
        >
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {keyName !== undefined && <KeyLabel keyName={keyName} />}
        <span className="min-w-0 truncate text-muted-foreground">{inlinePreview(value, isArray)}{comma}</span>
      </div>
      {isOpen && (
        <>
          {isArray
            ? <ArrayChildren entries={entries as [number, unknown][]} path={path} depth={depth} expanded={expanded} onToggle={onToggle} totalLength={entries.length} />
            : entries.map(([key, val], idx) => (
                <JsonNode
                  key={key as string}
                  keyName={key as string}
                  value={val}
                  path={path + SEP + key}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  isLast={idx === entries.length - 1}
                />
              ))
          }
        </>
      )}
    </div>
  );
}

function ArrayChildren({
  entries,
  path,
  depth,
  expanded,
  onToggle,
  totalLength,
}: {
  entries: [number, unknown][];
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  totalLength: number;
}) {
  const [visibleCount, setVisibleCount] = useState(ARRAY_CHUNK_SIZE);
  const visible = entries.slice(0, visibleCount);
  const remaining = totalLength - visibleCount;

  return (
    <>
      {visible.map(([idx, val]) => (
        <JsonNode
          key={idx}
          keyName={idx}
          value={val}
          path={path + SEP + idx}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          isLast={idx === totalLength - 1 && remaining <= 0}
        />
      ))}
      {remaining > 0 && (
        <div
          className="flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-[13px] text-blue-600 hover:underline dark:text-blue-400"
          style={{ paddingLeft: (depth + 1) * 12 + 4 }}
          onClick={() => setVisibleCount((c) => c + ARRAY_CHUNK_SIZE)}
        >
          <span className="inline-block h-4 w-4 shrink-0" />
          {t("json.moreItems", { n: remaining })}
        </div>
      )}
    </>
  );
}

function StringRow({
  keyName,
  value,
  depth,
  isLast,
}: {
  keyName?: string | number;
  value: string;
  depth: number;
  isLast: boolean;
}) {
  const [showFull, setShowFull] = useState(false);
  const truncated = value.length > STRING_TRUNCATE_LENGTH && !showFull;
  const display = truncated ? value.slice(0, 150) + "…" + value.slice(-50) : value;
  const comma = isLast ? "" : ",";

  return (
    <div className="flex items-start gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: depth * 12 + 4 }}>
      <span className="inline-block h-4 w-4 shrink-0" />
      {keyName !== undefined && <KeyLabel keyName={keyName} />}
      <span className={`min-w-0 break-all ${VALUE_COLORS.string}`}>"{display}"</span>
      <span className="text-muted-foreground">{comma}</span>
      {truncated && (
        <span
          className="shrink-0 cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => setShowFull(true)}
        >
          {t("json.showAll")}
        </span>
      )}
    </div>
  );
}

function PrimitiveRow({
  keyName,
  depth,
  isLast,
  valueClass,
  display,
}: {
  keyName?: string | number;
  depth: number;
  isLast: boolean;
  valueClass: string;
  display: string;
}) {
  const comma = isLast ? "" : ",";
  return (
    <div className="flex items-center gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: depth * 12 + 4 }}>
      <span className="inline-block h-4 w-4 shrink-0" />
      {keyName !== undefined && <KeyLabel keyName={keyName} />}
      <span className={valueClass}>{display}</span>
      <span className="text-muted-foreground">{comma}</span>
    </div>
  );
}

function KeyLabel({ keyName }: { keyName: string | number }) {
  return (
    <span className="shrink-0">
      <span className={VALUE_COLORS.key}>{keyName}</span>
      <span className="text-muted-foreground">: </span>
    </span>
  );
}
