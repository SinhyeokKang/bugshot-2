# logs.html AI 소비 매뉴얼 (LLM-readable manual)

## 배경

사용자가 버그를 디버깅할 때 BugShot이 내보낸 `logs.html`을 그대로 AI(Claude·ChatGPT 등)에게 던지는 경우가 많다. 그런데 현재 `logs.html`은 **사람용 인터랙티브 뷰어**(React 앱)이고, 실제 로그 데이터는 `<script id="__BUGSHOT_DATA__" type="application/gzip-base64">`에 **gzip+base64**로 들어있다. LLM은 이 압축 blob을 직접 해독할 수 없으므로:

- 평문으로 읽히는 건 `__BUGSHOT_META__`(제목·URL·버전)뿐이고, 정작 console/network/action 로그·report·영상은 전부 불투명한 base64 덩어리로 보인다.
- 파일 700~850KB 중 대부분이 뷰어 JS 번들 + 비디오 base64라 토큰만 먹고 정보는 못 얻는다.

즉 AI가 파일을 받아도 **무엇이 어디에 어떻게 들어있는지 모른다**. gzip은 큰 텍스트 로그 용량을 줄이려고 의도적으로 도입한 것이라 제거할 수 없다(중복 평문 저장은 그 절감을 깎는다).

## 목표

- `logs.html` 안에 **AI가 이 파일을 어떻게 소비하는지 설명하는 작은 평문 매뉴얼**을 박는다.
- 매뉴얼은 다음을 알려준다: 데이터가 gzip+base64로 어디에 있고 어떻게 디코드하는지(복붙 실행용 코드 레시피 포함), `report`에 버그 맥락이 있으니 먼저 읽으라는 것, 영상·이미지는 data URL이며 어떻게 소비하는지.
- 매뉴얼은 **UI에 렌더되지 않는다**(뷰어 동작·외형 불변).
- 데이터를 평문으로 **복제하지 않는다** — gzip 절감 효과를 건드리지 않는다. 파일 크기 증가는 매뉴얼 텍스트(수 KB) 한도.

## 비목표 (Non-goals)

- 별도 export 버튼·UI·메뉴 추가 (사용자 명시: export 원치 않음).
- 로그 데이터를 평문/마크다운으로 별도 직렬화해 중복 저장.
- 뷰어(`main.tsx`/`App.tsx`)의 렌더 로직 변경.
- 순수 채팅(코드 실행 불가) AI가 gzip을 풀 수 있게 만드는 것 — 불가능. 매뉴얼은 그런 AI에게도 "이건 압축 로그이고 디코드 도구가 필요하다"는 상황 인지만 제공한다.
- 매뉴얼의 다국어(i18n) 분기. 영문 단일.

## 사용자 시나리오

1. 사용자가 BugShot으로 버그를 캡처하고 `logs.html`을 내보낸다(기존 플로우 그대로).
2. 사용자가 그 파일을 **코드 실행 가능한 AI**(Claude.ai 분석 도구, Claude Code, ChatGPT Python 등)에 업로드/첨부한다.
3. AI가 파일 상단의 매뉴얼을 읽고 → 레시피대로 `__BUGSHOT_DATA__`를 base64 디코드 + gunzip + JSON 파싱 → console/network/action/report 전체를 읽는다.
4. AI가 `report`로 버그 맥락을 먼저 파악하고, 로그 타임스탬프(epoch ms)로 console/network/action을 상관분석해 원인을 진단한다.
5. (영상 처리 가능 시) `video.dataUrl` MP4를 디코드해 재현 화면을 본다. 불가하면 action 타임라인으로 갈음.

### 엣지 케이스

- **코드 실행 불가 AI**: 매뉴얼은 읽히지만 gzip을 못 푼다. AI는 최소한 "압축된 디버그 로그이며 디코드가 필요"함을 인지(현재는 그냥 멍듦).
- **구버전 logs.html**: 매뉴얼이 없다 — 기존과 동일하게 동작(회귀 없음). 매뉴얼은 신규 export부터 포함.
- **로그 일부만 존재**(예: console만, network 없음): 디코드된 JSON의 해당 최상위 키가 `null`. 매뉴얼이 "키가 없거나 null일 수 있다"고 명시.
- **매뉴얼 내 `</script`**: 매뉴얼 텍스트가 script 태그를 조기 종료시키면 안 됨 — 본문에 리터럴 `</script` 금지(테스트로 가드).

## 성공 기준

- 새로 내보낸 `logs.html`을 브라우저로 열면 뷰어 외형·동작이 이전과 **동일**(매뉴얼 비가시).
- 파일을 텍스트로 열면 `<head>` 상단에서 `__BUGSHOT_AI__` 매뉴얼이 보이고, 그 안의 디코드 레시피를 그대로 실행하면 `__BUGSHOT_DATA__`가 console/network/action/report JSON으로 복원된다(예시 파일로 검증 가능 — 실제 Python `gzip.decompress(base64.b64decode(...))`로 복원됨을 확인).
- 매뉴얼 추가로 인한 파일 크기 증가가 수 KB 이내(데이터 중복 없음).
- `pnpm test`의 `buildLogsHtml` 테스트가 매뉴얼 주입·`</script` 부재를 검증하며 통과.
