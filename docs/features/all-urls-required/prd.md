# `<all_urls>` required 승격

## 배경

현재 `<all_urls>`는 `optional_host_permissions`에 있어 30s Replay·BYOK LLM·GitLab self-managed가 런타임에 `chrome.permissions.request`로 획득한다. 이 모델은:

- **cross-origin 스타일 보강**(별도 feature)이 "이미 grant된 사용자만" 동작하는 반쪽 기능이 된다.
- 권한 요청 UI가 BYOK/GitLab 연결마다 끼어들어 흐름이 끊긴다.
- `tab-bindings`가 cross-origin 네비게이션마다 `permissions.contains`로 분기해야 한다.

확장의 핵심 가치(임의 웹페이지의 DOM·스타일·스크린샷·로그를 골라 이슈화)는 본질적으로 **모든 사이트 접근**을 전제한다. `<all_urls>`를 required host_permission으로 승격해 권한을 기본 보유로 만들고, 런타임 요청 분기를 제거한다.

**왜 지금**: 직접 동인은 cross-origin 스타일 보강(`docs/features/cross-origin-styles/`)이다. 그 기능은 `<all_urls>`가 grant된 사용자에게만 동작하는데, optional 모델에선 그 권한을 따로 받은 소수에게만 닿아 "naver처럼 CDN으로 CSS를 분리한 사이트에서 스타일이 안 잡힌다"는 핵심 결함을 절반만 해결한다. required 승격이 그 기능의 전제다. 나머지(프롬프트 끊김·contains 분기)는 부수적 단순화.

**점진적 대안을 택하지 않은 이유**: "신규 설치만 required, 기존은 optional 유예" / "사용자 기반이 더 클 때까지 연기" 같은 점진안은 (a) Chrome manifest는 설치 시점별로 권한을 분기할 수 없어 기술적으로 불가하고, (b) 100명 규모의 지금이 오히려 재동의 충격의 절대 규모가 가장 작은 시점이라 **연기할수록 비용이 커진다**. 일괄 승격을 택한다.

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
- **인앱 안내(온보딩 카드·재활성화 배너·what's-new)를 만들지 않는다.** 코드베이스에 온보딩/changelog UI가 없고, Chrome이 비활성화한 사용자는 사이드패널을 못 열어 인앱 안내가 **구조적으로 도달 불가**하다. 유일한 실효 접점은 Chrome 재동의 화면 문구 + 스토어 설명뿐임을 받아들인다. (신규 설치자 대상 권한 사유 카드도 이번 스코프에서 제외 — 별도 feature.)

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

### UI 전후 비교 (사용자가 보는 화면 변화)

| 트리거 | 변경 전 | 변경 후 |
|---|---|---|
| 설치 | 권한 경고가 도메인 한정(atlassian·github 등) | "모든 사이트의 데이터 읽기/변경" 경고로 강화 |
| Replay 토글 ON | Chrome 권한 다이얼로그 노출 → 동의해야 켜짐 | 다이얼로그 없이 즉시 켜짐(폴링 시작). help 텍스트가 점유 맥락 제공 |
| BYOK/GitLab Connect | custom baseUrl 입력 시 권한 다이얼로그 노출 | 다이얼로그 없이 즉시 연결 |
| cross-origin 이동 | (권한 미보유자) 패널이 닫힘 | 패널이 **유지**됨(http/https) — 새 동작 |

cross-origin 패널 유지는 개선이지만 사용자에겐 새 동작이라 명시한다. BYOK/GitLab 프롬프트 소멸은 "도메인 접근 인지 모먼트"가 사라지는 trade-off가 있으나, `LlmConnectDialog`의 `llm.apiKey.help`("이 기기에만 저장, 선택 엔드포인트로 직접 전송") 카피가 그 인지를 텍스트로 대체한다.

### 엣지 케이스
- **file: 페이지**: `<all_urls>` 보유에도 Chrome "파일 URL 액세스" 토글 미설정이면 캡처 불가 — 현행과 동일.
- **권한 거부**: required라 설치/재동의 시 거부하면 확장이 동작하지 않음(부분 동작 없음).
- **미동의 잔존 사용자**: 업데이트 후 Chrome 비활성화 알림을 무시해 **조용히 비활성 상태로 남는 사용자** — 추적 불가(PostHog 침묵), 인앱 복구 경로 없음. 제품적으로 "받아들이는 손실"로 인정.
- **재동의 거부 후 방치**: 재동의 화면에서 거부 후 장기 방치 — 위와 동일하게 복구·측정 불가.

## 성공 기준

- 빌드된 manifest의 `host_permissions`에 `<all_urls>` 포함, `optional_host_permissions` 키 부재.
- Replay 토글 ON 시 `chrome.permissions.request` 호출이 일어나지 않고 즉시 폴링 시작.
- BYOK/GitLab 연결 시 권한 프롬프트가 뜨지 않음.
- cross-origin 네비게이션 시 패널이 유지됨(http/https), `permissions.contains` 호출 0.
- privacy.md·PERMISSION.md·README.md·CLAUDE.md가 새 권한 모델로 갱신됨.
- 기존 단위 테스트(`resolveNavigationAction`)·e2e 회귀 없음(권한 전제 spec은 갱신).

**측정 한계 (제품 지표 부재 명시)**: 재동의율·이탈률 같은 사용자 결과 지표는 **측정 불가**다 — Chrome이 비활성화한 사용자에게선 PostHog 이벤트가 나오지 않는다(익명 집계도 침묵). 따라서 성공 기준을 코드/빌드 단언으로 한정하고, 사용자 영향은 **정성 프록시**(웹스토어 대시보드의 주간 활성 사용자 수 추이)로만 관찰한다. 정량 목표는 세우지 않는다.
