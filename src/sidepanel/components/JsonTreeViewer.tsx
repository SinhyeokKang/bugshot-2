import { useState, useCallback, useContext, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { HighlightedText, HighlightQueryContext } from "./HighlightedText";
import { JSON_TOKEN_CLASS } from "@/sidepanel/lib/highlightJson";

const ARRAY_CHUNK_SIZE = 100;
const STRING_TRUNCATE_LENGTH = 300;
const SEP = "\0";

interface JsonTreeViewerProps {
  data: unknown;
  defaultExpandDepth?: number;
  highlightQuery?: string;
}

// 검색어가 매칭되는 노드(키, 또는 String(value)가 매칭되는 문자열·숫자·불리언·null)를 드러내려면 열어야 하는 조상 컨테이너 path 집합.
// path 인코딩은 트리 내부와 동일(SEP·root·path+SEP+key, 배열 인덱스는 String).
export function collectMatchExpandedPaths(data: unknown, query: string): Set<string> {
  const paths = new Set<string>();
  if (!query) return paths;
  const q = query.toLowerCase();

  function walk(value: unknown, path: string, keyName?: string | number): boolean {
    const keyMatch = keyName !== undefined && String(keyName).toLowerCase().includes(q);
    if (value === null || typeof value !== "object") {
      // null도 트리에 "null"로 렌더되고 raw-body 검색도 매칭하므로 하이라이트/자동펼침 대상.
      const valueMatch = String(value).toLowerCase().includes(q);
      return keyMatch || valueMatch;
    }
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    let childMatch = false;
    for (const [k, v] of entries) {
      if (walk(v, path + SEP + k, k)) childMatch = true;
    }
    if (childMatch) paths.add(path);
    return keyMatch || childMatch;
  }

  walk(data, "root");
  return paths;
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


export function JsonTreeViewer({ data, defaultExpandDepth = 1, highlightQuery }: JsonTreeViewerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    buildInitialExpanded(data, defaultExpandDepth)
  );

  // 검색어 변경 시 매칭 조상을 최초 1회 펼침. 이후 사용자 collapse는 존중(강제 재펼침 안 함).
  useEffect(() => {
    if (!highlightQuery) return;
    const matchPaths = collectMatchExpandedPaths(data, highlightQuery);
    if (matchPaths.size) setExpanded((prev) => new Set([...prev, ...matchPaths]));
  }, [highlightQuery, data]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <HighlightQueryContext.Provider value={highlightQuery ?? ""}>
      <JsonNode value={data} path="root" depth={0} expanded={expanded} onToggle={toggle} />
    </HighlightQueryContext.Provider>
  );
}

function JsonNode({
  keyName,
  value,
  path,
  depth,
  expanded,
  onToggle,
}: {
  keyName?: string | number;
  value: unknown;
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  if (value === null) return <PrimitiveRow keyName={keyName} depth={depth} valueClass={JSON_TOKEN_CLASS.null} display="null" />;
  if (typeof value === "string") return <StringRow keyName={keyName} value={value} depth={depth} />;
  if (typeof value === "number") return <PrimitiveRow keyName={keyName} depth={depth} valueClass={JSON_TOKEN_CLASS.number} display={String(value)} />;
  if (typeof value === "boolean") return <PrimitiveRow keyName={keyName} depth={depth} valueClass={JSON_TOKEN_CLASS.boolean} display={String(value)} />;

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as const)
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, v] as const);

  const isEmpty = entries.length === 0;
  const isOpen = expanded.has(path);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const indent = depth * 12 + 4;

  if (isEmpty) {
    return (
      <div className="flex items-center gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: indent }}>
        <span className="inline-block h-4 w-4 shrink-0" />
        {keyName !== undefined && <KeyLabel keyName={keyName} />}
        <span className="text-muted-foreground">{openBracket}{closeBracket}</span>
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
        <span className="text-muted-foreground">{isArray ? `Array(${entries.length})` : `{${entries.length}}`}</span>
      </div>
      {isOpen && (
        <>
          {isArray
            ? <ArrayChildren entries={entries as [number, unknown][]} path={path} depth={depth} expanded={expanded} onToggle={onToggle} totalLength={entries.length} />
            : entries.map(([key, val]) => (
                <JsonNode
                  key={key as string}
                  keyName={key as string}
                  value={val}
                  path={path + SEP + key}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
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
  const t = useT();
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
}: {
  keyName?: string | number;
  value: string;
  depth: number;
}) {
  const t = useT();
  const q = useContext(HighlightQueryContext);
  const [showFull, setShowFull] = useState(false);
  const hasMatch = q !== "" && value.toLowerCase().includes(q.toLowerCase());
  const truncated = value.length > STRING_TRUNCATE_LENGTH && !showFull && !hasMatch;
  const display = truncated ? value.slice(0, 150) + "…" : value;

  return (
    <div className="flex items-start gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: depth * 12 + 4 }}>
      <span className="inline-block h-4 w-4 shrink-0" />
      {keyName !== undefined && <KeyLabel keyName={keyName} />}
      <div className="min-w-0">
        <span className={`break-all ${JSON_TOKEN_CLASS.string}`}>"<HighlightedText text={display} query={q} />"</span>
        {truncated && (
          <div>
            <span
              className="cursor-pointer text-xs text-foreground hover:underline"
              onClick={() => setShowFull(true)}
            >
              {t("json.showAll")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PrimitiveRow({
  keyName,
  depth,
  valueClass,
  display,
}: {
  keyName?: string | number;
  depth: number;
  valueClass: string;
  display: string;
}) {
  const q = useContext(HighlightQueryContext);
  return (
    <div className="flex items-center gap-1 py-0.5 pr-2 text-[13px] hover:bg-muted" style={{ paddingLeft: depth * 12 + 4 }}>
      <span className="inline-block h-4 w-4 shrink-0" />
      {keyName !== undefined && <KeyLabel keyName={keyName} />}
      <span className={valueClass}><HighlightedText text={display} query={q} /></span>
    </div>
  );
}

function KeyLabel({ keyName }: { keyName: string | number }) {
  const q = useContext(HighlightQueryContext);
  return (
    <span className="shrink-0">
      <span className={JSON_TOKEN_CLASS.key}><HighlightedText text={String(keyName)} query={q} /></span>
      <span className="text-muted-foreground">: </span>
    </span>
  );
}
