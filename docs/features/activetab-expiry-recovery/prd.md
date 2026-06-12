# 광역 권한 패널 확대 — 권한 만료 다이얼로그 만나는 경우 최소화

## 배경

activeTab 권한은 Chrome이 cross-origin 네비게이션·탭 닫힘 시 강제 회수한다. 현재 코드는 cross-origin 네비게이션 감지 시(`tab-bindings.ts:deactivatePanelIfCrossOrigin`) 비보존 패널을 닫고, 보존 상태(drafting 등)면 deferred 플래그를 세워 idle 복귀 시 만료 다이얼로그 → `window.close()`로 패널을 종료한다. 이 흐름은 **activeTab만 가진 사용자에겐 합리적인 self-healing UX다** — 패널이 닫히면 사용자는 자연스럽게 아이콘을 다시 클릭하고, 그 클릭이 정확히 grant 재부여 제스처라 복구가 저절로 일어난다. **이 UX는 그대로 유지한다.**

한편 30s Replay 옵트인이 부여하는 광역 host 권한(`https://*/*`·`http://*/*`)을 보유한 사용자는 `captureVisibleTab`·`scripting.executeScript`가 activeTab 없이도 동작한다. 즉 cross-origin 이동 후에도 캡처 능력이 살아 있는데, 현재 코드는 권한 보유 여부를 보지 않고 일괄로 패널을 닫거나 만료 다이얼로그를 예약한다 — **능력이 있는 사용자까지 불필요하게 끊는다**.

이번 과업의 목적: **30s Replay로 받는 광역 권한을 패널 전반(선제 닫기 판정·캡처 경로)으로 확대 적용해, 권한 만료 다이얼로그·패널 닫힘을 만나는 경우의 수를 최대한 줄인다.** 새 권한 요청 진입점은 만들지 않는다(옵트인은 30s Replay 설정 1곳 유지).

## 목표

- cross-origin 네비게이션 판정 시 광역 host 권한을 조회해, **보유 시 same-origin과 동일하게 취급**한다 — 패널 유지, deferred 다이얼로그 예약 없음, stale 세션 정리만.
- 광역 권한 보유자는 cross-origin 이동 후에도 캡처가 그대로 동작한다(캡처 시점 가드는 에러 후 분류 방식이라 captureVisibleTab이 성공하면 다이얼로그 자체가 발화하지 않음 — 코드 변경 불필요, 자연 효과).
- **광역 권한 미보유자의 UX는 일절 불변**: 비보존 cross-origin 패널 닫기, 보존 상태 deferred → idle 복귀 시 만료 다이얼로그 → `window.close()`(패널 종료 → 재오픈으로 grant 자연 재취득), 캡처 시점 만료 다이얼로그 모두 현행 그대로.
- 권한 모델 변화 없음: manifest diff 0, 새 권한 요청 UI 0, 새 store 필드·마이그레이션 0.

## 비목표 (Non-goals)

- deferred 경로(`activeTabExpiredDeferred` 메시지 → idle 복귀 시 다이얼로그) 제거 — **유지한다.** 미보유 사용자의 self-healing 트리거로 여전히 유효.
- 만료 다이얼로그의 동작(`window.close()`)·문구 변경 — **유지한다.** 패널 종료가 재오픈(=grant 재취득)을 유도하는 의도된 흐름.
- 광역 권한 요청 진입점 추가(다이얼로그 버튼·설정 토글 등) — 옵트인은 30s Replay 설정 1곳 유지.
- 영상 녹화(tabCapture)의 invoke 요구 우회 — Chrome 제약상 불가. 광역 보유자도 cross-origin 이동 후 새 녹화 시작은 만료 다이얼로그 경로(현행).
- stale 세션 정리·`picker.clear`·same-origin 동작 변경 — 없음.
- activeTab 권한 제거 — 미보유 사용자의 기본 경로로 유지.

## 사용자 시나리오

광역 권한 보유 = 30s Replay 옵트인을 승인한 사용자(`chrome.permissions.contains`로 판정, Replay 스위치 ON/OFF와 무관 — 권한은 1회 부여 후 영구).

### S1. 광역 미보유 — 모든 케이스
- **변경 없음.** 비보존 cross-origin → 패널 닫힘 → 아이콘 재클릭 재오픈(grant 재취득). 보존 cross-origin → deferred → idle 복귀 시 다이얼로그 → 확인 시 패널 종료 → 재오픈. 캡처 시점 만료 → 다이얼로그 → 종료 → 재오픈.

### S2. 광역 보유 — 비보존(idle) cross-origin 이동
1. 30s Replay를 승인한 사용자가 탭 A(`example.com`)에서 패널 열고 idle.
2. 같은 탭에서 `other.com`(지원 URL)으로 이동.
3. **변경 전**: 패널 닫힘 (캡처 능력이 살아 있는데도).
4. **변경 후**: 패널 유지 + stale 세션 정리(same-origin과 동일 취급). 캡처 시작하면 광역 권한으로 그대로 동작 — 다이얼로그 없음.

### S3. 광역 보유 — 보존(drafting 등) cross-origin 이동
1. draft 작성 중 cross-origin 이동.
2. **변경 전**: deferred 예약 → 제출/취소로 idle 복귀하는 순간 만료 다이얼로그 → 패널 종료.
3. **변경 후**: deferred 예약 자체가 없음. 패널·draft 유지, 추가 캡처(요소 추가·인라인 이미지)도 그대로 동작, idle 복귀해도 다이얼로그 없음.

### S4. 광역 보유 — 영상 녹화
- 녹화 중 cross-origin 이동: 보존 상태라 패널·tabCapture 스트림·로그 누적 유지(현행) + 변경 후엔 idle 복귀 다이얼로그 없음.
- cross-origin 이동 **후** 새 녹화 시작: tabCapture는 invoke 필수(Chrome 제약) → 현행 만료 다이얼로그 경로. 광역 권한이 줄여주지 못하는 유일한 다이얼로그 케이스.

### S5. 미지원 URL(`chrome://`·웹스토어)로 이동
- **변경 없음**: 광역 보유 여부와 무관하게 비보존 패널은 닫힌다(미지원 URL은 광역 권한 범위 밖 — 보유자도 URL 미가시 또는 미지원 판정 → 현행 닫기 분기).

### S6. same-origin 페이지 이동 / 탭 전환 후 복귀
- **변경 없음.** same-origin은 패널 유지 + stale 정리/`picker.clear`(현행). 탭 전환은 `resolveTabSwitch`(`onActivated`) 경로로 이번 변경과 독립.

## 성공 기준

- [ ] 광역 보유 시: 지원 URL 간 cross-origin 이동 후 패널이 닫히지 않고, idle 복귀 시 만료 다이얼로그가 뜨지 않으며, 캡처가 다이얼로그 없이 동작한다.
- [ ] 광역 미보유 시: 비보존 cross-origin 패널 닫힘·보존 deferred 다이얼로그·`window.close()` 동작이 현행과 완전히 동일하다(회귀 없음).
- [ ] 미지원 URL 이동 시 비보존 패널은 보유 여부와 무관하게 닫힌다.
- [ ] same-origin 이동 시 stale 세션 정리·element 선택 초기화가 그대로 동작한다.
- [ ] `REPLAY_ORIGINS`가 공용 상수(`BROAD_HOST_ORIGINS`)로 추출되어 단일 출처가 되고, 30s Replay 토글·폴링이 회귀 없이 동작한다.
- [ ] 신규 순수 헬퍼(`resolveNavigationAction`) 단위 테스트 포함 `pnpm typecheck`·`pnpm test` 통과.
