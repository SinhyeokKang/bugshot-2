export type MediaSource =
  | { kind: "media"; mediaId: string }
  | { kind: "external"; url: string };

export interface MediaDims {
  width?: number;
  height?: number;
}

// ADF media 노드. width/height(원본 픽셀)는 Jira가 종횡비를 잡는 데 쓰며,
// 둘 다 양수일 때만 주입한다(한쪽만 주면 렌더 비율이 깨짐).
export function adfMediaNode(src: MediaSource, dims?: MediaDims) {
  const attrs: Record<string, unknown> =
    src.kind === "media"
      ? { type: "file", id: src.mediaId, collection: "" }
      : { type: "external", url: src.url };
  if (dims && (dims.width ?? 0) > 0 && (dims.height ?? 0) > 0) {
    attrs.width = dims.width;
    attrs.height = dims.height;
  }
  return { type: "media", attrs };
}

// media 노드를 mediaSingle로 감싼다. media에 원본 픽셀(width/height)이 있으면
// width attr를 생략한다 — mediaSingle.width는 컨테이너 폭의 퍼센트라 값을 주면
// 작은 이미지도 본문 폭을 가득 채운다. 생략하면 Jira가 원본 크기로 렌더하고
// 컨테이너보다 클 때만 축소한다. 반대로 dims 측정에 실패해 원본 픽셀이 없으면
// Jira가 너무 작게 그리므로 width: 100으로 컨테이너에 맞춰 채운다.
export function adfMediaSingle(mediaNode: ReturnType<typeof adfMediaNode>) {
  const attrs = mediaNode.attrs as { width?: number; height?: number };
  const hasDims = (attrs.width ?? 0) > 0 && (attrs.height ?? 0) > 0;
  return {
    type: "mediaSingle",
    attrs: hasDims ? { layout: "align-start" } : { layout: "align-start", width: 100 },
    content: [mediaNode],
  };
}
