import { describe, it, expect } from "vitest";
import {
  parseEntries,
  validateEntries,
  aggregate,
  AREAS,
  PATTERNS,
  NETS,
} from "../postmortem-report.mjs";

const DOC = `# 회고 (Postmortems)

## 작성 형식

\`\`\`
## YYYY-MM-DD — <한 줄 제목>

- **영역**: \`background\`
- **증상**: 사용자가 관측한 잘못된 동작.
\`\`\`

---

## 2026-07-27 — 첫 항목

- **영역**: \`background\`, \`store\`
- **계열**: \`미검증단언\`, \`드리프트\`
- **그물**: \`unit\`
- **증상**: 뭔가 잘못됐다.
- **근본 원인**: 진짜 원인.
- **재발 방지**: grep 패턴.
- **관련**: \`src/background/tab-bindings.ts\`.

## 2026-07-26 — 둘째 항목

- **영역**: \`디자인\`
- **그물**: \`시각\`
- **증상**: 칩이 12px로 남았다.
- **관련**: \`src/lib/utils.ts\`.
`;

describe("parseEntries", () => {
  it("작성 형식 샘플 블록은 항목으로 세지 않는다", () => {
    const entries = parseEntries(DOC);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.date)).toEqual(["2026-07-27", "2026-07-26"]);
  });

  it("영역·계열은 여러 개, 그물은 단일값으로 파싱한다", () => {
    const [first, second] = parseEntries(DOC);
    expect(first.areas).toEqual(["background", "store"]);
    expect(first.patterns).toEqual(["미검증단언", "드리프트"]);
    expect(first.net).toBe("unit");
    expect(second.patterns).toEqual([]);
    expect(second.net).toBe("시각");
  });

  it("항목의 시작 줄 번호를 보존한다", () => {
    const [first] = parseEntries(DOC);
    expect(DOC.split("\n")[first.line - 1]).toBe("## 2026-07-27 — 첫 항목");
  });
});

describe("validateEntries", () => {
  it("정상 문서는 오류가 없다", () => {
    expect(validateEntries(parseEntries(DOC), DOC)).toEqual([]);
  });

  it("헤딩을 잃은 항목(한 항목 안에 증상 2개)을 잡는다", () => {
    const broken = DOC + `\n- **증상**: 헤딩 없이 붙은 항목.\n`;
    const errors = validateEntries(parseEntries(broken), broken);
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("orphan-body");
    expect(errors[0].date).toBe("2026-07-26");
  });

  it("태그 누락을 잡는다", () => {
    const doc = DOC.replace("- **영역**: `디자인`\n", "");
    const errors = validateEntries(parseEntries(doc), doc);
    expect(errors.map((e) => e.kind)).toContain("missing-area");
  });

  it("그물이 없거나 둘 이상이면 잡는다", () => {
    const none = DOC.replace("- **그물**: `시각`\n", "");
    expect(validateEntries(parseEntries(none), none).map((e) => e.kind)).toContain(
      "missing-net",
    );
    const two = DOC.replace("- **그물**: `시각`", "- **그물**: `시각`, `unit`");
    expect(validateEntries(parseEntries(two), two).map((e) => e.kind)).toContain(
      "multi-net",
    );
  });

  it("vocab에 없는 값을 잡는다", () => {
    const doc = DOC.replace("`background`, `store`", "`background`, `없는영역`");
    const errors = validateEntries(parseEntries(doc), doc);
    expect(errors[0].kind).toBe("unknown-area");
    expect(errors[0].value).toBe("없는영역");
  });

  it("vocab 상수는 서로 겹치지 않는 슬러그 집합이다", () => {
    expect(new Set(AREAS).size).toBe(AREAS.length);
    expect(new Set(PATTERNS).size).toBe(PATTERNS.length);
    expect(new Set(NETS).size).toBe(NETS.length);
  });
});

describe("aggregate", () => {
  it("영역·계열·그물별로 세고 건수 내림차순으로 준다", () => {
    const { areas, patterns, nets, total } = aggregate(parseEntries(DOC));
    expect(total).toBe(2);
    expect(areas[0]).toEqual({ key: "background", count: 1 });
    expect(areas.map((a) => a.key)).toEqual(["background", "store", "디자인"]);
    // 동점은 이름순으로 갈라 출력이 결정적이다(입력 순서에 안 흔들림).
    expect(patterns.map((p) => p.key)).toEqual(["드리프트", "미검증단언"]);
    expect(nets).toEqual([
      { key: "unit", count: 1 },
      { key: "시각", count: 1 },
    ]);
  });

  it("월별 추세를 최신순으로 집계한다", () => {
    const { months } = aggregate(parseEntries(DOC));
    expect(months).toEqual([{ key: "2026-07", count: 2 }]);
  });

  it("영역×계열 교차로 반복 함정을 드러낸다", () => {
    const { crossTop } = aggregate(parseEntries(DOC));
    expect(crossTop).toContainEqual({
      area: "background",
      pattern: "미검증단언",
      count: 1,
    });
  });
});
