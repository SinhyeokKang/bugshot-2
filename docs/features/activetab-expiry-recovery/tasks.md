# activeTab 만료 복구 개선 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음. manifest 변경 없음.
- 작업 전 `pnpm test` 그린 확인(베이스라인).
- **실탭 확인(구현 전)**: 이미 열린 패널에서 툴바 아이콘 재클릭 시 토글(닫힘)이 아니라 grant 재부여인지 — 다이얼로그 문구("아이콘 재클릭")의 전제.
- `activeTabExpiredDeferred` 사용처는 `tab-bindings.ts`(발신 145)·`usePickerMessages.ts`(수신 162) 2곳, `REPLAY_ORIGINS` 사용처는 `use-30s-replay.ts`(정의 16)·`SettingsTab.tsx`(95·97) 확인(grep 완료).

## 태스크

### Task 1: BROAD_HOST_ORIGINS 공용 상수 추출
- **변경 대상**: `src/lib/broad-host-origins.ts`(신규), `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**:
  - `src/lib/broad-host-origins.ts` 생성: `export const BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"];`
  - `use-30s-replay.ts:16`의 `REPLAY_ORIGINS` 정의 제거, 내부 사용처(86 부근 contains)와 `SettingsTab.tsx`(95·97)의 참조를 `BROAD_HOST_ORIGINS` import로 교체.
- **검증**:
  - [ ] `REPLAY_ORIGINS` grep 0건.
  - [ ] `pnpm typecheck` 통과.
  - [ ] Replay 토글·폴링 로직 diff가 import 교체뿐임(값·로직 불변).

### Task 2: resolveNavigationAction 순수 헬퍼 + 테스트 (`/tdd interface` 대상)
- **변경 대상**: `src/background/tab-bindings.ts`, `src/background/__tests__/tab-bindings.test.ts`
- **작업 내용**:
  - design.md 판정 표대로 `resolveNavigationAction` 구현(export). 테스트 먼저 작성:
    - 보존 → 항상 `{closePanel:false, removeSession:false}` (sameOrigin·broadGranted 조합 무관)
    - 비보존+same-origin → `removeSession=pageKeyChanged`, `closePanel=false`
    - 비보존+cross-origin+광역보유+지원URL → `{false, true}`
    - 비보존+cross-origin+(광역미보유 또는 미지원URL) → `{true, true}` ← 현행 닫기 고정
- **검증**:
  - [ ] `pnpm test` — 신규 표 테스트 그린, 기존 `shouldPreserveSession`(16케이스)·`resolveTabSwitch`(4케이스) 불변 그린.

### Task 3: deferred 메시지 타입 제거
- **변경 대상**: `src/types/messages.ts`
- **작업 내용**:
  - `BgInternalMessage` union에서 `| { type: "activeTabExpiredDeferred"; tabId: number }`(211) 제거.
  - `onPickerPermissionExpired` 정의(295–300) 유지, 인접 주석을 "아이콘 재클릭 안내"로 갱신.
- **검증**:
  - [ ] `pnpm typecheck` — 참조하던 두 파일에서 타입 에러가 나야 정상(Task 4·5에서 해소).

### Task 4: 사이드패널 deferred 경로 제거
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**:
  - `deferredActiveTabExpiry` 플래그(23), subscribe 콜백의 idle 전환 fire 분기(47–50), `activeTabExpiredDeferred` 핸들러(162–165) 제거. 로그 flush 분기(53–57) 유지.
  - `onPickerPermissionExpired`·`BgInternalMessage` import 잔존 사용처 확인 후 미사용이면 제거.
- **검증**:
  - [ ] `deferredActiveTabExpiry` grep 0건.
  - [ ] `onPickerPermissionExpired.fire` grep — `picker-control.ts`(155,164)·`video-capture.ts`(43) 3곳만 잔존.
  - [ ] 다른 메시지 핸들러(`logClear`·`*.data` 등) 변경 없음.

### Task 5: 선제 닫기 재구성 (deferred 발신 제거 + 광역 권한 스킵)
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**:
  - `deactivatePanelIfCrossOrigin`(110–156)의 분기 본문을 `resolveNavigationAction` 호출로 교체: snap 로드·refUrl resolve·origin 비교(기존 구조 유지) → 비보존+cross-origin일 때만 `chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })` 조회 → 결과대로 closePanel/removeSession 실행. **deferred 발신(144–146) 삭제.**
  - 함수 주석(107–109)·onUpdated loading 주석(223–224)을 새 정책으로 갱신.
  - `BgInternalMessage` import(4) 미사용이면 제거.
- **검증**:
  - [ ] `activeTabExpiredDeferred` grep 0건(타입·발신·수신 전부).
  - [ ] `pnpm typecheck`·`pnpm test` 통과.
  - [ ] `ACTIVATION_URL_PREFIX`·loading 분기·`apply`·`clearIfPageChanged` 구조 불변.

### Task 6: 만료 다이얼로그 패널 유지형 전환
- **변경 대상**: `src/sidepanel/App.tsx`, `src/i18n/namespaces/app.ts`
- **작업 내용**:
  - 확인 액션(339)의 `window.close()` 제거 — `onOpenChange`만으로 충분하면 onClick 자체 제거.
  - `app.permissionExpired.body` 교체(ko 16–17 / en 73–74, design.md 문구안). PostToolUse 훅의 locales 검사 통과.
  - `AlertDialogContent`에 `data-testid="permission-expired-dialog"` 부착.
