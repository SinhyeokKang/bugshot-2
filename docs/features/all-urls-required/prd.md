# `<all_urls>` required 승격

## 배경

현재 `<all_urls>`는 `optional_host_permissions`에 있어 30s Replay·BYOK LLM·GitLab self-managed가 런타임에 `chrome.permissions.request`로 획득한다. 이 모델은:

- **cross-origin 스타일 보강**(별도 feature)이 "이미 grant된 사용자만" 동작하는 반쪽 기능이 된다.
- 권한 요청 UI가 BYOK/GitLab 연결마다 끼어들어 흐름이 끊긴다.
- `tab-bindings`가 cross-origin 네비게이션마다 `permissions.contains`로 분기해야 한다.

확장의 핵심 가치(임의 웹페이지의 DOM·스타일·스크린샷·로그를 골라 이슈화)는 본질적으로 **모든 사이트 접근**을 전제한다. `<all_urls>`를 required host_permission으로 승격해 권한을 기본 보유로 만들고, 런타임 요청 분기를 제거한다.

단, **30s Replay는 권한과 별개로 메모리/CPU를 지속 점유**(600ms `captureVisibleTab` 폴링 + 최대 60프레임 버퍼)하므로, 기능 자체의 opt-in 토글(`replayEnabled`)은 그대로 유지한다 — 권한이 아니라 "리소스 점유 동의"로서.

## 목표

- `<all_urls>`를 `host_permissions`에 required로 넣고 `optional_host_permissions`에서 제거한다.
- 30s Replay·BYOK·GitLab·cross-origin 스타일 보강이 추가 권한 요청 없이 동작한다.
- 30s Replay 토글(`replayEnabled`)은 유지하되, 토글 시 권한 요청/확인 로직을 제거한다(순수 기능 on/off).
- `tab-bindings`의 cross-origin 패널 분기에서 `permissions.contains` 호출을 제거하고 `broadGranted=true` 고정으로 단순화한다.
- BYOK/GitLab self-managed 연결 시 권한 프롬프트가 더 이상 뜨지 않는다(이미 보유).

## 비목표 (Non-goals)

- 권한 패턴 세분화(`https://*/*`+`http://*/*` 등)는 하지 않는다. e2e와 일치하는 `<all_urls>` 단일.
- 30s Replay 기능 토글 자체는 제거하지 않는다(리소스 점유 opt-in 유지).
- `file:` 스킴 캡처 동작은 변경하지 않는다(`<all_urls>`에 명목 포함되나 Chrome의 "파일 URL 액세스" 별도 토글이 여전히 필요 — `isBroadCoveredUrl`이 file: 배제 유지).
- `activeTab`·`tabCapture` 등 다른 권한은 손대지 않는다.
- 기존 사용자 자동 재활성화를 코드로 우회하지 않는다(Chrome 정책상 불가 — 사용자 재동의 수용).

## 사용자 시나리오

### 신규 설치
1. 웹스토어 설치 시 "모든 웹사이트의 데이터 읽기/변경" 권한에 동의.
2. 설치 후 모든 사이트에서 picker·캡처·로그·cross-origin 스타일이 권한 프롬프트 없이 동작.

### 기존 사용자 업데이트 (충격 지점)
1. 업데이트 배포 → host_permission 확대로 **Chrome이 확장을 자동 비활성화**하고 권한 검토 알림.
2. 사용자가 chrome://extensions 또는 알림에서 권한 검토 후 **재활성화**.
3. 재활성화 후 정상 동작.

### 30s Replay (토글 유지)
1. 설정에서 Replay 토글 ON → 권한 요청 없이 즉시 `replayEnabled=true`, 폴링 시작.
2. 토글 OFF → 폴링 중단(리소스 해제). 권한은 그대로 보유.

### BYOK / GitLab self-managed
1. custom baseUrl 입력 후 Connect → 권한 프롬프트 없이 즉시 연결(이미 `<all_urls>` 보유).

### 엣지 케이스
- **file: 페이지**: `<all_urls>` 보유에도 Chrome "파일 URL 액세스" 토글 미설정이면 캡처 불가 — 현행과 동일.
- **권한 거부**: required라 설치/재동의 시 거부하면 확장이 동작하지 않음(부분 동작 없음).

## 성공 기준

- 빌드된 manifest의 `host_permissions`에 `<all_urls>` 포함, `optional_host_permissions` 키 부재.
- Replay 토글 ON 시 `chrome.permissions.request` 호출이 일어나지 않고 즉시 폴링 시작.
- BYOK/GitLab 연결 시 권한 프롬프트가 뜨지 않음.
- cross-origin 네비게이션 시 패널이 유지됨(http/https), `permissions.contains` 호출 0.
- privacy.md·PERMISSION.md·README.md·CLAUDE.md가 새 권한 모델로 갱신됨.
- 기존 단위 테스트(`resolveNavigationAction`)·e2e 회귀 없음(권한 전제 spec은 갱신).
