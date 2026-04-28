interface Env {
  ATLASSIAN_CLIENT_ID: string;
  ATLASSIAN_CLIENT_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

interface TokenRequestBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

const UPSTREAM_TOKEN_URL = "https://auth.atlassian.com/oauth/token";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const corsOrigin = resolveCorsOrigin(origin, env.ALLOWED_ORIGINS);
    const allowed = corsOrigin !== "null";

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: corsHeaders(corsOrigin),
      });
    }

    if (!allowed) {
      return jsonError(403, "origin not allowed", corsOrigin);
    }

    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/token") {
      return jsonError(404, "not found", corsOrigin);
    }

    let body: TokenRequestBody;
    try {
      body = (await req.json()) as TokenRequestBody;
    } catch {
      return jsonError(400, "invalid JSON body", corsOrigin);
    }

    const grant = body.grant_type;
    const forward: Record<string, string> = {
      client_id: env.ATLASSIAN_CLIENT_ID,
      client_secret: env.ATLASSIAN_CLIENT_SECRET,
    };

    if (grant === "authorization_code") {
      if (!body.code || !body.redirect_uri) {
        return jsonError(400, "missing code or redirect_uri", corsOrigin);
      }
      forward.grant_type = grant;
      forward.code = body.code;
      forward.redirect_uri = body.redirect_uri;
    } else if (grant === "refresh_token") {
      if (!body.refresh_token) {
        return jsonError(400, "missing refresh_token", corsOrigin);
      }
      forward.grant_type = grant;
      forward.refresh_token = body.refresh_token;
    } else {
      return jsonError(400, "unsupported grant_type", corsOrigin);
    }

    const upstream = await fetch(UPSTREAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(forward),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        ...corsHeaders(corsOrigin),
      },
    });
  },
};

function resolveCorsOrigin(origin: string, allowedEnv: string | undefined): string {
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
