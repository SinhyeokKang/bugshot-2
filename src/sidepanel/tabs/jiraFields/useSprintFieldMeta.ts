import { useEffect, useState } from "react";
import { jiraSiteId, useSettingsStore } from "@/store/settings-store";
import type { JiraAuth, JiraSprintFieldMeta } from "@/types/jira";
import { sendBg } from "@/lib/bg-client";

// 세션 캐시. Jira의 create 화면 구성은 세션 중 거의 바뀌지 않고, stale이 400으로 이어지지도
// 않는다(제출 시 background가 어차피 재해석한다). siteId를 키에 넣는 건 연동을 갈아끼운 뒤
// 이전 사이트의 판정이 남지 않게 하기 위함이다.
const cache = new Map<string, JiraSprintFieldMeta | null>();

function cacheKey(
  auth: JiraAuth | undefined,
  projectKey: string | undefined,
  issueTypeId: string | undefined,
): string | null {
  return projectKey && issueTypeId && auth
    ? `${jiraSiteId(auth)}|${projectKey}|${issueTypeId}`
    : null;
}

/**
 * 이미 받아둔 판정만 읽는다(요청하지 않는다). 제출 시점에 분석 축 하나를 채우려고 훅으로
 * 구독하면 다이얼로그가 닫혀 있어도, Jira가 아닌 플랫폼으로 제출해도 createmeta가 나간다 —
 * 그 경로에서 401이 나면 Jira 재로그인 안내까지 전역으로 뜬다.
 */
export function peekSprintFieldMeta(
  auth: JiraAuth | undefined,
  projectKey: string | undefined,
  issueTypeId: string | undefined,
): JiraSprintFieldMeta | null {
  const key = cacheKey(auth, projectKey, issueTypeId);
  return key ? (cache.get(key) ?? null) : null;
}

/**
 * (프로젝트, 이슈타입)의 create 화면에 Sprint 필드가 실제로 올라가 있는지 서버에 묻는다.
 *
 * "이미 받았나"를 비동기 state로 판정하지 않는다 — 판정 키는 요청을 규정한 입력이어야 한다
 * (docs/POSTMORTEM.md 2026-08-12: 같은 디렉터리 콤보가 이 함정으로 로딩 고착/빈 목록을 오갔다).
 */
export function useSprintFieldMeta(
  projectKey: string | undefined,
  issueTypeId: string | undefined,
): {
  meta: JiraSprintFieldMeta | null;
  loading: boolean;
  failed: boolean;
  // 이 (사이트, 프로젝트, 이슈타입)에 대해 답을 받았나. "아직 안 물어봤다"와 "서버가 없다고
  // 답했다"를 상위가 구분해야 값 비우기가 인증·입력이 잠깐 빈 순간에 선택을 지우지 않는다.
  answered: boolean;
} {
  const auth = useSettingsStore((s) => s.accounts.jira?.auth);
  const key = cacheKey(auth, projectKey, issueTypeId);
  const [entry, setEntry] = useState<{
    key: string;
    meta: JiraSprintFieldMeta | null;
    failed?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!key || !projectKey || !issueTypeId || cache.has(key)) return;
    // 실패는 캐시에 안 남으므로 같은 키로 되돌아오면 entry에 남은 옛 실패가 "이미 답을 받았다"로
    // 읽힌다 — 재요청을 내면서 그 기록을 비워야 로딩 자리 예약이 다시 걸린다.
    setEntry(null);
    sendBg<JiraSprintFieldMeta | null>({
      type: "jira.sprintFieldMeta",
      projectKey,
      issueTypeId,
    })
      .then((res) => {
        cache.set(key, res ?? null);
        setEntry({ key, meta: res ?? null });
      })
      // 판정 실패는 "필드 없음 확정"과 구분한다 — 실패를 확정으로 읽으면 429 한 번에
      // 사용자가 고른 스프린트가 지워진다. 캐시엔 안 남겨 다음에 재시도한다.
      .catch(() => {
        setEntry({ key, meta: null, failed: true });
      });
  }, [key, projectKey, issueTypeId]);

  // stale 응답 방어는 seq 카운터가 아니라 이 키 대조가 한다 — entry가 자기 키를 들고 다니므로
  // 늦게 도착한 이전 키의 응답은 렌더에서 그대로 탈락한다(성공분은 캐시가 한 겹 더 앞선다).
  const resolved = !key
    ? null
    : cache.has(key)
      ? { key, meta: cache.get(key) ?? null, failed: false }
      : entry?.key === key
        ? entry
        : null;

  return {
    meta: resolved?.meta ?? null,
    loading: !!key && !resolved,
    failed: !!resolved?.failed,
    answered: !!resolved,
  };
}
