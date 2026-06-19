# PostHog 이벤트 확장 (완전 익명)

## 배경

현재 PostHog 추적은 `issue_submitted` **단일 이벤트**뿐이다(`src/sidepanel/lib/track-submit.ts`). 활성화 funnel의 마지막 단계만 잡혀 있어 다음을 알 수 없다:

- 설치 후 사이드패널을 여는 비율 (활성화)
- 6개 플랫폼 중 무엇이 실제로 연결되는지 (플랫폼 인기도)
- OAuth 연결이 취소·실패하는 비율 (이탈/에러)

이 기능은 활성화·플랫폼 연결 단계의 익명 이벤트를 추가해 제품 사용 패턴을 본다.

## 목표

- 활성화/온보딩 이벤트 추가: `extension_installed`, `sidepanel_opened`
- 플랫폼 연결 이벤트 추가: `platform_connect`(성공/취소/실패), `platform_disconnected`
- **완전 익명 유지**: 모든 이벤트의 `distinct_id`를 고정 상수 `"anonymous"`로 통일. 기존 `issue_submitted`의 매-이벤트 `crypto.randomUUID()` 발급도 폐지해 동일하게 `"anonymous"`로 맞춘다.
- 측정 코드를 **background service worker에 수렴**시켜 side panel React 6개 ConnectForm을 건드리지 않는다.

## 비목표 (Non-goals)

- **Funnel·retention·재방문 분석 불가** — 완전 익명이므로 이벤트 간 연결이 없다. 이벤트 볼륨/비율만 본다. (의도된 트레이드오프)
- **설치 단위 persistent ID 도입 안 함** — 검토했으나 폐지. distinct_id는 식별자가 아니라 고정 더미값.
- **캡처 사용·AI 초안 이벤트 추가 안 함** — 이번 스코프 제외.
- OAuth 실패 사유의 세분화(network/token_exchange/state_mismatch 등) 안 함. `cancelled` vs `failed` 2단계까지만. 에러 메시지 문자열은 PostHog로 전송하지 않는다(노이즈·PII 회피).
- UI 변경·사용자 노출 텍스트 추가 없음.

## 사용자 시나리오

사용자에게 노출되는 UX 변화는 없다. 모두 background 익명 텔레메트리다.

1. 사용자가 확장을 **새로 설치** → `extension_installed` { version } 1회 전송.
2. 사용자가 지원 페이지에서 사이드패널을 **연다** → `sidepanel_opened` 전송.
3. 사용자가 플랫폼 OAuth **연결 성공** → `platform_connect` { platform, result: "success" }.
4. 사용자가 OAuth 창을 **닫거나 거부**(취소) → `platform_connect` { platform, result: "cancelled" }.
5. 토큰 교환·네트워크 등으로 **연결 실패** → `platform_connect` { platform, result: "failed" }.
6. 사용자가 플랫폼 **연결 해제** → `platform_disconnected` { platform }.

엣지 케이스:
- `VITE_POSTHOG_KEY`가 비어 있으면(dev 기본) 모든 이벤트가 no-op (`analyticsEnabled` 게이트). 기존 동작 유지.
- 확장 **업데이트**로 인한 `onInstalled`(reason="update")는 `extension_installed`를 보내지 않는다(신규 설치만).
- 같은 탭에서 패널을 닫았다 다시 열면 `sidepanel_opened`가 다시 발생한다(매 패널 포트 연결마다). 세션당 1회 제약은 두지 않는다.

## 성공 기준

- 위 4개 이벤트가 PostHog 대시보드에 도착하고, 모든 이벤트(신규 + 기존 `issue_submitted`)의 `distinct_id`가 `"anonymous"`로 동일하다.
- `platform_connect`의 `result`가 성공/취소/실패를 정확히 구분한다.
- 익명화 속성(`$process_person_profile:false`, `$ip:"0.0.0.0"`, `$geoip_disable:true`)이 모든 이벤트에 유지된다.
- `crypto.randomUUID()` 호출이 analytics 경로에서 사라진다.
- 관련 순수 함수 단위 테스트가 `pnpm test`로 통과한다.
