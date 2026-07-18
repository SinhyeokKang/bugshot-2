# 로그 표면 mono 일관화 — 기술 설계

## 개요

순수 CSS 클래스 변경이다. 5개 표면에 Tailwind `font-mono` 유틸을 붙이고, DESIGN "mono 표면 불변식(12px)"에 맞춰 크기를 `text-xs`로 정렬한다. 신규 CSS 규칙·컴포넌트·타입·i18n 키는 없다. 리거처 방어는 기존 `.font-mono` 셀렉터 리스트(`globals.css` + `log-viewer/styles.css`)가 자동으로 커버한다.

## 변경 범위

### 1. `src/sidepanel/components/JsonTreeViewer.tsx`
- **현재 역할**: 네트워크 요청/응답 JSON 본문(`NetworkLogContent.BodyBlock`)과 WebSocket JSON 프레임(`FrameBody`)을 트리로 렌더. 모든 행 `text-[13px]` sans.
- **변경**:
  - `JsonTreeViewer` 반환부의 `<JsonNode>`를 `<div className="font-mono">`로 감싼다(Provider는 DOM 노드가 없어 래퍼가 필요). `font-variant-ligatures: none`은 상속 속성이라 자식 전체에 적용됨.
  - 행의 `text-[13px]` → `text-xs`(12px)로 교체. 대상: `JsonNode` 빈 컨테이너·토글 행, `ArrayChildren` more 행, `StringRow`, `PrimitiveRow`, `KeyLabel` 하위 행 컨테이너(현재 `text-[13px]` 5곳: L128, L139, L210, L239, L272).
  - 색상 토큰(`JSON_TOKEN_CLASS`)·들여쓰기(`depth*12+4`)·`ChevronDown/Right` 아이콘 크기 등 그 외는 불변.

### 2. `src/sidepanel/components/ConsoleLogContent.tsx`
- **현재 역할**: 콘솔 로그 행. 접힌 요약은 sans `text-[13px]`, 펼침 `<pre>`/스택은 이미 `font-mono`.
- **변경**: `EntryAccordion` 접힌 행의 메시지 `<span>`(L243 `min-w-0 flex-1 break-all`)에 `font-mono text-xs` 추가. `LinkifiedText`는 그대로 감싸짐. 아이콘·타임스탬프 칩(이미 mono)·행 배경 불변.

### 3. `src/sidepanel/components/ActionLogContent.tsx`
- **현재 역할**: 액션 로그 행. verb 문장 + selector/tag/value chip 조합, 전체 sans `text-[13px]`.
- **변경**: `ActionRow`의 콘텐츠 `<span>`(L322 `min-w-0 flex-1 break-words leading-relaxed`)에 `font-mono text-xs` 추가. verb 문장·`InlineChip`·`ResolvedTargetChip`·`InlineLink`가 모두 mono를 상속(전체 mono = 콘솔과 통일). `leading-relaxed`는 다중 행 액션 문장 가독성을 위해 유지.
- `InlineChip.tsx`·`ResolvedTargetChip`은 **수정 없음** — 부모 span의 mono를 상속.

### 4. `src/log-viewer/components/TimelineMarkers.tsx`
- **현재 역할**: 로그뷰어 `ProgressBar`와 트리밍 `TrimTimeline`이 공유하는 마커 핀 + 호버 툴팁. 툴팁이 로그 내용(`labelParts`)을 `text-xs` sans로 portal 렌더.
- **변경**: 툴팁 컨테이너 `<div>`(L87)에 `font-mono` 추가. 이미 `text-xs`(12px)라 크기 변경 불필요. `labelParts`의 per-part 색상 className은 그대로.
- `markers.ts`(labelParts 생성)는 **수정 없음** — 데이터·색상 로직 불변, 서체만 컨테이너에서 얹음.

### 5. `src/sidepanel/components/NetworkLogContent.tsx` — `FrameBody`
- **현재 역할**: WebSocket 프레임 펼침 본문. JSON이면 `JsonTreeViewer`, non-JSON raw 텍스트면 `<pre className="... font-sans text-[11px]">`(L744-745). `font-sans`는 preflight의 pre→mono 리셋을 되돌리고 Geist 리거처(`------WebKitFormBoundary`의 `--` 붕괴)를 회피하려던 명시적 선택이었다.
- **변경**: L745 `<pre>`를 `font-sans text-[11px]` → `font-mono text-xs`로 교체. 형제인 `BodyBlock`의 raw body `<pre>`(L588 `font-mono text-xs`)와 동일 표면이 된다. L744 주석은 갱신/삭제(이제 mono가 의도) — 리거처는 `.font-mono`의 `font-variant-ligatures: none`이 커버하므로 `--` 붕괴 걱정 없음.
- **주의**: 크기 11→12px(`text-xs`) 동반. mono 불변식(12px) 준수 + 형제 raw body pre와 정합. JSON 프레임(JsonTreeViewer, 12px)과도 통일.

