import type { NetworkLog, NetworkRequest, NetworkRequestBody } from "@/types/network";

function headersToHar(headers: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function formatBytesHar(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function bodyToHarContent(
  body: NetworkRequestBody | undefined,
  contentType: string,
  size: number,
): { size: number; mimeType: string; text?: string; comment?: string } {
  if (body === undefined) {
    return { size, mimeType: contentType || "application/octet-stream" };
  }
  if (typeof body === "string") {
    return { size: body.length, mimeType: contentType || "text/plain", text: body };
  }
  let comment: string | undefined;
  switch (body.kind) {
    case "truncated":
      comment = `Body truncated (${formatBytesHar(body.size)} exceeded ${formatBytesHar(body.limit)} cap)`;
      break;
    case "binary":
      comment = `Binary content — body not captured (${body.contentType || "unknown"}, ${formatBytesHar(body.size)})`;
      break;
    case "stream":
      comment = `Streaming response — body not captured (${body.contentType || "unknown"})`;
      break;
    case "omitted":
      comment = "Body omitted (memory cap)";
      break;
  }
  return { size, mimeType: contentType || "application/octet-stream", comment };
}

function requestToEntry(req: NetworkRequest) {
  const url = req.url;
  let queryString: { name: string; value: string }[] = [];
  try {
    const u = new URL(url);
    u.searchParams.forEach((value, name) => {
      queryString.push({ name, value });
    });
  } catch { /* invalid URL */ }

  const resContent = bodyToHarContent(req.responseBody, req.contentType, req.responseBodySize);

  let postData: { mimeType: string; text: string; comment?: string } | undefined;
  if (req.requestBody !== undefined) {
    postData = {
      mimeType: req.requestHeaders["content-type"] || "",
      text: typeof req.requestBody === "string" ? req.requestBody : "",
    };
    if (typeof req.requestBody !== "string") {
      postData.comment = bodyToHarContent(req.requestBody, "", req.requestBodySize).comment;
    }
  }

  return {
    startedDateTime: new Date(req.startTime).toISOString(),
    time: req.durationMs,
    request: {
      method: req.method,
      url: req.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(req.requestHeaders),
      queryString,
      postData,
      headersSize: -1,
      bodySize: req.requestBodySize,
    },
    response: {
      status: req.status,
      statusText: req.statusText,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(req.responseHeaders),
      content: resContent,
      redirectURL: "",
      headersSize: -1,
      bodySize: req.responseBodySize,
    },
    cache: {},
    timings: {
      send: 0,
      wait: req.durationMs,
      receive: 0,
      blocked: -1,
      dns: -1,
      connect: -1,
      ssl: -1,
    },
    _bugshot: {
      id: req.id,
      pageUrl: req.pageUrl,
      phase: req.phase,
      ...(typeof req.responseBody !== "string" && req.responseBody ? { responseBodyKind: req.responseBody.kind } : {}),
      ...(typeof req.requestBody !== "string" && req.requestBody ? { requestBodyKind: req.requestBody.kind } : {}),
    },
  };
}

export function buildHar(log: NetworkLog): object {
  const entries = log.requests.map(requestToEntry);

  return {
    log: {
      version: "1.2",
      creator: {
        name: "BugShot",
        version: chrome.runtime.getManifest().version,
      },
      entries,
    },
  };
}

export function serializeHar(har: object): string {
  return JSON.stringify(har, null, 2);
}

