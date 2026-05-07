interface Env {
  ATLASSIAN_CLIENT_ID: string;
  ATLASSIAN_CLIENT_SECRET: string;
  // GitHub OAuth — DEV/PROD 두 OAuth App을 동시 운영. 클라이언트가 보낸 client_id로 매칭.
  // 한 쪽만 등록돼 있으면(예: DEV만) 그것만 매칭 가능. 둘 다 빈값이면 503.
  GITHUB_CLIENT_ID_DEV?: string;
  GITHUB_CLIENT_SECRET_DEV?: string;
  GITHUB_CLIENT_ID_PROD?: string;
  GITHUB_CLIENT_SECRET_PROD?: string;
  // Notion OAuth — public integration. App 1개에 dev/prod redirect URI 둘 다 등록.
  NOTION_CLIENT_ID?: string;
  NOTION_CLIENT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

interface TokenRequestBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
  client_id?: string;
}

const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env, fetch);
  },
};

export async function handleRequest(
  req: Request,
  env: Env,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const origin = req.headers.get("Origin") ?? "";
  const corsOrigin = resolveCorsOrigin(origin, env.ALLOWED_ORIGINS);
  const allowed = corsOrigin !== "null";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: allowed ? 204 : 403,
      headers: corsHeaders(corsOrigin),
    });
  }

  if (!allowed) return jsonError(403, "origin not allowed", corsOrigin);

  const url = new URL(req.url);
  if (req.method !== "POST") return jsonError(404, "not found", corsOrigin);

  if (url.pathname === "/token") {
    return handleAtlassianToken(req, env, corsOrigin, fetchImpl);
  }
  if (url.pathname === "/github/token") {
    return handleGithubToken(req, env, corsOrigin, fetchImpl);
  }
  if (url.pathname === "/github/refresh") {
    return handleGithubRefresh(req, env, corsOrigin, fetchImpl);
  }
  if (url.pathname === "/notion/token") {
    return handleNotionToken(req, env, corsOrigin, fetchImpl);
  }
  return jsonError(404, "not found", corsOrigin);
}

async function handleNotionToken(
  req: Request,
  env: Env,
  corsOrigin: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return jsonError(400, "invalid JSON body", corsOrigin);
  }
  if (!body.code || !body.redirect_uri) {
    return jsonError(400, "missing code or redirect_uri", corsOrigin);
  }
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    return jsonError(503, "notion oauth not configured", corsOrigin);
  }
  if (body.client_id && body.client_id !== env.NOTION_CLIENT_ID) {
    return jsonError(400, "client_id not registered", corsOrigin);
  }
  const basic = btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`);
  const upstream = await fetchImpl(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: body.code,
      redirect_uri: body.redirect_uri,
    }),
  });
  return relayUpstream(upstream, corsOrigin);
}

async function handleAtlassianToken(
  req: Request,
  env: Env,
  corsOrigin: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return jsonError(400, "invalid JSON body", corsOrigin);
  }

  const forward: Record<string, string> = {
    client_id: env.ATLASSIAN_CLIENT_ID,
    client_secret: env.ATLASSIAN_CLIENT_SECRET,
  };

  if (body.grant_type === "authorization_code") {
    if (!body.code || !body.redirect_uri) {
      return jsonError(400, "missing code or redirect_uri", corsOrigin);
    }
    forward.grant_type = body.grant_type;
    forward.code = body.code;
    forward.redirect_uri = body.redirect_uri;
  } else if (body.grant_type === "refresh_token") {
    if (!body.refresh_token) {
      return jsonError(400, "missing refresh_token", corsOrigin);
    }
    forward.grant_type = body.grant_type;
    forward.refresh_token = body.refresh_token;
  } else {
    return jsonError(400, "unsupported grant_type", corsOrigin);
  }

  const upstream = await fetchImpl(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(forward),
  });
  return relayUpstream(upstream, corsOrigin);
}

interface GithubAppCreds {
  clientId: string;
  clientSecret: string;
}

export function resolveGithubApp(
  env: Env,
  requestClientId: string | undefined,
): GithubAppCreds | { error: string; status: number } {
  const apps: GithubAppCreds[] = [];
  if (env.GITHUB_CLIENT_ID_DEV && env.GITHUB_CLIENT_SECRET_DEV) {
    apps.push({
      clientId: env.GITHUB_CLIENT_ID_DEV,
      clientSecret: env.GITHUB_CLIENT_SECRET_DEV,
    });
  }
  if (env.GITHUB_CLIENT_ID_PROD && env.GITHUB_CLIENT_SECRET_PROD) {
    apps.push({
      clientId: env.GITHUB_CLIENT_ID_PROD,
      clientSecret: env.GITHUB_CLIENT_SECRET_PROD,
    });
  }
  if (apps.length === 0) {
    return { error: "github oauth not configured", status: 503 };
  }
  if (!requestClientId) {
    return { error: "missing client_id", status: 400 };
  }
  const matched = apps.find((a) => a.clientId === requestClientId);
  if (!matched) {
    return { error: "client_id not registered", status: 400 };
  }
  return matched;
}

async function handleGithubToken(
  req: Request,
  env: Env,
  corsOrigin: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return jsonError(400, "invalid JSON body", corsOrigin);
  }
  if (!body.code || !body.redirect_uri) {
    return jsonError(400, "missing code or redirect_uri", corsOrigin);
  }
  const app = resolveGithubApp(env, body.client_id);
  if ("error" in app) return jsonError(app.status, app.error, corsOrigin);

  const upstream = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: body.code,
      redirect_uri: body.redirect_uri,
    }),
  });
  return relayUpstream(upstream, corsOrigin);
}

async function handleGithubRefresh(
  req: Request,
  env: Env,
  corsOrigin: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return jsonError(400, "invalid JSON body", corsOrigin);
  }
  if (!body.refresh_token) {
    return jsonError(400, "missing refresh_token", corsOrigin);
  }
  const app = resolveGithubApp(env, body.client_id);
  if ("error" in app) return jsonError(app.status, app.error, corsOrigin);

  const upstream = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
    }),
  });
  return relayUpstream(upstream, corsOrigin);
}

async function relayUpstream(upstream: Response, corsOrigin: string): Promise<Response> {
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      ...corsHeaders(corsOrigin),
    },
  });
}

export function resolveCorsOrigin(origin: string, allowedEnv: string | undefined): string {
  const list = (allowedEnv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return "null";
  if (list.includes("*")) return origin || "*";
  if (origin && list.includes(origin)) return origin;
  return "null";
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonError(status: number, message: string, corsOrigin: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(corsOrigin),
    },
  });
}
