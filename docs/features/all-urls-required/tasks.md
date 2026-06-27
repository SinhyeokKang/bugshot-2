# `<all_urls>` required 승격 — 구현 태스크

## 선행 조건

- 이 변경은 배포 시 기존 사용자 재동의를 유발한다(Chrome 자동 비활성화). `/deploy` 전에 스토어 설명·배포 노트에 broad 권한 사유를 준비할 것.
- cross-origin-styles feature보다 **먼저** 구현·머지 권장(그 feature의 권한 게이트가 불필요해짐).
- env·OAuth 변경 없음. 새 외부 엔드포인트 없음.

## 태스크

### Task 1: manifest 권한 승격
- **변경 대상**: `manifest.config.ts`
- **작업 내용**: `optional_host_permissions: ["<all_urls>"]`(라인 88) 키 삭제. `host_permissions`에 `"<all_urls>"` 상시 추가, `...(isE2eBuild ? ["<all_urls>"] : [])`(라인 102) 제거. 명시 도메인·proxyMatch는 유지.
- **검증**:
  - [ ] `pnpm build` 후 `dist/manifest.json`의 `host_permissions`에 `<all_urls>` 포함, `optional_host_permissions` 키 없음
  - [ ] `pnpm build:e2e` 후 `dist-e2e/manifest.json` 동일(조건 분기 제거로 동작 불변)
  - [ ] `pnpm typecheck` 통과

### Task 2: Replay 토글 권한 로직 제거
- **변경 대상**: `src/sidepanel/components/RecordingSettingsCard.tsx`
- **작업 내용**: `handleReplayToggle`에서 `permissions.contains/request`·toast·`BROAD_HOST_ORIGINS` import 제거 → `setReplayEnabled(next)`만. Switch `onCheckedChange`는 그대로(이제 동기 호출). 사용 안 하게 된 import(`toast`, `BROAD_HOST_ORIGINS`, 권한용 `useT` 분기) 정리. **`settings.replay.permissionDenied` i18n 키를 ko/en 양쪽에서 동시 삭제**(이 키는 Replay 권한 거부 toast 전용 — 사용처가 이 토글뿐). 주의: BYOK/GitLab 거부 toast 키(`llm.error.permission`·`gitlab.selfManaged.permissionDenied`)는 ai-provider 코드를 남기므로 **삭제하지 않는다**.
- **검증**:
  - [ ] Replay 토글 ON 시 `chrome.permissions.request` 호출 없음(코드상 확인 + e2e 네트워크/권한 프롬프트 0)
  - [ ] 토글 OFF/ON이 `replayEnabled` 상태만 토글
  - [ ] `grep -rn "settings.replay.permissionDenied" src` 결과 0 + ko/en 동시 삭제 + `locales.test`(PostToolUse 훅) 통과
  - [ ] `pnpm typecheck`·`pnpm test` 통과

### Task 3: Replay 폴링 권한 게이트 제거
- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: 폴링 시작 async IIFE(라인 85–96)의 `permissions.contains` 게이트·`setReplayEnabled(false)` 제거. `replayEnabled && tabId != null`이면 바로 `setInterval(tick, CAPTURE_INTERVAL_MS)` + displayId 타이머 시작. `BROAD_HOST_ORIGINS` import 제거. **tick의 다른 가드(`cancelled`/`phase!=="idle"`/`tabId==null`/`!tab.active`)는 별개 위치라 건드리지 않음** — 권한 게이트만 외과적 제거.
- **검증**:
  - [ ] Replay ON 상태에서 권한 확인 없이 폴링·버퍼 적재 시작(기존 `replay-action-log.spec.ts` green)
  - [ ] 토글 OFF 시 interval 해제(cancelled 가드 유지)
  - [ ] **`use-30s-replay`는 전용 단위 테스트가 없음 — OFF 시 interval 해제·가드 보존은 code-review로 확인**(자동 커버리지 없음, 솔직 표기). 필요 시 hook 가드용 최소 단위 테스트를 `/tdd`로 별도 추가 검토.

