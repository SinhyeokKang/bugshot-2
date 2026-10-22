# Chrome 로컬 AI 사용 가능 상태 복구 — 설계

## 개요

Chrome 모델의 준비 상태는 기존 생성 가능 상태와 분리한다. useAI의 기존 status 소비처는 available일 때만 생성한다. 별도의 Chrome 준비 상태와 사용자 시작 함수는 AI 설정 UI가 소비한다. 생성 요청은 기존 run의 AbortSignal을 native API까지 그대로 전달한다.

## 변경 범위

- `sidepanel/lib/ai-provider.ts`: Chrome 세션 언어 옵션, native prompt/create 타입·취소·monitor 지원. BYOK의 의미는 유지한다.
- `sidepanel/hooks/useAI.ts`: 로케일/LLM 변경에 따른 올바른 provider 재생성, 준비 상태 조회와 현재 가용성 반영.
- 새 `sidepanel/lib/chrome-ai.ts` 및 필요시 `hooks/useChromeAI.ts`: 상태·단일 준비 작업 소유. 테스트 가능한 컨트롤러/주입 경계로 API 조회·create·진행·세대 가드를 모은다.
- `tabs/settings/LlmConnectForm.tsx`: BYOK 미연결 온보딩에 Chrome 준비 상태·다운로드·재확인·언어 안내 컴포넌트.
- `prompts/draftCompact.ts`, `buildAiDraftPrompt.ts`, `generateReproPrefill.ts`, AI 다이얼로그: Chrome의 유효 출력 언어를 생성 지시와 맞춘다. compact인 Ollama를 Chrome으로 오인하지 않도록 provider 종류/해석된 언어를 명시적으로 전달한다.
- `src/i18n/namespaces/ai.ts`: 6개 로케일 대칭 문구. log-viewer에서 사용하지 않는 설정 전용 키는 복제하지 않는다.

## 상태·인터페이스 계약

```ts
type ChromeAIAvailability = 'checking' | 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface ChromeAIState {
  availability: ChromeAIAvailability;
  progress: number | null; // 0..1, 추측 진행률 금지
  error: boolean;
}
// 구체적인 공개 함수명은 기존 호출부와 최소 변경으로 맞춘다.
// refresh(): 설치를 시작하지 않는 availability 조회.
// prepare(): 사용자 클릭에서만 create 호출; 공유된 진행 중 Promise 재사용.
```

availability/create는 동일한 expectedInputs/expectedOutputs 설정을 사용한다. 시스템은 영어이며 지원되는 UI 입력·출력 언어를 선언한다. 한국어 처리의 최종 정책은 prd의 사용자 결정 후 반영한다. 언어별 상태가 다른 경우 이전 언어의 available을 재사용하지 않는다. obsolete probe가 최신 상태를 덮지 않도록 generation을 사용한다.

여러 useAI 구독자는 하나의 준비 작업·상태를 관측한다. 재조회는 단일 in-flight로 합치고 실패를 삼켜 영구 checking을 만들지 않는다. 로컬 상태를 settings persist에 추가하지 않는다(실제 브라우저 모델 상태가 진실). no-BYOK 화면을 벗어나도 준비용 세션은 완료/실패 시 정리하고 stale UI 결과는 버린다. 다운로드 중 다른 설정 화면으로 이동해도 기존 외부 AI 연결 플로우를 가로막지 않는다.

## 취소 계약

native `prompt(input, {responseConstraint, signal})`에 신호를 전달한다. 생성 중 취소가 필요한 경로는 create signal 또는 생성 완료 직후 aborted 검사와 destroy로 누수를 방지한다. 이미 취소된 요청은 native prompt를 시작하지 않는다. `generateReproStepsWithAI`의 finally destroy와 useAiRun의 결과 적용 가드를 유지한다. resumable effect cleanup에서 무조건 abort하는 수정은 금지한다(게이트 왕복 readopt 계약 유지).

## 기존 규칙·대안

- 설정 카드·버튼·진행률·role=status는 DESIGN.md 관용구를 따른다. 폼은 400px 폭, 키보드·다크모드·6개 언어 검증.
- 다운로드를 availability 조회나 자동 재현 effect에서 시작하는 대안은 user activation·사용자 동의·무음 네트워크 동작 때문에 제외한다.
- 기존 세 상태에 downloadable을 available로 합치는 대안은 자동 생성이 설치를 시작하고 progress를 잃어 제외한다.
- 새 외부 번역 서비스를 붙이는 대안은 데이터 직행 정책과 범위 확장 때문에 제외한다.

## 위험·검증

- 공식 API는 변동 가능하므로 구현 시 Chrome 공식 Prompt API 문서를 확인한다. 기존 readily 별칭 호환은 깨뜨리지 않는다.
- 실제 모델 설치 크기/지속 시간은 보장하지 않는다. 지원 환경·언어 부족은 의미가 다른 상태로 설명한다.
- 모듈 상태가 테스트 간 새지 않게 factory/reset 경계를 두되 사용되지 않는 범용 프레임워크는 만들지 않는다.
- 자동 테스트: 네 상태+API 부재/throw, user activation 호출 순서, 중복 클릭, monitor 없는 구현, 다운로드 실패→재시도, 구독 간 완료 반영, stale probe, BYOK 교체, 로케일 교체, 취소 전/중/생성 중 세션 정리.
- e2e: 설정 다운로드 버튼→진행→완료→AI 진입 가능, 실패→재시도, 키보드 접근, 지원/미지원 언어 안내. 실제 모델은 별도 수동 검증.

## 가이드 영향

`guide/{ko,en}/settings/ai.md`의 Chrome 폴백·준비·언어 설명 및 해당 스크린샷. `ARCHITECTURE.md` AI 통합/취소, `DIRECTORY.md` 신규 파일, `DESIGN.md` UI 변경, privacy의 모델 다운로드 설명 필요 여부를 지휘자가 통합 후 대조한다.
