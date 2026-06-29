# Slack 제출 이슈 승격 (Slack Issue Promotion)

## 배경

현재 Slack으로 공유한 이슈는 다른 트래커(Jira/GitHub 등) 제출과 동일하게 `markSubmitted`→`stripSubmitted`를 거쳐 draft 콘텐츠·스타일 편집·blob(이미지/영상/로그/첨부)을 전부 폐기한다. 남는 건 `platform/key/url`뿐이다.

하지만 Slack 공유는 "이슈 등록"이 아니라 "메시지 공유"다. 팀이 Slack에서 논의한 뒤 정식 트래커에 등록하고 싶을 때, 지금은 데이터가 이미 사라져 처음부터 다시 캡처해야 한다. Slack 공유 이슈의 원본 데이터를 보존해 두면, 나중에 클릭 한 번으로 Jira·GitHub 등으로 **승격(promote)** 할 수 있다.

## 목표

1. Slack으로 제출한 이슈는 draft와 동일하게 원본 데이터(draft 콘텐츠, snapshot, styleEdits, blob 전부)를 보존한다.
2. Slack 제출 이슈는 상태상 여전히 `submitted`다 — 필터·표시 모두 submitted로 취급한다. 데이터 보존 정책만 draft와 같다.
3. 이슈 목록에서 Slack 제출 카드의 우측에 **Upload(제출) IconButton**을 노출한다. 클릭하면 이슈 제출 다이얼로그가 열리되 플랫폼 탭에서 **Slack을 제외**한다.
4. Slack 제출 카드의 본문을 클릭하면 permalink로 이동하지 않고 `DraftDetailDialog`로 원본을 확인할 수 있다.
5. "Slack 제외 연결 플랫폼"이 0인 경우(승격 대상 트래커 없음) 해당 카드는 **지금과 동일하게** permalink 새 탭 이동 + `SubmittedBadge`를 유지한다.
6. 일반 트래커로 승격된 이슈는 과거 Slack 제출 이력을 추적할 수 없다 — 일반 제출 이슈와 동격이 된다(`stripSubmitted`로 Slack 보존 데이터·플래그까지 폐기).

## 비목표 (Non-goals)

- Slack 재공유(같은 이슈를 다시 Slack으로 보내기): 제출 다이얼로그에서 Slack 탭을 제외하므로 불가. 별도 지원하지 않는다.
- 승격 후 Slack permalink·메시지와의 연결 추적: 명시적으로 폐기(목표 6).
- 이미 Slack 제출된 **기존(과거)** 이슈의 소급 복원: `stripSubmitted`로 데이터가 이미 삭제됐으므로 복원 불가. 신규 제출분부터 적용한다(기존 카드는 보존 플래그가 없어 자동으로 현행 동작 유지).
- Slack 외 플랫폼의 데이터 보존 정책 변경: 기존대로 제출 시 폐기.
- IndexedDB blob 용량 관리·만료 정책 추가: 기존 draft 보존과 동일 취급, 별도 정책 없음.

## 사용자 시나리오

### 시나리오 A: Slack 공유 후 Jira로 승격
1. Jira·Slack 둘 다 연결된 사용자가 버그를 캡처해 Slack 채널로 공유한다.
2. 이슈 목록에서 해당 카드는 `submitted`로 보이고, 우측에 Upload 버튼이 뜬다.
3. 사용자가 Upload 버튼을 클릭 → 제출 다이얼로그가 열리고 탭은 Jira/GitHub/… (Slack 없음).
4. Jira 탭에서 필드를 채우고 제출 → 이슈가 Jira로 승격된다.
5. 승격 후 카드는 일반 Jira submitted 이슈가 된다(우측 Jira 배지, 클릭 시 Jira URL 이동). Slack 이력은 사라진다.

### 시나리오 B: Slack 공유 내용 다시 확인
1. Slack 공유 카드의 본문(제목 영역)을 클릭한다.
2. permalink로 이동하지 않고 `DraftDetailDialog`가 열려 캡처 이미지·스타일 변경·로그 등을 다시 볼 수 있다.
3. 다이얼로그 안에서 그대로 삭제하거나(휴지통 동작), 제출 버튼으로 승격할 수 있다(Slack 탭 제외).

### 시나리오 C: 트래커 미연결 (Slack만 연결)
1. Slack만 연결한 사용자가 이슈를 Slack 공유한다.
2. 카드 우측은 기존 `SlackSubmittedBadge`("전송됨"), 본문 클릭 시 Slack permalink 새 탭 이동 — **현행 동작 그대로**.
3. 이후 Jira를 추가 연결하면, 같은 카드가 동적으로 Upload 버튼 + DraftDetailDialog 동작으로 전환된다(현재 연결 상태 기준 동적 판정).

### 엣지 케이스
- **마지막 제출 플랫폼이 Slack**: 제출 다이얼로그 초기 탭이 Slack로 잡히면 Slack 제외 후 탭이 없어 깨진다 → 초기 플랫폼을 Slack 제외 목록의 첫 항목으로 보정.
- **승격 도중 트래커 연결 해제**: 승격 가능 판정은 렌더 시점 `accounts` 기준 동적 — 연결이 0이 되면 카드가 다시 permalink 이동 모드로 복귀.
- **기존 Slack submitted 이슈**: `slackPreserved` 플래그가 없으므로 보존 데이터 없이 현행 permalink 이동 유지.

## 성공 기준

- Slack 제출 직후 이슈 목록 카드가 `submitted`이면서, 승격 대상 트래커가 1개 이상 연결돼 있으면 우측에 Upload 버튼이 노출된다.
- Slack 제출 카드 본문 클릭 시(승격 대상 존재) `DraftDetailDialog`(`data-testid="draft-detail-dialog"`)가 열린다.
- 그 제출 다이얼로그에서 Slack 탭이 보이지 않는다.
- 승격 대상 트래커가 0이면 카드 동작이 현행(permalink 이동 + Slack 배지)과 동일하다.
- Slack 제출 이슈는 `submitted` 필터에 뜨고 `draft` 필터엔 뜨지 않는다.
- 일반 트래커로 승격하면 draft 콘텐츠·blob·`slackPreserved`가 모두 폐기되고 일반 submitted 이슈와 동일해진다.
- 관련 순수 함수 단위 테스트(`pnpm test`)가 통과한다.
