import { describe, it, expect } from "vitest";
import { extractCsrfToken } from "../github-upload";

describe("extractCsrfToken", () => {
  it("정상 HTML — meta csrf-token 추출", () => {
    const html = `
      <html><head>
        <meta name="csrf-token" content="abc123XYZ_token" />
      </head><body></body></html>
    `;
    expect(extractCsrfToken(html)).toBe("abc123XYZ_token");
  });

  it("meta 태그가 다른 태그 사이에 있어도 추출", () => {
    const html = `
      <meta name="viewport" content="width=device-width">
      <meta name="csrf-token" content="tok_456">
      <meta name="description" content="repo">
    `;
    expect(extractCsrfToken(html)).toBe("tok_456");
  });

  it("content에 특수문자(+, /, =) 포함", () => {
    const token = "a1b2c3+def/ghi=jkl==";
    const html = `<meta name="csrf-token" content="${token}">`;
    expect(extractCsrfToken(html)).toBe(token);
  });

  it("meta 태그 없으면 null", () => {
    const html = `<html><head><title>repo</title></head><body></body></html>`;
    expect(extractCsrfToken(html)).toBeNull();
  });

  it("빈 문자열 입력 → null", () => {
    expect(extractCsrfToken("")).toBeNull();
  });

  it("content가 빈 값이면 null", () => {
    const html = `<meta name="csrf-token" content="">`;
    expect(extractCsrfToken(html)).toBeNull();
  });

  it("content가 name보다 먼저 오는 meta도 추출", () => {
    const html = `<meta content="reversed_token_789" name="csrf-token">`;
    expect(extractCsrfToken(html)).toBe("reversed_token_789");
  });

  it("input authenticity_token에서 추출 (name → value 순서)", () => {
    const html = `<input type="hidden" name="authenticity_token" value="form_tok_123" data-csrf="true">`;
    expect(extractCsrfToken(html)).toBe("form_tok_123");
  });

  it("input authenticity_token에서 추출 (value → name 순서)", () => {
    const html = `<input type="hidden" value="rev_tok_456" name="authenticity_token">`;
    expect(extractCsrfToken(html)).toBe("rev_tok_456");
  });

  it("meta가 없고 input만 있을 때 input에서 추출", () => {
    const html = `
      <html><head><title>repo</title></head><body>
      <form><input type="hidden" name="authenticity_token" value="only_input_tok" data-csrf="true" class="js-confirm-csrf-token" /></form>
      </body></html>
    `;
    expect(extractCsrfToken(html)).toBe("only_input_tok");
  });

  it("meta와 input 둘 다 있으면 meta 우선", () => {
    const html = `
      <meta name="csrf-token" content="meta_tok">
      <input name="authenticity_token" value="input_tok">
    `;
    expect(extractCsrfToken(html)).toBe("meta_tok");
  });
});

describe("extractCsrfToken — data-csrf input (file-attachment)", () => {
  it("data-csrf input의 value 추출", () => {
    const html = `
      <file-attachment>
        <input type="hidden" data-csrf="true" value="upload_csrf_tok_1">
      </file-attachment>
    `;
    expect(extractCsrfToken(html)).toBe("upload_csrf_tok_1");
  });

  it("data-csrf input이 meta csrf-token보다 우선", () => {
    const html = `
      <meta name="csrf-token" content="meta_tok">
      <file-attachment>
        <input data-csrf="true" value="file_attach_tok">
      </file-attachment>
    `;
    expect(extractCsrfToken(html)).toBe("file_attach_tok");
  });

  it("data-csrf input만 있고 meta·authenticity_token 없을 때", () => {
    const html = `
      <html><body>
        <file-attachment class="js-upload-markdown-image">
          <input type="hidden" data-csrf="true" class="js-data-upload-policy-url-csrf" value="only_data_csrf">
        </file-attachment>
      </body></html>
    `;
    expect(extractCsrfToken(html)).toBe("only_data_csrf");
  });

  it("data-csrf input의 value가 비어있으면 meta fallback", () => {
    const html = `
      <input data-csrf="true" value="">
      <meta name="csrf-token" content="fallback_meta">
    `;
    expect(extractCsrfToken(html)).toBe("fallback_meta");
  });
});
