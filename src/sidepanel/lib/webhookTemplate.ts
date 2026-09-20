export interface WebhookTemplateVars {
  title: string;
  body: string;
  url: string;
  env: { os?: string; browser?: string; viewport?: string; selector?: string };
  capturedAt?: string;
  logSummary?: string;
  sections: Record<string, string>;
  media: {
    count: number;
    // dataUri는 없다. json 모드는 미디어를 바디에 싣지 않으므로(PRD 비목표) 이 축을
    // 템플릿에 노출하면 저장은 통과하고 제출에서 100% 터지는 변수가 생긴다.
    items: { filename: string; contentType: string }[];
  };
}

export type TemplateIssue =
  | { kind: "invalid-json"; message: string }
  | { kind: "unknown-var"; name: string };

export class WebhookTemplateError extends Error {
  constructor(readonly issue: TemplateIssue) {
    super(issue.kind === "unknown-var" ? issue.name : issue.message);
    this.name = "WebhookTemplateError";
  }
}

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

// 화이트리스트를 경로 접두사로 둔다 — 열거하면 media 인덱스처럼 동적인 꼬리를 못 담는다.
const ALLOWED_ROOTS = ["title", "body", "url", "capturedAt", "logSummary"];
const ALLOWED_ENV = ["os", "browser", "viewport", "selector"];
const MEDIA_FIELDS = ["filename", "contentType"];
// media.<index>.<field> — 판정(isAllowedPath)과 조회(readPath)가 같은 셰이프를 봐야 한다.
// 정규식을 양쪽에 복제하면 한쪽만 고쳐도 무음으로 갈린다.
const MEDIA_ITEM = /^media\.(\d+)\.(\w+)$/;

function isAllowedPath(path: string): boolean {
  const parts = path.split(".");
  const [head, ...rest] = parts;
  if (ALLOWED_ROOTS.includes(head)) return rest.length === 0;
  if (head === "env") return rest.length === 1 && ALLOWED_ENV.includes(rest[0]);
  if (head === "sections") return rest.length === 1 && rest[0].length > 0;
  if (head === "media") {
    if (rest.length === 1) return rest[0] === "count";
    const m = MEDIA_ITEM.exec(path);
    if (m) return MEDIA_FIELDS.includes(m[2]);
  }
  return false;
}

function readPath(path: string, vars: WebhookTemplateVars): unknown {
  // sections는 사용자 섹션 id가 키라 임의 문자열이 온다. hasOwn 없이 읽으면
  // {{sections.constructor}}가 프로토타입을 타고 함수 소스를 본문에 싣는다.
  const section = /^sections\.(.+)$/.exec(path);
  if (section) {
    return Object.hasOwn(vars.sections, section[1]) ? vars.sections[section[1]] : undefined;
  }
  // media.<index>.<field>는 템플릿 표기이고 실제 값은 media.items[index]에 있다.
  const media = MEDIA_ITEM.exec(path);
  if (media) {
    const item = vars.media.items[Number(media[1])];
    return item ? (item as unknown as Record<string, unknown>)[media[2]] : undefined;
  }
  const parts = path.split(".");
  let cur: unknown = vars;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function walk(node: unknown, visitLeaf: (s: string) => unknown): unknown {
  if (typeof node === "string") return visitLeaf(node);
  if (Array.isArray(node)) return node.map((n) => walk(n, visitLeaf));
  if (node && typeof node === "object") {
    // 키는 치환하지 않는다 — 문자열 리프만 본다.
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v, visitLeaf)]),
    );
  }
  return node;
}

// 저장 시점 게이트. 제출 시점에 처음 알게 되는 일이 없어야 한다.
export function parseWebhookTemplate(src: string): { ok: boolean; issues: TemplateIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(src);
  } catch (e) {
    return { ok: false, issues: [{ kind: "invalid-json", message: (e as Error).message }] };
  }

  const issues: TemplateIssue[] = [];
  walk(parsed, (leaf) => {
    for (const m of leaf.matchAll(PLACEHOLDER)) {
      const name = m[1].trim();
      if (!isAllowedPath(name)) issues.push({ kind: "unknown-var", name });
    }
    return leaf;
  });
  return { ok: issues.length === 0, issues };
}

// JSON.parse를 **먼저** 하고 문자열 리프 안에서만 치환한다. 문자열 단계에서 치환하면
// 본문의 따옴표·개행 하나에 JSON이 부서지고, 그 실패가 사용자 본문 내용에 의존해
// 재현이 불규칙해진다.
export function renderWebhookTemplate(src: string, vars: WebhookTemplateVars): unknown {
  const parsed = JSON.parse(src);

  return walk(parsed, (leaf) => {
    const whole = /^\{\{([^{}]+)\}\}$/.exec(leaf);
    if (whole) {
      // 리프 전체가 하나의 placeholder면 타입을 보존한다({{media.count}} → number).
      return resolve(whole[1].trim(), vars);
    }
    return leaf.replace(PLACEHOLDER, (_, raw: string) => {
      const v = resolve(raw.trim(), vars);
      return v == null ? "" : String(v);
    });
  });
}

function resolve(path: string, vars: WebhookTemplateVars): unknown {
  if (!isAllowedPath(path)) throw new WebhookTemplateError({ kind: "unknown-var", name: path });
  const value = readPath(path, vars);
  // media 인덱스는 저장 시점에 검증할 수 없다(미디어 수는 리포트마다 다르다). 없는 인덱스를
  // 빈 문자열로 치환하면 수신 서버가 빈 파일명을 받고도 모른다 — 명시적으로 터뜨린다.
  if (value === undefined && path.startsWith("media.")) {
    throw new WebhookTemplateError({ kind: "unknown-var", name: path });
  }
  return value;
}
