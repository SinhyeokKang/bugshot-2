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
