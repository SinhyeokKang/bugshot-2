import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_FRAME_ID,
  DEVICE_STYLE_ID,
  currentDeviceWidth,
  isDeviceFrame,
  mountDeviceFrame,
  unmountDeviceFrame,
} from "../device-frame";

const TITLE = "BugShot device viewport";

function frameEl(): HTMLIFrameElement | null {
  return document.getElementById(DEVICE_FRAME_ID) as HTMLIFrameElement | null;
}

function styleEl(): HTMLStyleElement | null {
  return document.getElementById(DEVICE_STYLE_ID) as HTMLStyleElement | null;
}

beforeEach(() => {
  unmountDeviceFrame();
  document.body.innerHTML = "";
});

// OFF는 unmount + reload인데, 래퍼가 한 번도 안 선 페이지(전달 실패 롤백)에서도 reload를
// 돌면 정상 페이지의 스크롤·입력값을 이유 없이 날린다 — 되돌릴 게 있었는지를 호출부가 알아야 한다.
describe("unmountDeviceFrame 반환값", () => {
  it("래퍼가 없었으면 false", () => {
    expect(unmountDeviceFrame()).toBe(false);
  });

  it("래퍼가 있었으면 true이고, 두 번째 호출은 false", () => {
    mountDeviceFrame(390, TITLE);
    expect(unmountDeviceFrame()).toBe(true);
    expect(unmountDeviceFrame()).toBe(false);
  });
});

describe("mountDeviceFrame", () => {
  it("래퍼가 document.body의 직속 자식이다", () => {
    document.body.innerHTML = "<main id='page'>original</main>";
    mountDeviceFrame(390, TITLE);
    const frame = frameEl();
    expect(frame).not.toBeNull();
    // shadow root 안에 넣으면 frame-geometry의 findChildIframe이 못 찾아 미등록이 되고,
    // elementFromPoint가 shadow retargeting으로 host를 조용히 선택한다.
    expect(frame!.parentElement).toBe(document.body);
  });

  // 모드 ON이면 페이지 전체가 이 프레임 하나라, 접근명이 없으면 무명 프레임이 된다.
  // content script는 사전을 못 읽으므로 문자열은 device.set 페이로드로 들어온다.
  it("래퍼가 전달받은 접근명을 title로 단다", () => {
    mountDeviceFrame(390, TITLE);
    expect(frameEl()!.title).toBe(TITLE);
  });

  it("래퍼의 src가 location.href다 (srcdoc·about:blank가 아니다)", () => {
    mountDeviceFrame(390, TITLE);
    const frame = frameEl()!;
    expect(frame.getAttribute("src")).toBe(location.href);
    expect(frame.hasAttribute("srcdoc")).toBe(false);
  });

  it("currentDeviceWidth가 mount 전 null, mount 후 폭을 돌려준다", () => {
    expect(currentDeviceWidth()).toBeNull();
    mountDeviceFrame(390, TITLE);
    expect(currentDeviceWidth()).toBe(390);
  });

  // title은 노드 생성 분기 밖에 있어야 한다 — 안에 두면 로케일을 바꾼 뒤 폭만 전환했을 때
  // (노드를 유지하는 경량 경로) 접근명이 옛 로케일로 남는다.
  it("폭만 바꿔도 접근명이 새 값으로 갱신된다", () => {
    mountDeviceFrame(390, TITLE);
    mountDeviceFrame(768, "BugShot 디바이스 뷰포트");
    expect(frameEl()!.title).toBe("BugShot 디바이스 뷰포트");
  });

  it("래퍼가 있는 상태에서 다시 부르면 iframe 노드가 교체되지 않고 폭만 바뀐다", () => {
    mountDeviceFrame(390, TITLE);
    const first = frameEl();
    mountDeviceFrame(768, TITLE);
    expect(frameEl()).toBe(first);
    expect(currentDeviceWidth()).toBe(768);
    // 재로드가 없어야 스크롤 위치·입력값이 유지된다.
    expect(first!.getAttribute("src")).toBe(location.href);
  });

  it("로드를 기다리거나 스스로 unmount하지 않는다 (판정 책임이 이 모듈에 없다)", () => {
    // XFO/CSP 판정 주체는 background다. 반환값이 Promise가 아니어야 계약이 지켜진다.
    const ret = mountDeviceFrame(390, TITLE) as unknown;
    expect(ret).toBeUndefined();
    expect(frameEl()).not.toBeNull();
  });

});

