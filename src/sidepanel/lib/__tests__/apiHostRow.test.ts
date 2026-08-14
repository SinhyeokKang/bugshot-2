import { describe, it, expect } from "vitest";

import type { EnvironmentRow } from "@/types/environment";
import type { NetworkLog } from "@/types/network";
import { EMPTY_NETWORK_LOG } from "../captureLogSupport";
import {
  API_HOSTS_LABEL,
  registrableDomain,
  deriveApiHostsRow,
  apiHostRowFor,
  syncApiHostsRow,
  isApiHostsUndetermined,
  stripApiHostsRows,
  environmentForSubmit,
} from "../apiHostRow";

const PAGE = "https://app.acme.com/orders/42";

function reqs(...urls: string[]): { url: string }[] {
  return urls.map((url) => ({ url }));
}

function netLog(urls: string[], captured?: number): NetworkLog {
  return {
    ...EMPTY_NETWORK_LOG,
    captured: captured ?? urls.length,
    requests: reqs(...urls) as NetworkLog["requests"],
  };
}

describe("registrableDomain", () => {
  it("서브도메인을 벗겨 마지막 2레이블을 반환", () => {
    expect(registrableDomain("api.acme.com")).toBe("acme.com");
  });

  it("이미 2레이블이면 그대로", () => {
    expect(registrableDomain("acme.com")).toBe("acme.com");
  });

  it("2단 접미사(co.kr)는 3레이블까지 보존", () => {
    expect(registrableDomain("api.acme.co.kr")).toBe("acme.co.kr");
  });

  it("레이블이 2개뿐인 2단 접미사 자체는 그대로 (3레이블 규칙의 미정의 분기)", () => {
    expect(registrableDomain("co.kr")).toBe("co.kr");
  });

  it("다단 서브도메인도 마지막 2레이블로 축약", () => {
    expect(registrableDomain("o1.ingest.sentry.io")).toBe("sentry.io");
  });

  it("단일 레이블(localhost)은 그대로", () => {
    expect(registrableDomain("localhost")).toBe("localhost");
  });

  it("IPv4 형태는 축약하지 않고 그대로", () => {
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
  });

  it("대괄호 IPv6는 그대로", () => {
    expect(registrableDomain("[::1]")).toBe("[::1]");
  });

  it("대문자 + 트레일링 닷은 정규화", () => {
    expect(registrableDomain("API.Acme.com.")).toBe("acme.com");
  });

  it("빈 문자열은 빈 문자열", () => {
    expect(registrableDomain("")).toBe("");
  });
});

