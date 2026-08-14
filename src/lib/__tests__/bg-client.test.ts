import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

type SendMessageCb = (res: unknown) => void;

let respondWith: unknown;
let lastError: { message: string } | undefined;
let lastRequest: unknown;

vi.stubGlobal("chrome", {
  runtime: {
    get lastError() {
      return lastError;
    },
    sendMessage: (req: unknown, cb: SendMessageCb) => {
      lastRequest = req;
      cb(respondWith);
    },
  },
});

import { onOAuthExpired } from "@/lib/app-events";
import { PLATFORM_TAB_KEYS } from "@/types/platform";
import {
  BgError,
  getOAuthErrorPlatform,
  isOAuthCancelled,
  isOAuthNotConfigured,
  isOAuthRefreshFailed,
  sendBg,
} from "@/lib/bg-client";

const req = { type: "ping" } as never;

// resolve로 새면 케이스가 공허해지므로, reject를 강제하면서 타입을 좁힌다.
async function rejection(p: Promise<unknown>): Promise<BgError> {
  return p.then(
    () => {
      throw new Error("expected sendBg to reject");
    },
    (e: unknown) => e as BgError,
  );
}

beforeEach(() => {
  respondWith = undefined;
  lastError = undefined;
  lastRequest = undefined;
});

describe("sendBg", () => {
  it("ok:true면 result만 resolve한다", async () => {
    respondWith = { ok: true, result: { id: "1" } };

    await expect(sendBg(req)).resolves.toEqual({ id: "1" });
  });

  it("요청 객체를 그대로 chrome.runtime.sendMessage에 넘긴다", async () => {
    respondWith = { ok: true, result: null };

    await sendBg(req);

    expect(lastRequest).toBe(req);
  });

  it("chrome.runtime.lastError가 있으면 통신 에러로 reject한다", async () => {
    lastError = { message: "port closed" };
    respondWith = { ok: true, result: "ignored" };

    await expect(sendBg(req)).rejects.toThrow("bg.error.communication");
  });

  // lastError 경로는 BgError가 아니라 평범한 Error다 — 판독기들이 이 에러에 걸리면 안 된다.
  it("lastError reject는 BgError가 아니다", async () => {
    lastError = { message: "port closed" };
    respondWith = { ok: true, result: "ignored" };

    await expect(sendBg(req)).rejects.not.toBeInstanceOf(BgError);
  });

  it("ok:false면 error·status·body를 실은 BgError로 reject한다", async () => {
    respondWith = { ok: false, error: "boom", status: 404, body: { x: 1 } };

    const err = await rejection(sendBg(req));

    expect(err).toBeInstanceOf(BgError);
    expect(err.message).toBe("boom");
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ x: 1 });
  });

  it("응답 자체가 undefined면 unknown 에러로 reject한다", async () => {
    respondWith = undefined;

    const err = await rejection(sendBg(req));

    expect(err).toBeInstanceOf(BgError);
    expect(err.message).toBe("bg.error.unknown");
  });

  it("oauthRefreshFailed 응답이면 onOAuthExpired가 platform과 함께 발화한다", async () => {
    const fn = vi.fn();
    const off = onOAuthExpired.subscribe(fn);
    respondWith = {
      ok: false,
      error: "expired",
      body: { oauthRefreshFailed: true, platform: "linear" },
    };

    await sendBg(req).catch(() => {});
    off();

    expect(fn).toHaveBeenCalledWith("linear");
  });

  // 위 케이스만으로는 "화이트리스트를 통과시켰다"와 "body.platform을 그냥 실어 보냈다"가
  // 구별되지 않는다(fixture가 통과값 하나뿐이라 인자 쪽이 항등식이 된다). 목록 밖 값을 넣어
  // getOAuthErrorPlatform이 실제로 경로에 끼어 있음을 고정한다 — 새면 App.tsx가 재연결
  // 다이얼로그를 못 골라 무음이 된다.
  it("목록 밖 platform이면 null로 발화한다 (생 필드 통과가 아니다)", async () => {
    const fn = vi.fn();
    const off = onOAuthExpired.subscribe(fn);
    respondWith = {
      ok: false,
      error: "expired",
      body: { oauthRefreshFailed: true, platform: "trello" },
    };

    await sendBg(req).catch(() => {});
    off();

    expect(fn).toHaveBeenCalledWith(null);
  });

  // 위 케이스가 게이트를 실제로 검증하려면, 플래그 없는 실패에서는 조용해야 한다.
  it("플래그 없는 ok:false에서는 onOAuthExpired가 발화하지 않는다", async () => {
    const fn = vi.fn();
    const off = onOAuthExpired.subscribe(fn);
    respondWith = { ok: false, error: "boom", body: { platform: "linear" } };

    await sendBg(req).catch(() => {});
    off();

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("OAuth 에러 판독기", () => {
  const readers = {
    oauthRefreshFailed: isOAuthRefreshFailed,
    oauthCancelled: isOAuthCancelled,
    oauthNotConfigured: isOAuthNotConfigured,
  } as const;

  for (const [flag, read] of Object.entries(readers)) {
    describe(flag, () => {
      it("BgError.body의 플래그가 true면 true", () => {
        expect(read(new BgError("e", 400, { [flag]: true }))).toBe(true);
      });

      it("플래그가 없거나 false면 false", () => {
        expect(read(new BgError("e", 400, {}))).toBe(false);
        expect(read(new BgError("e", 400, { [flag]: false }))).toBe(false);
      });

      // 서로의 플래그를 읽으면 안 된다 — isOAuthNotConfigured 주석이 "배타적"이라 못박은 축.
      it("다른 판독기의 플래그에는 반응하지 않는다", () => {
        for (const other of Object.keys(readers)) {
          if (other === flag) continue;
          expect(read(new BgError("e", 400, { [other]: true }))).toBe(false);
        }
      });

      it("truthy 문자열은 true가 아니다 (엄격 비교)", () => {
        expect(read(new BgError("e", 400, { [flag]: "true" }))).toBe(false);
      });

      it("body가 없거나 객체가 아니면 false", () => {
        expect(read(new BgError("e"))).toBe(false);
        expect(read(new BgError("e", 400, "nope"))).toBe(false);
        expect(read(new BgError("e", 400, null))).toBe(false);
      });

      // 판정은 body 플래그 전용이다 — 메시지 텍스트를 정규식으로 훑던 옛 구현으로
      // 되돌아가면 이 케이스가 red가 된다.
      it("메시지에 플래그 이름이 들어 있어도 body가 없으면 false", () => {
        expect(read(new BgError(`user ${flag} the OAuth`))).toBe(false);
      });

      // BgError가 아닌 값은 body가 같아도 거부한다 — 이게 instanceof 가드의 존재 이유다.
      it("BgError가 아니면 body가 같아도 false", () => {
        const plain = Object.assign(new Error("e"), { body: { [flag]: true } });
        expect(read(plain)).toBe(false);
        expect(read({ body: { [flag]: true } })).toBe(false);
        expect(read(undefined)).toBe(false);
      });
    });
  }
});

describe("getOAuthErrorPlatform", () => {
  // 로스터를 PlatformId 축에서 파생한다. 손으로 쓰면 9번째 플랫폼이 붙어도 green인데,
  // bg-client의 화이트리스트는 8개 그대로라 null을 돌려주고 App.tsx가 재연결 다이얼로그를
  // 못 고른다. 컴파일러는 이 화살표를 못 잡는다 — 반환이 8리터럴 union이라 넓은
  // PlatformId에 그냥 대입된다.
  const SUPPORTED = Object.keys(PLATFORM_TAB_KEYS);

  it("지원 플랫폼 전량을 그대로 돌려준다", () => {
    for (const p of SUPPORTED) {
      expect(getOAuthErrorPlatform(new BgError("e", 401, { platform: p }))).toBe(p);
    }
  });

  // 화이트리스트가 목록으로서 동작하는지 — 통과하면 안 되는 값을 섞는다.
  it("목록 밖 문자열은 null이다", () => {
    for (const p of ["bitbucket", "trello", "", "JIRA", "jira "]) {
      expect(getOAuthErrorPlatform(new BgError("e", 401, { platform: p }))).toBe(null);
    }
  });

  it("platform이 문자열이 아니면 null이다", () => {
    expect(getOAuthErrorPlatform(new BgError("e", 401, { platform: 1 }))).toBe(null);
    expect(getOAuthErrorPlatform(new BgError("e", 401, {}))).toBe(null);
  });

  it("body가 없거나 객체가 아니면 null이다", () => {
    expect(getOAuthErrorPlatform(new BgError("e"))).toBe(null);
    expect(getOAuthErrorPlatform(new BgError("e", 401, "jira"))).toBe(null);
  });

  it("BgError가 아니면 null이다", () => {
    expect(
      getOAuthErrorPlatform(Object.assign(new Error("e"), { body: { platform: "jira" } })),
    ).toBe(null);
    expect(getOAuthErrorPlatform(null)).toBe(null);
  });
});

describe("BgError", () => {
  it("name이 BgError이고 status·body를 보존한다", () => {
    const err = new BgError("msg", 500, { a: 1 });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BgError");
    expect(err.message).toBe("msg");
    expect(err.status).toBe(500);
    expect(err.body).toEqual({ a: 1 });
  });

  it("status·body는 선택이다", () => {
    const err = new BgError("msg");

    expect(err.status).toBeUndefined();
    expect(err.body).toBeUndefined();
  });
});
