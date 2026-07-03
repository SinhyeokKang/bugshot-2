# 컴포넌트/코드 공통화 리팩터 이니셔티브

## 배경

destructive 버튼 5곳이 `variant="outline" className="text-destructive"`로 복붙돼 hover 시 빨강 라벨이 검정으로 튀는 버그가 있었다. 이를 `destructive-outline` variant 하나로 공통화하며 해소(PR #123, squash 커밋 `e63f326`, v1.4.4). 그 과정에서 "같은 성격의 파편화가 더 있다"는 가설로 코드베이스를 3개 에이전트로 전수 감사한 결과, 공용 컴포넌트/헬퍼로 묶여야 하는데 파일마다 복붙된 클러스터를 **UI 층 8개 + 플랫폼/어댑터 층 5개(합 13개)** 발견했다. 이 중 P5(Submit 디스패치)는 난도·회귀 위험이 커 **별도 `/feature`로 분리**하고, 감사 초안에 있던 다중선택 콤보박스 공통화(U1b)는 검수 결과 대상 실체가 없어 **철회**했다(design.md U1 참조). 본 이니셔티브는 나머지 **12개(UI 8개 + 플랫폼 4개)**를 다룬다.

파편화의 공통 증상:
- 이미 존재·검증된 추상화(`SingleLazyCombobox`, `CancelConfirmDialog`, `ColorSwatch`, `FieldRow`)를 일부만 쓰고 나머지는 손으로 재구현
- 같은 className 리터럴·마크업이 3~19곳 복붙 (마진·색 표기가 미세하게 어긋나 시각 불일치 유발)
- 어댑터/설정 코드가 플랫폼 리터럴만 다른 채 바이트 단위 중복

## 목표

- 각 클러스터를 **순차 착수 가능한 태스크**로 쪼개, 토큰 예산에 따라 하나씩 처리 가능하게 한다. 같은 파일을 공유하는 태스크 쌍이 있어 **병렬 착수는 금지** — tasks.md의 겹침 매트릭스를 따른다.
- 신규 추상화보다 **이미 있는 컴포넌트로의 수렴**을 우선한다(리스크 최소).
- 공통화 과정에서 발견된 **시각 이탈 1건**(U8: linear 라벨 dot border 누락)을 함께 정합하고, 플랫폼별 API 색 포맷 차이(GitHub API만 `#` 없는 hex 반환 — github의 `#${color}` 보정은 버그가 아니라 정답)에 파일마다 제각각 대응하던 것을 `ColorSwatch` 경계 정규화 한 곳으로 모은다.
- 각 태스크에 **검증 방법**(typecheck / 실제 렌더 회귀 / e2e `data-testid` 보존)을 명시해 무손실 리팩터를 보장한다.

## 비목표 (Non-goals)

- **플랫폼 고유 차이의 강제 통합 금지**: Jira ADF·Notion 블록 JSON·Asana HTML·Slack mrkdwn 본문 렌더 모델, 401 처리 분류(즉시 refresh / hook 주입 / 즉시 throw), Slack `ok:false`, ClickUp raw 헤더·status 매핑, GitLab self-managed URL·사후 `injectIssueUrl`, Slack 2-step 업로드, linear GraphQL 요청 본체 — 어댑터 패턴이 흡수해야 할 **진짜 차이**이므로 공용 팩토리로 억지 통합하지 않는다.
- **동작 변경 금지**: 순수 리팩터. 사용자 눈에 보이는 UX·기능은 바뀌지 않는다(시각 정합만 오히려 개선). 콤보박스 검색 능력(key/email 복합 검색)도 보존한다.
- **한 번에 전부 처리 금지**: 클러스터별 분할 착수가 전제. 이 문서는 12개 클러스터 전체를 담지만 구현은 순차·부분 가능.
- 요청하지 않은 유연성·설정 가능성·미래 대비 추상화 추가 금지.

## 사용자 시나리오

이 이니셔티브는 내부 코드 품질 작업으로 **사용자 노출 UX 변화가 없다**. 회귀 없음이 곧 성공이다. 단, 다음 시각 정합이 부수적으로 개선된다:

- EmptyState 마진이 3종(mb-3/mb-1/무)으로 어긋나던 것이 통일됨
- 라벨 색 dot의 border 유무가 플랫폼마다 달라(linear만 border 없음) 어긋나던 것이 통일됨
- 스피너 사이즈가 소비처마다 제각각이던 것이 3단계로 정규화됨

## 성공 기준

- 각 클러스터 태스크 완료 시 `pnpm typecheck` 통과 + 해당 순수 함수 단위 테스트 통과.
- 리팩터 대상 화면이 Chrome 실제 렌더에서 이전과 시각적으로 동일(또는 명시된 정합 개선만).
- e2e가 실제 커버하는 `data-testid`(`attachment-remove`, `reset-all`/`reset-all-confirm`)가 이동 후에도 보존돼 `pnpm test:e2e` green 유지. e2e 미커버 testid(로그 프리뷰 3종, `annotation-delete` 등)는 grep+수동 렌더로 보존 확인한다(e2e 게이트 아님).
- 공통화 후 대상 파일 축소가 diff로 판별 가능: U1 각 콤보박스 파일 100~120줄 → 로더+주입 코드 수십 줄, P1 4개 api 파일의 refresh 골격 중복 블록 소멸, `build{Github,Gitlab}IssueBody` 18줄 diff 중복 제거.
- DESIGN.md 합성 컴포넌트 표(§13)·상태 표현(§14)이 새 공용 컴포넌트를 반영.