- **검증**:
  - [ ] `window.close` grep 0건(코드베이스 유일 사용처였음).
  - [ ] i18n locales 테스트(ko/en 대칭) 통과.
  - [ ] subscribe 경로(139–147)·다른 다이얼로그 불변.

### Task 7: 문서 갱신 (별도 docs 커밋, `/push` 신선도 검사)
- **변경 대상**: `PERMISSION.md`, `ARCHITECTURE.md`, `docs/privacy.md`, `DIRECTORY.md`, `CLAUDE.md`
- **작업 내용**:
  - PERMISSION.md: 지연 경로 절(149–154) 제거, 상태 표(273)·deferred 흐름(293)·라이프사이클 다이어그램 갱신, §12(521–560)에 광역 권한의 캡처 경로 공유 추가.
  - ARCHITECTURE.md: "사이드 패널 종료/유지 정책" 표(168–176)를 새 정책으로 갱신.
  - **privacy.md: 필수** — 선택적 호스트 권한 섹션(131–137)에 "30초 리플레이로 부여된 권한을 일반 캡처 지속에도 사용" + 시행일. manifest diff 0이어도 기존 권한의 새 목적 사용(심사 탈락 전례 패턴).
  - DIRECTORY.md: `src/lib/broad-host-origins.ts` 항목. CLAUDE.md: 게이트웨이 optional_host_permissions 줄 갱신.
- **검증**:
  - [ ] 문서에 `activeTabExpiredDeferred`·deferred 경로 서술이 남지 않음.
  - [ ] privacy.md에 새 용도·시행일 명시.

## 테스트 계획

- **단위 테스트**: `resolveNavigationAction` 표 테스트(Task 2, 전 조합). `shouldPreserveSession`·`resolveTabSwitch` 기존 테스트 불변 그린. i18n 문구 변경은 `locales.test.ts`가 커버.
- **e2e 시나리오** (`/e2e-write` 입력):
  - **주의: e2e 빌드는 `host_permissions: <all_urls>`라 `permissions.contains`가 항상 true — 광역 보유 경로만 자동 검증 가능. 미보유 닫기 경로는 수동 전용.**
  - cross-origin 재현: 픽스처 서버가 전 인터페이스 바인딩이므로 `localhost`↔`127.0.0.1` 호스트 스왑.
  - idle 상태에서 cross-origin 이동 → 패널이 닫히지 않고 유지되며, 만료 다이얼로그(`data-testid="permission-expired-dialog"`)가 뜨지 않는다. `alertdialog` role 단독 판정 금지(무관한 `SessionExpiredDialog` 오탐).
  - drafting 중 cross-origin 이동 → 패널 유지 + draft 내용 잔존.
  - 미지원 URL(`chrome://`) 이동 → 비보존 패널이 닫힌다 — panel Page의 `close` 이벤트 대기로 판정(`unsupported-url.spec.ts`의 네비게이션 패턴 참고).
  - same-origin 이동 → element 선택 초기화: 기존 `style-changes-dialog.spec.ts` Test 16(206–221)이 이미 커버(이번 변경과 무관·안 깨짐 — 검수 확인 완료). 중복이면 작성 생략.
- **수동 테스트** (광역 미보유 상태는 일반 dev 빌드 + Replay 미승인 프로필로):
  - [선행] 열린 패널에서 아이콘 재클릭 → 토글이 아니라 grant 재부여 확인.
  - 광역 미보유: idle cross-origin 이동 → 패널 닫힘(현행과 동일, 회귀 없음) → 아이콘 재클릭 복구.
  - 광역 미보유: drafting 중 cross-origin → 패널 유지, 제출 성공. idle 복귀 시 다이얼로그 안 뜸. 추가 캡처 시도 → 다이얼로그(패널 유지) → 아이콘 재클릭 → 캡처 재개.
  - 광역 보유(Replay 1회 승인): idle/drafting cross-origin → 패널 유지 + 캡처 즉시 동작, 다이얼로그 없음. 레코더 로그도 정상 누적.
  - 광역 보유: cross-origin 후 영상 녹화 시작 → 만료 다이얼로그(패널 유지) → 아이콘 재클릭 → 녹화 동작.
  - Replay 토글 ON 흐름(권한 요청 프롬프트)·폴링 시작 정상(상수 추출 회귀 확인).
  - BFCache 뒤로가기로 cross-origin 복귀 시 동작 확인(`onUpdated` 발화 패턴 상이).

## 구현 순서 권장

- Task 1·2 병렬 가능(서로 독립). Task 2는 `/tdd interface`로 테스트 선작성.
- Task 3 → 4·5 (타입 선제거로 typecheck가 잔존 참조를 잡음). Task 5는 1·2 완료 후.
- Task 6 독립 — 마지막에 i18n 훅 그린으로 마감.
- Task 7은 1–6 완료 후 `/push` 단계에서 docs 커밋 분리.

## 가이드 영향

`guide/` 중 "페이지를 이동하면 패널이 닫힌다"류 서술과 30초 리플레이 권한 설명 페이지를 대조(ko·en 동시). 만료 다이얼로그 문구가 가이드에 인용돼 있으면 새 문구로 갱신. 30초 리플레이 페이지에 "허용 시 페이지 이동 후에도 캡처가 끊기지 않는다" 혜택 추가 여부는 `guide/AUTHORING.md` 기준으로 `/guide`에서 판단. privacy.md는 Task 7에서 처리(**영향 있음** — 기존 권한의 새 목적).
