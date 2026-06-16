# 광역 캡처 권한을 `<all_urls>`로 전환 — 구현 태스크

## 선행 조건

- **Task 0를 먼저 통과**해야 Task 1·2에 착수한다(아래 P0 차단 게이트).
- 변경 후 dev 로드 언팩으로 테스트(`pnpm build`, `key` 유지 빌드).

## 태스크

### Task 0 (P0 차단 게이트): `<all_urls>` 권한 API 실동작 실증
- **목적**: `chrome.permissions.request({ origins: ["<all_urls>"] })`가 실제로 동작하는지가 설계의 생사다. `<all_urls>`는 match pattern 명세상 유효 토큰이지만 공식 문서가 `request`/`optional_host_permissions` 예시로 든 적이 없어 문헌상 확정 불가. **빨강이면 Task 1·2 착수 금지.**
- **방법**: 빈 테스트 확장 또는 현 dev 빌드에 임시 패치로 `optional_host_permissions: ["<all_urls>"]`를 선언하고, 하나의 실험에서 아래를 순서대로 확인.
- **검증**:
  - [x] `chrome.permissions.request({ origins: ["<all_urls>"] })`가 권한 **다이얼로그를 띄운다** (사용자 실증).
  - [x] grant 후 `chrome.permissions.contains({ origins: ["<all_urls>"] })`가 **true**.
  - [x] cross-origin(origin A→B, 둘 다 https) 이동 후 `captureVisibleTab`이 **성공**한다 (사용자 실증 green).
  - [ ] 권한 다이얼로그·스토어 권한 화면의 **경고 문구를 캡처**(file:/ftp: 포함으로 문구가 넓어지는지, 재심사·재허가 트리거 여부 판단 근거).
- **폴백 (위 첫 항목이 빨강일 때)**: `optional_host_permissions`·`BROAD_HOST_ORIGINS`를 `["http://*/*", "https://*/*", "file:///*"]` 합집합 패턴으로 전환하고, **같은 실험에서 그 합집합이 cross-origin `captureVisibleTab` 캡처 권한을 실제로 주는지 동시 측정**한다(합집합이 캡처에 무효일 수 있음 — design.md 대안3·위험 참조). 폴백 채택 시 Task 1·2의 대상 값을 합집합으로 교체.

### Task 1: 광역 권한 상수를 `<all_urls>`로 변경 (Task 0 green 전제)
- **변경 대상**: `src/lib/broad-host-origins.ts`
- **작업 내용**: `BROAD_HOST_ORIGINS = ["https://*/*", "http://*/*"]` → `["<all_urls>"]`.
- **검증**:
  - [x] `BROAD_HOST_ORIGINS`가 `["<all_urls>"]`다.
  - [x] 이 상수를 참조하는 SettingsTab·use-30s-replay·tab-bindings에 컴파일 에러 없음 (`pnpm typecheck`).

### Task 2: manifest optional_host_permissions 변경
- **변경 대상**: `manifest.config.ts:88`
- **작업 내용**: `optional_host_permissions: ["https://*/*", "http://*/*"]` → `["<all_urls>"]`. `host_permissions`·`permissions`는 변경 없음.
- **검증**:
  - [x] 빌드 산출 manifest의 `optional_host_permissions`가 `["<all_urls>"]` (빌드 확인).
  - [x] `host_permissions`(특정 플랫폼 목록) 변동 없음 (11개 유지).

### Task 3: 가드 단위 테스트 신규 작성
- **변경 대상**: `src/lib/__tests__/broad-host-origins.test.ts` **(신규 — 현재 존재하지 않음)**.
- **작업 내용**: `BROAD_HOST_ORIGINS`가 `["<all_urls>"]`(폴백 채택 시 합집합 패턴)임을 고정하는 가드 테스트. `resolveNavigationAction`/`isBroadCoveredUrl`은 로직 변경이 없고 `BROAD_HOST_ORIGINS` 리터럴 값에 의존하는 테스트가 repo에 0개라 "기존 테스트가 깨질" 리스크는 없다. `isBroadCoveredUrl`은 http/https=true, file:=false가 유지되는지 케이스로 확인.
- **검증**:
  - [x] `broad-host-origins.test.ts` 신규 작성, `pnpm test` 통과.
  - [x] `isBroadCoveredUrl(file:...)`가 여전히 false (tab-bindings.test.ts 신규 케이스).

### Task 4: 권한 문서 + 소스 주석 갱신
- **변경 대상**: `PERMISSION.md`, `docs/privacy.md`, `src/background/tab-bindings.ts` (주석만)
- **작업 내용**:
  - `PERMISSION.md`: optional_host_permissions 표기, `BROAD_HOST_ORIGINS` 값(§12), 분기표 주석. "광역 권한 보유 시 cross-origin 만료 미발생" 서술이 이제 사실과 일치함을 반영(captureVisibleTab이 `<all_urls>`로 실제 동작).
  - `docs/privacy.md`: 광역 권한 맥락의 `https://*/*`, `http://*/*` → `<all_urls>`. GitLab self-managed·30s Replay·BYOK 설명의 권한 문자열 일치. 시행일 갱신.
  - `src/background/tab-bindings.ts:135` **주석 갱신**: `isBroadCoveredUrl`의 stale 주석(`광역 host 권한(https://*/* + http://*/*)이…`)을 `<all_urls>`로 고치고, *"`<all_urls>`는 file:을 포함하지만 캡처에 별도 토글을 요구하므로 의도적으로 배제"*를 명시(다음 작업자의 버그 오인 방지). 로직은 변경하지 않음.
  - (참고) 위 line 번호는 작업 시점에 밀릴 수 있으므로 참고용. 검증은 grep으로 한다.
