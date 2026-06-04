# 사이드패널 레코더 게이팅

## 배경

세 레코더(network/console/action)는 MAIN world content script(`recorders-entry.ts`)로 `<all_urls>`에 `document_start` 상시 주입되며, 각 레코더의 `recording` 플래그 기본값이 `true`다(`network-recorder.ts:68`, `console-recorder.ts:28`, `action-recorder.ts:39`). 따라서 사이드패널을 한 번도 열지 않은 탭에서도 페이지 로드 순간부터 fetch/XHR/console/DOM 이벤트가 래핑·캡처된다.

이 상시 캡처는 v1.3.0에서 `recording` 기본값을 `false`→`true`로 바꾸며 도입됐고(cross-page 로그 누적 목적), 그 부작용으로 SigV4 등 본문 서명 요청을 보내는 사이트(AWS 콘솔)에서 장애가 발생했다. 본문 손상 자체는 핫픽스(`ba9f26e` + 후속)로 해결됐지만, "확장이 안 쓰일 때도 모든 페이지의 트래픽을 상시 래핑·버퍼링한다"는 구조적 오버헤드와 간섭 면적은 그대로 남아 있다.

## 목표

- 사이드패널이 **해당 탭에 활성화돼 있지 않을 때는** 세 레코더가 페이지 트래픽에 일절 간섭하지 않는다(fetch/XHR 원본 경로 그대로, console/DOM 래핑 무동작).
- 사이드패널이 탭에 활성화되면 그 시점부터 수집을 시작하고, 닫히거나 다른 탭으로 전환되면 수집을 중단한다.
- 핫픽스(본문 무손상)에 더해, 평소 브라우징의 노출 면적·오버헤드를 v1.2.3 수준(레코더 미동작)으로 되돌린다.

## 비목표 (Non-goals)

- **30s Replay**는 `captureVisibleTab` 폴링 기반으로 세 레코더와 독립적이므로 게이팅 대상이 아니다.
- 사이드패널을 열기 전에 발생한 요청을 소급 캡처하지 않는다(아래 트레이드오프 참조).
- 미캡처 구간을 사용자에게 알리는 UI/문구는 추가하지 않는다.
- content script 주입 방식(manifest `<all_urls>` 상시 주입)은 변경하지 않는다. 게이팅은 `recording` 플래그 수준에서만 한다.
- picker(요소 선택) 동작은 변경하지 않는다.

## 사용자 시나리오

1. **평소 브라우징(패널 미활성)**: 사용자가 AWS 콘솔 등 임의 사이트를 사용. 레코더 `recording=false`이므로 fetch/XHR은 원본 경로로 통과하고 console/DOM 캡처도 무동작. 페이지 동작에 영향 없음.
2. **이슈 작성 시작**: 사용자가 toolbar action 또는 컨텍스트 메뉴로 사이드패널을 연다 → 해당 탭에 레코더 activate → 그 시점부터 network/console/action 수집 시작.
3. **페이지 이동(같은 탭, 패널 유지)**: 기존 cross-page 누적 로직(webNavigation sync) 그대로 동작. 패널이 그 탭에 활성인 동안 로그 누적.
4. **다른 탭으로 전환**: 패널이 새 탭으로 옮겨가면(또는 비활성 탭이 되면) 이전 탭의 레코더는 stop, 새 탭이 활성이면 activate.
5. **패널 닫기**: 패널을 닫으면 해당 탭 레코더 stop → 이후 그 탭의 트래픽은 다시 무간섭.

### 엣지 케이스

- **패널 열기 직전 발생한 요청**: 캡처되지 않는다. 사용자는 보통 버그를 보고 패널을 열어 재현하므로 재현 트래픽은 패널 활성 이후 발생해 정상 캡처된다. 놓치는 것은 "패널을 닫은 채 버그를 목격하고 나서 여는" 직전 트래픽뿐이며, 이는 수용한다.
- **패널 닫힘이 React unmount cleanup으로 감지되지 않는 경우**: 문서 destroy 시 cleanup이 보장되지 않으므로, background의 port disconnect를 stop의 주 신호로 사용한다.
- **이미 캡처돼 첨부된 로그**: 패널을 닫았다 다시 열어도 IndexedDB(`pending:${tabId}`)에 영속된 로그는 유지된다(기존 동작 불변).

## 성공 기준

- 사이드패널을 한 번도 열지 않은 탭에서 AWS 콘솔 로그인·리전 선택·권한 작업이 정상 동작한다(레코더 미동작 확인).
- 사이드패널을 연 탭에서는 network/console/action 로그가 정상 수집된다.
- 사이드패널을 닫거나 다른 탭으로 전환하면 이전 탭의 `recording`이 `false`로 돌아간다.
- `recording=false`일 때 `fetch` 래퍼가 `new Request` 재구성 없이 원본 경로로 통과한다(단위 테스트로 검증).
- 기존 cross-page 누적·30s Replay·picker 동작에 회귀가 없다.
