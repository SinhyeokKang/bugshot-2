import { t } from "@/i18n";
import { isCredentialSafeUrl } from "./loopback-host";

// 접두사를 union으로 묶어 `${prefix}.invalid`가 TranslationKey에 속하는지 컴파일러가 보게 한다.
// 자유 문자열로 받으면 t()에 캐스트가 필요해지고, 키 리네임을 tsc가 못 잡는다.
type CredentialUrlKeyPrefix = "jira.workspaceUrl" | "gitlab.instanceUrl";

// 자격증명이 실려 나갈 base URL의 egress 관문. 판정은 isCredentialSafeUrl에 위임하고
// 여기서는 i18n 문구만 입힌다 — 판정을 복제하면 loopback 예외가 갈린다.
export function assertCredentialSafeBase(
  base: string,
  keyPrefix: CredentialUrlKeyPrefix,
): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(t(`${keyPrefix}.invalid`));
  }
  if (!isCredentialSafeUrl(url)) {
    throw new Error(t(`${keyPrefix}.insecure`));
  }
  return base;
}
