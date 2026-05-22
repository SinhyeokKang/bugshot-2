let cached: string | null = null;

export function formatOsInfo(
  platform: string,
  platformVersion: string,
): string {
  if (platform === "macOS" || platform === "Chrome OS") {
    if (!platformVersion) return platform;
    const segments = platformVersion.split(".");
    const short = segments.slice(0, 2).join(".");
    return `${platform} ${short}`;
  }

  if (platform === "Windows") {
    const major = parseInt(platformVersion.split(".")[0], 10);
    if (major >= 13) return "Windows 11";
    if (major >= 1) return "Windows 10";
    return "Windows";
  }

  if (platform === "Linux") return "Linux";

  return platform;
}

export async function resolveOsInfo(): Promise<string | null> {
  try {
    const ua = navigator.userAgentData;
    if (!ua) return null;
    const data = await ua.getHighEntropyValues(["platformVersion"]);
    cached = formatOsInfo(data.platform, data.platformVersion);
    return cached;
  } catch {
    return null;
  }
}

export function getOsInfo(): string | null {
  return cached;
}
