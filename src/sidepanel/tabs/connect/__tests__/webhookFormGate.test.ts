import { describe, expect, it } from "vitest";
import { hasAdvancedValues, validateWebhookForm } from "../webhookFormGate";
import type { WebhookAuth } from "@/types/webhook";

function draft(patch: Partial<Parameters<typeof validateWebhookForm>[0]> = {}) {
  return {
    url: "https://hooks.example.com/bugshot",
    secret: "",
    headers: [],
    format: "multipart" as const,
    template: "",
    ...patch,
  };
}

function ok(v: ReturnType<typeof validateWebhookForm>) {
  if (!v.ok) throw new Error(`expected ok, got ${JSON.stringify(v.issues)}`);
  return v;
}

describe("validateWebhookForm — URL 축", () => {
  it("정상 https는 정규화된 url로 통과한다", () => {
    const v = ok(validateWebhookForm(draft({ url: "hooks.example.com/bugshot" })));
    expect(v.auth.url).toBe("https://hooks.example.com/bugshot");
    expect(v.plaintext).toBe(false);
  });

  it("사설망 http는 통과하되 plaintext로 표시한다", () => {
    const v = ok(validateWebhookForm(draft({ url: "http://192.168.0.7:9000/hook" })));
    expect(v.plaintext).toBe(true);
  });

  it("공인망 http는 insecure-public으로 거부한다", () => {
    const v = validateWebhookForm(draft({ url: "http://hooks.example.com/bugshot" }));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.issues).toEqual([{ kind: "url", reason: "insecure-public" }]);
  });

  it("빈 URL은 invalid로 거부한다", () => {
    const v = validateWebhookForm(draft({ url: "   " }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "url", reason: "invalid" }]);
  });

  it("URL에 박힌 자격증명은 credentials로 거부한다", () => {
    const v = validateWebhookForm(draft({ url: "https://u:p@hooks.example.com/hook" }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "url", reason: "credentials" }]);
  });
});

describe("validateWebhookForm — 헤더 축", () => {
  it("이름·값이 둘 다 빈 행은 버린다 — 마지막 빈 행이 저장을 막지 않는다", () => {
    const v = ok(
      validateWebhookForm(draft({ headers: [{ name: "X-Team", value: "web" }, { name: "", value: "" }] })),
    );
    expect(v.auth.headers).toEqual([{ name: "X-Team", value: "web" }]);
  });

  it("이름·값의 앞뒤 공백을 떼고 저장한다", () => {
    const v = ok(validateWebhookForm(draft({ headers: [{ name: " X-Team ", value: " web " }] })));
    expect(v.auth.headers).toEqual([{ name: "X-Team", value: "web" }]);
  });

  it("forbidden 헤더 이름은 거부하고 이름을 issue에 싣는다", () => {
    const v = validateWebhookForm(draft({ headers: [{ name: "Cookie", value: "a=b" }] }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "header-name", name: "Cookie" }]);
  });

  it("token이 아닌 이름도 같은 축으로 거부한다", () => {
    const v = validateWebhookForm(draft({ headers: [{ name: "X Team", value: "web" }] }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "header-name", name: "X Team" }]);
  });

  it("값만 있고 이름이 빈 행은 거부한다 — 조용히 버리면 나갈 줄 알았던 헤더가 사라진다", () => {
    const v = validateWebhookForm(draft({ headers: [{ name: "  ", value: "web" }] }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "header-name", name: "" }]);
  });

  // 같은 이름이 둘이면 buildHeaders의 Record 조립에서 뒤가 앞을 덮어 앞 행이 무음으로 사라진다.
  it("대소문자만 다른 중복 이름을 거부한다", () => {
    const v = validateWebhookForm(
      draft({ headers: [{ name: "Authorization", value: "a" }, { name: "authorization", value: "b" }] }),
    );
    expect(v.ok === false && v.issues).toEqual([{ kind: "header-duplicate", name: "authorization" }]);
  });

  it("중복 판정은 trim 이후 이름으로 한다", () => {
    const v = validateWebhookForm(
      draft({ headers: [{ name: "X-Team", value: "a" }, { name: " x-team ", value: "b" }] }),
    );
    expect(v.ok === false && v.issues[0].kind).toBe("header-duplicate");
  });
});

