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
    });
  } catch (err) {
    console.warn("[bugshot] analytics capture failed", err);
  }
}

export async function captureEvent(
  event: string,
  properties: Record<string, string>,
): Promise<void> {
  const key = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
  if (!key) return;
  await postCapture(
    posthogHost(),
    buildCaptureBody(event, properties, crypto.randomUUID(), key),
  );
}
