// 본문 언어 래핑 게이트 두 벌(사이드패널 빌더 / background realm)이 공유하는 소스 스캐너.
// 같은 판정을 두 파일에 복제하면 한쪽만 강화됐을 때 다른 쪽이 조용히 약한 그물로 남는다.

export const CALLS_T = /(?<![\w.])t\(/;
export const CALLS_WITH_LOCALE = /(?<![\w.])withLocale\(/;
export const IMPORTS_WITH_LOCALE =
  /import\s*\{[^}]*\bwithLocale\b[^}]*\}\s*from\s*["']@\/i18n["']/;

// 최상위 선언 단위로 자른다. 비-export 헬퍼(sectionLabel·listItems·snapshotRow)가 t()를 쓰는
// 건 정상이므로 — 감싸진 진입점 안에서만 불린다 — export된 선언만 검사 대상이 된다.
// default·let·class·generator까지 마크를 만드는 건 매칭이 안 되면 그 선언이 **직전 세그먼트에
// 흡수돼 검사에서 사라지기** 때문이다(누락이 false red가 아니라 false green으로 나온다).
const DECL =
  /^(export\s+)(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|class\s+(\w+)|(?:const|let)\s+(\w+)\s*=)|^(?:async\s+)?(?:function\s*\*?\s*(\w+)|class\s+(\w+)|(?:const|let)\s+(\w+)\s*=)/gm;

export function exportedSegments(source: string): { name: string; body: string }[] {
  const marks = [...source.matchAll(DECL)];
  return marks.flatMap((m, i) => {
    if (!m[1]) return [];
    const end = i + 1 < marks.length ? marks[i + 1].index! : source.length;
    return [{ name: m[2] ?? m[3] ?? m[4]!, body: source.slice(m.index!, end) }];
  });
}

// `t(`와 `withLocale(`이 한 구간에 **같이 있기만 하면** 통과하는 판정은 래퍼 밖의 t()를 못
// 잡는다 — `const h = t(...); return withLocale(l, () => inner(h))`가 green이 되고 그 h는
// 화면 언어로 굳는다. 래핑 호출을 괄호 매칭으로 통째로 도려낸 나머지를 돌려준다.
export function stripWithLocaleCalls(source: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const rest = source.slice(cursor);
    const m = CALLS_WITH_LOCALE.exec(rest);
    if (!m) return out + rest;
    const open = cursor + m.index + m[0].length - 1;
    out += source.slice(cursor, cursor + m.index);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        i++;
        break;
      }
    }
    cursor = i;
  }
}
