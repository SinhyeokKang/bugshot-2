import { describe, expect, it } from "vitest";
import {
  parseWebhookTemplate,
  renderWebhookTemplate,
  SAMPLE_TEMPLATE_VARS,
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
    // 빈 문자열인 건 "없는 섹션은 키를 남기고 비운다"는 계약이고(수신 서버 스키마 안정),
    // 여기서 중요한 건 그게 Object.prototype.constructor가 아니라는 것이다.
    const out = renderWebhookTemplate('{"c":"{{sections.constructor}}"}', makeVars());
    expect((out as { c: unknown }).c).toBe("");
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

// 연결 다이얼로그에는 편집 중인 리포트가 없다 — 연동 탭에서 여는 화면이라 draft가
// 있다는 보장이 없다. 그래서 미리보기는 실데이터가 아니라 이 고정 샘플로 그린다.
describe("SAMPLE_TEMPLATE_VARS", () => {
  it("화이트리스트가 허용하는 경로를 전부 채운다 — 미리보기에서만 빈 자리가 나오면 안 된다", () => {
    const template = JSON.stringify({
      title: "{{title}}",
      body: "{{body}}",
      url: "{{url}}",
      capturedAt: "{{capturedAt}}",
      logSummary: "{{logSummary}}",
      os: "{{env.os}}",
      browser: "{{env.browser}}",
      viewport: "{{env.viewport}}",
      selector: "{{env.selector}}",
      count: "{{media.count}}",
      first: "{{media.0.filename}}",
      type: "{{media.0.contentType}}",
    });
    const out = renderWebhookTemplate(template, SAMPLE_TEMPLATE_VARS) as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) {
      expect(v, k).not.toBe("");
      expect(v, k).not.toBeUndefined();
    }
  });

  it("샘플이 저장 게이트를 통과하는 값만 쓴다", () => {
    expect(parseWebhookTemplate(JSON.stringify({ t: "{{title}}" })).ok).toBe(true);
  });

  it("media.count가 items 길이와 어긋나지 않는다", () => {
    expect(SAMPLE_TEMPLATE_VARS.media.count).toBe(SAMPLE_TEMPLATE_VARS.media.items.length);
  });
});

// media 인덱스와 sections는 "없을 때"의 의미가 다르다 — 없는 media 인덱스는 사용자가 센 파일
// 개수가 어긋난 것이고, 비활성 섹션은 이 리포트에 그 섹션이 없다는 정상 상태다. 그래서 전자는
// 명시적 실패, 후자는 빈 값이 맞다. 다만 **키가 통째로 사라지는 건** 수신 서버 스키마를
// 흔들므로 빈 문자열로 남긴다.
describe("renderWebhookTemplate — 없는 sections", () => {
  const vars = () => makeVars({ sections: { description: "본문" } });

  it("없는 섹션은 키를 지우지 않고 빈 문자열로 남긴다", () => {
    const out = renderWebhookTemplate('{"notes":"{{sections.notes}}"}', vars()) as Record<string, unknown>;
    expect(Object.hasOwn(out, "notes")).toBe(true);
    expect(out.notes).toBe("");
  });

  it("문자열 가운데의 없는 섹션도 빈 문자열이 된다", () => {
    const out = renderWebhookTemplate('{"s":"a{{sections.notes}}b"}', vars()) as Record<string, string>;
    expect(out.s).toBe("ab");
  });

  it("점이 든 섹션 이름은 판정과 조회가 같은 결론을 낸다", () => {
    // 판정(isAllowedPath)과 조회(readPath)가 다른 정규식을 쓰면 한쪽만 고쳐도 무음으로 갈린다
    // — 같은 파일이 media.<idx>에 대해 그 함정을 주석으로 경고하고 있다.
    expect(parseWebhookTemplate('{"s":"{{sections.a.b}}"}').ok).toBe(false);
    expect(() => renderWebhookTemplate('{"s":"{{sections.a.b}}"}', vars())).toThrow();
  });
});
