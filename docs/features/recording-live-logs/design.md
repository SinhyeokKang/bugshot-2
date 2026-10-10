# 녹화 중 로그 확인 — 기술 설계

## 개요

`DebugTab`의 로그 탭 잠금 조건에서 `recording`을 뺀다. 콘솔·네트워크 서브탭은 녹화 중일 때 footer 버튼을 disabled로 두고, 그 위에 `RecordingFloatingBar`를 `absolute`로 겹쳐 띄운다. 바는 **앱 테마의 반대 테마 스코프**(`.light` / `.dark` 클래스)를 하위 트리에 걸어서, raw 색 없이 shadcn 토큰과 Button variant만으로 반전 표면을 만든다. 이를 위해 `globals.css`의 라이트 토큰 블록 셀렉터를 `:root`에서 `.light, :root`로 넓히고, 현재 resolved 테마(불리언)를 돌려주는 훅 `useResolvedDark`를 `useThemeEffect`에서 떼어낸다. 녹화 경과 시간은 `RecordingState`와 바가 공유하도록 `useRecordingElapsed` 훅으로 추출한다. 정지·취소는 두 화면 모두 `videoRecorder.stopRecording()`/`cancelRecording()`을 직접 호출한다(같은 함수라 경로가 갈라지지 않는다). drafting 계열 phase로 바뀌면 서브탭을 issue로 되돌리는 불변식 effect를 `DebugTab`에 둔다.

캡처·전송 동작 변화는 없다. 이미 수집 중인 로그를 패널에서 보여줄 뿐이라 `docs/privacy`·`PERMISSION.md` 영향은 없다.

