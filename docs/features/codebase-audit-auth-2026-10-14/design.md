# 인증 경계 복구 — 기술 설계

## 개요
기존 bugshot-settings envelope와 동기 store 액션 API를 유지한다. read-side는 동일 grant 확인과 grant별 refresh 공유, write-side는 모든 해당 키 writer가 참여하는 Web Lock과 의도한 변경분 병합으로 보호한다. 인증 모듈에 React/store 의존성을 추가하지 않는다.

## 변경 범위
- src/background/lib/rotatedAuth.ts: 신원·grant가 같은 stored auth만 회전 결과로 채택.
- Jira 및 github/gitlab/linear/asana refresh 소유 모듈: 플랫폼 단일 promise를 grant 구분 공유로 변경. Asana도 진행 중 결과 혼용 대상에 포함.
- src/types/jira.ts 및 Jira 연결 발급부: 새 연결을 구분할 optional grant 식별 필드. 연결 시 한 번 생성하고 refresh는 보존.
- src/lib/settings-storage.ts 및 필요시 순수 sibling helper: 공통 grant 비교, envelope transaction, 토큰 writer.
- src/store/settings-store.ts 및 전용 storage adapter: 액션 이전/이후의 의도한 변경분만 최신 durable state에 적용. src/store/chrome-storage.ts의 다른 store 동작은 유지.
- src/sidepanel/lib/settings-sync.ts와 main.tsx: rehydrate가 미완 local intent를 덮거나 stale snapshot을 write하지 않도록 동기화.
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
토큰 writer는 시작 인증과 갱신 인증을 별도 인자로 받고 모든 호출부를 검증한다. 임의 JSON 전역 병합 라이브러리·새 의존성은 추가하지 않는다.

## 기존 패턴 준수
화이트리스트 토큰 업데이트, GitHub optional refreshToken/expiresAt 보존, prefill 신원 비교와 grant 비교 분리, store→UI 역의존 금지, 기존 i18n 문자열 재사용. issue 제출에서 이미 사용하는 Web Lock과 같은 origin 범위를 이용하되 별도 이름을 쓴다.

## 대안 검토
- background 로컬 큐만: 다른 패널 realm의 persist가 참여하지 않아 제외.
- 잠금 아래 전체 snapshot 저장: stale UI가 토큰을 되돌리므로 제외.
- 인증을 별도 저장 키로 전면 이관: 복수 reader·migration 변경이 커 현재 범위에서는 기존 envelope 보존을 우선.

## 위험 요소
동기 store와 비동기 저장 사이 실패/rehydrate, 계정 삭제 tombstone 성격, 레거시 grant 연속성, promise map에 토큰을 오래 보관하는 문제, lock 재진입 deadlock. 테스트와 독립 리뷰에서 이 축을 판정한다. 외부 API 호출 중 설정 write lock을 잡지 않는다.

## CTO·QA 검수 반영 계약 (2026-10-14)

아래 계약은 위 개요의 선택 사항을 확정한다. 제품 결정 추가 없이 기존 신원·정상 회전·저장 보전 목표를 적용한다.

### Grant 발급·승격과 오류

- 회전 가능한 Jira/GitHub/GitLab/Linear/Asana의 신규 OAuth 연결은 충돌 없는 `grantId`를 한 번 발급한다. `grantedAt`은 시간 메타로 유지한다. refresh는 ID를 보존하고 account identity 비교에서는 ID를 제외한다.
- legacy 인증은 첫 네트워크/refresh 이전 auth 획득 경계에서 동일 설정 잠금 아래 현재 durable 신원·원 토큰과 일치하는지 확인하고 canonical ID를 붙인다. 해당 요청 체인은 canonical 인증을 전달한다. reader와 직접 인증을 받는 API/refresh 진입점 모두 이 경계를 보장한다.
- ID 없는 이미 확보된 객체가 동시에 진입하면 아직 회전 전인 동일 원 토큰과의 검증으로 같은 canonical ID를 얻는다. 회전 후 늦은 진입의 연속성은 처음 획득한 canonical 인증 전달로 유지하며, 증명할 수 없는 legacy 객체를 신원만으로 새 grant에 결합하지 않는다. 이미 진행 중인 미승격 요청은 새 grant를 사용하지 않고 안전하게 중단한다. 승격 시점을 놓쳐 정상 요청을 일괄 로그아웃시키는 구현은 허용하지 않는다.
- refresh 공유 키는 플랫폼·신원·grant다. 완료/실패 후 자기 promise만 정리한다. Asana 비회전 RT에서도 access token 갱신을 재사용한다. GitHub refresh token 부재의 기존 동작을 유지한다.
- writer 입력은 expected/start auth와 refreshed auth 둘이다. 최신 durable grant와 비교해 저장하고 다른 grant/삭제를 덮지 않는다. 네트워크는 잠금 밖, 잠금 내부는 unlocked leaf 연산만 사용한다.
- 확인된 계정 교체/해제는 구 요청을 중단하되 현재 계정의 만료 이벤트로 내리지 않는다. durable read/lock/write 실패도 OAuth 자격 증명 만료와 구별하며 무잠금 overwrite·다른 grant 재시도를 하지 않는다. 실제 현재 grant의 refresh 거부는 기존 만료 이벤트를 유지한다. serialize→bg-client 경계까지 단언한다.

