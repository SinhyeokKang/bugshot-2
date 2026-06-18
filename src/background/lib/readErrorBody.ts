// 에러 응답 본문을 JSON 우선 파싱, 실패 시 원문, read 자체 실패 시 undefined.
export async function readErrorBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}
