// PostHog 익명 이슈 제출 집계. VITE_POSTHOG_KEY는 store 빌드에서만 vite define으로 값이
// 박힌다(VITE_POSTHOG_KEY_PROD 승격) → dev/일반/e2e 빌드는 키가 비어 no-op. define 치환이라
// vi.stubEnv가 안 먹히므로 게이팅·전송 로직은 키·host를 인자로 받는 순수/주입 함수로 분리해 테스트한다.

export interface PosthogCaptureBody {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, string | boolean>;
}

export function analyticsEnabled(key: string | undefined): boolean {
  return !!(key ?? "").trim();
}

function posthogHost(): string {
  return (import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com")
    .trim()
    .replace(/\/+$/, "");
}

// 허용목록. `analytics.capture`는 사이드패널에서 임의 문자열·임의 Record<string,string>을
// 받으므로 런타임 방어가 없으면 Privacy 코어밸류의 유일한 무방비 지점이 된다 — 목록 밖 event는
// 통째로 드롭하고, 목록 밖 property 키도 payload에서 뺀다(값은 원문 유지).
const ALLOWED_EVENTS: Record<string, readonly string[]> = {
  // project_overridden: Jira 한정. 이번 제출의 프로젝트가 계정 기본값과 달랐는지만 보낸다
  // (프로젝트 키 자체는 보내지 않는다).
  issue_submitted: [
    "platform",
    "capture_mode",
    "result",
    "replay_trimmed",
    "trim_source",
    "project_overridden",
  ],
  // reason에는 ConnectReason 고정 enum만 온다 — 상류 error_description·응답 본문을
  // 이 목록에 얹지 말 것(원문이 나가는 유일한 경로가 된다).
  platform_connect: ["platform", "result", "reason"],
  platform_disconnected: ["platform"],
  extension_installed: ["version"],
  // page_supported: 패널이 미지원 페이지에서도 열리게 되면서 이 이벤트가 기계적으로 늘어난다.
  // 이 property 없이는 배포 후 상승이 그 증가분인지 실제 activation 회복인지 가를 수 없다.
  sidepanel_opened: ["page_supported"],
};

export function isAllowedEvent(event: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_EVENTS, event);
}

export function filterProperties(
  event: string,
  properties: Record<string, string>,
): Record<string, string> {
  const allowed = ALLOWED_EVENTS[event];
  if (!allowed) return {};
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const value = properties[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function buildCaptureBody(
  event: string,
  properties: Record<string, string>,
  distinctId: string,
  apiKey: string,
): PosthogCaptureBody {
  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      $process_person_profile: false,
      // 빈 문자열은 ingestion에서 무시돼 PostHog가 소스 IP로 덮어쓴다. 더미 IP로 실제 IP를 가린다.
      $ip: "0.0.0.0",
      $geoip_disable: true,
    },
  };
}

export async function postCapture(
  host: string,
  body: PosthogCaptureBody,
): Promise<void> {
  try {
    await fetch(host + "/capture/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // extension_installed는 onInstalled 리스너가 동기 반환한 뒤 fire-and-forget으로 나가므로
      // MV3가 그 사이 SW를 종료하면 요청이 통째로 사라진다. keepalive면 SW가 죽어도 브라우저가
      // 전송을 완주시킨다(64KB 제한 — payload는 수백 바이트).
      keepalive: true,
    });
  } catch (err) {
    console.warn("[bugshot] analytics capture failed", err);
  }
}

const INSTALL_ID_KEY = "bugshot:install-id";

export function resolveInstallationId(
  stored: string | undefined,
  generate: () => string,
): { id: string; created: boolean } {
  const trimmed = (stored ?? "").trim();
  if (trimmed) return { id: trimmed, created: false };
  return { id: generate(), created: true };
}

// 설치 단위 익명 식별자(무작위 UUID, PII 아님). 매 이벤트 새 UUID 대신 이걸 공유해
// 같은 설치의 이벤트를 PostHog에서 연결한다(활성화율·플랫폼 인기도 비율 산출).
async function getInstallationId(): Promise<string> {
  // 락 없음: 최초 동시 발화 시 두 호출이 서로 다른 UUID를 set할 수 있으나(마지막이 승),
  // 설치당 1~2개 이벤트의 id가 갈리는 정도라 익명 집계 통계엔 무해. 뮤텍스는 과함.
  const data = await chrome.storage.local.get(INSTALL_ID_KEY);
  const { id, created } = resolveInstallationId(
    data[INSTALL_ID_KEY] as string | undefined,
    () => crypto.randomUUID(),
  );
  if (created) await chrome.storage.local.set({ [INSTALL_ID_KEY]: id });
  return id;
}

export async function captureEvent(
  event: string,
  properties: Record<string, string>,
): Promise<void> {
  const key = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
  if (!analyticsEnabled(key)) return;
  if (!isAllowedEvent(event)) {
    if (import.meta.env.DEV) {
      console.warn("[bugshot] analytics: dropped unlisted event", event);
    }
    return;
  }
  await postCapture(
    posthogHost(),
    buildCaptureBody(
      event,
      filterProperties(event, properties),
      await getInstallationId(),
      key,
    ),
  );
}
