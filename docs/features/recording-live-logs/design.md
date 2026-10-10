# 녹화 중 로그 확인 — 기술 설계

## 개요

`DebugTab`의 로그 탭 잠금 조건에서 `recording`을 뺀다. 콘솔·네트워크 서브탭은 녹화 중일 때 footer 버튼을 disabled로 두고, 그 위에 `RecordingFloatingBar`를 `absolute`로 겹쳐 띄운다. 바는 **앱 테마의 반대 토큰을 받는 `.theme-inverse` 스코프**를 루트에 건다. 이 스코프는 JS 없이 CSS 셀렉터만으로 만든다 — `<html>`에 이미 토글되는 `.dark` 하나에 반전이 묶이므로 바와 앱 테마가 어긋날 수 없다. 그래서 raw 색 없이 shadcn 토큰과 Button variant만으로 반전 표면이 나온다. 녹화 경과 시간은 `RecordingState`와 바가 공유하도록 `useRecordingElapsed` 훅으로 추출하고, 정지 처리 구간에 0으로 떨어지지 않게 마지막 값을 유지한다. 정지·취소는 두 화면 모두 `videoRecorder.stopRecording()`/`cancelRecording()`을 직접 호출한다. `hideSubTabs` phase로 바뀌면 서브탭을 issue로 되돌리는 불변식 effect를 `DebugTab`에 둔다.

새 캡처·수집·전송은 없다. 이미 수집 중인 로그를 패널에서 보여줄 뿐이라 `docs/privacy`·`PERMISSION.md`는 무변경이다. 단, **화면 녹화(`getDisplayMedia`)는 패널까지 찍으므로** 녹화 중 로그 탭을 열면 로그 내용이 영상에 남는다(`logsAttach` off여도). 이 기능이 그 노출을 유도하는 건 새로운 점이라 가이드(`video/record.md`)에 한 줄 안내한다.

