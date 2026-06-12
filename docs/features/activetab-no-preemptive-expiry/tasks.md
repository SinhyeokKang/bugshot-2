# activeTab 선제 만료 트리거 제거 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음. manifest 변경 없음.
- 작업 전 `pnpm test` 그린 확인(베이스라인).
- `BgInternalMessage`의 `activeTabExpiredDeferred` 사용처는 `tab-bindings.ts`(발신)·`usePickerMessages.ts`(수신) 2곳뿐임을 확인(grep 완료).

## 태스크

### Task 1: deferred 메시지 타입 제거
- **변경 대상**: `src/types/messages.ts`
- **작업 내용**:
  - `BgInternalMessage` union에서 `| { type: "activeTabExpiredDeferred"; tabId: number }`(211) 제거.
  - 인접 주석(295 부근 "페이지 이동으로 activeTab grant가 만료돼…") 정리.
  - `onPickerPermissionExpired` 정의(296)는 **유지**.
- **검증**:
  - [ ] `pnpm typecheck` — `activeTabExpiredDeferred` 참조하던 두 파일에서 타입 에러가 나야 정상(다음 태스크에서 해소).
  - [ ] `onPickerPermissionExpired` export 유지 확인.

### Task 2: 사이드패널 deferred 경로 제거
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**:
  - `let deferredActiveTabExpiry = false;`(23) 제거.
  - `useEditorStore.subscribe` 콜백의 idle 전환 `onPickerPermissionExpired.fire()` 분기(47–50) 제거. 로그 flush 분기(53–57) 유지.
  - `activeTabExpiredDeferred` 메시지 핸들러 `else if`(162–165) 제거.
  - 이 파일에서 `onPickerPermissionExpired` import가 더 안 쓰이면 import 목록(5)에서 제거.
- **검증**:
  - [ ] `deferredActiveTabExpiry` grep 0건.
  - [ ] 로그 flush(`flushNow`) 분기와 다른 메시지 핸들러(`logClear`·`*.data` 등) 변경 없음.

### Task 3: background 선제 만료 트리거 제거
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**:
  - `deactivatePanelIfCrossOrigin` 함수(110–156) 전체 삭제.
  - `setupTabBindings`의 `onUpdated` 리스너에서 `status === "loading"` 분기(225–228)와 그 `deactivatePanelIfCrossOrigin` 호출 제거. `info.url` 분기(`clearIfPageChanged → apply`)·`complete` 분기는 유지.
  - `ACTIVATION_URL_PREFIX` 상수(14) 제거.
  - `activateTab`의 `ACTIVATION_URL_PREFIX` write(173–175) 제거.
  - `onRemoved`의 remove 배열(243)을 `sessionKey(tabId)` 단일 키로 축소.
  - 미사용이 된 import(`originOf`, `BgInternalMessage` 등) 정리 — 실제 잔존 사용처 확인 후.
- **검증**:
  - [ ] `deactivatePanelIfCrossOrigin`·`ACTIVATION_URL_PREFIX`·`activeTabExpiredDeferred` grep 0건.
  - [ ] `pnpm typecheck` 통과(미사용 import 0).
  - [ ] `shouldPreserveSession`·`resolveTabSwitch`·`apply`·`clearIfPageChanged`·`activateTab` 시그니처·로직 변경 없음.
  - [ ] `pnpm test` — `tab-bindings.test.ts` 그린(순수함수 영향 없음).

### Task 4: PERMISSION.md 갱신 (별도 docs 커밋)
- **변경 대상**: `PERMISSION.md`
- **작업 내용**:
  - "만료 시 동작 > 지연 경로(보존 상태)"(149–154) 제거 또는 "패널 유지 + 캡처 시점 안내"로 수정.
  - 상태 표(273 부근) cross-origin 행, `activeTabExpiredDeferred` 흐름(293), 라이프사이클 다이어그램 갱신.
- **검증**:
  - [ ] 문서에 `activeTabExpiredDeferred`·deferred 경로 서술이 남지 않음.
  - [ ] 즉시 경로(캡처 시점 가드) 서술은 유지.
- **참고**: 구현 커밋과 분리해 `docs(PERMISSION): ...`로. `/push` 신선도 검사 대상.

## 테스트 계획

- **단위 테스트**: 신규/변경 순수 함수 **없음**. `shouldPreserveSession`·`resolveTabSwitch`는 미변경이라 기존 `tab-bindings.test.ts` 그대로 그린이어야 한다. 제거되는 로직(`deactivatePanelIfCrossOrigin`)은 chrome API 의존 부수효과 함수라 단위 테스트 대상이 아니었음 → 추가 단위 테스트 없음.
- **e2e 시나리오** (`/e2e-write` 입력):
  - cross-origin(지원 URL) 이동 후 사이드패널이 **닫히지 않고 유지된다**.
  - drafting 중 cross-origin 이동 후 패널이 유지되고 draft 내용이 남아 있다.
  - 미지원 URL(`chrome://`·웹스토어)로 이동하면 비보존 패널이 **닫힌다**.
  - same-origin 다른 페이지로 이동하면 element 선택이 초기화된다(`picker.clear`).
- **수동 테스트** (captureVisibleTab 의존 — 자동화 불가):
  - cross-origin 이동 후 캡처를 시도하면 만료 다이얼로그가 정상적으로 뜬다(즉시 경로 회귀 없음).
  - 만료 다이얼로그 후 아이콘 재클릭으로 grant가 복구되고 캡처가 다시 된다.
  - 영상 녹화(tabCapture) 중 cross-origin 이동 시 만료 안내가 정상.

## 구현 순서 권장

- Task 1 → 2 → 3 순서(타입 먼저 제거하면 typecheck가 잔존 참조를 잡아줌). 2·3은 서로 독립이라 순서 무관하나, 1 이후 함께 진행해 typecheck 그린으로 마감.
- Task 4(PERMISSION.md)는 1–3 완료 후, `/push` 단계에서 `docs(PERMISSION)` 커밋으로 분리.

## 가이드 영향

`guide/` 페이지 중 "페이지를 이동하면 패널/세션이 닫힌다"류 서술이 있으면 갱신 필요(있다면 ko·en 동시). 판단·작성 기준은 `guide/AUTHORING.md`. 구현 후 `/guide`로 cross-origin 이동 시 패널 유지 동작과 대조 — 해당 서술이 없으면 "없음". privacy.md는 권한·캡처·수집 동작 변화가 없으므로(오히려 권한 사용 축소) **영향 없음**.
