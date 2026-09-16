import type { GithubRepo } from "@/types/github";

// 소비처는 사이드패널뿐이지만 leaf에 둔다 — 판정이 background/github-api 옆에 있으면
// 패널이 그걸 value import하게 되고, 그 순간 OAuth 런처가 패널 번들에 딸려온다.
export function canCreateIssue(repo: GithubRepo): boolean {
  return repo.hasIssues && !repo.archived;
}
