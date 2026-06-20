# PostHog 이벤트 확장 (익명 설치 단위)

## 배경

현재 PostHog 추적은 `issue_submitted` **단일 이벤트**뿐이다(`src/sidepanel/lib/track-submit.ts`). 게다가 `captureEvent`가 매 이벤트마다 `crypto.randomUUID()`로 새 `distinct_id`를 발급해 **이벤트 간 연결이 불가능**하다(unique user 분모가 없어 비율·funnel 계산 불가). 그 결과 다음을 알 수 없다:

- 설치 후 사이드패널을 여는 비율 (활성화율)
- 6개 플랫폼 중 무엇이 실제로 연결되는지 (플랫폼 인기도)
- OAuth 연결이 취소·실패하는 비율 (이탈/에러율)
- 연결한 사용자 중 실제 이슈 제출까지 가는 비율 (funnel 전환)

이 기능은 (1) 설치 단위 **익명 random UUID**를 `distinct_id`로 도입해 분모를 복원하고, (2) 활성화·플랫폼 연결 단계의 이벤트를 추가해 위 지표를 측정 가능하게 한다.

## 목표

- 활성화/온보딩 이벤트 추가: `extension_installed`, `sidepanel_opened`
- 플랫폼 연결 이벤트 추가: `platform_connect`(성공/취소/실패), `platform_disconnected`
- **설치 단위 익명 식별자 도입**: `chrome.storage.local`에 설치 시 1회 생성하는 random UUID를 `distinct_id`로 사용. 기존의 매-이벤트 `crypto.randomUUID()` 발급은 폐지하고, 기존 `issue_submitted`를 포함한 모든 이벤트가 이 안정적 ID를 공유한다.
  - 이 ID는 **개인정보가 아니다**: 무작위 UUID이며 이메일·계정·IP 등 어떤 PII와도 연결되지 않는다. 기존 익명화 속성(`$process_person_profile:false`, `$ip:"0.0.0.0"`, `$geoip_disable:true`)도 그대로 유지한다.
- 측정 코드를 **background service worker에 수렴**시켜 side panel React의 6개 ConnectForm을 건드리지 않는다. (Jira disconnect만 background case가 없어 예외 처리 — 설계 참조)

## 비목표 (Non-goals)

- **캡처 사용·AI 초안 이벤트 추가 안 함** — 이번 스코프 제외.
- **OAuth 실패 사유 세분화 안 함** — `cancelled` vs `failed` 2단계까지만. 에러 메시지 문자열은 PostHog로 전송하지 않는다(노이즈·PII 회피).
- **PII·사용자 콘텐츠 수집 안 함** — distinct_id는 무작위 UUID. 페이지 URL·DOM·이슈 본문 등 일체 전송 안 함.
- **UI 변경·사용자 노출 텍스트 추가 없음** — 사이드패널 내 분석 고지·opt-out UI는 이번 스코프 밖(별도 백로그). 데이터 수집 공시는 웹스토어 listing의 Privacy practices 폼 + `docs/privacy.md`로 충족.

## 사용자 시나리오

사용자에게 노출되는 UX 변화는 없다. 모두 background 익명 텔레메트리다.

1. 사용자가 확장을 **새로 설치** → (최초 이벤트 시점에) 설치 단위 UUID 생성·저장 → `extension_installed` { version } 1회 전송.
2. 사용자가 지원 페이지에서 사이드패널을 **연다** → `sidepanel_opened` 전송.
3. 사용자가 플랫폼 OAuth **연결 성공** → `platform_connect` { platform, result: "success" }.
4. 사용자가 OAuth 창을 **닫거나 거부**(취소) → `platform_connect` { platform, result: "cancelled" }.
5. 토큰 교환·네트워크 등으로 **연결 실패** → `platform_connect` { platform, result: "failed" }.
6. 사용자가 플랫폼 **연결 해제** → `platform_disconnected` { platform }.

엣지 케이스:
- `VITE_POSTHOG_KEY`가 비어 있으면(dev 기본) 모든 이벤트가 no-op (`analyticsEnabled` 게이트). ID 생성도 불필요. 기존 동작 유지.
- 확장 **업데이트**로 인한 `onInstalled`(reason="update")는 `extension_installed`를 보내지 않는다(신규 설치만). 단 업데이트 전 설치에서 이미 저장된 UUID는 유지된다(업데이트로 초기화되지 않음).
- **업데이트로 진입한 기존 사용자**(installation id 미보유)는 첫 `captureEvent` 시점에 lazy 생성된다(`onInstalled install`에만 의존하지 않음).
- 같은 탭에서 패널을 닫았다 다시 열면 `sidepanel_opened`가 다시 발생한다(매 패널 포트 연결마다). 세션당 1회 제약은 두지 않는다. → `sidepanel_opened` 카운트는 "활성화율"이 아니라 "설치당 오픈 횟수" 지표임에 유의(대시보드 해석 시 unique distinct_id 기준으로 활성화율 산출).

## 성공 기준

- 위 4종 이벤트(`extension_installed`/`sidepanel_opened`/`platform_connect`/`platform_disconnected`)가 PostHog 대시보드에 도착한다.
- 같은 설치에서 발생한 모든 이벤트(신규 + 기존 `issue_submitted`)의 `distinct_id`가 **동일**하고, 확장 재시작·SW 재기동 후에도 **변하지 않는다**.
- 서로 다른 설치는 서로 다른 `distinct_id`를 가져 PostHog unique user 카운트가 의미를 갖는다(활성화율·플랫폼 인기도 비율·취소율 산출 가능).
- `platform_connect`의 `result`가 성공/취소/실패를 정확히 구분한다.
- 익명화 속성(`$process_person_profile:false`, `$ip:"0.0.0.0"`, `$geoip_disable:true`)이 모든 이벤트에 유지된다.
- 매-이벤트 `crypto.randomUUID()` 발급이 사라지고, 설치 단위 ID 해석 순수 함수의 단위 테스트가 `pnpm test`로 통과한다.