describe("deriveApiHostsRow", () => {
  it("동족 hostname 1개 → API Hosts 행", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/orders"), PAGE)).toEqual({
      label: API_HOSTS_LABEL,
      value: "api.acme.com",
      source: "api-hosts",
    });
  });

  it("페이지 hostname으로만 요청하면 null", () => {
    expect(
      deriveApiHostsRow(reqs("https://app.acme.com/api/orders", "https://app.acme.com/me"), PAGE),
    ).toBeNull();
  });

  it("비동족 서드파티(Sentry·GA)만 있으면 null", () => {
    expect(
      deriveApiHostsRow(
        reqs("https://o1.ingest.sentry.io/api/1/envelope", "https://www.google-analytics.com/g/collect"),
        PAGE,
      ),
    ).toBeNull();
  });

  it("동족 2개는 요청 수 내림차순으로 ', ' 연결", () => {
    const row = deriveApiHostsRow(
      reqs(
        "https://auth.acme.com/token",
        "https://api.acme.com/a",
        "https://api.acme.com/b",
        "https://api.acme.com/c",
      ),
      PAGE,
    );
    expect(row?.value).toBe("api.acme.com, auth.acme.com");
  });

  it("요청 수 동률이면 배열에서 먼저 등장한 hostname이 앞", () => {
    const row = deriveApiHostsRow(
      reqs("https://zeta.acme.com/x", "https://alpha.acme.com/y"),
      PAGE,
    );
    expect(row?.value).toBe("zeta.acme.com, alpha.acme.com");
  });

  it("status 200 정상 요청도 후보가 된다 (실패 축과 직교 — 대안 C 회귀 방지)", () => {
    const ok = [{ url: "https://api.acme.com/orders", status: 200, phase: "complete" }];
    expect(deriveApiHostsRow(ok, PAGE)?.value).toBe("api.acme.com");
  });

  it("scheme·port·path·query를 제거하고 hostname만 남긴다", () => {
    const row = deriveApiHostsRow(reqs("https://api.acme.com:8443/v2/orders?token=x"), PAGE);
    expect(row?.value).toBe("api.acme.com");
  });

  it("상대 URL이 섞여도 skip하고 나머지로 판정", () => {
    const row = deriveApiHostsRow(reqs("/api/orders", "https://api.acme.com/orders"), PAGE);
    expect(row?.value).toBe("api.acme.com");
  });

  it("파싱 불가 URL이 섞여도 skip하고 나머지로 판정", () => {
    const row = deriveApiHostsRow(reqs("not a url", "https://api.acme.com/orders"), PAGE);
    expect(row?.value).toBe("api.acme.com");
  });

  it("ws/wss만 동족이면 null (http/https만 후보)", () => {
    expect(
      deriveApiHostsRow(reqs("wss://api.acme.com/socket", "ws://api.acme.com/socket"), PAGE),
    ).toBeNull();
  });

  it("스킴만 다른 동족(https 페이지 → http 요청)도 후보", () => {
    expect(deriveApiHostsRow(reqs("http://api.acme.com/orders"), PAGE)?.value).toBe("api.acme.com");
  });

  it("localhost ↔ 127.0.0.1은 비동족이라 null", () => {
    expect(
      deriveApiHostsRow(reqs("http://127.0.0.1:8080/api"), "http://localhost:3000/app"),
    ).toBeNull();
  });

  it("포트만 다른 동일 hostname은 null (hostname 단위 비교)", () => {
    expect(
      deriveApiHostsRow(reqs("http://localhost:8080/api"), "http://localhost:3000/app"),
    ).toBeNull();
  });

  it("요청 URL의 트레일링 닷은 정규화해 페이지 자기 호스트를 재포함하지 않는다", () => {
    expect(deriveApiHostsRow(reqs("https://app.acme.com./orders"), PAGE)).toBeNull();
  });

  it("IDN 호스트는 punycode로 정규화돼 동족 판정이 성립", () => {
    const row = deriveApiHostsRow(reqs("https://api.한글.example/x"), "https://app.한글.example/p");
    expect(row?.value).toBe("api.xn--bj0bj06e.example");
  });

  it("requests가 비면 null", () => {
    expect(deriveApiHostsRow([], PAGE)).toBeNull();
  });

  it("pageUrl이 빈 문자열이면 null", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/orders"), "")).toBeNull();
  });

  it("pageUrl이 undefined면 null", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/orders"), undefined)).toBeNull();
  });

  it("pageUrl이 file:// 이면 null (origin이 문자열 'null'인 트랩)", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/orders"), "file:///x/y.html")).toBeNull();
  });

  it("pageUrl이 about:blank면 null", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/orders"), "about:blank")).toBeNull();
  });

  it("2단 접미사 환경에서 동족이면 후보", () => {
    const row = deriveApiHostsRow(
      reqs("https://api.acme.co.kr/orders"),
      "https://app.acme.co.kr/p",
    );
    expect(row?.value).toBe("api.acme.co.kr");
  });

  it("2단 접미사 환경에서 조직이 다르면 null (co.kr 우연 일치 방지)", () => {
    expect(
      deriveApiHostsRow(reqs("https://api.acme.co.kr/orders"), "https://app.other.co.kr/p"),
    ).toBeNull();
  });

  // 호스팅형 접미사는 그룹 자체가 조직 경계가 아니다 — 남의 배포·남의 버킷이 동족으로 잡히면
  // 내 이슈·Slack에 남의 조직 hostname이 실린다. 못 넣는 불편 < 잘못 넣는 유출.
  it("vercel.app 페이지는 null — 남의 배포 호스트를 동족으로 끌어오지 않는다", () => {
    expect(
      deriveApiHostsRow(reqs("https://other-team.vercel.app/api"), "https://myapp.vercel.app/p"),
    ).toBeNull();
  });

  it("github.io 페이지는 null", () => {
    expect(
      deriveApiHostsRow(reqs("https://someone.github.io/api"), "https://me.github.io/p"),
    ).toBeNull();
  });

  it("S3 버킷 호스트는 null — 다른 버킷이 동족으로 잡히지 않는다", () => {
    expect(
      deriveApiHostsRow(
        reqs("https://other-bucket.s3.amazonaws.com/x"),
        "https://my-bucket.s3.amazonaws.com/p",
      ),
    ).toBeNull();
  });

  it("PSL private section의 미등재 호스팅 도메인도 다른 tenant를 포함하지 않는다", () => {
    expect(
      deriveApiHostsRow(
        reqs("https://other.appspot.com/api"),
        "https://mine.appspot.com/page",
      ),
    ).toBeNull();
  });

  it("호스팅형 접미사가 아닌 일반 도메인은 영향 없다", () => {
    expect(deriveApiHostsRow(reqs("https://api.acme.com/x"), PAGE)?.value).toBe("api.acme.com");
  });
});

