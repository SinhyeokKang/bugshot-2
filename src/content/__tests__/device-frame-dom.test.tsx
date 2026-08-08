import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_FRAME_ID,
  DEVICE_STYLE_ID,
  currentDeviceWidth,
  deviceFrameUrl,
  isDeviceFrame,
  isHiddenTopElement,
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
// 래퍼 안에서 same-origin 이동을 해도 top URL은 안 바뀐다 — 캡처가 기록할 주소를
// `chrome.tabs.get().url`에서 가져오면 리포트 Page 행·세션 키가 사용자가 본 화면과 갈린다.
describe("deviceFrameUrl", () => {
  it("래퍼가 없으면 null", () => {
    expect(deviceFrameUrl()).toBeNull();
  });

  it("래퍼가 있으면 그 문서의 주소를 돌려준다", () => {
    mountDeviceFrame(390, TITLE);
    const frame = frameEl()!;
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { location: { href: "https://a.com/detail" } },
    });
    expect(deviceFrameUrl()).toBe("https://a.com/detail");
  });

  // src를 세운 직후~커밋 전까지 contentWindow는 about:blank다. 그걸 주소로 돌려주면
  // 전이 중에 시작한 캡처가 "about:blank"로 기록되고, 곧 커밋되는 진짜 URL이 세션
  // 만료 판정에서 다른 페이지로 읽혀 방금 만든 캡처 세션을 지운다.
  it("아직 커밋 전(about:blank)이면 null", () => {
    mountDeviceFrame(390, TITLE);
    Object.defineProperty(frameEl()!, "contentWindow", {
      configurable: true,
      value: { location: { href: "about:blank" } },
    });
    expect(deviceFrameUrl()).toBeNull();
  });

  // same-origin 불변식이 깨지는 순간(cross-origin으로 밀림)엔 접근이 throw한다.
  it("접근이 throw하면 null로 접는다", () => {
    mountDeviceFrame(390, TITLE);
    Object.defineProperty(frameEl()!, "contentWindow", {
      configurable: true,
      get() {
        throw new Error("cross-origin");
      },
    });
    expect(deviceFrameUrl()).toBeNull();
  });
});

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

// 래퍼는 body의 유일한 표시 자식이고 body 자신은 height:100vh; display:flex다 — 좌우 여백
// (390 모드에서 각 500px대)을 클릭하면 elementFromPoint가 **숨겨진 top의 body**를 돌려준다.
// 그걸 그대로 고르면 편집은 화면에 아무 효과가 없고, 리포트의 Viewport는 element 경로의
// frameId 0 분기 때문에 top 실폭으로 기록된다(PRD 목표 5 위반).
describe("isHiddenTopElement", () => {
  it("모드 OFF면 무엇도 숨은 top이 아니다", () => {
    expect(isHiddenTopElement(document.body)).toBe(false);
  });

  it("모드 ON에서 래퍼 밖 top 요소는 숨은 top이다", () => {
    mountDeviceFrame(390, TITLE);
    expect(isHiddenTopElement(document.body)).toBe(true);
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(isHiddenTopElement(div)).toBe(true);
  });

  it("래퍼 자신은 아니다 — 그 클릭은 기존 iframe 핸드오프 경로가 받는다", () => {
    mountDeviceFrame(390, TITLE);
    expect(isHiddenTopElement(frameEl())).toBe(false);
  });

  it("null은 아니다 — 호출부의 기존 null 처리를 뺏지 않는다", () => {
    mountDeviceFrame(390, TITLE);
    expect(isHiddenTopElement(null)).toBe(false);
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

  // `id`는 페이지가 붙이는 DOM 속성이라, 2-depth에 심은 프레임이 래퍼를 자칭해
  // allowsContextExpansion(=캡처 범위 확장)을 열 수 있다. 진짜 래퍼는 top의 직속 자식뿐이다.
  it("top의 직속 자식이 아니면 id가 같아도 false", () => {
    const fake = document.createElement("iframe");
    fake.id = DEVICE_FRAME_ID;
    vi.spyOn(window, "frameElement", "get").mockReturnValue(fake);
    vi.spyOn(window, "parent", "get").mockReturnValue({} as Window);
    expect(isDeviceFrame()).toBe(false);
    vi.restoreAllMocks();
  });
});