describe("validateWebhookForm — 시크릿 축", () => {
  it("시크릿을 headers로 굳히지 않는다 — auth.secret으로만 저장된다", () => {
    const v = ok(validateWebhookForm(draft({ secret: "  s3cr3t-value  " })));
    expect(v.auth.secret).toBe("s3cr3t-value");
    expect(v.auth.headers).toEqual([]);
  });

  it("빈 시크릿은 undefined로 저장한다 — 빈 Bearer를 만들지 않는다", () => {
    const v = ok(validateWebhookForm(draft({ secret: "   " })));
    expect(v.auth.secret).toBeUndefined();
  });
});

describe("validateWebhookForm — 템플릿 축", () => {
  it("multipart면 템플릿을 검사하지 않는다", () => {
    const v = ok(validateWebhookForm(draft({ format: "multipart", template: "{ not json" })));
    expect(v.auth.format).toBe("multipart");
  });

  // format을 json↔multipart로 오가며 편집할 때 템플릿이 사라지면 다시 써야 한다.
  it("multipart여도 입력된 템플릿은 보존한다", () => {
    const v = ok(validateWebhookForm(draft({ format: "multipart", template: '{"t":"{{title}}"}' })));
    expect(v.auth.template).toBe('{"t":"{{title}}"}');
  });

  it("json인데 템플릿이 비면 template-empty로 거부한다", () => {
    const v = validateWebhookForm(draft({ format: "json", template: "  " }));
    expect(v.ok === false && v.issues).toEqual([{ kind: "template-empty" }]);
  });

  it("json 템플릿의 구문 오류를 거부한다", () => {
    const v = validateWebhookForm(draft({ format: "json", template: "{ not json" }));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.issues[0].kind).toBe("template");
  });

  it("화이트리스트 밖 변수를 이름과 함께 거부한다", () => {
    const v = validateWebhookForm(draft({ format: "json", template: '{"x":"{{secret}}"}' }));
    expect(v.ok === false && v.issues).toEqual([
      { kind: "template", issue: { kind: "unknown-var", name: "secret" } },
    ]);
  });

  it("정상 json 템플릿은 통과한다", () => {
    const v = ok(
      validateWebhookForm(draft({ format: "json", template: '{"text":"{{title}}","n":"{{media.count}}"}' })),
    );
    expect(v.auth.format).toBe("json");
    expect(v.auth.template).toBe('{"text":"{{title}}","n":"{{media.count}}"}');
  });
});

describe("validateWebhookForm — 여러 축이 동시에 틀릴 때", () => {
  it("URL과 헤더가 둘 다 틀리면 둘 다 보고한다", () => {
    const v = validateWebhookForm(
      draft({ url: "ftp://x.example.com", headers: [{ name: "Host", value: "a" }] }),
    );
    expect(v.ok === false && v.issues).toEqual([
      { kind: "url", reason: "scheme" },
      { kind: "header-name", name: "Host" },
    ]);
  });
});

describe("hasAdvancedValues", () => {
  const base: WebhookAuth = { url: "https://x.example.com/h", headers: [], format: "multipart" };

  it("계정이 없으면 false", () => {
    expect(hasAdvancedValues(undefined)).toBe(false);
  });

  it("기본값만 든 계정은 false — 고급을 닫은 채로 연다", () => {
    expect(hasAdvancedValues(base)).toBe(false);
  });

  it("시크릿은 기본 화면 값이라 고급을 열지 않는다", () => {
    expect(hasAdvancedValues({ ...base, secret: "s" })).toBe(false);
  });

  it("헤더가 하나라도 있으면 true", () => {
    expect(hasAdvancedValues({ ...base, headers: [{ name: "X-A", value: "1" }] })).toBe(true);
  });

  it("format이 json이면 true", () => {
    expect(hasAdvancedValues({ ...base, format: "json" })).toBe(true);
  });
});