describe("isApiHostsUndetermined", () => {
  it("지원 모드 + 첨부 on 인데 networkLog가 아직 null이면 판정 불가", () => {
    expect(
      isApiHostsUndetermined({ captureMode: "screenshot", logsAttach: true, networkLog: null }),
    ).toBe(true);
  });

  it("networkLog가 도착했으면 판정 가능", () => {
    expect(
      isApiHostsUndetermined({
        captureMode: "screenshot",
        logsAttach: true,
        networkLog: netLog([]),
      }),
    ).toBe(false);
  });

  it("로그 첨부가 off면 판정 가능 (제거가 정답)", () => {
    expect(
      isApiHostsUndetermined({ captureMode: "screenshot", logsAttach: false, networkLog: null }),
    ).toBe(false);
  });

  it("element 모드는 판정 가능 (행이 없는 게 정답)", () => {
    expect(
      isApiHostsUndetermined({ captureMode: "element", logsAttach: true, networkLog: null }),
    ).toBe(false);
  });
});

describe("stripApiHostsRows", () => {
  it("자동 행만 걷어내고 사용자 행은 남긴다", () => {
    const user = { label: "Locale", value: "ko-KR" };
    const auto = { label: API_HOSTS_LABEL, value: "api.acme.com", source: "api-hosts" as const };
    expect(stripApiHostsRows([user, auto], "api.acme.com")).toEqual([user]);
  });

  it("사용자가 수정한 자동 행은 제출 직전에도 남긴다", () => {
    const edited = {
      label: API_HOSTS_LABEL,
      value: "내가-고친.acme.com",
      source: "api-hosts" as const,
    };
    expect(stripApiHostsRows([edited], "api.acme.com")).toEqual([edited]);
  });

  it("자동 행이 없으면 입력 참조를 그대로 반환", () => {
    const rows = [{ label: "Locale", value: "ko-KR" }];
    expect(stripApiHostsRows(rows, null)).toBe(rows);
  });
});

describe("apiHostRowFor", () => {
  const base = {
    logsAttach: true,
    networkLog: netLog(["https://api.acme.com/orders"]),
    pageUrl: PAGE,
  };

  it("element 모드는 null (로그 미첨부 약속 — 모드 게이트)", () => {
    expect(apiHostRowFor({ ...base, captureMode: "element" })).toBeNull();
  });

  it("logsAttach가 false면 null", () => {
    expect(apiHostRowFor({ ...base, captureMode: "screenshot", logsAttach: false })).toBeNull();
  });

  it("networkLog가 null이면 null", () => {
    expect(apiHostRowFor({ ...base, captureMode: "screenshot", networkLog: null })).toBeNull();
  });

  it("captured > 0이어도 requests가 비면 null (캡 트림 상황)", () => {
    expect(
      apiHostRowFor({ ...base, captureMode: "screenshot", networkLog: netLog([], 3) }),
    ).toBeNull();
  });

  it("screenshot + 첨부 on + 동족 요청 → 행", () => {
    expect(apiHostRowFor({ ...base, captureMode: "screenshot" })?.value).toBe("api.acme.com");
  });

  it("video 모드도 행을 만든다", () => {
    expect(apiHostRowFor({ ...base, captureMode: "video" })?.value).toBe("api.acme.com");
  });

  it("freeform 모드도 행을 만든다", () => {
    expect(apiHostRowFor({ ...base, captureMode: "freeform" })?.value).toBe("api.acme.com");
  });
});

