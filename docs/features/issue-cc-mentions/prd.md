# 이슈 CC 멘션 (멤버 참조)

## 배경

이슈를 등록할 때 담당자(assignee) 한 명 외에 "이 이슈를 알아야 할 사람"(리뷰어, 디자이너, PM 등)을 함께 알릴 방법이 없다. 사용자는 이슈 생성 후 각 플랫폼에 들어가 수동으로 멘션 코멘트를 달아야 한다. 제출 시점에 멤버를 골라 본문에 네이티브 멘션으로 박아주면 이 수고가 사라진다.

## 목표

- 6개 플랫폼(Jira·GitHub·Linear·Notion·GitLab·Asana) 모두에서 이슈 제출 필드에 **CC 멀티셀렉트**를 제공한다.
- 제출된 이슈 본문에 선택한 멤버가 **플랫폼 네이티브 멘션**으로 표시되고, **실제 알림이 발송**된다.
  - Jira: ADF `mention` 노드 (accountId)
  - GitHub / GitLab: 본문 `@username` 텍스트 (플랫폼이 자동 멘션 처리)
  - Linear: `issueCreate.subscriberIds`로 구독자 등록(알림 보장) + 본문에 `@이름` 텍스트(시각 표시)
  - Notion: rich text `mention` 객체 (user id)
  - Asana: `html_notes`의 `<a data-asana-gid="..."/>` 앵커 (멘션 + 팔로워 추가)
- CC 선택은 assignee와 동일하게 `lastSubmitFields`에 저장돼 다음 제출 시 prefill된다.

## 비목표 (Non-goals)

- 본문 에디터 내 인라인 `@` 트리거 멘션 (Tiptap Mention extension) — 이번 스코프 제외. 에디터는 플랫폼 공용이라 플랫폼별 사용자 ID 멘션이 어울리지 않음.
- 플랫폼 간 CC 매핑/이관 — CC는 플랫폼별 필드라 전환 시 각자 독립 (다른 필드와 동일 동작).
- 멘션 외 알림 수단(이메일, 웹훅 등).
- 그룹/팀 멘션 — 개인 사용자만.

## 사용자 시나리오

1. 사용자가 버그를 캡처하고 "이슈 등록" 버튼 → SubmitFieldsDialog 오픈.
2. 플랫폼 탭(예: Jira) 선택 → 기존 필드(프로젝트·담당자 등) 아래 **CC** 필드 노출.
3. CC 콤보박스 클릭 → 멤버 목록(assignee와 동일 소스) 로드 → 검색 → 여러 명 토글 선택. 선택된 멤버는 트리거에 이름 나열로 표시.
4. 제출 → 생성된 이슈 본문 하단(푸터 직전)에 `cc @멤버1 @멤버2` 멘션 줄이 들어가고, 각 멤버에게 플랫폼 알림 발송.
5. 다음 이슈 제출 시 직전 CC가 미리 채워져 있음. 필요 없으면 클리어.

**엣지 케이스**
- CC 미선택: 본문에 cc 줄 미출력 (기존과 동일한 본문).
- 멤버 목록 로드 실패(권한·네트워크): 콤보박스에 에러 메시지 표시 (기존 assignee 콤보박스 패턴). 제출은 CC 없이 가능.
- Notion 통합에 사용자 읽기 capability가 없어 `/v1/users`가 403: CC 콤보박스 에러 표시, 제출 차단 없음.
- 선행 필드 미선택(GitHub 레포, Linear 팀, Asana 워크스페이스, GitLab 프로젝트 미선택): CC 콤보박스 disabled (assignee와 동일).
- CC 멤버가 assignee와 중복: 그대로 허용 (플랫폼이 중복 알림을 자체 처리).
- 드래프트에서 재개해 제출(DraftDetailDialog 경로)할 때도 동일하게 동작.

## 성공 기준

- [ ] 6개 플랫폼 제출 다이얼로그(IssueCreateModal·DraftDetailDialog 양쪽)에 CC 필드가 노출되고 멀티 선택이 동작한다.
- [ ] 각 플랫폼에서 생성된 실제 이슈 본문에 멘션이 네이티브로 렌더링되고 알림이 발송된다 (Linear는 구독자 알림).
- [ ] CC 미선택 시 본문이 기존과 byte-동일하다 (회귀 없음).
- [ ] 직전 CC가 다음 제출에 prefill된다.
- [ ] `pnpm test` green — cc 헬퍼·본문 빌더·background API 단위 테스트 포함.