### 변경 없음 (확인 완료)
- **인라인 `<code>`·코드블럭**(`doc-section-body.css`·`tiptap-editor.css`): font-family 미지정 → Tailwind preflight가 `fontFamily.mono`를 공급. 이미 Geist Mono 12px. 스코프 외.
- **`globals.css` / `log-viewer/styles.css`의 `.font-mono` 규칙**: 신규 표면이 `.font-mono` 셀렉터를 타므로 리거처 규칙 자동 적용. CSS 파일 수정 불필요(`tokens.test.ts` 일치 검사도 무영향).

## 데이터 흐름

데이터·상태 흐름 변화 없음. 순수 렌더 서체 변경.

**렌더 재사용 주의**: `JsonTreeViewer`·`ConsoleLogContent`·`ActionLogContent`는 `log-viewer/App.tsx`가 그대로 import하고, `TimelineMarkers`는 로그뷰어 native + 사이드패널 `TrimTimeline` 공용이다. `NetworkLogContent`(FrameBody 포함)도 `log-viewer/App.tsx`가 import한다. 따라서 5개 변경 모두 **사이드패널과 내보낸 `logs.html` 양쪽에 동시 반영**된다. `logs.html`엔 Geist `@font-face`가 없어 시스템 mono로 폴백(기존 mono 표면과 동일한 의도된 발산).

## 인터페이스 설계

신규/변경 타입·시그니처 없음. props·함수 시그니처 불변, className 문자열만 변경.

## 기존 패턴 준수

- **mono 표면 불변식(DESIGN §4)**: "모든 mono 표면은 12px". 신규 리스트·칩 표면은 `text-xs`(12px / line-height 16px)를 쓴다. `text-[12px]` 금지(행간 18px 누수). → JSON 트리·콘솔 인라인·액션 행을 `text-xs`로. 마커 툴팁은 이미 `text-xs`.
- **리거처 방어**: `font-feature-settings`가 아니라 `.font-mono` 셀렉터의 `font-variant-ligatures: none`. 신규 표면은 `font-mono` 클래스만 붙이면 자동 적용(추가 규칙 불필요).
- **preflight sans 오버라이드 패턴**: sans여야 하는 `<pre>`는 `font-sans` 명시(WS `FrameBody` 사례) — 이번 변경은 그 반대 방향이라 무관하나, WS non-JSON `FrameBody`는 건드리지 않는다.
- **log-viewer 손복사본**: CSS는 손대지 않으므로 `styles.css` 동기화 불필요. 컴포넌트 재사용 경로만 타므로 자동 반영.

## 대안 검토

- **대안 A: 13px 유지한 채 font-mono만 추가.** 기각 — DESIGN 불변식이 "모든 mono 표면 12px"이고, 13px mono가 섞이면 DOM 트리·콘솔 본문(12px)과 크기가 갈려 오히려 불일치를 만든다. 문서에 예외를 늘리는 비용도 크다.
- **대안 B: 액션 로그를 chip만 mono(부분 적용).** 최초 안이었으나 사용자가 "전체 mono, 콘솔과 통일"로 번복. 부분 적용은 verb/chip 경계에서 서체가 튀어 콘솔 인라인(전체 mono)과 결이 안 맞는다.
- **대안 C: JsonTreeViewer 각 행에 `font-mono` 개별 부착.** 기각 — 래퍼 `<div>` 1개로 상속시키는 편이 외과적이고 리거처 상속도 자연스럽다.
- **대안 D: 네트워크 헤더 상세·리스트 행도 함께 mono.** 사용자가 sans 유지로 결정(LNB·헤더는 UI성으로 간주). 스코프에서 제외.

## 위험 요소

- **크기 변경(13→12px) 회귀**: JSON 트리·콘솔·액션 행이 1px 작아진다. 행 높이·truncation·가로 스크롤이 미세 변동. 좁은 패널에서 오히려 밀도 개선이나, 스냅샷성 시각 검증 필요.
- **log-viewer export 시각 검증**: 시스템 mono 폴백이라 개발 중(개발자 기기 Geist 설치)엔 안 보이는 발산. `pnpm build` 후 `logs.html`을 Geist 미설치 상태에 준해 확인.
- **액션 로그 `leading-relaxed` + `text-xs` 조합**: 불변식 표의 "리스트·칩 16px"과 살짝 어긋나나(다중 행 문장이라 relaxed 유지), 기존에도 relaxed였으므로 신규 발산 아님. DESIGN 표에 각주로 남긴다.
- **기존 컴포넌트 테스트**: `ConsoleLogContent.test.tsx`·`NetworkLogContent.test.tsx`는 서체 className을 assert하지 않음(확인함) → 회귀 없음. `markers.test.ts`는 `buildMarkers` 데이터만 검사(툴팁 DOM 무관) → 무영향.
- **WS 프레임 본문 11→12px**: `FrameBody` non-JSON `<pre>`가 `text-[11px]` → `text-xs`로 커진다. 형제 raw body pre(12px)와 정합되지만 WS 프레임 밀도가 미세 변동 — 시각 확인.
