import type { NetworkLog, NetworkRequest, NetworkRequestBody } from "@/types/network";

function headersToHar(headers: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
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
  const comment =
    body.kind === "truncated" ? "Body truncated (exceeded 1MB cap)" :
    body.kind === "binary" ? "Binary content — body not captured" :
    body.kind === "stream" ? "Streaming response — body not captured" :
    body.kind === "omitted" ? "Body omitted (memory cap)" :
    undefined;
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

