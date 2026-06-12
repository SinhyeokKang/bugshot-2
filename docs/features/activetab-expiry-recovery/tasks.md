# 광역 권한 패널 확대 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음. manifest 변경 없음.
- 작업 전 `pnpm test` 그린 확인(베이스라인).
- `REPLAY_ORIGINS` 사용처는 `use-30s-replay.ts`(정의 16·contains 86)·`SettingsTab.tsx`(95·97) 확인(grep 완료). deferred 경로·다이얼로그·i18n은 **건드리지 않는다**.

## 태스크

### Task 1: BROAD_HOST_ORIGINS 공용 상수 추출
- **변경 대상**: `src/lib/broad-host-origins.ts`(신규), `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**:
  - `src/lib/broad-host-origins.ts` 생성: `export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];`
  - `use-30s-replay.ts:16`의 `REPLAY_ORIGINS` 정의 제거, 내부 사용처(86 부근)와 `SettingsTab.tsx`(95·97) 참조를 `BROAD_HOST_ORIGINS` import로 교체.
- **검증**:
  - [ ] `REPLAY_ORIGINS` grep 0건.
  - [ ] `pnpm typecheck` 통과.
  - [ ] Replay 토글·폴링 로직 diff가 import 교체뿐임(값·로직 불변).

### Task 2: resolveNavigationAction 순수 헬퍼 + 테스트 (`/tdd interface` 대상)
- **변경 대상**: `src/background/tab-bindings.ts`, `src/background/__tests__/tab-bindings.test.ts`
- **작업 내용**: design.md 판정 표대로 `resolveNavigationAction` 구현(export). 테스트 먼저 작성:
  - **현행 고정(broadGranted=false)**: 보존+same-origin → `keep` / 보존+cross-origin → `notifyDeferredExpiry` / 비보존+same-origin → pageKeyChanged ? `clearSession` : `keep` / 비보존+cross-origin → `deactivate`
  - **광역 예외(broadGranted=true)**: cross-origin+지원 URL이 same-origin처럼 — 보존 → `keep`, 비보존 → `clearSession` / cross-origin+미지원·판별불가 URL(`newUrlSupported=false`) → 현행 분기(`notifyDeferredExpiry`/`deactivate`)
  - same-origin일 때 broadGranted는 결과에 영향 없음(불변 케이스 1–2개).
- **검증**:
  - [ ] `pnpm test` — 신규 표 테스트 그린, 기존 `shouldPreserveSession`(16케이스)·`resolveTabSwitch`(4케이스) 불변 그린.

### Task 3: deactivatePanelIfCrossOrigin에 판정 통합
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**:
  - 기존 구조(activated 체크 → snap 로드 → refUrl resolve → origin 비교) 유지, 분기 본문을 `resolveNavigationAction` 결과 실행으로 교체: `keep` → no-op / `clearSession` → 세션 remove(현행 136–138) / `notifyDeferredExpiry` → deferred 발신(현행 144–146 **그대로**) / `deactivate` → 닫기+세션 remove(현행 150–152).
  - `chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })`는 cross-origin 판정일 때만 조회.
  - 함수 주석(107–109)·loading 분기 주석(223–224)에 광역 권한 예외 한 줄 반영.
- **검증**:
  - [ ] `pnpm typecheck`·`pnpm test` 통과.
  - [ ] deferred 발신 코드·`activeTabExpiredDeferred` 타입·`usePickerMessages` 핸들러·`App.tsx` 다이얼로그 diff 0.
  - [ ] `ACTIVATION_URL_PREFIX`·loading 분기·`apply`·`clearIfPageChanged` 구조 불변.

### Task 4: 문서 갱신 (별도 docs 커밋, `/push` 신선도 검사)
- **변경 대상**: `PERMISSION.md`, `ARCHITECTURE.md`, `docs/privacy.md`, `DIRECTORY.md`, `CLAUDE.md`
- **작업 내용**:
  - PERMISSION.md: "만료 시 동작" 절·상태 표(273)·라이프사이클 다이어그램에 광역 보유 예외 추가. §12(521–560)에 광역 권한의 선제 닫기 스킵·캡처 지속 용도 추가.
  - ARCHITECTURE.md: "사이드 패널 종료/유지 정책" 표(168–176)에 광역 보유 행 추가(기존 행은 미보유 기준 명시).
  - **privacy.md: 필수** — 선택적 호스트 권한 섹션(131–137)에 "30초 리플레이로 부여된 권한을 일반 캡처 지속(페이지 이동 후 캡처·패널 유지)에도 사용" + 시행일. manifest diff 0이어도 기존 권한의 새 목적(심사 탈락 전례 패턴).
  - DIRECTORY.md: `src/lib/broad-host-origins.ts` 항목. CLAUDE.md: 게이트웨이 optional_host_permissions 줄 갱신.
- **검증**:
  - [ ] privacy.md에 새 용도·시행일 명시.
  - [ ] ARCHITECTURE.md 표가 보유/미보유 두 경우를 모두 서술.

## 테스트 계획

- **단위 테스트**: `resolveNavigationAction` 표 테스트(Task 2 — 현행 고정 케이스 먼저, 광역 예외 케이스 추가). `shouldPreserveSession`·`resolveTabSwitch` 기존 테스트 불변 그린.
- **e2e 시나리오** (`/e2e-write` 입력):
  - **주의: e2e 빌드는 `host_permissions: <all_urls>`라 `permissions.contains`가 항상 true — 광역 보유 경로만 자동 검증 가능. 미보유 경로(닫힘·deferred 다이얼로그)는 수동 전용.**
  - cross-origin 재현: 픽스처 서버가 전 인터페이스 바인딩이므로 `localhost`↔`127.0.0.1` 호스트 스왑.
  - idle 상태에서 cross-origin 이동 → 패널이 닫히지 않고 유지된다. 다이얼로그 부재 판정 시 `alertdialog` role 단독 판정 금지(무관한 `SessionExpiredDialog` 오탐 — styling 상태로 짜지 말 것). 만료 다이얼로그 식별이 필요하면 `data-testid` 부착은 `/e2e-write`의 허용 범위(src 수정은 testid만)에서 처리.
  - drafting 중 cross-origin 이동 → 패널 유지 + draft 내용 잔존 + idle 복귀(취소) 후에도 다이얼로그가 뜨지 않는다.
  - 미지원 URL(`chrome://`) 이동 → 비보존 패널이 닫힌다 — panel Page의 `close` 이벤트 대기로 판정(`unsupported-url.spec.ts`의 네비게이션 패턴 참고).
  - same-origin 이동 → element 선택 초기화: 기존 `style-changes-dialog.spec.ts` Test 16(206–221)이 이미 커버(이번 변경과 무관·안 깨짐 — 검수 확인 완료). 중복이면 작성 생략.