### Task 4: tab-bindings cross-origin 분기 단순화
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**: `deactivatePanelIfCrossOrigin`(라인 177–186)의 `permissions.contains` 호출 제거, `broadGranted = true` 고정. `resolveNavigationAction`은 시그니처·로직 불변(true 전달). `isBroadCoveredUrl`의 file: 배제 유지. tab-bindings에서 `BROAD_HOST_ORIGINS` 사용이 사라지면 import 제거. **stale 주석 갱신**: 계약 주석(114–116)·`deactivatePanelIfCrossOrigin` 미부여 주석(151)·`tab-bindings.test.ts` legacyCases(broadGranted=false)에 "required 승격 후 프로덕션 미도달, 순수함수 안전망으로 보존" 취지 1줄 추가.
- **검증**:
  - [ ] `tab-bindings.test.ts`(`resolveNavigationAction` 단위, legacyCases 포함) 그대로 green
  - [ ] **기존 `e2e/activetab-broad-permission.spec.ts` test1**(127.0.0.1→localhost cover-URL 이동 → `isActivated=true`)이 cross-origin keep 회귀 가드 — green 재확인(새 spec 작성 불필요)
  - [ ] file: 네비게이션은 기존대로 만료 처리(수동)

### Task 5: BROAD_HOST_ORIGINS 고아 정리
- **변경 대상**: `src/lib/broad-host-origins.ts`, `src/lib/__tests__/broad-host-origins.test.ts`
- **작업 내용**: Task 2·3·4로 사용처가 모두 사라졌으면 상수 파일·테스트 삭제. 잔존 import가 있으면 남긴다(전수 grep 확인 후 결정). `broad-host-origins.test.ts`는 다른 테스트가 import하지 않음(사용처는 test 자신·use-30s-replay·tab-bindings뿐 — 확인됨)이라 삭제 안전.
- **검증**:
  - [ ] `grep -rn "BROAD_HOST_ORIGINS" src e2e` 결과 0(삭제 시) 또는 잔존 사용처 명확 — **e2e 포함**(activetab spec 주석 잔재까지 정리 대상)
  - [ ] `pnpm typecheck`·`pnpm test` 통과
  - ⚠️ 인지: 상수 삭제 시 "captureVisibleTab이 `<all_urls>`만 받는다"는 불변식을 잠그던 유일한 단위 자산이 사라짐 — manifest `<all_urls>` 포함은 Task 1의 빌드 산출물 검사로만 보장됨(빌드타임 단언 공백 수용).

### Task 6: 문서 갱신
- **변경 대상**: `docs/privacy.md`, `PERMISSION.md`, `README.md`, `CLAUDE.md`, `e2e/README.md`
- **작업 내용**: `<all_urls>` optional→required 반영. privacy.md에 "모든 사이트 데이터 접근이 기본"·시행일. PERMISSION.md의 optional/런타임 요청 서술을 required로. README 권한·설치 안내. CLAUDE.md는 ① 게이트웨이 섹션 optional_host_permissions 문구 + ② **`BUGSHOT_E2E_BUILD` 설명**("`<all_urls>`는 테스트 전용") 둘 다 수정 — isE2eBuild 분기 제거로 e2e/prod host_permissions가 동일해지므로 "권한 차이 없음(분리 이유는 outDir 격리·dev key)"으로. `e2e/README.md`(89·109행)의 `BROAD_HOST_ORIGINS`·`permissions.contains`·중복 선언 서술 갱신.
- **검증**:
  - [ ] 5개 문서에서 `<all_urls>`를 optional/런타임 요청으로 서술한 잔재 없음
  - [ ] CLAUDE.md의 BUGSHOT_E2E_BUILD 설명이 prod 포함 사실과 정합
  - [ ] `/push` 신선도 검사 통과

