# activeTab 만료 복구 개선 — deferred 사망 경로 제거 + 광역 권한 공유

## 배경

activeTab 권한은 Chrome이 cross-origin 네비게이션·탭 닫힘 시 강제로 회수한다. 현재 코드는 cross-origin 네비게이션을 감지해(`tab-bindings.ts:deactivatePanelIfCrossOrigin`) 두 가지를 한다:

1. **비보존 상태**: 패널을 즉시 닫는다. 이건 사실 self-healing UX다 — 사용자가 아이콘을 다시 클릭하는 행위가 정확히 grant 재부여 제스처라 복구가 저절로 일어난다. **유지한다.**
2. **보존 상태(drafting 등)**: `activeTabExpiredDeferred` 메시지를 보내 두고, 사용자가 idle로 복귀하는 순간 뜬금없이 만료 다이얼로그를 띄운 뒤 `window.close()`로 패널을 강제 종료한다. 사용자 맥락과 무관한 시점의 다이얼로그 + 패널 사망 — **나쁜 UX의 핵심. 제거한다.**

한편 30s Replay 옵트인이 부여하는 광역 host 권한(`https://*/*`·`http://*/*`)을 보유한 사용자는 `captureVisibleTab`·`scripting.executeScript`가 activeTab 없이도 동작한다. 즉 이 사용자에겐 cross-origin 이동 후에도 캡처 능력이 살아 있는데 패널만 닫힌다 — 닫을 이유가 없다. **권한을 공유해, 광역 권한 보유 시 선제 닫기를 스킵한다.** 새 권한 요청 진입점은 만들지 않는다(30s Replay 옵트인 1곳 유지).

캡처 시점 만료 다이얼로그(`App.tsx:permissionExpired`)도 확인 시 `window.close()`로 패널을 닫고 문구가 "다시 실행해 주세요"라 drafting 중 추가 캡처 시 작성 맥락이 통째로 사라진다 — 패널 유지형(문구: 아이콘 재클릭 안내)으로 바꾼다.

## 목표

- 보존 상태 cross-origin 이동 시의 deferred 경로(`activeTabExpiredDeferred` 메시지 → idle 복귀 시 다이얼로그 → `window.close()`)를 제거한다. 패널은 조용히 유지된다.
- 광역 host 권한 보유 시(=30s Replay 허용 사용자) 비보존 cross-origin 이동에도 패널을 닫지 않는다 — 캡처가 그대로 동작하므로 만료 다이얼로그도 자연히 안 뜬다.
- 광역 권한 미보유 시 비보존 cross-origin 닫기(self-healing)는 **현행 그대로 유지**한다.
- 캡처 시점 만료 다이얼로그를 패널 유지형으로 바꾼다 — `window.close()` 제거, 문구를 아이콘 재클릭 복구 안내로 교체(ko/en).
- 권한 모델 변화 없음: manifest diff 0, 새 권한 요청 UI 0, 새 store 필드·마이그레이션 0.

## 비목표 (Non-goals)

- activeTab 권한 자체 제거 — captureVisibleTab·tabCapture·executeScript의 기본 경로로 유지.
- 광역 권한 요청 진입점 추가(만료 다이얼로그 버튼·설정 토글 등) — 옵트인은 30s Replay 설정 1곳 유지. 다이얼로그에 리플레이 설정 힌트 문구도 넣지 않는다(최소 문구).
- 영상 녹화(tabCapture)의 invoke 요구 우회 — Chrome 제약상 불가. 광역 권한 보유자도 cross-origin 이동 후 녹화 시작은 만료 다이얼로그 → 아이콘 재클릭.
- 캡처 시점 만료 안내(`onPickerPermissionExpired` 즉시 경로) 제거 — 유지한다(동작만 패널 유지형으로).
- 레코더 재주입 무음 실패(`picker-control.ts`의 catch) 개선 — 현행 유지. 광역 권한 보유 시엔 자연 해소된다.
- stale 세션 정리·`picker.clear`(페이지 변경 대응) 변경 — 별개 책임, 유지.
- same-origin 네비게이션 동작 변경 — 없음.

