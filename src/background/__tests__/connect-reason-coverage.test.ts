import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// 토큰 교환 실패에 `reason`이 없으면 classifyConnectReason의 파생 규칙에서 "other"로
// 떨어진다 — 즉 **태깅을 빠뜨린 플랫폼만 조용히 미분류**가 되고 테스트는 전부 green이다.
// 실제로 slack 태깅을 지워도 4856 테스트가 통과하는 걸 뮤테이션으로 실측했다(2026-07-30
// 회고 (4): 그물의 비공허성을 증명하라). 사이트별 fetch 모킹은 8파일 × 20여 지점이라 비용이
// 크고, 여기서 막아야 할 건 로직이 아니라 **호출부 누락**이므로 원문 전수 대조로 잠근다.
const BG = resolve(__dirname, "..");

// 하드코딩하면 9번째 플랫폼 파일이 목록에 안 들어가 통째로 스캔을 빠져나간다.
const OAUTH_FILES = [
  "oauth.ts", // jira (역사적 이유로 접미사가 없다)
  ...readdirSync(BG).filter((f) => f.endsWith("-oauth.ts")),
].sort();

const TAGGED_HTTP = /reason:\s*httpReason\(\w+\.status\)/;

function blocks(file: string, start: RegExp): string[] {
  const src = readFileSync(resolve(BG, file), "utf8");
  const re = new RegExp(`${start.source}[\\s\\S]{0,400}?\\)\\s*;`, "g");
  return src.match(re) ?? [];
}

