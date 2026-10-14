# 인증 경계 복구 — 기술 설계

## 개요
기존 bugshot-settings envelope와 동기 store 액션 API를 유지한다. read-side는 동일 grant 확인과 grant별 refresh 공유, write-side는 모든 해당 키 writer가 참여하는 Web Lock과 의도한 변경분 병합으로 보호한다. 인증 모듈에 React/store 의존성을 추가하지 않는다.

## 변경 범위
- src/background/lib/rotatedAuth.ts: 신원·grant가 같은 stored auth만 회전 결과로 채택.
- Jira 및 github/gitlab/linear/asana refresh 소유 모듈: 플랫폼 단일 promise를 grant 구분 공유로 변경. Asana도 진행 중 결과 혼용 대상에 포함.
- src/types/jira.ts 및 Jira 연결 발급부: 새 연결을 구분할 optional grant 식별 필드. 연결 시 한 번 생성하고 refresh는 보존.
- src/lib/settings-storage.ts 및 필요시 순수 sibling helper: 공통 grant 비교, envelope transaction, 토큰 writer.
- src/store/settings-store.ts 및 전용 storage adapter: 액션 이전/이후의 의도한 변경분만 최신 durable state에 적용. src/store/chrome-storage.ts의 다른 store 동작은 유지.
- 필요시 src/sidepanel/lib/settings-sync.ts와 main.tsx: rehydrate가 미완 local intent를 덮거나 stale snapshot을 write하지 않도록 동기화.
- 관련 unit/integration 테스트. 메시지 union 변경은 우선 피한다. 필요하면 CONNECT 배치 통합 후 소유권을 재조정한다.

## 데이터 흐름과 계약
### 요청·토큰 회전
- 신원과 grant는 별개다. accountIdentityExcluded는 같은 계정의 prefill 보전에 계속 사용한다.
- 새 연결에는 회전 중 불변인 grant 식별자를 둔다. Jira는 현재 이 축이 없어 추가가 필요하다. 기존 grantedAt 필드가 충분하지 않은 동시/동일 시각 조건도 리뷰에서 확인한다.
- 저장 인증이 다른 grant면 rotated 반환을 하지 않으며 해당 인증으로 요청을 재시도하지 않는다. 진행 중 promise도 같은 기준으로 공유한다.
- 갱신 응답은 시작 grant와 결부하고, 저장 직전에 최신 durable grant와 비교한다. stale 결과는 새 연결을 덮지 않는다.
- 레거시 grant 필드 부재는 정상 기존 계정을 일괄 로그아웃시키지 않는 호환 경로가 필요하다. 동일 refresh token일 때 연속성을 확인하고 토큰이 다르면 신원만으로 새 grant를 추측하지 않는다. 레거시 전환 시점과 동시 요청 테스트를 필수로 한다.

### 설정 쓰기
- bugshot-settings를 쓰는 background writer·패널 persist·마이그레이션 경로가 동일 이름의 origin Web Lock 아래 최신 envelope를 읽고 병합하고 저장한다.
- 잠금만으로는 오래된 UI snapshot의 overwrite를 막지 못한다. 로컬 액션이 바꾼 필드만 적용하며, 변경 없는 다른 플랫폼과 토큰은 최신 저장값을 유지한다.
- 계정 교체/삭제는 명시적 intent이고 field patch와 구분한다. 계정의 기본값 patch는 시작 grant가 달라졌으면 새 계정에 적용하지 않는다.
- 하나의 패널에서 연속 액션은 순서를 유지한다. 실패한 write·rehydrate로 baseline을 앞당겨 미저장 intent를 잃지 않는다.
- rehydrate로 반영된 외부 변화는 새 local intent로 간주하지 않는다. storage onChanged 에코 루프를 방지한다.
- 기존 string/object envelope·알 수 없는 무관 필드·legacy Jira reader fallback을 보존한다.
- Web Lock이나 durable read 실패 시 무잠금 전체 overwrite로 폴백하지 않는다. 기존 저장 실패 알림 경로를 사용하고 패널 hydration을 영구 차단하지 않는다.

## 인터페이스 설계
구체 이름은 구현에서 기존 export 호환을 고려해 정하되 다음 책임을 분리한다.
```ts
// identity/grant comparison: pure, tokens are not the generation
sameOAuthGrant(platform, requested, stored): boolean
// one critical section shared by all writers of the settings envelope
withSettingsWriteLock<T>(run: () => Promise<T>): Promise<T>
// capture intentional action delta; merge against latest durable state
mergeSettingsMutation(latest, previous, next): PersistedSettings
```
토큰 writer의 시작 인증 조건을 전달할 필요가 있으면 인자를 추가하고 모든 호출부를 검증한다. 임의 JSON 전역 병합 라이브러리·새 의존성은 추가하지 않는다.

## 기존 패턴 준수
화이트리스트 토큰 업데이트, GitHub optional refreshToken/expiresAt 보존, prefill 신원 비교와 grant 비교 분리, store→UI 역의존 금지, 기존 i18n 문자열 재사용. issue 제출에서 이미 사용하는 Web Lock과 같은 origin 범위를 이용하되 별도 이름을 쓴다.

## 대안 검토
- background 로컬 큐만: 다른 패널 realm의 persist가 참여하지 않아 제외.
- 잠금 아래 전체 snapshot 저장: stale UI가 토큰을 되돌리므로 제외.
- 인증을 별도 저장 키로 전면 이관: 복수 reader·migration 변경이 커 현재 범위에서는 기존 envelope 보존을 우선.

## 위험 요소
동기 store와 비동기 저장 사이 실패/rehydrate, 계정 삭제 tombstone 성격, 레거시 grant 연속성, promise map에 토큰을 오래 보관하는 문제, lock 재진입 deadlock. 테스트와 독립 리뷰에서 이 축을 판정한다. 외부 API 호출 중 설정 write lock을 잡지 않는다.
