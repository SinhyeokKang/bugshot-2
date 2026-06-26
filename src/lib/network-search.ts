import type { NetworkRequest, NetworkRequestBody } from "@/types/network";

function bodyHas(body: NetworkRequestBody | undefined, lowerQuery: string): boolean {
  return typeof body === "string" && body.toLowerCase().includes(lowerQuery);
}

function headersHave(headers: Record<string, string>, lowerQuery: string): boolean {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase().includes(lowerQuery) || v.toLowerCase().includes(lowerQuery)) return true;
  }
  return false;
}

// lowerQuery는 비어있지 않고 이미 소문자임을 전제. 첫 매칭에서 즉시 반환(short-circuit).
export function requestMatchesQuery(req: NetworkRequest, lowerQuery: string): boolean {
  if (req.url.toLowerCase().includes(lowerQuery)) return true;
  if (bodyHas(req.requestBody, lowerQuery)) return true;
  if (bodyHas(req.responseBody, lowerQuery)) return true;
  if (headersHave(req.requestHeaders, lowerQuery)) return true;
  if (headersHave(req.responseHeaders, lowerQuery)) return true;
  return false;
}