인증 사용 문맥은 저장 계정 요청과 저장 전 연결 후보를 명시적으로 구분한다. durable grant 일치·legacy 승격·교체/해제 중단 규칙은 저장 계정 요청에 적용한다. 신규 OAuth 연결의 프로필 조회는 연결 진입점이 전달한 후보 문맥에서 해당 후보 인증만 사용하며, 저장된 다른 grant나 그 refresh promise를 재사용하지 않는다. 후보의 refresh 결과는 후보 요청 체인과 최종 connect/replace 입력에 전달하고, 연결 확정 전 기존 durable 계정에는 쓰지 않는다. 후보 문맥은 grantId 부재·durable 불일치·계정 미존재로 추론하지 않으며, 명시적인 연결 호출 경계에서만 부여한다.

### 명시적 mutation과 계정 종속 데이터

previous/next JSON diff만으로 의도를 추측하지 않는다. connect/replace, disconnect(platform), disconnect-all, accountPatch, submissionPrefillPatch, 일반 설정 patch를 구분한다. 기존 동기 액션 API는 가능한 유지하되 계정 종속 비동기 작업은 출발 grant를 전달한다.

- connect/replace는 잠금 안 latest durable identity로 같은 계정 여부를 판단해 prefill을 보전/삭제한다. 토큰 교체와 prefill 정리는 원자적이다. 같은 계정 새 grant는 기존 prefill 보전 정책을 유지한다.
- disconnect는 최신 저장된 해당 플랫폼을 제거하고 prefill도 지운다. disconnect-all은 stale 로컬 snapshot에 없던 계정까지 transaction 시점에 지운다.
- accountPatch/prefillPatch는 출발 grant가 최신 grant와 같을 때만 적용한다. 이전 제출이 재연결 후 완료돼도 새 계정의 목적지를 덮지 않는다. IssueCreateModal과 DraftDetailDialog의 비동기 제출 시작/완료 배선을 포함한다.
- 명시적 undefined 삭제와 생략을 직렬화 전에 구별한다. defaults는 기존 얕은 교체 계약을 유지한다. 일반 필드 동시 수정은 commit 순서의 마지막 명시적 의도가 이기며 무관 필드는 보전한다.

### Persist·동기화 상태 전이

- durable baseline과 ordered pending intents를 별도로 둔다. 액션은 intent를 순서대로 큐에 넣고 메모리에 즉시 적용한다. transaction은 latest read→현재 migration→의도 적용→write 후 성공한 intent만 ack한다.
- write/read/lock 실패는 저장 실패 알림을 내고 pending을 유지한다. 후속 액션·외부 변경 후 재시도하되 실패한 앞 intent를 뒤 intent가 추월하지 않으며 tight retry loop를 만들지 않는다. 실패 뒤 reconnect 같은 새 의도도 순서대로 최종 반영된다.
- 외부 snapshot은 최신 durable baseline을 갱신하고 pending을 재적용한다. 외부 hydrate를 새 사용자 intent로 직렬화하지 않는다. 오래된 hydrate 응답과 자기 write echo를 세대/기대 snapshot으로 걸러 유한 write 횟수로 수렴한다.
- 초기 hydration 완료와 durable write 성공은 별개다. 초기 read/migration 실패에도 기존 저장 실패 안내와 화면 ready를 보장하고, 정상 read가 확인될 때까지 기본값을 durable 전체 overwrite하지 않는다. 초기화 실패 뒤 후속 정상 읽기로 복구한다.
- settings 전용 adapter와 테스트 가능한 settings-sync leaf를 필수로 둔다. main.tsx는 설치만 한다. 다른 store의 chrome-storage 동작은 바꾸지 않는다.
- 모든 bugshot-settings writer(set/remove/clearStorage/migration/토큰 갱신)는 같은 queued exclusive Web Lock 상수를 사용한다(ifAvailable 사용 금지). read/migrate/write 전체를 잠그며 네트워크 중 잠금을 유지하지 않는다.
- string/object envelope와 legacy Jira fallback을 보존한다. v1/v2 및 v10/v11 migration은 잠금 내 최신 raw에서 계산한다. unknown 무관 필드와 미래 version은 삭제/역행시키지 않는다. malformed raw는 저장 실패로 취급하고 정상 read 전 파괴적 기본값 write를 금지한다. null은 실제 미존재로 확인된 경우에만 빈 저장소로 취급한다.

### 검증 모델과 파일 소유권

storage mock get/set은 structured clone 또는 문자열 snapshot으로 실제 복제 경계를 재현한다. 독립 store/adapter 두 개와 실제 background writer를 공유 durable backing·lock scheduler에 연결한다. 동일 모듈 로컬 mutex나 객체 참조 공유로 테스트를 통과시키지 않는다. 첫 commit을 보류하고 두 번째 writer가 lock 앞에서 대기함을 확인한 뒤 해제한다.

최종 envelope·양 store 값·실제 API URL/Authorization/refresh POST body·저장 실패 이벤트·hydration ready·유한 write 횟수를 단언한다. 공통 lock/intent 병합 또는 modal 배선을 되돌린 red를 확인한다. migration·동시 onChanged·실패 복구 및 provider 5종 pre-refresh/401 매트릭스를 포함한다.

AUTH는 CAPTURE 및 CONNECT 통합 후 착수한다. IssueCreateModal/DraftDetailDialog의 grant/prefill 배선, 관련 테스트·타입은 AUTH 소유로 확장한다. CAPTURE의 로그·첨부 변경은 유지한다. 공용 문서·coverage baseline은 계속 지휘자 소유다.
