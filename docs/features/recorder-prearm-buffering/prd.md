# 로그 레코더 Pre-arm 버퍼링 (초반 요청 누락 보완)

## 배경

로그 레코더(network/console/action)는 `document_start`에 MAIN world로 주입되지만, sentinel(=레코딩 활성화 신호, 로그 레코더의 `recording` 플래그)을 받기 전까지 `recording=false`라 모든 로그를 **버퍼링 없이 즉시 버린다**(`network-recorder.ts:182-183`, `console-recorder.ts:52-53`, `action-recorder.ts:52-53`). (이 `recording`은 사용자에게 보이는 video "녹화 중" UI와 무관 — design.md 참조.)

top frame(frameId 0)의 재무장은 `useBackgroundRecorder.ts:91`의 `chrome.tabs.onUpdated` `status:complete`에서만 일어난다(iframe만 `onCommitted→frameCommitted`로 일찍 받음). 즉 **하드 네비게이션(특히 새로고침)에서는 `document_start` ~ 페이지 로드 완료 사이에 발생한 초반 fetch/XHR/console/클릭이 통째로 누락**된다.

체감 증상: "같은 A 페이지라도, 링크로 클릭 이동(SPA soft 네비게이션이면 레코더가 안 죽어 다 잡힘)했을 때보다 새로고침(항상 하드 로드)했을 때 초반 요청이 더 많이 빠진다." 이는 기분 탓이 아니라 위 구조에서 비롯된 실제 누락이다.

## 목표

- active origin(이미 한 번 armed된 origin/탭 세션)에서 페이지를 **새로고침하거나 같은 탭에서 하드 네비게이션**할 때, `document_start`부터 발생한 초반 network/console/action 로그를 누락 없이 캡처한다.
- 누락 보완은 sentinel 도착(현재 타이밍 = `status:complete`) 시점에 **버퍼에 쌓아둔 초반 로그를 소급(retroactive) flush**하는 방식으로 달성한다. 재무장 타이밍 자체는 건드리지 않는다.
- 소급 flush된 초반 로그가 **reload의 `logClear`/`lastLogClearAt` 경계에 걸려 사이드패널에서 버려지지 않도록** 보존한다(pre-arm 엔트리 마커로 필터 우회 — design.md 참조).
- bugshot을 사용한 적 없는 origin/페이지에서는 **현행과 동일하게 무부하**(후킹은 설치돼 있으나 즉시 버림)를 유지한다.

## 비목표 (Non-goals)

- top frame 재무장 시점을 `onCommitted`/`onDOMContentLoaded`로 앞당기는 변경은 하지 않는다(버퍼링이 그 창을 이미 덮으므로 불필요).
- iframe 로그 경로(`frameCommitted` → `rebroadcastSentinelsToFrame`) 변경 없음. iframe에도 동일한 pre-arm 게이트가 자연 적용될 뿐, 별도 로직 추가 안 함.
- SPA soft 네비게이션(같은 document 유지) 동작 변경 없음 — 이미 레코더가 살아 있어 누락이 없다.
- 새 권한·env·외부 API 추가 없음.
- **첫 방문**(해당 origin sessionStorage에 active 플래그가 없는 첫 로드 — 패널 오픈 여부 무관)의 초반 누락은 보완 대상이 아니다. cross-origin 하드 네비 첫 진입도 여기 포함된다.
- active 플래그를 명시적으로 정리(clear)하지 않는다 — 탭 종료 시 sessionStorage 자연 소멸에 맡긴다. 따라서 녹화 종료 후 편집 단계(drafting~done)에서 reload 시 sentinel이 안 와도 플래그는 남으나, 이때 pre-arm 버퍼는 flush 없이 폐기되는 **무해한 적재 비용**(전송 0)으로 둔다.

## 사용자 시나리오

1. 사용자가 사이드패널을 연다 → 지원 URL이면 `useBackgroundRecorder`가 레코더를 **자동 주입**(명시적 "시작" 액션 없음). 페이지 A가 armed되면서 레코더가 sessionStorage에 active 플래그를 남긴다.
2. 사용자가 A를 **새로고침**한다(버그 재현).
3. 새 MAIN world가 `document_start`에 주입되며 active 플래그를 동기로 읽어 **pre-arm 모드로 시작** → 페이지 스크립트보다 먼저 후킹된 fetch/XHR/console/액션을 버퍼에 쌓고 `preArm` 마커를 단다(아직 dispatch 안 함).
4. 페이지 로드 완료 → `status:complete` → 사이드패널이 `setSentinel` 전송.
5. 레코더가 sentinel을 받는 순간 **버퍼에 쌓인 초반 로그를 소급 flush** → 사이드패널 수신부가 `preArm` 마커로 `lastLogClearAt` 필터를 우회해 보존 → 로그 탭에 로드 초반 요청까지 표시된다.

### 엣지 케이스
- **bugshot 미사용 origin**: active 플래그 없음 → pre-arm 비활성 → 현행대로 즉시 버림(무부하).
- **sentinel이 끝내 안 옴**(패널을 닫은 채 페이지 방치): 버퍼는 기존 entry/memory cap으로 상한 유지, dispatch는 sentinel 없으면 no-op(전송 0). 네비게이션/pagehide 시 폐기.
- **sandboxed iframe**(sessionStorage 접근 시 throw): 안전하게 false 처리 → pre-arm 비활성, 회귀 없음.
- **cross-origin 하드 네비게이션**: 도착 origin의 sessionStorage는 새 것이라 플래그 없음 → 첫 진입은 pre-arm 안 됨(현행과 동일).

## 성공 기준

- active origin에서 새로고침 시, **`document_start` 직후 발사한 marker 요청이 로그 탭에 나타난다**(e2e: 고정 marker fetch를 reload 후 카운트로 판정 — 결정론적). 보강 수동: 데모 페이지 새로고침 전후 초반 요청 포착 건수 비교(차이가 양수).
- 소급 flush된 pre-arm 엔트리가 reload의 `logClear`/`lastLogClearAt`에 걸리지 않고 보존된다.
- bugshot 미사용 origin에서 fetch/XHR가 버퍼에 쌓이지 않는다(즉시 버림 — 무부하 유지).
- pre-arm 게이트(`isPreArmFlag`)와 필터 우회(`shouldDropPreArmEntry`) 순수 함수에 단위 테스트가 추가되고 `pnpm test` 통과.
- console error/warn 조기 후킹이 스택 attribution·페이지 Sentry를 깨지 않는다(실탭 수동 회귀).
- 기존 e2e/단위 테스트 회귀 없음.