## 변경 범위

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/tabs/DebugTab.tsx` | 서브탭 셸: sub 상태, 잠금, issue 서브탭일 때 3종 레코더 1.5s 폴링 | ① `logTabsLocked = unsupported`(recording 제거, 주석 갱신) ② 3종 폴링 조건을 파생 불리언 `pollAll = sub === "issue" \|\| recording`(`recording = phase === "recording"`)으로 넓힘. deps에 `phase`가 아니라 `pollAll`을 넣어 무관한 phase 전이마다 interval이 재시작되지 않게 한다. 기존 `activeMainTab`·`unsupported` 가드 유지 ③ `hideSubTabs`가 true가 되면 `setSub("issue")` — `useLayoutEffect`(drafting 첫 페인트에 sub=console이 한 프레임 그려지는 걸 막는다) ④ 25-26행 주석("sub는 이때 항상 issue") 갱신 |
| `src/sidepanel/tabs/ConsoleSubTab.tsx` | 콘솔 로그 + footer(Clear·이슈 작성) | `recording = phase === "recording"`. 두 버튼 `disabled`에 `recording` OR. [이슈 작성]에 testid(`console-write-issue`) 추가. `PageShell className="relative"`, `ConsoleLogContent bottomInset={recording}`, `recording && <RecordingFloatingBar />`(**footer 뒤**에 렌더 — 읽기 순서 목록 → footer → 바) |
| `src/sidepanel/tabs/NetworkSubTab.tsx` | 네트워크 로그 + footer | ConsoleSubTab과 대칭(testid `network-write-issue`) |
| `src/sidepanel/components/ConsoleLogContent.tsx` | 콘솔 로그 뷰(사이드패널·트림·다이얼로그·log-viewer 공용) | optional prop `bottomInset?: boolean`. true면 목록 `ScrollArea` 안쪽 래퍼(`<div className="overflow-hidden">`, 현재 164행)에 `pb-6` |
| `src/sidepanel/components/NetworkLogContent.tsx` | 네트워크 로그 뷰(공용) | optional prop `bottomInset?: boolean`. true면 ① 목록 `ScrollArea` 안쪽 `<div>`에 `pb-6` ② 상세 `ScrollArea`(현재 405-423행) 안의 형제 `TabsContent` 3~4개를 **래퍼 div 하나로 감싸고** 그 래퍼에 조건부 `pb-6`. 두 대상 div에 testid(`network-list-body`·`network-detail-body`) 부착 |
| `src/sidepanel/components/RecordingFloatingBar.tsx` | **신규** | 반전 플로팅 바. 아래 인터페이스 참조 |
| `src/sidepanel/hooks/useRecordingElapsed.ts` | **신규** | `videoRecorder.getElapsedSec()`를 500ms 폴링하고 `getMaxDuration()`을 함께 반환. `RecordingState`의 기존 effect를 이리로 옮김. **정지 처리 구간 보정**: `getElapsedSec()`가 0을 돌려줘도 직전 값이 0보다 크면 직전 값을 유지(`stopRecording` 뒤 `onstop`이 `state = null`을 먼저 하고 썸네일·settle을 await하는 동안 0으로 튀는 것 방지). 훅은 녹화마다 새로 마운트되므로 이전 녹화 값이 새지 않는다 |
| `src/sidepanel/tabs/IssueTab.tsx` | `RecordingState`가 경과 시간을 직접 폴링 | `RecordingState`의 elapsed `useState`/`useEffect`·`getMaxDuration()`을 `useRecordingElapsed()`로 교체. 렌더는 무변경(마지막 값 유지 보정은 여기에도 적용된다) |
| `src/styles/globals.css` | `:root`(라이트) / `.dark` 토큰 | 셀렉터만 확장(토큰 0줄 추가): 라이트 블록 `.dark .theme-inverse, :root`, 다크 블록 `:root:not(.dark) .theme-inverse, .dark` + 한 줄 주석(반전 스코프 용도, `parseTokens`가 `":root {"`·`".dark {"`로 블록을 찾으므로 각 리스트의 **마지막** 셀렉터 고정) |
| `src/i18n/namespaces/issue.ts` | 녹화 문구 | 신규 키 3개 × 5 로케일: `issue.recording.barLabelTab`, `issue.recording.barLabelScreen`, `issue.recording.barStop` |
| `docs/DESIGN.md` | 디자인 규칙 | 아래 "문서 갱신" 참조 |
| `e2e/GOTCHAS.md` | e2e 함정 | 45행 재작성(아래 "문서 갱신") |
| `e2e/recording-live-logs.spec.ts` | **신규** | `getDisplayMedia` stub으로 phase=recording에 진입하는 e2e(tasks Task 10) |
| `e2e/COVERAGE.md` | e2e 커버리지·수동 잔여 | 신규 spec 등재, 남는 수동 잔여(탭 녹화 실경로·OS 테마 전환·reduced motion·화면 녹화 중 탭 이동) 기록 |

`src/log-viewer/`는 바를 렌더하지 않으므로 복제 사전·토큰 표(`log-viewer/styles.css`)를 건드리지 않는다. `bottomInset` 기본값은 false라 다른 소비처 4곳(트림·LogInsert·LogPreview·log-viewer)은 렌더 결과가 같다(네트워크 상세의 래퍼 div 하나가 추가될 뿐 클래스 없음).

### 문서 갱신

- **DESIGN §6**: "반전 플로팅 바" 관용구를 기존 "콘텐츠 위에 떠 있는 컨트롤"(`bg-background/90 backdrop-blur-sm` — ZoomControl·ImageActions)의 **파생**으로 기술한다. 차이는 반전 스코프(`.theme-inverse`)와 토스트급 elevation(`shadow-lg rounded-xl`)뿐. **진행 중인 세션 상태 전용**(다른 용도로 쓰면 위계 효과가 사라진다). 높이 관계(68px·inset 12px·`pb-6`)와 "바에 덮이는 footer 버튼은 `aria-disabled`가 아니라 `disabled`"(§14 예외) 포함.
- **DESIGN §3**: "반전 스코프(`.theme-inverse`) 안에서 `dark:` variant 금지"(Tailwind class 전략은 *어떤* 조상이든 `.dark`면 매칭) + 셀렉터 순서 의존(`parseTokens`).
- **DESIGN §2**: 61행 "단발 상태·기능 색 4종(넷 다 `dark:` 짝 보유)" 문장을 갱신 — 녹화 red에 `RecordingFloatingBar`(`dark:` 짝 없음, 반전 스코프라 의도)를 추가하면 "넷 다"가 거짓이 된다.
- **DESIGN §8**: reduced-motion 대응 목록에 바 맥박(`motion-reduce:animate-none`) 추가.
- **DESIGN §14**: "앱 내 유일한 `animate-pulse`" 문장 갱신(스켈레톤 + 녹화 점).
- **e2e/GOTCHAS.md 45행**: 기존 서술은 귀속부터 틀렸다(drafting/previewing/done은 `logTabsLocked`가 아니라 `hideSubTabs`이고 styling이 빠져 있다). "로그 탭은 미지원 페이지(`logTabsLocked`)에서 비활성, styling/drafting/previewing/done(`hideSubTabs`)에선 서브탭 바 자체가 숨겨진다. 녹화 중엔 열린다"로 재작성.

## 데이터 흐름

```
phase === "recording"  (editor-store, 기존)
   │
   ├─ DebugTab
   │    ├─ logTabsLocked = unsupported                → 콘솔·네트워크 트리거 활성
   │    ├─ 3종 sync interval (pollAll = issue || recording) → 배지 갱신 보조 경로 유지
   │    │     (주 경로는 레코더 200ms stream → usePickerMessages → store, 서브탭 무관)
   │    └─ useLayoutEffect: hideSubTabs → setSub("issue")
   │
   └─ Console/NetworkSubTab (active일 때 자기 레코더 sync — 기존)
        ├─ footer 버튼 disabled
        ├─ LogContent bottomInset → 목록·상세 끝 pb-6
        └─ RecordingFloatingBar (.theme-inverse)
             ├─ useEditorStore(recordingSource) → 라벨 tab/screen
             ├─ useRecordingElapsed()            → "0:45" (정지 구간엔 마지막 값)
             ├─ [✕ 취소] → 서브탭 트리거 focus → videoRecorder.cancelRecording() → phase idle (sub 유지)
             └─ [완료]   → videoRecorder.stopRecording() → 3종 stop + recorder.onstop
                           → syncAndSettleLogs(picker-control.ts) → phase drafting(+replayTrim) → sub issue
