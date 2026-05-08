# GitHub 이슈 파일 첨부

## 배경

Bugshot은 Jira·Linear·Notion 이슈 등록 시 이미지·비디오·로그를 자동 업로드하여 본문에 인라인 삽입한다. GitHub만 유일하게 파일 업로드가 없어 본문에 파일명만 나열하고 사용자가 직접 GitHub UI에서 drag-and-drop해야 한다.

GitHub Issues REST API에는 공식 attachment upload 엔드포인트가 없다. 그러나 GitHub 웹 UI가 내부적으로 사용하는 비공식 upload API(`/upload/policies/assets`)를 통해 `https://github.com/user-attachments/assets/...` 형태의 영구 URL을 발급받을 수 있으며, 이 URL은 마크다운 이미지/링크로 삽입 가능하다.

## 목표

1. GitHub 이슈 등록 시 이미지(스크린샷, before/after), 비디오(녹화), 로그(네트워크 HAR, 콘솔 JSON), AI 메타(bugshot.md)를 자동 업로드하여 본문에 인라인 삽입한다.
2. 사용자가 GitHub.com에 로그인되어 있으면 자동 업로드, 그렇지 않으면 현재 방식(파일명 나열 + 수동 drag-drop)으로 fallback한다.
3. Jira·Linear·Notion과 동일한 수준의 "등록 한 번이면 끝" 경험을 제공한다.

## 비목표 (Non-goals)

- GitHub 공식 API만 사용하기 — 공식 attachment API가 존재하지 않아 비공식 API 의존 불가피.
- GitHub.com 미로그인 사용자를 위한 별도 로그인 플로우 — 기존 PAT/OAuth 인증과는 별개로 브라우저 세션 쿠키가 필요. 세션 없으면 기존 수동 방식으로 graceful fallback.
- GitHub Release Assets API 활용 — release 생성이 필요하고 목적에 맞지 않음.
- 이미지 포맷 변환 — GitHub가 .webp를 지원하지 않을 경우 별도 대응은 이번 스코프 밖. 테스트 후 미지원 확인 시 후속 작업으로.

## 사용자 시나리오

### 시나리오 1: 정상 업로드 (GitHub.com 로그인 상태)

1. 사용자가 웹 페이지에서 요소를 선택하고 스타일을 수정한다.
2. 이슈 작성 탭에서 GitHub 플랫폼을 선택하고 "등록" 버튼을 누른다.
3. Bugshot이 GitHub.com 세션 쿠키를 확인하고 파일(before.webp, after.webp, bugshot.md)을 업로드한다.
4. 업로드된 URL로 이슈 본문을 구성하여 GitHub API로 이슈를 등록한다.
5. 이슈 본문에 이미지가 인라인으로 렌더되고, bugshot.md는 링크로 첨부된다.

### 시나리오 2: 비디오 + 로그 업로드

1. 사용자가 화면 녹화 모드로 녹화를 마친 뒤 GitHub 이슈로 등록한다.
2. recording.webm, network-log.har, console-log.json, bugshot.md가 모두 업로드된다.
3. 비디오는 본문에 인라인 렌더, 로그와 메타는 링크로 삽입.

### 시나리오 3: Fallback (GitHub.com 미로그인)

1. 사용자가 GitHub 이슈를 등록하려 하지만 해당 Chrome 프로필에서 GitHub.com에 로그인되어 있지 않다.
2. Bugshot이 세션 쿠키 부재를 감지하고 현재 방식대로 이슈를 등록한다(파일명 나열).
3. 이슈는 정상 등록되며, 본문에 "파일은 사이드 패널에서 다운로드 후 GitHub UI에 첨부" 안내가 포함된다.
4. (기존 동작과 동일)

### 시나리오 4: 업로드 중 부분 실패

1. 5개 파일 중 2개 업로드 성공, 3개 실패.
2. 성공한 파일은 인라인 URL로, 실패한 파일은 파일명 나열 방식으로 본문에 포함.
3. 이슈는 정상 등록된다. 사용자에게 부분 실패 안내 없이 최선의 결과를 보여준다.

## 성공 기준

1. GitHub.com에 로그인된 상태에서 element/screenshot/video 3가지 캡처 모드 모두 파일이 자동 업로드되어 이슈 본문에 인라인 렌더된다.
2. bugshot.md가 이슈에 링크로 첨부된다.
3. GitHub.com 미로그인 시 기존 동작(파일명 나열)과 동일하게 동작한다.
4. 업로드 실패 시 이슈 등록 자체는 실패하지 않는다(graceful degradation).
5. 기존 Jira·Linear·Notion 플로우에 영향 없다.
