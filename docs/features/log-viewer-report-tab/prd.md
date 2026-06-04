# Log Viewer — Report 탭

## 배경

`logs.html`(log-viewer)은 현재 Console·Network·Action 로그만 보여준다. 이슈를 제출하거나 draft를 열 때 작성했던 **이슈 본문(제목·환경·설명/재현/예상/노트)** 은 사이드패널의 프리뷰 패널(`PreviewPanel`)에서만 볼 수 있고, 첨부된 `logs.html`을 단독으로 열면 "이 로그가 어떤 이슈에 대한 것인지"를 알 수 없다. 좌측 패널은 캡처 화면(스크린샷·영상)과 이슈 제목 오버레이로 *화면* 맥락은 제공하지만, *이슈 본문*(환경·재현 절차·기대 결과 등)의 맥락은 여전히 없다.

`logs.html`은 인터넷 없이 단독 실행되는 자기완결 산출물이므로, 여기에 이슈 본문을 함께 담으면 첨부 파일 하나로 "무엇이 문제였는가 + 그때의 로그"를 모두 전달할 수 있다.

## 목표

- log-viewer에 **Report 탭**을 추가한다. 탭 순서는 `[Report] [Console] [Network] [Action]`.
- Report 탭의 UI·데이터는 사이드패널 `PreviewPanel`과 동일하다. 단 **Media 섹션(스크린샷/영상 임베드)과 Log attachments 섹션은 제외**한다.
  - Media: log-viewer 좌측 패널이 이미 동일한 스크린샷·영상을 보여주므로 중복 제거.
  - Log attachments: Console/Network/Action 탭이 같은 데이터를 이미 담당.
- Report 탭이 담는 것: **제목 + Copy markdown 버튼 + 환경(Environment) + 텍스트 섹션(설명/재현/예상/노트, 사용자 섹션 설정 순서·라벨 반영)**.
- 기본 활성 탭 fallback 순서는 기존 그대로 유지: **Console → Network → Action**. Report는 가장 후순위라 자동 선택되지 않는다(사용자가 직접 클릭해야 보임).
- Copy markdown 버튼은 `PreviewPanel`과 동일하게 마크다운/HTML을 클립보드에 복사한다.
- **logs 첨부 드랍 경고**: Report 본문(inline dataURL)이 더해져 `logs.html`/`logs.zip`이 커지면 Notion 무료 워크스페이스 5 MiB 한도 등으로 첨부가 빠질 수 있다. 현재는 logs 첨부 실패가 격리되어 **사용자에게 알림 없이 조용히 드랍**된다(`submitToNotion.ts:105-109`). 이번에 logs 첨부가 제외되면 **제출 완료 페이지에서 경고 토스트**를 노출한다 — 문구는 "Notion 무료 플랜 한도로 `logs.html`이 누락되었습니다" 류(실패 반응형 — 용량 외 모든 logs 업로드 실패 원인 포함).

## 비목표 (Non-goals)

- Report 탭에 Media(스크린샷/영상/스타일 변경 표)·Log attachments 카드를 넣지 않는다.
- Report 탭에서 이슈 본문을 **편집**하는 기능은 만들지 않는다(읽기 전용, Copy만 가능).
- log-viewer 좌측 패널(영상/스크린샷/이슈 오버레이) 동작은 변경하지 않는다.
- element 캡처 모드 대응: element 모드는 콘솔/네트워크 로그 첨부 자체가 비활성(`supportsConsoleNetworkLog`)이라 `logs.html`이 생성되지 않으므로, Report 탭의 element 전용 env/스타일 표는 다루지 않는다(도달 불가 경로).
- fallback 우선순위·탭 enable 규칙을 사용자가 설정하게 만드는 옵션은 추가하지 않는다.
- 기존 `IssueCreateModal`/`DraftDetailDialog`의 ctx 빌드 중복은 이번에 통합하지 않는다. Report용 copy는 **호출처에 이미 만들어진 `ctx`를 재사용**하고, `buildMarkdownContext` 추출은 `PreviewPanel` copy 한정 리팩터로 좁힌다(스코프 크리프 차단).

## 사용자 시나리오

1. 사용자가 screenshot/freeform/video 모드로 캡처하고 콘솔·네트워크(·액션) 로그를 첨부한 뒤 이슈를 제출한다.
2. 제출 시 본문에 `logs.html`이 첨부된다(기존 동작).
3. 첨부된 `logs.html`을 연다. 기본은 Console 탭(없으면 Network → Action).
4. 사용자가 **Report 탭**을 클릭한다 → 사이드패널 프리뷰와 동일한 제목·환경·본문 섹션이 보인다. Media/Log attachments는 없다.
5. Report 탭의 **Copy markdown** 버튼을 누르면 이슈 본문이 마크다운/HTML로 클립보드에 복사된다.

### 엣지 케이스

- **본문이 비어 있음**: 제목만 있고 섹션 내용이 비면, 빈 섹션은 `PreviewPanel`과 동일하게 `emptyVariant="muted"` placeholder로 표시한다(숨김 아님 — "동일 UI" 목표 유지). Report 탭 자체는 항상 표시한다.
- **저장된 draft 열기**(`DraftDetailDialog`): 제출 전 draft에서도 `logs.html`을 만들 수 있으므로, Report 데이터도 동일하게 채워진다.
- **inline 이미지가 본문에 포함**: 본문 섹션의 `inline:` 마커는 IndexedDB에서 resolve되는데 standalone HTML에선 접근 불가하므로, 사이드패널에서 **data URL로 미리 치환**해 주입한다(깨진 이미지 방지).
- **로그가 하나도 없음**: 기존 게이팅상 `logs.html` 자체가 생성되지 않으므로 Report 탭도 존재하지 않는다(변화 없음).
- **Notion 용량 초과로 logs 첨부 드랍**: 이슈는 정상 생성되되 `logs` 카테고리 첨부만 격리 catch로 빠진다(image/video 실패와 달리 전체 실패 아님). 이번 변경으로 이 경우 제출 완료 페이지에서 **"Notion 무료 플랜 한도로 logs.html 누락" 경고 토스트**가 뜬다(기존 silent drop 개선).

## 성공 기준

- screenshot/freeform/video + 로그 첨부로 제출 → `logs.html`에 Report 탭이 보이고, 내용이 사이드패널 프리뷰와 일치(Media·Log attachments만 빠짐). 구체적으로 **동일 draft·섹션 설정에서 Report 본문 텍스트 = `PreviewPanel` 본문 텍스트**(inline 이미지 resolve 결과 포함).
- 기본 활성 탭은 여전히 Console(없으면 Network → Action), Report는 클릭해야 보인다.
- Report 탭 Copy markdown이 사이드패널 프리뷰의 Copy 결과와 동일한 마크다운을 생성한다.
- inline 이미지가 본문에 있어도 Report 탭에서 정상 표시된다.
- Notion 제출에서 logs 첨부가 용량 등으로 빠지면 경고 토스트가 노출된다(조용한 드랍 아님).
- 기존 Console/Network/Action 탭, 좌측 패널, 사이드패널 `PreviewPanel` 동작에 회귀가 없다(`pnpm test` 통과).