// ① 상류가 non-2xx로 거절한 레인.
const HTTP_LANE = /t\("oauth\.error\.token(?:Exchange|Refresh)"/;
// ② 상류가 200을 주면서 본문에 error를 담은 레인. ③ authorize 리다이렉트가 `?error=`를
//    달고 돌아온 레인. 둘이 왜 다른 값을 쓰는지는 errors.ts의 헬퍼 주석 참조.
const GRANT_LANE = /throw new OAuthError\(\s*(?:r?[Dd]ata\.error_description \|\| r?[Dd]ata\.error|data\.error \|\| "slack_oauth_error")/;
const REDIRECT_LANE = /throw new OAuthError\(\s*\n?\s*(?:parsed\.)?searchParams\.get\("error_description"\) \|\| errorParam/;

// spread 형태를 요구해야 호출부가 cancelled·reason을 따로 넘겨 어긋뜨리는 걸 막는다.
const TAGGED_GRANT = /\.\.\.grantRejection\(/;
const TAGGED_AUTHORIZE = /\.\.\.authorizeRejection\(/;

// 거부 레인은 refresh 경로에도 같은 모양이 있다. 취소코드를 판정하는 건 최초 연결
// 레인뿐이라, 취소 판정 함수 호출을 함께 요구해 연결 경로만 고른다. 두 번째 대안은
// 현재 매칭 0건이지만, 호출부가 수동 `cancelled:`로 회귀하면 그 블록을 스코프에
// 붙잡아 spread 단언을 실패시키는 방어다.
const CANCEL_CHECK = /is\w+CancellationCode\(|\bcancelled\s*[,:]/;

function rejectionBlocks(file: string, lane: RegExp): string[] {
  return blocks(file, lane).filter((b) => CANCEL_CHECK.test(b));
}

describe("연결 실패 레인의 reason 태깅 전수", () => {
  it.each(OAUTH_FILES)("%s: non-2xx 레인이 전부 httpReason을 단다", (file) => {
    const found = blocks(file, HTTP_LANE);
    // 스캔이 아무것도 못 잡으면 이 테스트 자체가 빈 그물이 된다 — 0건을 실패로 본다.
    expect(found.length, `${file}에서 토큰 교환 throw를 못 찾았다`).toBeGreaterThan(0);
    for (const b of found) {
      expect(b, `${file}: httpReason 태깅 누락\n${b}`).toMatch(TAGGED_HTTP);
    }
  });

  it.each(OAUTH_FILES)("%s: 리다이렉트 error= 레인이 authorizeRejection을 편다", (file) => {
    const found = rejectionBlocks(file, REDIRECT_LANE);
    expect(found.length, `${file}에서 리다이렉트 error 레인을 못 찾았다`).toBeGreaterThan(0);
    for (const b of found) {
      expect(b, `${file}: authorizeRejection 누락\n${b}`).toMatch(TAGGED_AUTHORIZE);
    }
  });

  // 200+본문 error 레인은 프록시를 경유하는 8개 파일 전부에 있다. jira·notion은 원래
  // `res.ok`만 봐서 이 분기가 없었고, 그래서 200 + `{error:"invalid_grant"}` 본문이
  // `access_token: undefined`인 채 저장으로 흘러가 classifyConnectReason이 other로 뭉갰다.
  // 파일당 비공허성 대신 **레인 보유 파일 집합**을 고정한다: 포매팅 드리프트로 한 파일이
  // 스캔에서 빠지면 목록이 어긋나 잡히고, 새 플랫폼이 이 레인을 가지면 목록 갱신을 강제한다.
  const GRANT_LANE_FILES = [
    "asana-oauth.ts",
    "clickup-oauth.ts",
    "github-oauth.ts",
    "gitlab-oauth.ts",
    "linear-oauth.ts",
    "notion-oauth.ts",
    "oauth.ts",
    "slack-oauth.ts",
  ];

  it("200+error 본문 레인의 보유 파일 집합이 고정돼 있다", () => {
    const owners = OAUTH_FILES.filter((f) => rejectionBlocks(f, GRANT_LANE).length > 0);
    expect(owners).toEqual(GRANT_LANE_FILES);
  });

  it.each(GRANT_LANE_FILES)("%s: 200+error 본문 레인이 grantRejection을 편다", (file) => {
    for (const b of rejectionBlocks(file, GRANT_LANE)) {
      expect(b, `${file}: grantRejection 누락\n${b}`).toMatch(TAGGED_GRANT);
    }
  });

  // 위 파일별 단언은 파일당 ≥1만 보장하므로 8까지밖에 안 나온다 — 13이 유지되는지는
  // 총합으로만 확인된다. (grant·redirect 총합은 위 두 테스트에서 논리적으로 따라온다.)
  it("non-2xx 태깅 지점 13곳이 유지된다", () => {
    const total = OAUTH_FILES.reduce((n, f) => n + blocks(f, HTTP_LANE).length, 0);
    expect(total).toBeGreaterThanOrEqual(13);
  });

  it("8개 플랫폼 파일을 전부 스캔한다", () => {
    expect(OAUTH_FILES).toHaveLength(8);
  });

  // `!redirect` 취소 분기 8곳은 Promise형 launchWebAuthFlow가 창 닫기를 reject로 알리는
  // 탓에 도달 불가지만 방어용으로 남아 있다(2026-07-30 회고). 태깅이 없으면 파생으로
  // cancelled_denied가 붙는데, 이 레인이 뜻하는 건 창 닫기라 값이 **틀린다**.
  it.each(OAUTH_FILES)("%s: !redirect 취소 분기가 cancelled_window를 단다", (file) => {
    const found = blocks(file, /if \(!redirect\) \{/);
    expect(found.length, `${file}에서 !redirect 분기를 못 찾았다`).toBe(1);
    expect(found[0], `${file}: cancelled_window 누락\n${found[0]}`).toMatch(
      /reason:\s*"cancelled_window"/,
    );
  });

  // ④ 토큰 교환 성공 뒤 프로필 조회 레인. 7개 플랫폼은 getMyself가 던지는 숫자 status를
  //    classifyConnectReason이 duck-typing으로 잡아 파생되지만, **OAuthError로 감싸진
  //    세 지점만 파생이 안 걸려** 명시 태깅이 필요하다. 위 레인들과 파일·문구가 달라
  //    같은 스캐너에 안 걸리므로 지점을 직접 못박는다 — 뮤테이션에서 이 셋만 생존했다.
  it.each([
    ["oauth.ts", /t\("oauth\.error\.siteList"/, "jira는 getMyself가 없어 이게 프로필 조회 대응 단계"],
    ["notion-api.ts", /t\("notion\.oauthExpired"/, "notion 401만 OAuthError로 감싸여 파생을 빠져나간다"],
    ["lib/createRefreshRunner.ts", /t\("oauth\.error\.refreshExhausted"/, "연결 중 401 재시도 소진"],
  ])("%s: 프로필 조회 레인이 profile_fetch_failed를 단다", (file, marker, why) => {
    const found = blocks(file, marker);
    expect(found.length, `${file}에서 지점을 못 찾았다 (${why})`).toBe(1);
    expect(found[0], `${file}: 태깅 누락 — ${why}\n${found[0]}`).toMatch(
      /reason:\s*"profile_fetch_failed"/,
    );
  });
});
