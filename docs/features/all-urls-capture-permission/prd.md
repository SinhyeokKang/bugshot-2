# 광역 캡처 권한을 `<all_urls>`로 전환

## 배경

30s Replay를 옵트인하면 광역 host 권한(`https://*/*`, `http://*/*`)을 런타임으로 부여받는다. 의도는 "광역 권한 보유 시 cross-origin 이동 후에도 캡처가 계속 동작"하는 것이고, `tab-bindings.ts`와 `PERMISSION.md` 분기표도 그 전제로 작성돼 있다.

그러나 Chrome `tabs.captureVisibleTab()`은 **일반 host 권한을 캡처 권한으로 인정하지 않는다**. 공식 규칙상 이 API는 `<all_urls>` 권한 또는 `activeTab` grant만 받는다. `https://*/*` + `http://*/*`는 `tab.url`을 읽는 데는 충분하지만 캡처 권한으로는 무효다.

결과적으로 다음 회귀가 발생한다:

- origin A에서 사이드패널을 열면 user gesture로 그 탭에 `activeTab` grant가 붙어 캡처가 된다.
- A → B로 cross-origin 이동하면 Chrome이 `activeTab` grant를 자동 폐기한다. 광역 권한은 남지만 캡처엔 무력하다.
- origin B에서 캡처 또는 pick element를 하면 picker 진입 가드(`classifyTabSupport`)는 `tab.url`이 광역 권한으로 읽혀 통과하지만, 실제 `captureVisibleTab` 호출이 실패해 "Permission expired" 알럿(`maybeSurfacePermissionExpired`)이 뜬다.
- 같은 이유로 30s Replay 폴링도 origin B에서 프레임을 못 쌓는다(조용히 catch 스킵).

## 목표

- 광역 캡처 권한을 `<all_urls>`로 전환해, 30s Replay 옵트인 사용자가 cross-origin(http/https) 이동 후에도 캡처·pick element·Replay 폴링을 정상 수행한다.
- 기존 `tab-bindings.ts` / `PERMISSION.md`가 전제한 "광역 권한 보유 시 cross-origin 만료 미발생"이 실제로 성립하게 만든다.
- 권한 선언 방식·요청 흐름은 현행(optional + replay 토글 시 런타임 요청)을 유지해 최소 변경으로 끝낸다.

## 비목표 (Non-goals)

- **file:// 로컬 페이지 캡처 지원 안 함**. `<all_urls>`는 file:을 포함하지만 Chrome은 file: 접근에 별도 "파일 URL 액세스 허용" 토글을 요구한다. file: 페이지는 현행대로 `activeTab` 의존을 유지한다(`isBroadCoveredUrl`이 file:을 제외하는 현행 로직 그대로).
- **static host_permissions 승격 안 함**. 모든 사용자에게 설치 시점부터 광역 권한을 강제하지 않는다. optional 유지.
- **기존 사용자 자동 업그레이드 로직 추가 안 함**. 구 권한(`https://*/*`) 보유자는 다음에 replay 토글을 켤 때 `<all_urls>`를 자연스럽게 재요청받는다.
- BYOK LLM·GitLab self-managed의 특정 origin 요청 흐름 변경 안 함(그대로 동작).

## 사용자 시나리오

### 신규 사용자 (replay 첫 옵트인)
1. 설정에서 30s Replay 토글 ON.
2. 브라우저 권한 다이얼로그가 `<all_urls>`(= "모든 웹사이트의 데이터 읽기") 1회 요청.
3. 허가 → replay 활성화.
4. origin A에서 사이드패널을 열고 작업 중 B로 이동.
5. B에서 캡처/pick element → **정상 동작**(이전엔 Permission expired).

### 기존 사용자 (구 `https://*/*` 권한 보유)
1. 확장 업데이트 후 replay가 켜진 상태로 사이드패널을 연다.
2. `use-30s-replay`가 `contains({ origins: ["<all_urls>"] })`를 false로 감지 → replay 자동 비활성화 + `issue.replay.permissionRevoked` 토스트.
3. 사용자가 토글을 다시 ON → `<all_urls>` 권한 다이얼로그 1회 → 허가 → 정상.

### file: 페이지 (비목표 경계 확인)
1. file:// 페이지에서 사이드패널을 열고 캡처 → user gesture activeTab으로 동작.
2. 다른 origin으로 이동 후 file: 캡처 시도 → 현행대로 만료 처리(변경 없음).

## 성공 기준

- `<all_urls>` 권한을 grant한 상태에서 origin A→B(둘 다 https) 이동 후 캡처·pick element·inline 캡처가 모두 성공한다.
- 같은 상태에서 30s Replay가 origin B에서도 프레임을 계속 쌓는다.
- 구 `https://*/*` 권한만 가진 사용자는 replay가 자동 비활성화되고 토글 재ON 시 `<all_urls>`를 재요청받는다.
- file: 페이지는 cross-origin 이동 후 캡처가 현행대로 만료된다(회귀 없음).
- `pnpm test` 통과, `pnpm typecheck` 통과.
