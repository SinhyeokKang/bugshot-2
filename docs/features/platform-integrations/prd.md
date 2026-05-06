# Platform Integrations — GitHub 1차 (PRD)

## 배경

bugshot-2는 현재 Jira 전용 이슈 등록기다. Linear/GitHub/Notion/Slack 사용 팀도 같은 워크플로우(요소 픽 → 스타일 비교 → 이슈 등록)를 쓸 수 있게 확장한다. 첫 차례는 **GitHub** — Jira와 가장 유사한 이슈 트래커이면서, OAuth Web Flow까지 한 번에 검증해 향후 Linear/Notion이 동일한 어댑터 패턴을 그대로 복제할 수 있는 발판을 만든다.

## 목표

- GitHub repository에 이슈를 등록할 수 있다(repo/title/body/labels/assignees 메타 포함).
- 인증 방식 두 가지 모두 지원: OAuth Web Flow(앱 설치 없이 클릭 한 번) + PAT(개인 토큰 직접 입력).
- 사용자는 Jira·GitHub 두 플랫폼을 동시에 연결해두고 이슈 작성 시 어디로 보낼지 선택할 수 있다.
- 기존 Jira 워크플로우는 회귀 없이 동일하게 동작한다.
- 본 작업으로 도입된 어댑터 패턴(Auth union, accounts 스토어, 메시지 namespace, body 빌더 라우팅)을 후속 Linear/Notion에서 그대로 재사용 가능한 형태로 둔다.

## 비목표 (Non-goals)

- Linear/Notion/Slack 통합(각각 후속 차례).
- GitHub Enterprise Server 자체 호스팅 지원(이번엔 github.com만; PAT 폼에 baseUrl을 받지 않는다).
- GitHub App(installation 모델). 이번 차례는 OAuth App만.
- 자동 첨부(이미지를 제외한 HAR/콘솔 로그/대용 이미지). 본문에 안내 푸터로 갈음.
- 플랫폼 간 이슈 동기화/미러링.

## 사용자 시나리오

1. **GitHub 신규 연결 (OAuth)**: 사이드패널 → "연동 설정" 탭 → [GitHub] sub-tab → "GitHub로 로그인" 버튼 → 새 창에서 GitHub authorize → 콜백 → "{viewer.login}으로 연결됨" 카드 표시.
2. **GitHub 신규 연결 (PAT)**: 동일 sub-tab 하단 "Personal Access Token" 섹션에서 토큰 입력 → 저장 → viewer 검증 → 연결됨.
3. **이슈 등록(다중 활성)**: Jira·GitHub 둘 다 연결된 상태에서 사이드패널 등록 다이얼로그 상단에 PlatformPicker(Jira/GitHub 칩). GitHub 선택 시 메타 필드가 RepoCombobox + LabelMultiSelect + AssigneeMultiSelect로 동적 전환. 등록 성공 → 토스트에 issue URL.
4. **본문 인라인 vs 안내**: 스크린샷 1장(50KB) → base64로 본문에 인라인. 캡(아래 design 참조) 초과 → 본문에 "이 첨부는 사이드패널에서 다운로드 후 GitHub UI에서 paste/drag로 업로드하세요" 안내 + 사이드패널은 다운로드 버튼 노출.
5. **OAuth 만료**: refresh token도 무효 → 다이얼로그로 재인증 안내(기존 Jira AlertDialog 패턴 동일).
6. **Jira 연결만 있던 기존 사용자**: 업그레이드 후 [Jira] sub-tab에 기존 연결 그대로 보여짐. [GitHub]는 빈 폼.

## 성공 기준

- GitHub OAuth Web Flow로 연결 → 이슈 1건 등록 → 본문에 스크린샷 1장 base64 인라인 + 메타(스타일 diff 표·URL·selector) 포함, GitHub UI에서 정상 렌더.
- GitHub PAT으로 연결 → 같은 시나리오 통과.
- Jira·GitHub 동시 연결 → 같은 draft를 양쪽으로 각각 등록 가능.
- v2 → v3 마이그레이션: 기존 Jira 단일 사용자가 업그레이드해도 회귀 없음.
- 첨부 캡 초과 케이스 1건 수동 검증(예: 큰 PNG): 본문이 깨지지 않고 안내 푸터가 정상 노출.
- 단위 테스트: GitHub 페이로드 매퍼, base64 인라인 캡 헬퍼, settings-store v2→v3 마이그레이션 각 케이스.