```

스토리지·메시지·타입 영속은 변하지 않는다. `sub`는 기존처럼 `DebugTab` 로컬 상태다.

## 인터페이스 설계

```ts
// src/sidepanel/hooks/useRecordingElapsed.ts
export function useRecordingElapsed(): { elapsedSec: number; maxSec: number };

// src/sidepanel/components/RecordingFloatingBar.tsx
export function RecordingFloatingBar(): JSX.Element;

// ConsoleLogContentProps / NetworkLogContentProps
bottomInset?: boolean;
```

`RecordingFloatingBar` 마크업(치수는 계약이다. 아래 "높이 관계" 참조):

```tsx
// 반전 스코프 안에서는 Tailwind dark variant를 쓰지 않는다(조상 .dark에 매칭돼 반전이 깨진다).
<div
  ref={rootRef}
  data-testid="recording-bar"
  role="region"
  aria-label={t(labelKey)}
  className={cn(
    "theme-inverse",
    "absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-xl p-4",
    "bg-background/90 text-foreground shadow-lg backdrop-blur-sm",
  )}
>
  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
  <span className="min-w-0 truncate text-sm font-medium">{t(labelKey)}</span>
  <span className="shrink-0 text-sm tabular-nums">{formatMmSs(elapsedSec)}</span>
  <div className="ml-auto flex shrink-0 gap-2">
    <TooltipIconButton label={t("common.cancel")} className="h-9 w-9" testId="recording-bar-cancel" onClick={handleCancel}>
      <X />
    </TooltipIconButton>
    <Button onClick={() => videoRecorder.stopRecording()} data-testid="recording-bar-stop">{t("issue.recording.barStop")}</Button>
  </div>
