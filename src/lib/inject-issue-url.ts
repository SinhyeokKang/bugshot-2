import { bytesToBase64 } from "./gzip-base64";

// 제출 후 issueUrl/issueKey 마커는 평문 META 태그에만 있다(무거운 데이터는 gzip-base64라 미접근).
const META_TAG =
  /(<script id="__BUGSHOT_META__" type="application\/json">)([\s\S]*?)(<\/script>)/;

export async function injectIssueUrl(
  logsDataUrl: string,
  issueUrl: string,
  issueKey?: string,
): Promise<string> {
  const mime = /^data:(.*?);base64,/.exec(logsDataUrl)?.[1];
  if (mime === undefined) return logsDataUrl;

  const html = await (await fetch(logsDataUrl)).text();

  const sm = html.match(META_TAG);
  if (!sm) return logsDataUrl;

  let json = sm[2];

  if (issueKey) {
    const keyMarker = '"issueKey":""';
    const keyIdx = json.lastIndexOf(keyMarker);
    if (keyIdx !== -1) {
      const keyLiteral = JSON.stringify(issueKey).replace(/</g, "\\u003c");
      json = `${json.slice(0, keyIdx)}"issueKey":${keyLiteral}${json.slice(keyIdx + keyMarker.length)}`;
    }
  }

  const urlMarker = '"issueUrl":""';
  const urlIdx = json.lastIndexOf(urlMarker);
  if (urlIdx !== -1) {
    const urlLiteral = JSON.stringify(issueUrl).replace(/</g, "\\u003c");
    json = `${json.slice(0, urlIdx)}"issueUrl":${urlLiteral}${json.slice(urlIdx + urlMarker.length)}`;
  }

  const newHtml = html.replace(META_TAG, () => `${sm[1]}${json}${sm[3]}`);
  return `data:${mime};base64,${await bytesToBase64(new TextEncoder().encode(newHtml), { yield: true })}`;
}
