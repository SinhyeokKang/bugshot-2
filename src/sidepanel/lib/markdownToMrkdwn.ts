// 마크다운 → Slack mrkdwn. Slack은 볼드 `*`, 이탤릭 `_`, 링크 `<url|text>`, 헤딩 없음,
// 인라인 이미지 없음 등 문법이 다르다. 코드블록·인라인 코드 내부는 변환하지 않는다.

// 변환 중 충돌 방지용 sentinel (제어문자 — 입력에 등장하지 않음).
const CODE_OPEN = "\u0000";
const CODE_CLOSE = "\u0001";
const BOLD = "\u0002";

function convertInline(text: string): string {
  // 인라인 코드 `...`는 보호 후 마지막에 복원 (내부 마크 변환 방지).
  const codes: string[] = [];
  let s = text.replace(/`[^`]+`/g, (m) => {
    codes.push(m);
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`;
  });

  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // 이미지 제거 (Slack 인라인 이미지 미지원)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>"); // 링크 → <url|text>
  s = s.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${BOLD}`); // 볼드 보호 (이탤릭 룰과 충돌 회피)
  s = s.replace(/~~([^~]+)~~/g, "~$1~"); // 취소선
  s = s.replace(/\*([^*\n]+)\*/g, "_$1_"); // 이탤릭 * → _
  s = s.replace(new RegExp(BOLD, "g"), "*"); // 볼드 복원

  return s.replace(
    new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, "g"),
    (_, i) => codes[Number(i)],
  );
}

export function markdownToMrkdwn(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    // 들여쓰기 ≤3만 fence — CommonMark 규칙. trim으로 판정하면 코드블럭 본문의
    // 무해화된(4칸 들여쓴) 백틱 런이 fence를 조기 종료시켜 나머지 본문이 변환된다.
    if (/^ {0,3}```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(`*${convertInline(heading[1])}*`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      out.push(`• ${convertInline(bullet[1])}`);
      continue;
    }
    out.push(convertInline(line));
  }

  return out.join("\n");
}

// Slack mrkdwn 특수문자 이스케이프 — 평문 값(selector·DOM 라벨·환경값)에만 적용한다.
// 멘션 `<@id>`·링크 `<url|text>`는 생성 시점에 만들어지므로 이 함수를 거치지 않는다.
export function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
