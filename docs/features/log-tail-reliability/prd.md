# 로그 꼬리 유실 보강 (log-tail-reliability)

## 배경

녹화(`recording` phase) 중 풀 네비게이션이 일어나면, 네비 직전에 발생한 로그 꼬리(tail)가 유실될 수 있다.

현 구조에서 console/network/action 레코더(MAIN world)는 버퍼에 로그를 쌓고, **`sync`/`stop`/`pagehide` 시점에만 batch로 CustomEvent를 dispatch**한다. 브리지(현 `picker.ts`, 분리 후 `recorder-bridge.ts`)가 이를 받아 `chrome.runtime.sendMessage`로 사이드패널에 전송한다.

유실 윈도우는 세 가지다:
- **갭1 (핵심)**: `pagehide` 핸들러에서 `dispatch()`→`sendMessage`까지는 동기로 호출되지만, **실제 IPC 전송이 페이지 unload와 경쟁**한다. Chrome이 best-effort로 flush하지만 보장이 없어, 마지막 배치가 통째로 유실될 수 있다.
- **갭2**: `onBeforeNavigate` sync 왕복이 초고속 네비(캐시 페이지·즉시 리다이렉트)에서 페이지 도착 전에 unload되어 미완료.
- **갭3**: `pagehide` 미발화(프로세스 크래시 등).

SPA의 `pushState`/`replaceState`는 페이지 컨텍스트가 유지되어 유실이 0이다 — **풀 네비게이션만 해당**한다. 이미 이중 안전망(`onBeforeNavigate` sync + `pagehide` flush)이 있어 실질 리스크는 확률적 극단 케이스지만, 0은 아니다. 특히 [iframe-log-coverage](../iframe-log-coverage/)로 레코더가 `all_frames`로 확장되면 프레임 수만큼 `pagehide` flush가 늘어 유실 표면이 커진다.

## 목표

- 녹화 중 사이드패널이 로그를 **거의 실시간으로 누적**하게 하여, 풀 네비게이션 유실 시에도 손실을 **마지막 throttle 간격(~200ms) 이내의 꼬리로 한정**한다.
- 네비 직전 **로그 폭주 상황에서도** flush가 지연되지 않도록, 디바운스가 아닌 **trailing throttle(최대 ~200ms마다 강제 flush)**로 구현한다.
- 기존 `sync`/`stop`/`pagehide` flush 경로를 그대로 유지하고, 그 위에 자동 throttle flush + `visibilitychange(hidden)` flush를 **추가**한다(안전망 다중화).
- console/network/action 3종 레코더에 일관되게 적용한다.
- 권한·외부 의존성 추가 0.

## 비목표 (Non-goals)

- **SW 실시간 적재(Jam식) 미채택**: 로그 저장소를 service worker로 옮기는 아키텍처 변경은 하지 않는다(과도).
- **증분 전송 미채택**: 자동 flush에서 "마지막 flush 이후 새 entry만" 보내는 증분 전송은 하지 않는다. 전체 버퍼를 그대로 보내고 `mergeLogItems`의 id dedup에 맡긴다(복잡도 회피, 버퍼 cap이 트래픽 상한 보장 — 아래 design 참조).
- **갭1의 완전 제거 불가**: MAIN/ISOLATED world는 동기 저장 수단이 없어(chrome API 비동기) unload race를 100% 없앨 수 없다. 유실 윈도우를 ~200ms로 **축소**하는 것이 목표이지 0으로 만드는 것이 아니다.
- **UI 변경 없음**: 사용자 비노출 내부 신뢰성 개선. 로그 표시·필터·매트릭스 변경 없음.
- **데이터 모델 변경 없음**: entry 타입·메시지 타입 변경 없음.

## 사용자 시나리오

(사용자 비노출 — 내부 동작 시나리오)

1. 사용자가 녹화 중인 페이지에서 폼 제출·버튼 클릭으로 console 에러와 network 요청이 연달아 발생한다.
2. 레코더가 entry를 버퍼에 쌓고, **trailing throttle**가 최대 200ms마다 자동으로 전체 버퍼를 dispatch → 사이드패널이 실시간 누적한다.
3. 사용자가 곧바로 cross-origin 링크로 풀 네비게이션한다.
4. 네비 직전 200ms 이내 로그를 제외한 나머지는 이미 사이드패널에 도착해 있다. `visibilitychange(hidden)`·`pagehide`·`onBeforeNavigate` sync가 마지막 꼬리까지 추가로 flush 시도한다.
5. 새 페이지에서 레코더가 재활성화(sentinel 재주입)되어 녹화가 이어진다.

**엣지 케이스**
- 로그 폭주(루프 안 `console.log`): throttle가 200ms마다 강제 flush하므로 폭주 중에도 누적이 멈추지 않는다(디바운스였다면 멈춤).
- iframe 다수 페이지: 각 프레임 레코더가 독립적으로 throttle flush. id dedup으로 병합.
- 녹화 아님(`recording=false`): `pushEntry`가 즉시 return하므로 throttle도 동작하지 않음(상시비용 없음).

## 성공 기준

- 수동 재현(cross-origin 링크 직전 `for(50) console.log` 후 즉시 네비)에서 보강 후 도착 로그 개수가 보강 전보다 유의미하게 증가한다(유실 꼬리 축소).
- 로그 폭주 중에도 사이드패널 누적이 200ms 주기로 진행됨을 확인(디바운스 미채택 검증).
- 기존 `sync`/`stop`/`pagehide` flush·30s replay trim·세션 영속화에 회귀가 없다.
- 자동 flush 빈도 증가가 사이드패널 store/IndexedDB write를 과부하시키지 않는다(write 빈도 가드 확인).
- manifest 권한 diff 0.