- **수동 테스트** (광역 미보유 상태는 일반 dev 빌드 + Replay 미승인 프로필로):
  - 광역 미보유: idle cross-origin → 패널 닫힘 → 아이콘 재클릭 복구 (현행 동일, 회귀 없음).
  - 광역 미보유: drafting 중 cross-origin → 패널 유지 → 제출/취소로 idle 복귀 → 만료 다이얼로그 → 확인 시 패널 종료 → 재오픈 시 정상 (현행 deferred 경로 회귀 없음).
  - 광역 보유(Replay 1회 승인, 스위치 OFF 상태로도): idle/drafting cross-origin → 패널 유지 + 캡처 즉시 동작 + idle 복귀 다이얼로그 없음. 레코더 로그 정상 누적.
  - 광역 보유: cross-origin 후 영상 녹화 시작 → 만료 다이얼로그(현행) → 재오픈 후 녹화 동작.
  - Replay 토글 ON 흐름(권한 요청 프롬프트)·폴링 시작 정상(상수 추출 회귀 확인).
  - BFCache 뒤로가기로 cross-origin 복귀 시 동작 확인(`onUpdated` 발화 패턴 상이).

## 구현 순서 권장

- Task 1·2 병렬 가능(서로 독립). Task 2는 `/tdd interface`로 테스트 선작성.
- Task 3은 1·2 완료 후.
- Task 4는 1–3 완료 후 `/push` 단계에서 docs 커밋 분리.

## 가이드 영향

30초 리플레이 권한 설명 페이지(ko·en)에 "허용 시 페이지를 이동해도 패널·캡처가 끊기지 않는다" 혜택 서술 추가 여부를 `guide/AUTHORING.md` 기준으로 `/guide`에서 판단. "페이지를 이동하면 패널이 닫힌다"류 서술이 있으면 광역 보유 예외를 반영. privacy.md는 Task 4에서 처리(**영향 있음** — 기존 권한의 새 목적).