describe("주입 스타일시트", () => {
  it("라이트/다크 배경값이 서로 다르고 다크 미디어쿼리 블록이 있다", () => {
    mountDeviceFrame(390, TITLE);
    const css = styleEl()!.textContent ?? "";
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
    const light = css.slice(0, darkAt).match(/background:\s*(hsl\([^)]+\))/)?.[1];
    const dark = css.slice(darkAt).match(/background:\s*(hsl\([^)]+\))/)?.[1];
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(light).not.toBe(dark);
  });

  it("원본 자식은 display:none으로 숨긴다 (visibility가 아니다)", () => {
    mountDeviceFrame(390, TITLE);
    const css = styleEl()!.textContent ?? "";
    // visibility면 레이아웃이 살아 원본 문서의 옵저버·측정 코드가 계속 돌아 유령 로그가 는다.
    expect(css).toMatch(
      new RegExp(`body\\s*>\\s*\\*:not\\(#${DEVICE_FRAME_ID}\\)[^}]*display:\\s*none`),
    );
  });
});

describe("unmountDeviceFrame", () => {
  it("style·iframe이 둘 다 제거된다", () => {
    mountDeviceFrame(390, TITLE);
    unmountDeviceFrame();
    expect(frameEl()).toBeNull();
    expect(styleEl()).toBeNull();
    expect(currentDeviceWidth()).toBeNull();
  });

  // 은닉이 스타일시트 한 장이므로 저장·복원 자체가 없다. "복원이 정확한가"가 아니라
  // "애초에 건드리지 않았는가"를 본다.
  it("원본 요소의 인라인 style 속성을 한 번도 변경하지 않는다", () => {
    document.body.innerHTML = "<main id='page' style='color: red'>x</main><aside>y</aside>";
    const main = document.getElementById("page")!;
    const aside = document.querySelector("aside")!;
    const beforeMain = main.getAttribute("style");
    const beforeAside = aside.getAttribute("style");
    mountDeviceFrame(390, TITLE);
    expect(main.getAttribute("style")).toBe(beforeMain);
    expect(aside.getAttribute("style")).toBe(beforeAside);
    unmountDeviceFrame();
    expect(main.getAttribute("style")).toBe(beforeMain);
    expect(aside.getAttribute("style")).toBe(beforeAside);
  });

  it("2회 호출해도 throw하지 않는다 (멱등)", () => {
    mountDeviceFrame(390, TITLE);
    unmountDeviceFrame();
    expect(() => unmountDeviceFrame()).not.toThrow();
  });
});

describe("isDeviceFrame", () => {
  it("top 문서에서는 false", () => {
    expect(isDeviceFrame()).toBe(false);
  });

  it("frameElement.id가 래퍼 id면 true", () => {
    const fake = document.createElement("iframe");
    fake.id = DEVICE_FRAME_ID;
    vi.spyOn(window, "frameElement", "get").mockReturnValue(fake);
    expect(isDeviceFrame()).toBe(true);
    vi.restoreAllMocks();
  });

  it("일반 iframe 안에서는 false (게이트가 래퍼 하나만 추가한다)", () => {
    const fake = document.createElement("iframe");
    fake.id = "some-other-frame";
    vi.spyOn(window, "frameElement", "get").mockReturnValue(fake);
    expect(isDeviceFrame()).toBe(false);
    vi.restoreAllMocks();
  });
});