- **검증**:
  - [x] 세 파일에 구 권한 문자열(`https://*/*`, `http://*/*`)이 광역 권한 맥락에서 남아있지 않음(특정 플랫폼 host_permissions 표기는 별개).
  - [x] privacy.md 시행일 갱신됨 (2026-06-16).
  - [x] `tab-bindings.ts` 주석에 file: 의도적 배제가 명시됨.

### Task 5: 마이그레이션 토스트 문구 개선
- **변경 대상**: `src/i18n/namespaces/issue.ts`(`issue.replay.permissionRevoked` ko/en), `src/sidepanel/30s-replay/use-30s-replay.ts`(토스트 호출부)
- **작업 내용**: 구 권한 보유자가 업데이트 후 replay가 꺼질 때 보는 토스트가 "캡처 권한이 해제되어…"라 상황(사용자는 해제한 적 없음)과 안 맞고 복구 길을 안 알려준다. 문구를 마이그레이션·복구 안내형으로 교체하되 **일반 권한 철회 맥락에서도 자연스러운 표현**으로(이 키는 두 경우 공용). sonner `toast.error(..., { action: { label, onClick } })`로 설정 탭(30s Replay 토글)로 보내는 action 버튼 추가 검토.
  - 예시 ko: "보안 업데이트로 30초 리플레이 권한을 다시 받아야 합니다. 설정에서 켜 주세요." / en: "A security update reset the 30s replay permission. Re-enable it in Settings."
- **검증**:
  - [x] ko/en 문구 + "설정 열기" action으로 복구 경로 전달.
  - [x] i18n locales.test.ts 통과(ko/en 대칭).
  - [x] "설정 열기" action → navTo("settings","issue") (replay 토글 위치).

## 테스트 계획

- **단위 테스트**: `BROAD_HOST_ORIGINS === ["<all_urls>"]` 가드. `isBroadCoveredUrl` — http/https=true, file:=false 유지 케이스(기존 테스트 재확인).
- **e2e 시나리오**: 권한 다이얼로그(`chrome.permissions.request`)는 Playwright로 제어 불가하고 cross-origin 캡처는 실 권한 grant가 필요 → **자동화 비대상**. (e2e 영향: 없음)
- **수동 테스트** (captureVisibleTab 의존 — Chrome에서 확인):
  - [ ] replay 토글 ON → 권한 다이얼로그에 `<all_urls>`("모든 웹사이트") 표시 → 허가 → replay 활성화.
  - [ ] **권한 다이얼로그·스토어 권한 화면 경고 문구 캡처** — `https://*/*` 대비 file:/ftp: 포함으로 문구가 넓어지는지, 재심사·재허가 트리거 여부 확정(Task 0와 공유 가능).
  - [ ] origin A(https)에서 사이드패널 오픈 → B(다른 https origin)로 이동 → **캡처 성공**(Permission expired 안 뜸).
  - [ ] 같은 흐름에서 pick element → 영역 캡처·inline 캡처 성공.
  - [ ] origin B에서 30s Replay 버퍼가 계속 쌓임(bufferedSeconds 증가).
  - [ ] 구 권한(`https://*/*`)만 가진 프로필에서 업데이트 → replay 자동 비활성화 + **개선된 마이그레이션 토스트(복구 안내) 노출** → 토글 재ON 시 `<all_urls>` 재요청.
  - [ ] **구+신 권한 혼재**: 구 권한(`https://*/*`+`http://*/*`) 보유 프로필 → 토글 재ON으로 `<all_urls>` 추가 grant → `contains(["<all_urls>"])`=true + 캡처 정상 + Chrome 권한 화면에 잔존 구 권한이 이상 표시 없는지 확인.
  - [ ] **replay OFF + 광역 권한 잔존**: replay 한 번 켜 권한 grant 후 토글 OFF → cross-origin 이동 시 패널이 유지되는지(navigation 분기 `broadGranted`=true) 동작 확인(의도 확인 — revoke 안 함).
  - [ ] file:// 페이지에서 cross-origin 이동 후 캡처 → 현행대로 만료 처리(회귀 없음).
  - [ ] BYOK LLM 프로바이더 연결(특정 origin 요청) 정상 동작.

## 구현 순서 권장

0. **Task 0 (P0 게이트) 먼저** — green이어야 이후 착수. red면 폴백(합집합 패턴)으로 Task 1·2 대상 값 교체.
1. Task 1 → Task 2 (상수·manifest 동시 변경, 둘이 짝).
2. Task 3 (가드 테스트 신규, `pnpm test` 통과 확인).
3. Task 4 (문서 + 소스 주석 — `/push` 신선도 게이트 충족), Task 5 (마이그레이션 토스트 문구).
4. 수동 테스트는 Task 1·2 적용 후 dev 로드 언팩으로 실행.

Task 1·2는 병렬 불가(한 PR에 함께). Task 3·4·5는 Task 1·2 이후 병렬 가능. **Task 0가 모든 코드 변경의 선행 차단 게이트.**

## 가이드 영향

`guide/`에 30s Replay 권한 요청을 설명하며 `https://*/*` 등 권한 문자열을 노출하는 페이지가 있으면 ko·en 대조·갱신(`/guide`). 권한 문자열을 언급하지 않고 "권한 허용" 수준으로만 안내한다면 **없음**. `/guide` 단계에서 `guide/AUTHORING.md` 기준으로 30s Replay 관련 페이지(예: `capture/replay.md` 류)에 광역 권한 문자열 노출 여부를 확인 후 결정한다.

추가로, 기존 사용자가 업데이트 후 replay 재허용이 필요해진다(마이그레이션). 가이드에 "권한 재허용이 필요할 수 있음" 안내가 적절한 페이지가 있으면 ko·en 보강 검토.
