import { describe, expect, it } from "vitest";

import { readErrorBody } from "../readErrorBody";

// 소비처 5파일(github/jira/gitlab/asana/clickup-api)이 이 반환값의 **형태로 분기**한다 —
// 객체면 필드를 꺼내고 문자열이면 그대로 메시지에 붙인다. 갈래를 안 고정하면 어느 쪽으로
// 떨어지는지가 조용히 바뀐다.
const resWith = (text: () => Promise<string>): Response => ({ text }) as Response;

describe("readErrorBody", () => {
  it("JSON 본문은 파싱된 객체로 준다", async () => {
    const res = resWith(async () => '{"message":"nope","code":42}');
    await expect(readErrorBody(res)).resolves.toEqual({ message: "nope", code: 42 });
  });

  it("비-JSON 본문은 원문 문자열로 준다", async () => {
    const res = resWith(async () => "<html>502</html>");
    await expect(readErrorBody(res)).resolves.toBe("<html>502</html>");
  });

  // JSON.parse("")가 throw해 원문 fallback을 탄다 — undefined가 아니라 빈 문자열이다.
  it("빈 본문은 빈 문자열이다 (undefined가 아니다)", async () => {
    const res = resWith(async () => "");
    await expect(readErrorBody(res)).resolves.toBe("");
  });

  it("본문 읽기 자체가 실패하면 undefined다", async () => {
    const res = resWith(() => Promise.reject(new Error("stream closed")));
    await expect(readErrorBody(res)).resolves.toBeUndefined();
  });
});
