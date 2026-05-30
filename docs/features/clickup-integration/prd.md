# ClickUp 연동 (이슈 플랫폼)

## 배경

bugshot-2는 현재 Jira·GitHub·Linear·Notion·GitLab을 지원한다. ClickUp은 성장세 PM 툴로, task description이 **마크다운 네이티브**(`markdown_content`)이고 생성 페이로드가 평범한 JSON이라 **세 후보 중 순수 재사용성이 가장 높다**(변환기 0 + JSON Patch 같은 특수 직렬화 없음). Asana의 약점(html_notes 변환기)을 제거한 형태.

## 목표

- 사용자가 ClickUp을 **Personal API Token(`pk_…`)**으로 연결한다.
- 버그 스냅샷을 ClickUp **task**로 생성한다.
- task 생성 시 team(workspace)·space·(folder)·list·assignee를 선택한다.
- 생성된 task의 status(list별 커스텀 상태)를 이슈 목록에서 조회·변경한다.
- GitLab 통합과 동일한 파일 구조를 따른다.

## 비목표 (Non-goals)

- **OAuth2 인증** — confidential client(secret) → 프록시 필요. MVP는 Personal Token only. 후속.
- custom fields·tags·priority 매핑 (MVP는 name·markdown_content·list·assignee).
- 서브태스크·종속성·체크리스트.
- 멀티 list 동시 등록.

## 사용자 시나리오

1. **연결**: Integrations 탭 → ClickUp → Personal Token(`pk_…`) 입력 → `/user`로 검증 후 기본 team·space·list 선택.
2. **이슈 등록**: 캡처 → 플랫폼 ClickUp 선택 → team→space→(folder)→list→assignee 선택 → 제목·본문 → 등록. 미디어는 task 생성 후 attachment 업로드.
3. **상태 확인**: 이슈 목록 배지가 task status를 표시. 클릭으로 list status 중 닫힘/완료 계열로 변경.

### 엣지 케이스

- **folderless list**: space 직속 list가 존재 → `/space/{id}/list`(folderless) + `/folder/{id}/list` 양쪽 조회 병합.
- **커스텀 status**: list마다 status 집합이 다름 → list 선택 후 status 메타를 조회해 닫힘(`type:"closed"|"done"`) 후보 결정.
- **인라인 이미지**: ClickUp attachment URL의 마크다운 인라인 렌더 여부 불확실 → 첨부 + 본문 링크 폴백(구현 전 검증).
- **업로드 실패**: per-file 격리 (GitLab 패턴).

## 성공 기준

- Personal Token 연결 후 실제 ClickUp task 생성 + URL이 이슈 레코드에 저장.
- 첨부 미디어가 task attachment로 업로드.
- 상태 배지가 task status를 정확히 반영, 변경 동작.
- `pnpm test` / `pnpm typecheck` 통과.
- 실제 ClickUp workspace에서 수동 E2E 1회 성공.
