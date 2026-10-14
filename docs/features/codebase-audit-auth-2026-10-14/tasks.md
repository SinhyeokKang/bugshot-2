# 인증 경계 복구 — 태스크

## 선행
feature-review CTO·QA 검수 후 AUTH 워커 착수. docs/features/codebase-audit-2026-10-14/orch.md의 소유권과 공통 게이트를 따른다.

## Task 1: grant 경계
- [ ] A→B 재연결, 동일 계정 새 grant, 동시 서로 다른 grant 요청을 red로 고정.
- [ ] Jira grant 발급·refresh 보존, legacy 호환, 정상 회전 재사용, grant별 dedup 구현.
- [ ] 실제 요청 URL·Authorization과 persisted auth로 결과 단언. storage writer 거부만으로 read-side 안전을 주장하지 않는다.

## Task 2: 다중 writer
- [ ] 두 플랫폼 refresh, refresh+titlePrefix, refresh+계정 기본값, 두 패널의 독립 변경, disconnect/reconnect+늦은 write를 제어된 순서로 재현.
- [ ] 동일 Web Lock의 최신 read/merge/write와 intent delta 도입. hydrate/초기 migration도 검사.
- [ ] lock/read/write 실패, 재시도, 외부 onChanged와 미완 local 변경, 알 수 없는 필드 및 기존 envelope 호환 검증.
- [ ] 최종 저장값과 store 동기화가 맞고 onChanged 무한 루프가 없음.

## Task 3: 자체 검증·인계
- [ ] typecheck, 전체 test, sync:agents:check exit 0.
- [ ] 전문 자체 리뷰·독립 리뷰 지적 해소.
- [ ] 문서/회고 초안과 설계 차이를 handoff에 기록.

## 테스트 계획
단위·통합 테스트로 서로 독립한 저장 주체를 만들고 barrier/deferred로 interleaving을 강제한다. e2e가 필요하면 확장 두 패널에서 설정 변화와 mocked refresh 후 보존을 검증한다. 실 OAuth는 제공자 계정·실 토큰이 있어야 하므로 별도 런타임 한계로 보고하되 결정적 경계 테스트를 대체하지 않는다.

## 가이드 영향
기존 연결 동작의 복구이므로 새 사용자 절차 없음. 변경 후 실제 UX와 대조해 최종 판정한다.

## 검수 추가 수용 조건
- [ ] 5종 신규 grant ID 발급, canonical legacy 승격과 동시/늦은 요청, 동일 시각 재연결, GitHub optional RT 및 Asana 비회전 RT를 검증한다.
- [ ] connect/replace/disconnect/all/accountPatch/prefillPatch를 최신 durable state에 원자적으로 적용한다. 이전 제출 완료→새 grant prefill 오염을 두 제출 진입점에서 막는다.
- [ ] 복제 storage mock + 독립 패널 2개 + 실제 background writer로 lock/intent production 배선의 red→green을 입증한다.
- [ ] 실패 intent 보존·순서·재시도·외부 rehydrate 재적용·자기 echo·초기 hydration ready를 단언한다.
- [ ] migration(v1/v2/10/11/current), string/object/null/malformed/unknown 필드, 두 migration과 refresh의 경쟁을 단언한다.
- [ ] 구 grant 중단·저장 실패는 현재 계정 만료 이벤트를 발생시키지 않고 실제 만료는 유지한다. 실제 URL/헤더/refresh body와 최종 저장값으로 판정한다.
