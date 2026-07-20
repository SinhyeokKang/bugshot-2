# Chrome Nano `downloadable` 유도 배너

> 상태: **초안 (context capture)**. 다른 세션 작업 중 맥락만 따둠 — 후속 세션에서 이어서 진행.

## 배경

BugShot의 AI 기능(초안 작성·AI 스타일링·재현 단계 자동 채움)은 3단 폴백을 탄다:

```
BYOK(사용자 키) > Chrome 빌트인 AI(Gemini Nano, 온디바이스) > (둘 다 없으면) AI 미제공
```

이 중 **Chrome Nano 경로가 지금 덜 활용되고 있다.** `useAI.ts`가 `LanguageModel.availability()` 반환을 `available`/`unavailable` 2값으로만 접는데, Chrome Prompt API의 실제 상태는 **4개**다:

| 상태 | 의미 | 현재 처리 |
|---|---|---|
| `available` | 즉시 사용 가능 | ✅ 배너 노출 |
| `downloadable` | **하드웨어 자격은 되는데 온디바이스 모델만 안 받음** | ❌ `unavailable`로 뭉갬 |
| `downloading` | 다운로드 진행 중 | ❌ `unavailable`로 뭉갬 |
| `unavailable` | 하드웨어 미달(디스크·GPU/CPU 부족) → 나노 영영 불가 | ❌ (정상: 나노 불가) |

즉 **`downloadable` 코호트 = 원클릭 다운로드만 하면 무료로 AI가 되는데, 우리가 조용히 "없음" 처리하고 진입점을 아예 안 그리는 순수 손실분**이다. 하드웨어 게이트(디스크 22GB 여유 + GPU VRAM >4GB 또는 CPU 16GB RAM·4코어)를 통과했기에 회복이 확정된 사용자들이다.

### 촉발 신호 (웹스토어 리뷰)

> "Honestly, good stuff. But I wish it had more help from AI — like, filling the subject, description and the rest of it."

리뷰어가 원한 "subject/description 자동 채우기"가 **바로 존재하지만 그에게는 안 보인 기능**이다. BYOK 미설정 + 나노 미다운로드(`downloadable`) 상태였다면, AI 배너가 렌더될 조건(`aiStatus === "available"`)을 못 넘어 **AI의 존재 신호가 화면에 0개**였다. "AI가 부족"이 아니라 "AI를 못 봄"이 진짜 원인일 가능성이 크다.

### 코어밸류 정합

이 방향은 **프라이버시 코어밸류(클라이언트 온리)와 완벽히 정합**한다. 온디바이스 나노는 서버를 거치지 않으므로 캡처 컨텍스트가 사용자 브라우저를 떠나지 않고, 추론 비용도 0(사비 소모 없음)이다. 호스팅 AI를 붙이는 대안은 이 밸류와 정면충돌하므로 배제한다 — 무료 온디바이스 경로를 더 살리는 것이 정답.

## 목표

1. `useAI`가 4상태를 구분해 노출한다(`available` / `downloadable` / `downloading` / `unavailable` / `checking`).
2. `downloadable`일 때 **"온디바이스 AI 모델 받기 (무료)"** 유도 배너를 그린다 — 클릭 시 `LanguageModel.create({monitor})`로 다운로드 트리거.
3. `downloading` 중에는 진행률/진행 중 상태를 배너에 표시하고, 완료되면 자연스럽게 `available` 배너(기존 AI 트리거)로 전환.
4. 진입점 3곳 모두 일관 처리: `DraftingPanel`(AI 초안)·`StyleEditorPanel`(AI 스타일링)·`useReproPrefill`(재현 자동 채움).

## 비목표 (Non-goals)

- **`unavailable`(하드웨어 미달) 대상 BYOK 유도** — 별도 후속. 여기선 나노 다운로드 경로만. (하드웨어 미달층은 나노가 영영 안 되므로 BYOK 안내가 맞지만 스코프 분리.)
- **BYOK 폴백 로직 변경** — `llm?.modelId`가 있으면 여전히 즉시 `available`. 손대지 않는다.
- **호스팅/서버 AI** — 코어밸류 충돌, 영구 배제.
- **레거시 `"readily"` 처리 확장** — 현행 스펙에 없는 옛 명칭. `useAI.ts:40`의 `=== "readily"` 체크는 죽은 레거시라 정리만(무해).

## 열린 질문 (후속 세션에서 결정)

- **[권장 선행] 실측 먼저?** `downloadable` 비중이 유의미한지 필드 데이터가 없다. `src/background/analytics.ts`(PostHog 익명 집계, 스토어 빌드만)에 availability 반환 문자열을 한 줄 로깅하면 추측 대신 실측 가능. **문자열은 능력 enum이라 캡처 데이터가 아님 → 프라이버시 코어밸류 무관, 로깅 안전.** 이 배너 작업의 즉효 여부를 판가름하므로 1~2주 실측을 선행할지, 아니면 저비용 UX라 실측 없이 바로 박을지 결정 필요.
- **다운로드 UX 위치**: 배너 클릭 → 그 자리에서 진행률 인라인 표시 vs 다이얼로그. (기존 AI 트리거는 다이얼로그를 여는 패턴이라 결에 맞춤 필요.)
- **다운로드 실패/중단 처리**: 네트워크 끊김·용량 부족(자격은 됐으나 다운로드 중 실패)시 토스트/재시도 안내.

## 성공 기준

- `downloadable` 환경(나노 자격 O, 모델 미다운로드)에서 3개 진입점에 유도 배너가 렌더된다.
- 배너 클릭 → 모델 다운로드가 트리거되고 진행률이 사용자에게 보인다.
- 다운로드 완료 후 새로고침 없이(또는 자연스러운 재확인으로) 기존 AI 배너로 전환돼 바로 사용 가능.
- `unavailable`(하드웨어 미달)에선 이 배너가 안 뜬다(잘못된 기대 유발 방지).
- BYOK 설정 사용자는 동작 불변.
- `pnpm test` 통과(useAI 상태 매핑 단위 테스트 + 배너 렌더 컴포넌트 테스트).
- ko/en i18n 키 대칭.
