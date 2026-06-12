# activeTab 선제 만료 트리거 제거

## 배경

activeTab 권한은 Chrome이 cross-origin 네비게이션·탭 닫힘 시 **강제로** 회수한다. 이건 우리가 못 막는다. 그런데 현재 코드는 이 강제 회수와 별개로, cross-origin 네비게이션을 직접 감지해 **선제적으로 사이드패널을 닫거나 만료 다이얼로그를 띄워 패널을 종료**한다 (`tab-bindings.ts:deactivatePanelIfCrossOrigin`).

문제는 **grant 소멸 ≠ 패널 닫기**라는 점이다. activeTab grant가 사라져도 사이드패널 UI는 살아있을 수 있고, 사용자가 툴바 아이콘만 다시 클릭하면(`action.onClicked`) 패널을 닫았다 열 필요 없이 새 grant가 부여된다. 게다가 캡처 시점 런타임 가드(`isActiveTabPermissionError`·`isTabCaptureUnavailable`)가 이미 **캡처 경로의** 만료 케이스를 정확히 잡아 안내한다(레코더 재주입 등 일부 비캡처 경로는 무음 실패 — 현행 유지, 비목표 참조). 즉 선제 닫기/다이얼로그는 **중복 안전망**이고, 오히려 사용자가 같은 탭에서 잠깐 다른 사이트에 갔다 오기만 해도 패널이 사라지는 UX 단절을 만든다.

## 목표

- cross-origin 네비게이션을 감지해 **선제적으로 패널을 닫거나 만료 다이얼로그를 띄우는** 동작을 제거한다.
- activeTab 만료는 **캡처를 실제로 시도하는 시점**의 기존 런타임 가드로만 안내한다 (즉시 경로 유지).
- cross-origin 이동 후에도 사이드패널은 그대로 유지되고, 사용자는 아이콘 재클릭으로 grant를 복구한다.
- 캡처 시점 만료 다이얼로그를 **패널 유지형**으로 바꾼다 — 확인 시 `window.close()` 제거, 문구를 "툴바의 BugShot 아이콘을 다시 클릭해 주세요" 취지의 복구 안내로 교체(ko/en). "패널 유지" 철학이 캡처 시도 시점까지 일관되도록.

## 비목표 (Non-goals)

- activeTab 권한 자체 제거 — captureVisibleTab·tabCapture·executeScript에 여전히 필요하므로 manifest는 그대로 둔다.
- 캡처 시점 만료 안내(`onPickerPermissionExpired` 다이얼로그) 제거 — 즉시 경로는 유지한다(단 다이얼로그의 `window.close()`·문구는 목표대로 변경).
- 레코더 재주입 무음 실패(`picker-control.ts`의 catch) 개선 — activeTab 만료 시 조용히 실패하는 현행 동작을 유지한다.
- stale 세션 정리·`picker.clear`(페이지 변경 대응) 제거 — activeTab 만료와 무관한 별개 책임이므로 유지한다.
- drafting 중 cross-origin 이동 시 stale 안내 배너 추가 — "그냥 유지"로 결정(별도 UI 없음).
- same-origin 네비게이션 동작 변경 — Chrome이 grant를 유지하고 현재도 패널을 유지하므로 손대지 않는다.

## 사용자 시나리오

### S1. idle 상태에서 cross-origin 이동 (지원 URL)
1. 탭 A(`example.com`)에서 아이콘 클릭 → 패널 열림, 아직 캡처 안 함(idle).
2. 같은 탭에서 `other.com`(지원 URL)으로 이동.
3. **변경 전**: 패널이 닫힘 → 사용자가 아이콘 재클릭해야 함.
4. **변경 후**: 패널 유지. stale 세션은 정리됨. 사용자가 캡처를 시작하면 진입 가드(`ensureSupportedTab`)가 grant 만료를 감지해 만료 다이얼로그를 띄운다 — 다이얼로그는 패널을 닫지 않고 아이콘 재클릭 복구를 안내, 사용자는 아이콘 재클릭으로 grant 복구 후 이어서 사용.

### S2. drafting 중 cross-origin 이동 (보존 상태)
1. 탭 A에서 요소를 캡처해 draft 작성 중(drafting, 보존 상태).
2. 같은 탭에서 cross-origin 페이지로 이동.
3. **변경 전**: idle 전환 시 만료 다이얼로그 → `window.close()`로 패널 강제 종료.
4. **변경 후**: 패널 유지. draft는 그대로 남아 제출 가능(캡처 데이터는 이미 스토리지에 있음). before/after 이미지는 캡처 당시 페이지 기준 — 별도 안내 없이 그대로 둔다.
5. drafting 중 **추가 캡처**(요소 추가·인라인 이미지 삽입)를 시도하면 즉시 경로 만료 다이얼로그가 뜨되 패널은 유지 — 아이콘 재클릭 후 이어서 작성.

### S3. 미지원 URL로 이동 (엣지)
1. 패널 열린 탭에서 `chrome://settings`·웹스토어 등 캡처 불가 URL로 이동.
2. **변경 후**: 비보존 상태면 `apply()`의 미지원 분기가 패널을 닫는다(현행 유지). 보존 상태면 유지(draft 제출 가능).

### S4. same-origin 페이지 이동
- 변경 없음. 패널 유지 + stale 세션 정리/element `picker.clear`(현행).

### S5. recording(영상 녹화) 중 cross-origin 이동
1. 탭 A에서 영상 녹화 시작(recording — 보존 상태).
2. 같은 탭에서 cross-origin 페이지로 이동.
3. **변경 전**: 보존 상태라 패널·녹화는 유지되나 deferred 플래그가 세팅 → 이후 idle 전환 시점(제출/취소 후)에 만료 다이얼로그 → 패널 종료.
4. **변경 후**: 패널·녹화(tabCapture 스트림)·로그 누적 모두 현행대로 유지. idle 전환 시 다이얼로그가 더는 뜨지 않고, 다음 캡처 시도 시점에 즉시 경로가 안내.

### S6. 탭 전환 후 복귀
- 변경 없음. 탭 전환은 `resolveTabSwitch`(`onActivated`) 경로로, 이번 변경 대상(`onUpdated` 네비게이션 경로)과 독립. 탭 전환 자체는 activeTab grant를 회수하지 않으므로(회수 트리거는 cross-origin 네비게이션·탭 닫힘) 패널 재표시·레코더 재개도 현행 유지.

## 성공 기준

- [ ] cross-origin 네비게이션 시 패널이 닫히지 않고, 만료 다이얼로그가 즉시 뜨지 않는다.
- [ ] cross-origin 이동 후 캡처를 시도하면 기존 만료 다이얼로그가 정확히 뜬다(즉시 경로 회귀 없음).
- [ ] 만료 다이얼로그 확인 시 패널이 닫히지 않는다(`window.close()` 제거), 문구가 아이콘 재클릭 복구 안내로 갱신된다(ko/en 대칭).
- [ ] 미지원 URL 이동 시 비보존 패널은 여전히 닫힌다.
- [ ] same-origin 페이지 이동 시 stale 세션 정리·element 선택 초기화가 그대로 동작한다.
- [ ] `activeTabExpiredDeferred` 메시지 타입과 deferred 경로가 코드베이스에서 사라진다(고아 없음).
- [ ] `pnpm typecheck`·`pnpm test` 통과.
