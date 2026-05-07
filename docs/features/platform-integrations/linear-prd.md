# Platform Integrations — Linear 2차 (PRD)

## 배경

bugshot-2는 현재 Jira와 GitHub에 이슈를 등록할 수 있다. 둘 다 어댑터 패턴(discriminated union auth, namespaced 메시지, per-platform 스토어 entry, 동적 필드 렌더링)으로 구현되어 있으며 GitHub 1차에서 후속 플랫폼이 같은 패턴을 복제할 수 있는 발판을 만들었다. Linear는 세 번째 플랫폼이다.

Linear 선택 근거:
- **도메인 일치**: 이슈 트래커라 "요소 선택 → 이슈 등록" 흐름에 1:1 매핑.
- **PKCE 지원**: Linear OAuth는 public client flow(PKCE)를 지원해 **oauth-proxy가 불필요**. Jira/GitHub 대비 인프라 의존이 줄어든다.
- **마크다운 네이티브**: 이슈 본문이 마크다운 원본으로 저장·렌더. Jira ADF 같은 변환이 없다.
- **단일 GraphQL 엔드포인트**: REST 대신 `https://api.linear.app/graphql` 하나로 모든 조회·생성.

## 목표

1. Linear에 이슈를 등록할 수 있다(Team 필수, Project/Label/Assignee/Priority 선택 메타 포함).
2. 인증 두 가지 모두 지원: OAuth 2.0 PKCE(클릭 한 번, proxy 불필요) + Personal API Key(수동 입력).
3. 사용자는 Jira·GitHub·Linear 세 플랫폼을 동시에 연결하고 이슈 작성 시 선택할 수 있다.
4. 기존 Jira·GitHub 워크플로우는 회귀 없이 동일하게 동작한다.
5. 어댑터 패턴을 그대로 복제해 후속 Notion/Slack에서도 같은 방식을 따를 수 있다.

## 비목표 (Non-goals)

- Notion/Slack 통합(각각 후속 차례).
- Linear webhook, 이슈 업데이트, 양방향 동기화.
- `fileUpload` mutation + presigned URL을 통한 파일 자동 첨부(GitHub과 동일하게 본문에 파일명 안내로 갈음).
- 이슈 생성 시 workflow state 선택(Linear가 팀 기본 시작 상태를 자동 지정).
- Linear cycle, estimate, sub-issue.
- Linear App(installation 모델) — 개인 OAuth와 API Key만.

## 사용자 시나리오

1. **Linear OAuth 연결 (PKCE)**: 사이드패널 → "연동 설정" 탭 → [Linear] sub-tab → "Linear로 로그인" 버튼 → 새 창에서 Linear authorize → 콜백 → extension이 직접 토큰 교환(proxy 없음) → "{displayName}으로 연결됨" 카드 표시.
2. **Linear API Key 연결**: 동일 sub-tab → "API Key" 섹션에서 키 입력 → `viewer` 쿼리로 검증 → 연결됨.
3. **이슈 등록(3개 플랫폼 활성)**: Jira·GitHub·Linear 모두 연결. 등록 다이얼로그 상단에 3-tab 셀렉터. Linear 선택 시 Team combobox(필수) + Project/Label/Assignee/Priority 필드 동적 렌더. 등록 성공 → 토스트에 Linear issue URL(`https://linear.app/.../issue/ENG-123`).
4. **본문 내용**: 마크다운 본문. `MarkdownContext` 기반 빌더. 첨부는 `## Attachments` 섹션에 파일명만 안내(GitHub과 동일한 `attachmentNotInline` 패턴).
5. **OAuth 토큰 갱신**: Linear access token은 24시간 만료. refresh token으로 `https://api.linear.app/oauth/token`에 직접 갱신(proxy 없음). refresh 실패 시 기존 `onOAuthExpired(platform)` AlertDialog 패턴으로 "Linear" 레이블 재인증 안내.
6. **기존 사용자 업그레이드**: Jira/GitHub 연결 보존. [Linear] sub-tab에 빈 온보딩 UI.

## 성공 기준

- Linear OAuth PKCE 연결 → 이슈 1건 등록 → 본문에 마크다운 내용 + 메타(스타일 diff 표·URL·selector) 포함, Linear UI에서 정상 렌더.
- Linear API Key 연결 → 같은 시나리오 통과.
- 세 플랫폼 동시 연결 → 같은 draft를 세 곳 각각 등록 가능.
- `settings-store` v3→v4 마이그레이션: 기존 Jira/GitHub 사용자 업그레이드해도 회귀 없음.
- `PlatformId` union에 `"linear"` 추가, 기존 entry 영향 없음.
- 단위 테스트: Linear GraphQL 에러 파서, settings-store v3→v4 마이그레이션, PKCE challenge 생성기, body 빌더 각 케이스.
- i18n: ko/en 키 패리티 유지.