describe("syncApiHostsRow", () => {
  const apiRow: EnvironmentRow = {
    label: API_HOSTS_LABEL,
    value: "api.acme.com",
    source: "api-hosts",
  };
  const userRow: EnvironmentRow = { label: "Locale", value: "ko-KR" };

  it("행이 없고 미삭제면 주입하고 lastDerived를 기록", () => {
    const out = syncApiHostsRow({
      rows: [userRow],
      apiRow,
      dismissed: false,
      lastDerived: null,
    });
    expect(out.rows).toEqual([userRow, apiRow]);
    expect(out.lastDerived).toBe("api.acme.com");
  });

  it("사용자가 삭제한 뒤에는 주입하지 않고 rows 참조를 그대로 반환", () => {
    const rows = [userRow];
    const out = syncApiHostsRow({ rows, apiRow, dismissed: true, lastDerived: null });
    expect(out.rows).toBe(rows);
  });

  it("값이 lastDerived 그대로면(미수정) 새 파생값으로 갱신", () => {
    const out = syncApiHostsRow({
      rows: [apiRow],
      apiRow: { ...apiRow, value: "api.acme.com, auth.acme.com" },
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([
      { label: API_HOSTS_LABEL, value: "api.acme.com, auth.acme.com", source: "api-hosts" },
    ]);
    expect(out.lastDerived).toBe("api.acme.com, auth.acme.com");
  });

  it("사용자가 고친 값은 새 파생값으로 덮지 않는다", () => {
    const edited: EnvironmentRow = {
      label: API_HOSTS_LABEL,
      value: "내가-고친.acme.com",
      source: "api-hosts",
    };
    const rows = [edited];
    const out = syncApiHostsRow({
      rows,
      apiRow: { ...apiRow, value: "api.acme.com, auth.acme.com" },
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([
      { label: API_HOSTS_LABEL, value: "내가-고친.acme.com" },
    ]);
    expect(out.lastDerived).toBeNull();
  });

  it("사용자가 고친 label도 일반 커스텀 행으로 승격한다", () => {
    const edited: EnvironmentRow = {
      label: "API 호스트",
      value: "api.acme.com",
      source: "api-hosts",
    };
    const out = syncApiHostsRow({
      rows: [edited],
      apiRow: { ...apiRow, value: "api.acme.com, auth.acme.com" },
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([{ label: "API 호스트", value: "api.acme.com" }]);
    expect(out.lastDerived).toBeNull();
  });

  it("apiRow가 null이면 미수정 자동 행을 제거하고 lastDerived를 비운다", () => {
    const out = syncApiHostsRow({
      rows: [userRow, apiRow],
      apiRow: null,
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([userRow]);
    expect(out.lastDerived).toBeNull();
  });

  // 로그 첨부 off·hydrate 지연 어느 쪽이든, 사용자가 타이핑한 문자열을 파생 부재로 지우지 않는다.
  it("apiRow가 null이어도 사용자가 고친 자동 행은 지우지 않는다", () => {
    const edited: EnvironmentRow = {
      label: API_HOSTS_LABEL,
      value: "내가-고친.acme.com",
      source: "api-hosts",
    };
    const rows = [userRow, edited];
    const out = syncApiHostsRow({
      rows,
      apiRow: null,
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([
      userRow,
      { label: API_HOSTS_LABEL, value: "내가-고친.acme.com" },
    ]);
    expect(out.lastDerived).toBeNull();
  });

  it("apiRow가 null이어도 label을 고친 자동 행은 커스텀 행으로 남긴다", () => {
    const edited: EnvironmentRow = {
      label: "API 호스트",
      value: "api.acme.com",
      source: "api-hosts",
    };
    const out = syncApiHostsRow({
      rows: [userRow, edited],
      apiRow: null,
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toEqual([
      userRow,
      { label: "API 호스트", value: "api.acme.com" },
    ]);
    expect(out.lastDerived).toBeNull();
  });

  it("apiRow가 null이고 자동 행도 없으면 rows 참조 유지 + lastDerived 초기화", () => {
    const rows = [userRow];
    const out = syncApiHostsRow({
      rows,
      apiRow: null,
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toBe(rows);
    expect(out.lastDerived).toBeNull();
  });

  // 이 가드가 죽으면 로그 배치마다 setDraft 전체 교체가 일어나 입력 중인 draft를 덮어쓴다.
  it("값·파생값이 모두 같으면 rows 참조를 그대로 반환한다 (setDraft 루프 가드)", () => {
    const rows = [apiRow];
    const out = syncApiHostsRow({
      rows,
      apiRow: { ...apiRow },
      dismissed: false,
      lastDerived: "api.acme.com",
    });
    expect(out.rows).toBe(rows);
  });

  // source 표식이 자동 행을 가르는 유일한 축이다 — label로 찾으면 사용자가 직접 만든
  // 같은 이름 행을 자동 행으로 오인해 덮어쓴다.
  it("label만 같고 source가 없는 사용자 행은 자동 행으로 취급하지 않는다", () => {
    const handWritten: EnvironmentRow = { label: API_HOSTS_LABEL, value: "손으로 쓴 값" };
    const out = syncApiHostsRow({
      rows: [handWritten],
      apiRow,
      dismissed: false,
      lastDerived: null,
    });
    expect(out.rows).toEqual([handWritten, apiRow]);
  });

  it("제거 후 로그 첨부를 다시 켜면 재주입한다 (명시 삭제만 미부활)", () => {
    const out = syncApiHostsRow({
      rows: [userRow],
      apiRow,
      dismissed: false,
      lastDerived: null,
    });
    expect(out.rows).toEqual([userRow, apiRow]);
  });

  it("사용자 커스텀 행은 건드리지 않는다", () => {
    const out = syncApiHostsRow({
      rows: [userRow],
      apiRow,
      dismissed: false,
      lastDerived: null,
    });
    expect(out.rows[0]).toBe(userRow);
  });
});

// 라이브(buildEditorCapture)와 draft 재제출(DraftDetailDialog)이 통과하는 단일 초크포인트.
// 두 경로가 갈리면 같은 초안이 저장 전후로 다른 본문을 낳는다.
describe("environmentForSubmit", () => {
  const userRow: EnvironmentRow = { label: "Locale", value: "ko-KR" };
  const autoRow: EnvironmentRow = {
    label: API_HOSTS_LABEL,
    value: "api.acme.com",
    source: "api-hosts",
  };

  it("지원 모드 + 로그 ON이면 자동 행을 포함해 원본을 유지한다", () => {
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: true,
        rows: [userRow, autoRow],
        lastDerived: "api.acme.com",
      }),
    ).toEqual([userRow, autoRow]);
  });

  it("element 모드는 로그 ON이어도 자동 행을 걷어낸다 (모드 게이트)", () => {
    expect(
      environmentForSubmit({
        captureMode: "element",
        logsAttach: true,
        rows: [userRow, autoRow],
        lastDerived: "api.acme.com",
      }),
    ).toEqual([userRow]);
  });

  it("logsAttach가 false면 자동 행을 걷어낸다", () => {
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: false,
        rows: [userRow, autoRow],
        lastDerived: "api.acme.com",
      }),
    ).toEqual([userRow]);
  });

  // 구 초안엔 apiHostsDerived가 없다. 판정 재료 없이 지우면 사용자가 고친 값을 지울 수 있다.
  it("lastDerived가 undefined면(구 초안) strip이 no-op다", () => {
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: false,
        rows: [userRow, autoRow],
        lastDerived: undefined,
      }),
    ).toEqual([userRow, autoRow]);
  });

  it("source가 api-hosts여도 값이 파생값과 다르면 보존한다 (사용자가 고친 행)", () => {
    const edited: EnvironmentRow = {
      label: API_HOSTS_LABEL,
      value: "내가-고친.acme.com",
      source: "api-hosts",
    };
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: false,
        rows: [edited],
        lastDerived: "api.acme.com",
      }),
    ).toEqual([edited]);
  });

  it("rows가 undefined면 빈 배열", () => {
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: true,
        rows: undefined,
        lastDerived: null,
      }),
    ).toEqual([]);
  });

  // 호출부가 ctx.environment로 그대로 싣는다 — 입력 참조를 돌려주면 draft 배열이 공유된다.
  it("모든 분기에서 입력과 다른 배열 참조를 반환한다", () => {
    const rows = [userRow];
    expect(
      environmentForSubmit({
        captureMode: "screenshot",
        logsAttach: true,
        rows,
        lastDerived: null,
      }),
    ).not.toBe(rows);
    expect(
      environmentForSubmit({
        captureMode: "element",
        logsAttach: false,
        rows,
        lastDerived: null,
      }),
    ).not.toBe(rows);
  });
});
