import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// 토큰 교환 실패에 `reason`이 없으면 classifyConnectReason의 파생 규칙에서 "other"로
// 떨어진다 — 즉 **태깅을 빠뜨린 플랫폼만 조용히 미분류**가 되고 테스트는 전부 green이다.
// 실제로 slack 태깅을 지워도 4856 테스트가 통과하는 걸 뮤테이션으로 실측했다(2026-07-30
// 회고 (4): 그물의 비공허성을 증명하라). 사이트별 fetch 모킹은 8파일 × 19지점이라 비용이
// 크고, 여기서 막아야 할 건 로직이 아니라 **호출부 누락**이므로 원문 전수 대조로 잠근다.
const BG = resolve(__dirname, "..");

// 하드코딩하면 9번째 플랫폼 파일이 목록에 안 들어가 통째로 스캔을 빠져나간다.
const OAUTH_FILES = [
  "oauth.ts", // jira (역사적 이유로 접미사가 없다)
  ...readdirSync(BG).filter((f) => f.endsWith("-oauth.ts")),
].sort();

// 태깅 단언은 인자명·줄바꿈에 묶지 않는다 — 순수 포매팅 변경이 거짓 경보를 내면
// 그물이 리팩터를 방해하는 노이즈가 된다.
const TAGGED_HTTP = /reason:\s*httpReason\(\w+\.status\)/;
const TAGGED_GRANT = /reason:\s*grantReason\(/;

function blocks(file: string, start: RegExp): string[] {
  const src = readFileSync(resolve(BG, file), "utf8");
  const re = new RegExp(`${start.source}[\\s\\S]{0,400}?\\)\\s*;`, "g");
  return src.match(re) ?? [];
}

// ① 상류가 non-2xx로 거절한 레인.
const HTTP_LANE = /t\("oauth\.error\.token(?:Exchange|Refresh)"/;
// ② 상류가 200을 주면서 본문에 error를 담은 레인. GitHub의 bad_verification_code,
//    Slack의 ok:false가 여기로 온다 — status가 200이라 httpReason으로는 못 덮는다.
//    `cancelled:`를 함께 요구해 **연결 경로만** 고른다: 취소코드를 판정하는 건 최초 연결
//    레인뿐이고, refresh 레인은 trackConnect 밖이라 태깅해도 집계에 도달하지 않는다.
const GRANT_LANE = /throw new OAuthError\(\s*(?:r?[Dd]ata\.error_description \|\| r?[Dd]ata\.error|data\.error \|\| "slack_oauth_error")/;

// ③ authorize 리다이렉트가 `?error=`를 달고 돌아온 레인. ②와 구조가 같은 "제공자가
//    grant를 거부했다"인데, cancelCodes가 대부분 access_denied 하나뿐이라 invalid_scope·
//    server_error·unauthorized_client는 cancelled=false로 빠져나가 미분류가 된다.
const REDIRECT_LANE = /throw new OAuthError\(\s*\n?\s*(?:parsed\.)?searchParams\.get\("error_description"\) \|\| errorParam/;

function taggedLaneBlocks(file: string, lane: RegExp): string[] {
  // shorthand(`cancelled,`)와 명시(`cancelled: …`) 양쪽을 받는다. `cancelled`를 함께
  // 요구해 **연결 경로만** 고른다 — 취소코드를 판정하는 건 최초 연결 레인뿐이고,
  // refresh 레인은 trackConnect 밖이라 태깅해도 집계에 도달하지 않는다.
  return blocks(file, lane).filter((b) => /\bcancelled\s*[,:]/.test(b));
}

describe("토큰 교환 실패의 reason 태깅 전수", () => {
  it.each(OAUTH_FILES)("%s: non-2xx 레인이 전부 httpReason을 단다", (file) => {
    const found = blocks(file, HTTP_LANE);
    // 스캔이 아무것도 못 잡으면 이 테스트 자체가 빈 그물이 된다 — 0건을 실패로 본다.
    expect(found.length, `${file}에서 토큰 교환 throw를 못 찾았다`).toBeGreaterThan(0);
    for (const b of found) {
      expect(b, `${file}: httpReason 태깅 누락\n${b}`).toMatch(TAGGED_HTTP);
    }
  });

  it.each(OAUTH_FILES)("%s: 리다이렉트 error= 레인이 전부 grantReason을 단다", (file) => {
    const found = taggedLaneBlocks(file, REDIRECT_LANE);
    expect(found.length, `${file}에서 리다이렉트 error 레인을 못 찾았다`).toBeGreaterThan(0);
    for (const b of found) {
      expect(b, `${file}: grantReason 태깅 누락\n${b}`).toMatch(TAGGED_GRANT);
    }
  });

  // 200+본문 error 레인은 6개 파일에만 있다 — jira·notion은 그 분기 자체가 없다.
  // 파일당 비공허성 대신 **레인 보유 파일 집합**을 고정한다: 포매팅 드리프트로 한 파일이
  // 스캔에서 빠지면 목록이 어긋나 잡히고, 새 플랫폼이 이 레인을 가지면 목록 갱신을 강제한다.
  const GRANT_LANE_FILES = [
    "asana-oauth.ts",
    "clickup-oauth.ts",
    "github-oauth.ts",
    "gitlab-oauth.ts",
    "linear-oauth.ts",
    "slack-oauth.ts",
  ];

  it("200+error 본문 레인의 보유 파일 집합이 고정돼 있다", () => {
    const owners = OAUTH_FILES.filter((f) => taggedLaneBlocks(f, GRANT_LANE).length > 0);
    expect(owners).toEqual(GRANT_LANE_FILES);
  });

  it.each(GRANT_LANE_FILES)("%s: 200+error 본문 레인이 전부 grantReason을 단다", (file) => {
    for (const b of taggedLaneBlocks(file, GRANT_LANE)) {
      expect(b, `${file}: grantReason 태깅 누락\n${b}`).toMatch(TAGGED_GRANT);
    }
  });

  it("지점 수가 줄지 않았다 (경로가 통째로 사라지면 커버리지가 준 것이다)", () => {
    const sum = (fn: (f: string) => number) => OAUTH_FILES.reduce((n, f) => n + fn(f), 0);
    expect(sum((f) => blocks(f, HTTP_LANE).length)).toBeGreaterThanOrEqual(13);
    expect(sum((f) => taggedLaneBlocks(f, GRANT_LANE).length)).toBeGreaterThanOrEqual(6);
    expect(sum((f) => taggedLaneBlocks(f, REDIRECT_LANE).length)).toBeGreaterThanOrEqual(8);
  });

  it("8개 플랫폼 파일을 전부 스캔한다", () => {
    expect(OAUTH_FILES).toHaveLength(8);
  });
});
