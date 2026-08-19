import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 소스 전수 스캔 테스트가 쓰는 파일 목록. walk를 각자 복제하면 한쪽만 강화된다
// (withLocaleScan이 판정 정규식을 공용화한 것과 같은 이유).
// 반환 shape이 다른 스캐너(bodyLocaleBackground·builderLocaleWrap)는 자기 walk를 유지한다 —
// "전부 여기로 모았다"가 아니라 "같은 shape이면 여기를 쓴다"가 규칙이다.
export function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSources(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

export const relToRepo = (p: string): string => p.replace(`${process.cwd()}/`, "");
