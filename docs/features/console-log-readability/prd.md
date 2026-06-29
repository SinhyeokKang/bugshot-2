# 콘솔 로그 가독성 개선 (DevTools 스타일 색상)

## 배경

리포터가 첨부하는 Chrome DevTools Console 캡처와 우리 로그 뷰어의 콘솔 표현을 비교하면 두 가지 어긋남이 있다.

1. **갯수 차이** — 이건 구조적 한계로, 이번 스코프 대상이 아니다(비목표 참조). 페이지가 `console.*`로 찍지 않고 브라우저(렌더러/네트워크 스택)가 직접 콘솔에 뱉는 메시지(네트워크 실패, CORS, CSP, Deprecation)는 content script의 `console` 패칭으로 캡처 불가. DevTools만 CDP `Log.entryAdded` 특권으로 받는다.
2. **색상/가독성** — DevTools는 메시지 본문은 거의 기본색으로 두고, 행 배경·아이콘(혹은 작은 배지)으로 종류를 신호하며, 메시지·스택 안의 URL을 파란 클릭 링크로 렌더한다. 우리 세 로그 탭의 행 표현은 어긋나 있다: **Network는 이미 이 패턴**(method 배지에만 색, 본문 중립)인데, **Console은 `entry.args` 전체를 레벨 색**(에러=빨강)으로, **Action은 navigation 행 전체를 파랑**으로 통째 칠한다. → 스캔성·가독성 저하 + 탭 간 비일관.

이 기능은 Console·Action을 **Network 레퍼런스 패턴에 통일**하고("본문 중립색 + 신호는 배경/아이콘 + URL은 링크"), URL 링크화를 공유 자원으로 정리한다 — 기존 `InlineLink`(단일 URL 슬롯) + 신규 `LinkifiedText`(URL 박힌 자유 텍스트, 콘솔 전용). 이미 공유 중인 `syncRowClass`·`LogSeekChip`·`OriginFilterBar`는 그대로 둔다.

## 목표

- 콘솔 에러/경고/정보 행의 **본문 텍스트 색을 기본색(foreground)으로** 바꿔, 심각도는 행 배경 틴트(`levelBgColor`)와 좌측 아이콘(`LevelIcon`)으로만 신호한다 (DevTools와 동일한 시각 모델).
- 콘솔 메시지(접힌 헤더), 펼친 본문 `<pre>`, 스택 `<pre>` 안의 **URL을 파란 클릭 링크로 렌더**한다.
- URL 링크화를 **공유 순수 헬퍼 + 얇은 React 래퍼(`LinkifiedText`)**로 추출한다 (콘솔 전용 소비).
- **Action navigation 행도 동일 패턴으로 통일** — 줄 전체 파랑(`kindColor`)을 제거해 동사부는 기본색, URL은 기존 `InlineLink` 파란 링크 유지, 신호는 파란 배경 틴트 + `MapPin` 아이콘으로.
- 스택의 `https://.../index.js:55:27752`처럼 URL 뒤 `:line:col`이 붙은 경우, **표시는 전체 유지하되 링크 href는 `:line:col`을 제거**해 새 탭에서 깨지지 않게 한다.

## 비목표 (Non-goals)

- **브라우저 생성 콘솔 메시지(네트워크 실패·CORS·CSP·Deprecation) 캡처** — `console` 패칭으로 구조적 불가. 별도 검토 대상(이번 스코프 제외).
- **좌측 심각도 세로 바(left accent border) 추가** — 채택 안 함. 행 배경 + 아이콘으로만 신호.
- **로그된 객체/값의 syntax highlighting**(숫자·문자열 색) — 우리 args는 이미 문자열로 직렬화돼 구조가 없으므로 제외.
- **Network 행 변경 일체** — Network는 이미 레퍼런스 패턴(method 배지에만 색, 본문 중립). 상세 패널 URL은 **평문 그대로 유지**(링크화 안 함). `methodColor`·접힌 행 path 미변경.
- **통합 `<LogRow>` 컴포넌트 추출** — 세 탭의 상호작용 모델(아코디언/선택/정적)이 달라 과추상. 이미 공유 중인 작은 프리미티브 + `LinkifiedText`로 충분.
- **로그된 객체/값의 syntax highlighting**은 위에 기술. action click/input 색(이미 중립)·network는 미변경.
- i18n 문자열 추가/변경 없음.

## 사용자 시나리오

1. 사용자가 리포트/로그 뷰어의 Console 탭을 연다.
2. 에러 행은 연분홍 배경 + 빨강 `CircleX` 아이콘으로 한눈에 식별되고, 메시지 본문은 기본색이라 읽기 쉽다.
3. 메시지·스택 안의 `https://...` URL은 파란 밑줄 링크로 보이고, 클릭하면 새 탭에서 해당 리소스가 열린다(소스 파일은 `:line:col` 없이 정상 열림).
4. 행을 클릭하면 펼쳐지고, 펼친 본문/스택 `<pre>` 안의 URL도 동일하게 링크다.
   - 엣지: 접힌 헤더 안의 URL을 클릭해도 **행 펼침이 토글되지 않는다**(링크 클릭은 전파 차단).
5. Action 탭의 navigation 행은 동사부가 기본색이고, 목적지 URL만 파란 링크 + 파란 배경 틴트/`MapPin` 아이콘으로 신호된다(콘솔 에러 행과 같은 시각 모델).

## 성공 기준

- 에러/경고/정보 콘솔 행의 본문 텍스트가 기본색으로 렌더되고, 심각도는 배경+아이콘으로만 구분된다.
- `https://...`를 포함한 콘솔 메시지·스택에서 URL만 파란 링크로 분리 렌더되고, 나머지는 텍스트다.
- `at F3 (https://host/assets/index.js:55:27752)`의 링크 href가 `https://host/assets/index.js`(line:col 제거)이고, 표시 텍스트는 `https://host/assets/index.js:55:27752` 그대로다.
- 접힌 헤더의 링크 클릭이 행 펼침을 토글하지 않는다.
- Action navigation 행의 동사부가 기본색이고 URL만 파란 링크다(`data-testid="action-nav-link"` 보존). 파란 배경 틴트·아이콘 유지.
- Network 행은 시각 변화 없음(회귀 없음).
- linkify 순수 함수 단위 테스트 통과, `pnpm test`·`pnpm typecheck` green.