### Task 7: e2e 권한 전제 spec 재확인
- **변경 대상**: `e2e/activetab-broad-permission.spec.ts`
- **작업 내용**: **주의 — 실측상 이 spec의 3개 테스트는 이미 broad-held(`<all_urls>` 보유) 경로만 단언한다**(dist-e2e가 항상 `<all_urls>`라 미보유 경로는 e2e에 부재). 따라서 "단언 제거"가 아니라 ① **기존 단언이 그대로 green인지 재확인**, ② spec 헤더 주석(6–8행)이 `permissions.contains(BROAD_HOST_ORIGINS)` 전제를 설명하므로 그 주석을 required 모델로 갱신, ③ (선택) cross-origin http/https keep 단언이 약하면 보강. **멀쩡한 테스트를 잘못 손대지 말 것.** 미보유 분기는 `tab-bindings.test.ts` legacyCases(순수함수)에만 존재하며 Task 4에서 주석만 갱신.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` 전체 green (단언 변경 없이도 green이어야 정상)
  - [ ] spec 헤더 주석이 더 이상 `permissions.contains` 런타임 분기를 전제하지 않음

## 테스트 계획

- **단위 테스트**:
  - `resolveNavigationAction`: 기존 케이스 유지 + `broadGranted=true` 고정 호출 경로가 same-origin/cross-origin http/https에서 "keep/clearSession" 산출하는지 재확인(tab-bindings.test.ts).
  - 별도 신규 순수 함수 없음(이 feature는 주로 분기 제거).
- **e2e 시나리오** (`/e2e-write` 입력):
  - Replay 토글을 켜면 (권한 프롬프트 없이) 버퍼 적재가 시작된다 — `bufferedSeconds` 증가/캡처 버튼 활성으로 판정.
  - cross-origin(127.0.0.1 → localhost) 네비게이션 후에도 패널이 유지된다 — 기존 `activetab-broad-permission.spec.ts` test1로 이미 커버(재확인).
  - **BYOK는 "프롬프트 부재"를 직접 단언할 수 없음**(Playwright가 브라우저 네이티브 권한 프롬프트 부재를 관측 불가, 게다가 `<all_urls>` 보유 시 프롬프트 자체가 안 뜸). → connect 후 **connected-state testid 노출**로 재작성하거나, testid 부재 시 **수동 테스트로 강등**. `LlmConnectDialog`에 연결 성공 testid 실재 여부 먼저 확인.
  - 기존 replay·capture·session spec 회귀 없음.
- **수동 테스트** (Chrome, 자동화 불가):
  - 빌드한 dist를 unpacked 로드 시 설치 권한에 "모든 사이트" 표기 확인.
  - 기존 프로필에 업데이트 적용 시 Chrome이 재동의를 요구하는지(스토어 배포 전 시뮬레이션 한계 — 인지 차원).
  - file: 페이지에서 "파일 URL 액세스" 토글 OFF면 캡처 불가가 현행과 동일한지.

## 구현 순서 권장

- Task 1(manifest) 먼저 — 이후 작업의 전제(권한 보유).
- Task 2·3·4 병렬 가능(서로 독립: UI 토글 / 폴링 훅 / background 분기).
- Task 5는 2·3·4 완료 후(고아 확정).
- Task 6 문서·Task 7 e2e는 코드 green 후. 권장: 1 → (2·3·4) → 5 → 7 → 6.

## 가이드 영향

- `guide/ko`·`guide/en`: 30s Replay·BYOK·GitLab self-managed 안내에 "권한 허용" 단계가 서술돼 있으면 제거(이제 자동 보유). 설치 시 권한 안내 페이지가 있으면 "모든 사이트" 반영. `guide/AUTHORING.md` 확인 후 `/guide`로 처리.
- privacy.md·PERMISSION.md·README·CLAUDE는 가이드가 아니라 Task 6에서 직접 갱신.
