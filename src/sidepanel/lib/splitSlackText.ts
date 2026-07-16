// Slack chat.postMessage의 text는 4000자 한계이고, 넘으면 Slack이 제멋대로 여러 메시지로 쪼갠다.
// 그 경계가 코드블럭 안에 떨어지면 펜스가 깨져 로그가 평문으로 나오거나 엉뚱한 섹션이 코드블럭에
// 씌워진다 — 쪼개는 걸 우리가 제어해 조각마다 펜스를 닫고 다시 연다.
export const SLACK_TEXT_LIMIT = 3800;

const FENCE = /^ {0,3}```(.*)$/;

// 재개 펜스(```lang\n) + 닫는 펜스(\n```)가 조각 안에서 차지하는 자리.
function fenceOverhead(lang: string): number {
  return lang.length + 4 + 4;
}

export function splitSlackText(text: string, limit: number = SLACK_TEXT_LIMIT): string[] {
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let lines: string[] = [];
  let len = 0;
  let lang: string | null = null; // 현재 위치가 코드블럭 안이면 그 language
  let openLang: string | null = null; // 다음 조각 첫 줄에서 다시 열어야 할 language

  const flush = () => {
    if (lines.length === 0) return;
    chunks.push(lines.join("\n") + (lang !== null ? "\n```" : ""));
    openLang = lang;
    lines = [];
    len = 0;
  };

  const push = (line: string) => {
    if (lines.length === 0 && openLang !== null) {
      const reopen = "```" + openLang;
      lines.push(reopen);
      len = reopen.length;
      openLang = null;
    }
    lines.push(line);
    len += (lines.length > 1 ? 1 : 0) + line.length;
  };

  for (const line of text.split("\n")) {
    const overhead = lang !== null ? fenceOverhead(lang) : 0;

    // 한 줄이 조각보다 길면(미니파이 JSON 등) 줄 단위로는 못 담는다. 개행 글루가 원문을
    // 훼손하지 않도록 조각마다 독립 청크로 내보낸다.
    if (line.length > limit - overhead) {
      flush();
      const size = limit - overhead;
      for (let i = 0; i < line.length; i += size) {
        const piece = line.slice(i, i + size);
        chunks.push(lang !== null ? `\`\`\`${lang}\n${piece}\n\`\`\`` : piece);
      }
      openLang = lang;
      continue;
    }

    const reopen = lines.length === 0 && openLang !== null ? openLang.length + 4 : 0;
    // 닫는 펜스 자리를 남긴다 — 조각은 항상 닫힌 채로 나가야 한다.
    if (len + 1 + line.length + (lang !== null ? 4 : 0) + reopen > limit) flush();
    push(line);

    const m = FENCE.exec(line);
    if (m) lang = lang === null ? m[1] : null;
  }
  flush();

  return chunks;
}