## 사용자 시나리오

광역 권한 보유 = 30s Replay 옵트인을 승인한 사용자 (`chrome.permissions.contains`로 판정, Replay 스위치 ON/OFF와 무관 — 권한은 1회 부여 후 영구).

### S1. 비보존(idle) cross-origin 이동 — 광역 미보유
- **변경 없음**: 패널 닫힘 → 아이콘 재클릭으로 재오픈 + grant 재부여 (self-healing 현행 유지).

### S2. 비보존(idle) cross-origin 이동 — 광역 보유
1. 30s Replay를 켠 적 있는 사용자가 탭 A(`example.com`)에서 패널 열고 idle.
2. 같은 탭에서 `other.com`으로 이동.
3. **변경 전**: 패널 닫힘 (캡처 능력이 살아 있는데도).
4. **변경 후**: 패널 유지 + stale 세션 정리. 캡처를 시작하면 광역 권한으로 **그대로 동작** — 만료 다이얼로그 자체가 안 뜬다.

### S3. 보존(drafting 등) cross-origin 이동 — 광역 미보유
1. 탭 A에서 draft 작성 중 cross-origin 이동.
2. **변경 전**: deferred 플래그 세팅 → 제출/취소로 idle 복귀하는 순간 만료 다이얼로그 → `window.close()`로 패널 사망.
3. **변경 후**: 패널 조용히 유지, draft 제출 가능. 추가 캡처(요소 추가·인라인 이미지)를 시도하면 즉시 경로 만료 다이얼로그가 뜨되 **패널은 유지** — 아이콘 재클릭 후 이어서 작성.

### S4. 보존 cross-origin 이동 — 광역 보유
- 패널·draft 유지 + 추가 캡처도 그대로 동작. 다이얼로그 없음.

### S5. recording(영상 녹화) 중 cross-origin 이동
- 보존 상태라 패널·녹화(tabCapture 스트림)·로그 누적 유지(현행). 변경 후엔 idle 복귀 시 deferred 다이얼로그가 더는 안 뜬다. 새 녹화 시작은 광역 보유 여부와 무관하게 invoke 필요 — 만료 다이얼로그(패널 유지) → 아이콘 재클릭.

### S6. 미지원 URL(`chrome://`·웹스토어)로 이동
- **변경 없음**: 광역 보유 여부와 무관하게 비보존 패널은 닫힌다(`apply`의 미지원 분기 + 선제 닫기의 supported 조건). 보존 상태면 유지.

### S7. same-origin 페이지 이동 / 탭 전환 후 복귀
- **변경 없음**. same-origin은 패널 유지 + stale 정리/`picker.clear`(현행). 탭 전환은 `resolveTabSwitch`(`onActivated`) 경로로 이번 변경과 독립.

## 성공 기준

- [ ] 광역 권한 보유 시 cross-origin 이동 후 패널이 닫히지 않고, 캡처가 다이얼로그 없이 동작한다.
- [ ] 광역 권한 미보유 시 비보존 cross-origin 이동의 패널 닫힘이 현행과 동일하다(회귀 없음).
- [ ] 보존 상태 cross-origin 이동 후 idle 복귀 시 만료 다이얼로그가 뜨지 않고 패널이 살아 있다.
- [ ] 만료 다이얼로그 확인 시 패널이 닫히지 않는다(`window.close()` 제거), 문구가 아이콘 재클릭 안내로 갱신된다(ko/en 대칭).
- [ ] 미지원 URL 이동 시 비보존 패널은 여전히 닫힌다.
- [ ] same-origin 이동 시 stale 세션 정리·element 선택 초기화가 그대로 동작한다.
- [ ] `activeTabExpiredDeferred` 메시지 타입과 deferred 경로가 코드베이스에서 사라진다(고아 없음). `REPLAY_ORIGINS`는 공용 상수로 추출되어 단일 출처가 된다.
- [ ] `pnpm typecheck`·`pnpm test` 통과 (신규 순수 헬퍼 단위 테스트 포함).