</div>
```

```ts
// 바가 언마운트되기 전에 포커스를 자기 서브탭 트리거로 옮긴다.
// Radix TabsContent(role=tabpanel)의 aria-labelledby가 트리거 id다.
const handleCancel = () => {
  const triggerId = rootRef.current?.closest('[role="tabpanel"]')?.getAttribute("aria-labelledby");
  if (triggerId) document.getElementById(triggerId)?.focus();
  videoRecorder.cancelRecording();
};
```

- [완료]는 기본 size(`h-9`), [✕]는 `TooltipIconButton`(outline)을 `h-9 w-9`로 맞춘다. 바 높이 = `p-4`×2 + 36 = **68px**로 `PageFooter`(`p-4` + `h-9` + `border-t` ≈ 69px)와 같다.
- `TooltipIconButton`의 툴팁은 portal로 스코프 밖에 렌더되므로 앱 테마를 따른다(의도).
- `ring-1 ring-border`는 쓰지 않는다. 반전 스코프의 `--border`가 바 배경과 거의 같아 보이지 않고, 반전 표면은 바깥 콘텐츠와 대비가 이미 최대라 분리선이 필요 없다.
- `aria-label`은 `progressLabel`("녹화 진행률" — progressbar용)이 아니라 바 라벨 키다. 좁은 폭에서 라벨이 시각적으로 0까지 잘려도 보조기기에는 맥락이 남는다.
- 시간 텍스트는 aria-live를 걸지 않는다. 500ms마다 바뀌어서 스크린리더가 계속 읽어버린다.
- 최소 폭 추정(Pretendard 14px, fr 최장): 점 10 + 시간 ≈32 + [✕] 36 + [Arrêter] ≈84 + gap(12×3 + 8) ≈ **206~228px**로 320px 패널의 바 안쪽 가용 폭 264px(= 320 − inset 24 − 패딩 32) 안에 들어온다. 라벨은 남는 폭만큼 보이다 말줄임된다. e2e(Task 10)가 실측으로 고정한다.

i18n 값:

| 키 | ko | en | fr | es | de |
|---|---|---|---|---|---|
| `issue.recording.barLabelTab` | 탭 녹화 중 | Tab recording | Enregistrement de l’onglet | Grabando pestaña | Tab-Aufnahme |
| `issue.recording.barLabelScreen` | 화면 녹화 중 | Screen recording | Enregistrement de l’écran | Grabando pantalla | Bildschirmaufnahme |
| `issue.recording.barStop` | 완료 | Stop | Arrêter | Detener | Stoppen |

라벨은 기존 `titleTab`/`titleScreen`에서 `{time}`만 뗀 값이다(en은 "Recording tab"이 "녹화용 탭"으로 읽혀 명사형으로 바꿈). `barStop`은 기존 `issue.recording.stop`(fr "Arrêter l’enregistrement" 등)이 바 폭에 안 들어가서 둔 짧은 전용 키다. 기존 키는 `RecordingState`가 계속 쓴다.

## 기존 패턴 준수

- **반전 스코프 메커니즘**: `.dark .theme-inverse`(앱 다크 → 바 라이트)와 `:root:not(.dark) .theme-inverse`(앱 라이트 → 바 다크)는 바 루트 요소에 토큰을 **직접 선언**하므로, `<html>`에서 상속된 값보다 이긴다. 앱 테마는 `useThemeEffect`가 `<html>.dark`를 토글하는 기존 경로 하나뿐이고 바는 그걸 CSS로 읽기만 한다 — `system` 모드의 OS 테마 변경도 그 경로를 그대로 탄다. JS 훅·matchMedia 구독이 추가되지 않는다.
- **반전 스코프 안에서 `dark:` variant 금지**: Tailwind class 전략은 *어떤* 조상이든 `.dark`면 매칭된다. 그래서 앱이 다크일 때 라이트 스코프 안에서도 `dark:`가 켜진다. 바는 `dark:` 클래스를 쓰지 않는다(`button.tsx`도 0건). 빨간 점은 `dark:` 짝 없는 `bg-red-500` 하나만 쓴다.
- **muted 표면 위 hover 무효 함정(DESIGN §2)**: 바 표면은 `bg-secondary`가 아니라 `bg-background`다. outline 아이콘 버튼의 `hover:bg-accent`가 산다.
- **플로팅 컨트롤 관용구(DESIGN §6)**: `bg-background/90 backdrop-blur-sm`은 ZoomControl·ImageActions와 같은 값이다. Elevation만 토스트와 같은 3단계(`shadow-lg`·`rounded-xl`)로 올린다. **Z-index**: 로컬 겹침 `z-10`(DESIGN §7).
- **footer 잠금은 `disabled`(DESIGN §14 예외)**: §14의 "진행 중 잠금 = `aria-disabled` + 가드"는 버튼이 보이는 상태에서 툴팁·hover를 살리기 위한 규칙이다. 녹화 중 footer 버튼은 바에 완전히 덮여 보이지 않으므로 목적은 **tab order·보조기기에서 빼는 것**이고, 그건 `disabled`만 된다(`aria-disabled`면 보이지 않는 버튼에 포커스가 간다).
- **i18n**: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 돌린다. 5개 로케일을 한 번에 추가한다. log-viewer 사전은 무관하다.
- **경로 표기**: `sidepanel`은 `@/` 유지가 지역 관례다(`@/sidepanel/video-recorder`, `@/sidepanel/lib/logRow`, `@/sidepanel/components/TooltipIconButton`).
- **shadcn 우선**: Button·TooltipIconButton은 기존 variant만 쓴다. 바 자체는 shadcn 대응 컴포넌트가 없는 레이아웃 컨테이너다.
- **테스트 2트랙**: 훅·컴포넌트는 `*.test.tsx`(jsdom), 토큰 셀렉터는 node 트랙(`tokens.test.ts`).

## 대안 검토

1. **footer를 바로 갈아 끼우기(오버레이 없음)** — 레이아웃은 단순하다. 하지만 바가 떠 있는 표면이 아니라 footer 교체로 읽혀 위계가 약해지고, 녹화가 끝나면 footer가 튀어 바뀐다. 사용자가 오버레이를 택했다.
2. **`RecordingState` 안에 최신 로그 미니 피드** — 로그 뷰를 하나 더 만들어야 하고, 필터나 상세가 필요해지는 순간 기존 탭과 똑같아진다.
3. **raw 색 고정 다크 바(`bg-zinc-900/80` 등)** — 앱이 다크면 배경과 묻히고, 버튼 variant를 바 전용으로 직접 스타일링해야 한다(shadcn 우선 원칙 위반).
4. **`.inverse` 토큰 블록 복제** — 토큰 표가 네 벌로 늘어나고 `tokens.test.ts` 대조 대상이 하나 더 생긴다. 셀렉터 리스트 확장이 토큰 0줄 추가로 같은 효과를 낸다.
5. **JS 훅(`useResolvedDark`)으로 `.light`/`.dark` 클래스 선택** — `useThemeEffect` 개편·matchMedia 구독(이미 `CssCodeMirror`에 한 벌 더 있다)·stale matches·첫 렌더 FOUC 대응이 따라온다. 바 하나를 위해 앱 전역 테마 경로를 건드리는 회귀 범위에 비해 얻는 게 없다. CSS 셀렉터가 같은 결과를 html 클래스 하나에 묶어 낸다.
6. **바를 footer 높이 안으로 축소(`size="sm"` + `py-3`, 56px)** — `bottomInset`과 높이 불변식이 사라지지만 바 위계가 약해진다. 사용자가 68px를 택했다.
7. **바를 `DebugTab`에서 단일 마운트** — 위치 기준을 TabsContent로 잡아야 하고, footer disabled는 어차피 각 서브탭이 들고 있다. 서브탭 소유가 응집도가 높다.

## 위험 요소

- **높이 관계 불변식**: 바 윗변 = 12 + 68 = 바닥에서 80px, footer 윗변 ≈ 69px라 로그 영역을 **11px 의도적으로 겹친다**. `pb-6`(24px) = 겹침 11px + 여유 12px(+1). 바 패딩·버튼 size·inset·`PageFooter` 패딩 중 하나라도 바꾸면 `bottomInset` 값을 다시 계산한다. 기존 하단 고정(pin-to-bottom) 자동 추적의 24px 임계(`ConsoleLogContent.tsx:100-109`)와 충돌하지 않는다.
- **셀렉터 순서 의존**: `src/test/cssContrast.ts:parseTokens`가 `indexOf(":root {")`·`indexOf(".dark {")`로 블록을 찾는다. 리스트의 마지막 셀렉터가 `:root`/`.dark`가 아니면(`:root, .dark .theme-inverse {` 등) `tokens.test.ts`·`muted-surface-contrast.test.ts`가 "블록이 없다"로 red가 난다. 주석과 테스트(Task 4)로 고정한다.
- **반전 스코프 안 `dark:` 누출**: 나중에 바에 `dark:` 클래스를 추가하면 반전이 깨진다. 타입으로 못 잡으므로 DESIGN §3 규칙, 컴포넌트 상단 주석, 소스 스캔 단언(Task 5)에 의존한다. 반전 스코프에 넣는 자식 컴포넌트(Button·TooltipIconButton)도 `dark:` 0건이어야 한다.
- **IssueTab 마운트 의존 로직**: Radix `TabsContent`는 비활성 탭을 언마운트하므로, 로그 서브탭에 있는 동안 `IssueTab`은 마운트돼 있지 않다. `IssueTab.tsx:97-104`의 "phase→idle 전이 시 `clearPicker`" 구독은 바에서 [취소]할 때 돌지 않는다. 녹화 세션의 picker는 idle이고 `cancelRecording`이 `hideAnnotation`을 직접 호출하므로 현재 실해는 없다고 본다(추정, 수동 확인). **이후 IssueTab에 녹화 관련 마운트 의존 로직을 추가하면 같은 갈림이 생긴다** — 그런 로직은 IssueTab 밖(store 구독·`video-recorder`)에 둔다. 구독 이전은 이번 범위 밖.
- **이중 sync**: 녹화 중 콘솔 서브탭에 있으면 `DebugTab`의 3종 폴링과 `ConsoleSubTab`의 콘솔 폴링이 함께 돈다. 레코더 sync는 id dedup 머지라 결과는 같다. `sendToTabAllFrames`라 1.5s당 **프레임 수만큼** 메시지가 더 나간다. 녹화 중 이슈 서브탭에서 이미 도는 비용과 같은 수준이라 수용한다.
- **녹화 정지 경로**: 정지는 `video-recorder.ts`의 `stopRecording`(3종 `stop*Recorder` → `recorder.stop()`)과 `beginRecording`의 `recorder.onstop`이 await하는 `syncAndSettleLogs`(`picker-control.ts`)를 그대로 탄다. 서브탭 위치와 무관하게 로그 꼬리가 보존되고 새 경로를 만들지 않는다. 정지 처리 구간에 누른 [✕]는 finalize 가드(`finalizing.cancel()`)로 정상 폐기된다(POSTMORTEM recording-trim 함정 회피 확인). 같은 구간의 [완료] 재클릭은 `if (!state) return`으로 no-op이다.
- **화면 녹화가 패널을 찍는다**: 위 개요 참조. docs/privacy는 수집·전송 동작이 변하지 않아 무변경, 가이드 안내로 처리.
- **e2e는 stub 경로**: 실 tabCapture는 headed 자동화에서 불안정하다(`e2e/capture.spec.ts` 주석). 대신 `getDisplayMedia`를 `canvas.captureStream()`으로 stub해 화면 녹화로 phase=recording에 진입한다(선례: `e2e/logview/fixtures.ts:62`의 canvas 스트림 + MediaRecorder). 이 진입이 되는지는 PoC 전 추정이다. 안 되면 `/e2e-write`가 그 사실을 보고하고 jsdom + 수동 체크리스트로 폴백한다. 탭 녹화 실경로는 수동 잔여로 남는다.
- **`hideSubTabs` effect 범위**: drafting/previewing/done 진입 경로가 지금은 전부 issue 서브탭이라 기존엔 무해했다. 이번에 녹화 완료가 콘솔·네트워크 서브탭에서도 일어나게 되면서 불변식이 필요해졌다. effect는 idle 전이(취소)에선 동작하지 않아야 한다(S2).
