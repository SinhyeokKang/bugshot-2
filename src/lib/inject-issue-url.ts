export function injectIssueUrl(
  logsDataUrl: string,
  issueUrl: string,
): string {
  const m = /^data:(.*?);base64,(.+)$/.exec(logsDataUrl);
  if (!m) return logsDataUrl;

  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const html = new TextDecoder().decode(bytes);

  const tag =
    /(<script id="__BUGSHOT_DATA__" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const sm = html.match(tag);
  if (!sm) return logsDataUrl;

  try {
    const data = JSON.parse(sm[2]);
    data.meta.issueUrl = issueUrl;
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    const newHtml = html.replace(tag, `${sm[1]}${json}${sm[3]}`);
    const enc = new TextEncoder().encode(newHtml);
    let b = "";
    for (let i = 0; i < enc.length; i++) b += String.fromCharCode(enc[i]);
    return `data:${m[1]};base64,${btoa(b)}`;
  } catch {
    return logsDataUrl;
  }
}