## 변경 범위

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/tabs/DebugTab.tsx` | 서브탭 셸: sub 상태, 잠금, issue 서브탭일 때 3종 레코더 1.5s 폴링 | ① `logTabsLocked = unsupported`(recording 제거, 주석 갱신) ② 3종 폴링 조건을 `sub === "issue" \|\| phase === "recording"`으로 넓힘 ③ `hideSubTabs`가 true가 되면 `setSub("issue")` effect 추가 |
| `src/sidepanel/tabs/ConsoleSubTab.tsx` | 콘솔 로그 + footer(Clear·이슈 작성) | `recording = phase === "recording"`. 두 버튼 `disabled`에 `recording` OR. `PageShell className="relative"`, `recording && <RecordingFloatingBar />`, `ConsoleLogContent bottomInset={recording}` |
| `src/sidepanel/tabs/NetworkSubTab.tsx` | 네트워크 로그 + footer | ConsoleSubTab과 대칭 |
| `src/sidepanel/components/ConsoleLogContent.tsx` | 콘솔 로그 뷰(사이드패널·트림·다이얼로그·log-viewer 공용) | optional prop `bottomInset?: boolean`. true면 목록 `ScrollArea` 안쪽 래퍼(`<div className="overflow-hidden">`)에 `pb-6` |
| `src/sidepanel/components/NetworkLogContent.tsx` | 네트워크 로그 뷰(공용) | optional prop `bottomInset?: boolean`. true면 목록 `ScrollArea` 안쪽 `<div>`와 상세 패널 `ScrollArea` 안쪽 콘텐츠에 `pb-6` |
| `src/sidepanel/components/RecordingFloatingBar.tsx` | **신규** | 반전 플로팅 바. 아래 인터페이스 참조 |
| `src/sidepanel/hooks/useRecordingElapsed.ts` | **신규** | `videoRecorder.getElapsedSec()`를 500ms 폴링하고 `getMaxDuration()`을 함께 반환. `RecordingState`의 기존 effect를 이리로 옮김 |
| `src/sidepanel/hooks/useResolvedDark.ts` | **신규** | `theme` + `matchMedia("(prefers-color-scheme: dark)")` → `resolveDark()` 불리언. `system`이면 OS 변경을 구독 |
| `src/sidepanel/hooks/useThemeEffect.ts` | `<html>`에 `.dark` 토글 + matchMedia 구독 | `useResolvedDark()` 값을 받아 `classList.toggle("dark", dark)`만 하도록 축소(구독 로직이 두 벌로 갈리지 않게) |
| `src/sidepanel/tabs/IssueTab.tsx` | `RecordingState`가 경과 시간을 직접 폴링 | `RecordingState`의 elapsed `useState`/`useEffect`·`getMaxDuration()`을 `useRecordingElapsed()`로 교체. UI는 무변경 |
| `src/styles/globals.css` | `:root`(라이트) / `.dark` 토큰 | 라이트 블록 셀렉터를 `.light, :root`로 변경 + 한 줄 주석(반전 스코프 용도, 순서가 `parseTokens`의 `indexOf(":root {")`에 걸려 있음) |
| `src/i18n/namespaces/issue.ts` | 녹화 문구 | 신규 키 2개 × 5 로케일: `issue.recording.barLabelTab`, `issue.recording.barLabelScreen` |
| `docs/DESIGN.md` | 디자인 규칙 | §6에 "반전 플로팅 바" 관용구 추가, §2 raw 색 사용처에 바의 red 점 추가, §14 로딩 스피너 항목의 "앱 내 유일한 `animate-pulse`" 문장 갱신 + §8 모션의 reduced-motion 대응 목록에 바 맥박 추가(`motion-reduce:animate-none` 관용) |
| `e2e/GOTCHAS.md` | e2e 함정 | 45행 "로그 탭은 recording/... 에서 비활성"에서 `recording` 제거(drafting/previewing/done은 서브탭 바 자체가 숨겨짐) |

`src/log-viewer/`는 바를 렌더하지 않으므로 복제 사전·토큰 표(`log-viewer/styles.css`)를 건드리지 않는다. `bottomInset` 기본값은 false라 다른 소비처 4곳(트림·LogInsert·LogPreview·log-viewer)은 무변경이다.

## 데이터 흐름

```
phase === "recording"  (editor-store, 기존)
   │
   ├─ DebugTab
   │    ├─ logTabsLocked = unsupported           → 콘솔·네트워크 트리거 활성
   │    ├─ 3종 sync interval (sub === issue || recording) → 배지 실시간
   │    └─ effect: hideSubTabs → setSub("issue") → drafting 진입 시 issue로 복귀
   │
   └─ Console/NetworkSubTab (active일 때 자기 레코더 sync — 기존)
        ├─ footer 버튼 disabled
        ├─ LogContent bottomInset → 목록 끝 pb-6
        └─ RecordingFloatingBar
             ├─ useEditorStore(recordingSource) → 라벨 tab/screen
             ├─ useRecordingElapsed()            → "0:45 / 2:00"
             ├─ useResolvedDark()                → 스코프 클래스 dark ? "light" : "dark"
             ├─ [취소]      → videoRecorder.cancelRecording() → phase idle (sub 유지)
             └─ [녹화 완료] → videoRecorder.stopRecording()   → flush(3종 sync+settle, 기존) → phase drafting → sub issue
```

스토리지·메시지·타입 영속은 변하지 않는다. `sub`는 기존처럼 `DebugTab` 로컬 상태다.

## 인터페이스 설계

```ts
// src/sidepanel/hooks/useResolvedDark.ts
export function useResolvedDark(): boolean;

// src/sidepanel/hooks/useRecordingElapsed.ts
export function useRecordingElapsed(): { elapsedSec: number; maxSec: number };

// src/sidepanel/components/RecordingFloatingBar.tsx
export function RecordingFloatingBar(): JSX.Element;

// ConsoleLogContentProps / NetworkLogContentProps
bottomInset?: boolean;
```

`RecordingFloatingBar` 마크업(치수는 계약이다. 아래 "높이 관계" 참조):

```tsx
<div
  data-testid="recording-bar"
  role="region"
  aria-label={t("issue.recording.progressLabel")}
  className={cn(
    dark ? "light" : "dark",
    "absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-xl p-4",
    "bg-background/80 text-foreground shadow-lg ring-1 ring-border backdrop-blur-md",
  )}
