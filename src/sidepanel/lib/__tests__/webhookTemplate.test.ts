import { describe, expect, it } from "vitest";
import {
  parseWebhookTemplate,
  renderWebhookTemplate,
  type WebhookTemplateVars,
} from "../webhookTemplate";

function makeVars(overrides: Partial<WebhookTemplateVars> = {}): WebhookTemplateVars {
  return {
    title: "버튼이 안 눌린다",
    body: "본문",
    url: "https://example.com/checkout",
    env: { os: "macOS", browser: "Chrome 140", viewport: "1024x768", selector: "#pay" },
    capturedAt: "2026-09-20T01:00:00.000Z",
    logSummary: "network 3 / console 1",
    sections: { description: "설명", expectedResult: "기대" },
    media: {
      count: 3,
      items: [
        { filename: "screenshot.webp", contentType: "image/webp" },
        { filename: "logs.html", contentType: "text/html" },
        { filename: "note.pdf", contentType: "application/pdf" },
      ],
    },
    ...overrides,
  };
}

describe("parseWebhookTemplate — 저장 시점 게이트", () => {
  it("유효한 JSON + 화이트리스트 변수면 통과한다", () => {
    const r = parseWebhookTemplate('{"content":"**{{title}}**\\n{{url}}"}');
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("깨진 JSON은 invalid-json으로 거부한다", () => {
    const r = parseWebhookTemplate('{"content": }');
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toContain("invalid-json");
  });

  it.each(["{{token}}", "{{auth.headers}}", "{{account}}", "{{env.password}}"])(
    "%s — 화이트리스트 밖 변수는 이름과 함께 거부한다 (조용히 빈 문자열로 치환하지 않는다)",
    (expr) => {
      const r = parseWebhookTemplate(`{"c":"${expr}"}`);
      expect(r.ok).toBe(false);
      const unknown = r.issues.find((i) => i.kind === "unknown-var");
      expect(unknown).toBeDefined();
      expect(expr).toContain(unknown && "name" in unknown ? unknown.name : "###");
    },
  );

  it("{{media.N.dataUri}}는 저장 시점에 거부한다 — json 모드는 미디어를 바디에 싣지 않는다", () => {
    // 화이트리스트에 두면 저장은 통과하고 제출 시점에 100% 터진다(값을 만들 자리가 없다).
    const r = parseWebhookTemplate('{"f":"{{media.0.dataUri}}"}');
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toContain("unknown-var");
  });

  it("sections는 프로토타입 체인을 타지 않는다", () => {
    const r = parseWebhookTemplate('{"c":"{{sections.constructor}}"}');
    // 이름 자체는 화이트리스트를 통과하지만(섹션 id는 임의 문자열이다)
    expect(r.ok).toBe(true);
    // 값이 프로토타입에서 오면 안 된다 — hasOwn 없이 읽으면 함수 소스가 본문에 실린다.
    const out = renderWebhookTemplate('{"c":"{{sections.constructor}}"}', makeVars());
    expect((out as { c: unknown }).c).toBeUndefined();
    const inline = renderWebhookTemplate('{"c":"x{{sections.constructor}}y"}', makeVars());
    expect((inline as { c: string }).c).toBe("xy");
  });

  it("중첩 배열·객체 안쪽 리프의 변수도 검사한다", () => {
    const r = parseWebhookTemplate('{"embeds":[{"description":"{{nope}}"}]}');
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toContain("unknown-var");
  });
});

describe("renderWebhookTemplate — parse 먼저, 문자열 리프 안에서만 치환", () => {
  it.each([
    ['따옴표 "인용"', "quote"],
    ["역슬래시 C:\\Users\\me", "backslash"],
    ["첫 줄\n둘째 줄", "newline"],
    ["이모지 🐛 와 한글", "unicode"],
    ['탭\t과 제어 "혼합"\\', "mixed"],
  ])("본문에 %s(%s)가 있어도 결과가 유효한 JSON이다", (body) => {
    const out = renderWebhookTemplate('{"content":"{{body}}"}', makeVars({ body }));
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    expect((out as { content: string }).content).toBe(body);
  });

  it("리프 전체가 하나의 placeholder면 타입을 보존한다", () => {
    const out = renderWebhookTemplate('{"n":"{{media.count}}"}', makeVars());
    expect((out as { n: unknown }).n).toBe(3);
    expect(typeof (out as { n: unknown }).n).toBe("number");
  });

  it("placeholder가 문자열의 일부면 문자열로 이어붙인다", () => {
    const out = renderWebhookTemplate('{"s":"x{{media.count}}y"}', makeVars());
    expect((out as { s: unknown }).s).toBe("x3y");
  });

  it("중첩 배열·객체 안쪽 리프까지 치환한다", () => {
    const out = renderWebhookTemplate(
      '{"embeds":[{"title":"{{title}}","fields":[{"value":"{{env.os}}"}]}]}',
      makeVars(),
    );
    const embeds = (out as { embeds: { title: string; fields: { value: string }[] }[] }).embeds;
    expect(embeds[0].title).toBe("버튼이 안 눌린다");
    expect(embeds[0].fields[0].value).toBe("macOS");
  });

  it("키 이름은 치환 대상이 아니다 — 문자열 리프만 본다", () => {
    const out = renderWebhookTemplate('{"{{title}}":"v"}', makeVars());
    expect(Object.keys(out as object)).toEqual(["{{title}}"]);
  });

  it("media 항목을 인덱스로 참조할 수 있다", () => {
    const out = renderWebhookTemplate('{"f":"{{media.0.filename}}"}', makeVars());
    expect((out as { f: string }).f).toBe("screenshot.webp");
  });

  it("없는 media 인덱스는 빈 문자열이 아니라 명시적 이슈다", () => {
    const r = parseWebhookTemplate('{"f":"{{media.9.filename}}"}');
    // 인덱스 유효성은 vars를 알아야 하므로 parse가 아니라 render에서 드러난다.
    expect(r.ok).toBe(true);
    expect(() => renderWebhookTemplate('{"f":"{{media.9.filename}}"}', makeVars())).toThrow();
  });

  it("미디어는 파일명·타입만 노출한다 — 내용은 템플릿에 실을 수 없다", () => {
    const vars = makeVars({
      media: { count: 1, items: [{ filename: "replay.mp4", contentType: "video/mp4" }] },
    });
    expect(Object.keys(vars.media.items[0])).toEqual(["filename", "contentType"]);
    const out = renderWebhookTemplate('{"f":"{{media.0.filename}}"}', vars);
    expect((out as { f: string }).f).toBe("replay.mp4");
  });
});
