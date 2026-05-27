const DATA_TAG =
  /(<script id="__BUGSHOT_DATA__" type="application\/json">)([\s\S]*?)(<\/script>)/;

// 49152 = 3의 배수라 청크별 btoa 결과를 그대로 이어 붙여도 유효한 base64가 된다(마지막 청크만 패딩).
// 영상 임베드(~20MB)에서 단일 거대 btoa·문자열 누적의 메인 스레드/SW 블로킹을 피한다.
const ENCODE_CHUNK = 0xc000;

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let out = "";
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    const slice = bytes.subarray(i, i + ENCODE_CHUNK);
    let binary = "";
    for (let j = 0; j < slice.length; j += 0x8000) {
      binary += String.fromCharCode(...slice.subarray(j, j + 0x8000));
    }
    out += btoa(binary);
    // 매 ~1MB마다 매크로태스크에 양보해 SW/UI가 다른 이벤트를 처리할 수 있게 한다.
    if (i % (ENCODE_CHUNK * 16) === 0) await new Promise((r) => setTimeout(r));
  }
  return out;
}

export async function injectIssueUrl(
  logsDataUrl: string,
  issueUrl: string,
): Promise<string> {
  const mime = /^data:(.*?);base64,/.exec(logsDataUrl)?.[1];
  if (mime === undefined) return logsDataUrl;

  // fetch(data:)로 디코딩 — 네이티브 비동기라 atob+TextDecoder 동기 변환을 대체한다.
  const html = await (await fetch(logsDataUrl)).text();

  const sm = html.match(DATA_TAG);
  if (!sm) return logsDataUrl;

  // buildLogsHtml이 meta의 마지막 키로 박아둔 빈 issueUrl 자리를 치환한다. meta는 data(=JSON)의
  // 마지막 top-level 키이고 issueUrl은 meta의 마지막 키이므로, 이 marker는 JSON 전체에서 항상
  // 가장 뒤에 위치한다 → 응답 본문·pageUrl 값에 같은 리터럴이 박혀도 lastIndexOf가 진짜를 잡는다.
  const json = sm[2];
  const marker = '"issueUrl":""';
  const idx = json.lastIndexOf(marker);
  if (idx === -1) return logsDataUrl;
  // buildLogsHtml과 동일하게 < 를 escape. JSON.stringify가 바깥 따옴표까지 포함한다.
  const urlLiteral = JSON.stringify(issueUrl).replace(/</g, "\\u003c");
  const newJson = `${json.slice(0, idx)}"issueUrl":${urlLiteral}${json.slice(idx + marker.length)}`;

  const newHtml = html.replace(DATA_TAG, () => `${sm[1]}${newJson}${sm[3]}`);
  return `data:${mime};base64,${await bytesToBase64(new TextEncoder().encode(newHtml))}`;
}