>
  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
  <span className="min-w-0 truncate text-sm font-medium">{t(labelKey)}</span>
  <span className="shrink-0 text-sm tabular-nums">{`${formatMmSs(elapsedSec)} / ${formatMmSs(maxSec)}`}</span>
  <div className="ml-auto flex shrink-0 gap-2">
    <Button variant="ghost" onClick={() => videoRecorder.cancelRecording()} data-testid="recording-bar-cancel">{t("common.cancel")}</Button>
    <Button onClick={() => videoRecorder.stopRecording()} data-testid="recording-bar-stop">{t("issue.recording.stop")}</Button>
  </div>
</div>
```

- 버튼은 기본 size(`h-9`)를 쓴다. 바 높이 = `p-4`×2 + 36 = **68px**로 `PageFooter`(`p-4` + `h-9` + `border-t` ≈ 69px)와 같다.
- 시간 텍스트는 aria-live를 걸지 않는다. 500ms마다 바뀌어서 스크린리더가 계속 읽어버린다.

i18n 값:

| 키 | ko | en | fr | es | de |
|---|---|---|---|---|---|
| `issue.recording.barLabelTab` | 탭 녹화 중 | Recording tab | Enregistrement de l’onglet | Grabando pestaña | Tab-Aufnahme |
| `issue.recording.barLabelScreen` | 화면 녹화 중 | Recording screen | Enregistrement de l’écran | Grabando pantalla | Bildschirmaufnahme |

기존 `titleTab`/`titleScreen`에서 `{time}`만 뗀 값이다. 기존 키는 `RecordingState`가 계속 쓴다.

## 기존 패턴 준수

- **반전 스코프 메커니즘**: `.dark { --… }`는 일반 클래스 셀렉터라 하위 요소에 걸면 그 트리의 토큰이 다크 값으로 재선언된다. `.light, :root`도 같은 방식으로 라이트 값을 재선언한다. 상속값보다 요소 자신에게 선언된 값이 이긴다.
- **반전 스코프 안에서 `dark:` variant 금지**: Tailwind class 전략은 *어떤* 조상이든 `.dark`면 매칭된다. 그래서 앱이 다크일 때 `.light` 스코프 안에서도 `dark:`가 켜진다. 바는 `dark:` 클래스를 쓰지 않는다(`button.tsx`도 0건). 빨간 점은 `dark:` 짝 없는 `bg-red-500` 하나만 쓴다.
- **muted 표면 위 hover 무효 함정(DESIGN §2)**: 바 표면은 `bg-secondary`가 아니라 `bg-background`다. 그래야 ghost 버튼의 `hover:bg-accent`가 산다.
- **Elevation**: `shadow-lg`·`rounded-xl`은 토스트와 같은 3단계(DESIGN §6). **Z-index**: 로컬 겹침 `z-10`(DESIGN §7).
- **i18n**: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 돌린다. 5개 로케일을 한 번에 추가한다. log-viewer 사전은 무관하다.
- **경로 표기**: `sidepanel`은 `@/` 유지가 지역 관례다(`@/sidepanel/video-recorder`, `@/sidepanel/lib/logRow`).
- **shadcn 우선**: Button은 기존 variant만 쓴다. 바 자체는 shadcn 대응 컴포넌트가 없는 레이아웃 컨테이너다.
- **테스트 2트랙**: 훅·컴포넌트는 `*.test.tsx`(jsdom). `setup-dom`에 `matchMedia`가 없으니 테스트에서 stub한다.

## 대안 검토

1. **footer를 바로 갈아 끼우기(오버레이 없음)** — 레이아웃은 단순하다. 하지만 바가 떠 있는 표면이 아니라 footer 교체로 읽혀 위계가 약해지고, 녹화가 끝나면 footer가 튀어 바뀐다. 사용자가 오버레이를 택했다.
2. **`RecordingState` 안에 최신 로그 미니 피드** — 로그 뷰를 하나 더 만들어야 하고, 필터나 상세가 필요해지는 순간 기존 탭과 똑같아진다.
3. **raw 색 고정 다크 바(`bg-zinc-900/80` 등)** — 앱이 다크면 배경과 묻히고, 버튼 variant를 바 전용으로 직접 스타일링해야 한다(shadcn 우선 원칙 위반).
4. **`.inverse` 토큰 블록 복제** — 토큰 표가 네 벌로 늘어나고 `tokens.test.ts` 대조 대상이 하나 더 생긴다. 셀렉터 리스트 확장이 토큰 0줄 추가로 같은 효과를 낸다.
5. **바를 `DebugTab`에서 단일 마운트** — 위치 기준을 TabsContent로 잡아야 하고, footer disabled는 어차피 각 서브탭이 들고 있다. 서브탭 소유가 응집도가 높다.

## 위험 요소

- **최소 폭 넘침(미해결, 수동 확인 필요)**: 라벨을 0까지 줄여도 `점 + "0:45 / 2:00" + [Cancel] + [Stop recording]`이 바 안쪽 폭(패널 폭 − 24 − 32)을 넘을 수 있다. 추정치로 en ≈ 290px, fr("Annuler" + "Arrêter l’enregistrement") ≈ 380px이고, 320px 패널의 가용 폭은 264px다. 구현 후 최소 폭에서 5개 로케일을 실측한다. 넘치면 2단계 축소 규칙(예: `/ 2:00` 숨김, 버튼 라벨 축약)을 **사용자 결정**으로 추가한다. 이번 설계는 사용자가 고른 "라벨만 말줄임"까지만 담는다.
- **높이 관계 불변식**: 바 윗변 = 12 + 68 = 바닥에서 80px, footer 윗변 ≈ 69px라 로그 영역을 **11px 의도적으로 겹친다**. `pb-6`(24px) = 겹침 11px + 여유 12px(+1). 바 패딩·버튼 size·inset·`PageFooter` 패딩 중 하나라도 바꾸면 `bottomInset` 값을 다시 계산한다.
- **`.light, :root` 순서 의존**: `src/test/cssContrast.ts:parseTokens`가 `indexOf(":root {")`로 블록을 찾는다. `:root, .light {`로 쓰면 `tokens.test.ts`·`muted-surface-contrast.test.ts`가 "블록이 없다"로 red가 난다. 주석과 테스트(Task 7)로 고정한다.
- **반전 스코프 안 `dark:` 누출**: 나중에 바에 `dark:` 클래스를 추가하면 앱 다크 + 바 라이트 조합에서 다크 스타일이 켜진다. 타입·테스트로 못 잡으므로 DESIGN.md 규칙과 컴포넌트 상단 한 줄 주석에 의존한다.
- **이중 sync**: 녹화 중 콘솔 서브탭에 있으면 `DebugTab`의 3종 폴링과 `ConsoleSubTab`의 콘솔 폴링이 함께 돈다. 레코더 sync는 id dedup 머지라 결과는 같고 비용만 1.5s당 메시지 1건 늘어난다. 수용한다.
- **녹화 정지 경로**: 정지는 기존 flush(3종 sync + settle, `picker-control.ts` 녹화 정지 경로)를 그대로 타므로 서브탭 위치와 무관하게 로그 꼬리가 보존된다. 새 경로를 만들지 않는다.
- **e2e 불가**: 실 녹화(tabCapture/getDisplayMedia)는 headed 자동화에서 불안정하다고 문서화돼 있다(`e2e/capture.spec.ts` 주석). 그래서 phase="recording" 진입을 e2e로 못 만든다. jsdom 테스트와 수동 체크리스트가 그물이다.
- **`hideSubTabs` effect 범위**: drafting/previewing/done 진입 경로가 지금은 전부 issue 서브탭이라 기존엔 무해했다. 이번에 녹화 완료가 콘솔·네트워크 서브탭에서도 일어나게 되면서 불변식이 필요해졌다. effect는 idle 전이(취소)에선 동작하지 않아야 한다(S2).
