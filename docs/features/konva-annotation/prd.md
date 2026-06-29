# Konva 스크린샷 주석 오버레이

## 배경

현재 스크린샷 주석은 `markerjs2`(v2.x)에 의존한다. 라이브러리가 박아주는 1세대 툴바 UI가 사이드패널의 shadcn/Tailwind 디자인과 이질적이고 낡았다. 후속작 marker.js 3는 Linkware(백링크 강제) 또는 유료 라이선스라 무료 확장에 부적합하다.

`markerjs2`는 명령형 인스턴스를 ref로 붙드는 구조(`MarkerArea` + `restoreState`)라 React 코드베이스와 정합성이 낮고, `willReadFrequently` 힌트 없이 2d 컨텍스트를 만들어 `main.tsx`에 전역 `getContext` 패치를 강제했다.

헤드리스 캔버스 엔진 **Konva(+react-konva, MIT)**로 교체해 주석 도형은 라이브러리가 렌더·조작하고, 툴바·옵션 UI는 shadcn으로 직접 구성한다. UI 통제력을 확보하고 사이드패널과 일관된 모던 UX를 만든다.

## 목표

- `markerjs2` 의존성을 제거하고 `konva` + `react-konva`로 주석 오버레이를 재구현한다.
- 도구 6종 제공: 화살표, 사각형, 타원, 펜(자유선), 텍스트, 형광펜 + 선택/이동 도구.
- 선택 도형의 이동·리사이즈·회전을 Konva `Transformer`로 제공.
- 스타일 프리셋: 색상 5종(red/yellow/green/blue/black), 두께 3단계(S/M/L), 텍스트 기본 1크기.
- Undo/Redo 제공 (버튼 + `Cmd/Ctrl+Z` · `Cmd/Ctrl+Shift+Z`).
- 툴바·옵션은 shadcn 컴포넌트로 구성해 사이드패널 폭(좁음)에서 자연스럽게 리플로우.
- 기존 외부 계약 유지: `AnnotationOverlay`의 props(`imageUrl`/`onComplete`/`onCancel`) 시그니처, 출력 포맷 `image/webp` 0.92, `screenshotAnnotated` dataURL 저장 흐름.

## 비목표 (Non-goals)

- **주석 개별 객체의 세션 간 재편집**: 완료 시 webp로 flatten해 `screenshotAnnotated`에 저장하는 현재 동작을 유지한다. 재편집 진입 시 base는 평탄화된 이미지(= 기존 markerjs2 동작과 동일). 도형을 JSON으로 영속화하지 않는다 → store 스키마·IndexedDB·마이그레이션 변경 없음.
- 이미지 자체 편집(크롭·필터·회전) — 주석만.
- 터치/모바일 제스처 대응 — 데스크탑 확장 전제.
- 임의색 컬러피커·두께 슬라이더·폰트 크기 선택 등 풀 커스텀 옵션.
- screenshot 이외 캡처 모드(element/video/freeform/replay)로의 주석 진입 확장 — 현행대로 screenshot 모드 한정.
- 도형 복사/붙여넣기, 정렬, 레이어 순서 변경 UI.

## 사용자 시나리오

1. 사용자가 IssueTab에서 "Screenshot"으로 영역을 캡처 → drafting 단계, 미디어 섹션에 스크린샷 표시.
2. 미디어 섹션의 연필 버튼(`draft.addAnnotation`) 클릭 → 주석 오버레이가 사이드패널 위에 뜬다.
3. 상단 툴바에서 도구를 고른다(화살표/박스/타원/펜/텍스트/형광펜).
4. 캔버스에서 드래그해 도형을 그린다. 펜·형광펜은 자유 드로잉. 텍스트는 클릭 후 인라인 입력.
5. 색상(5색)·두께(S/M/L)를 툴바에서 바꾸면 이후 그리는 도형과 현재 선택 도형에 적용된다.
6. 선택 도구로 도형을 클릭하면 Transformer 핸들이 떠 이동·리사이즈·회전, `Delete`/`Backspace`로 삭제.
7. 실수하면 Undo 버튼 또는 `Cmd/Ctrl+Z`, 되돌리면 Redo.
8. "주석 완료"(`annotation.done`) → 캔버스를 자연 해상도 webp로 flatten해 `screenshotAnnotated`에 저장, 오버레이 닫힘. 미디어 미리보기·다운로드·이슈 첨부에 반영.
9. "취소"(`annotation.cancel`) → 변경 폐기, 오버레이 닫힘.
10. 재편집: 연필 버튼 다시 클릭 → 평탄화된 주석 이미지가 base로 로드되어 그 위에 추가 주석. "주석 제거"(`draft.removeAnnotation`, RotateCcw) 버튼은 `screenshotAnnotated`를 null로 되돌려 원본 복귀.

### 엣지 케이스

- 빈 캔버스에서 "완료": 도형이 하나도 없으면 원본과 동일한 이미지가 저장되거나, 변경 없이 닫는다(도형 0개면 onComplete 호출 생략 가능).
- 텍스트 입력 중 빈 문자열 확정: 빈 텍스트 노드는 제거.
- 자연 해상도가 큰 스크린샷: 화면에는 축소 표시(max-height 70vh)하되 export는 `pixelRatio`로 자연 해상도 유지.
- 오버레이 unmount(패널 전환/취소): Konva Stage·이미지·이벤트 정리, 메모리 누수 없음.
- 도형을 캔버스 밖으로 드래그: Stage 경계 클리핑은 Konva 기본 동작에 맡김(export는 Stage 영역만).

## 성공 기준

- 6개 도구로 도형을 그리고, 선택·이동·리사이즈·회전·삭제가 동작한다.
- Undo/Redo가 도형 추가·이동·삭제를 정확히 되돌린다.
- "완료" 결과가 `image/webp`이고 원본 자연 해상도를 유지한다(다운로드 확장자·미리보기·IndexedDB 첨부 모두 기존과 동일하게 동작).
- `package.json`에서 `markerjs2`가 제거되고 `konva`/`react-konva`가 추가된다.
- konva가 메인 사이드패널 청크에 포함되지 않는다(주석 진입 시에만 로드).
- 순수 함수(도형 팩토리, undo/redo 히스토리 리듀서, 프리셋) 단위 테스트가 `pnpm test`에서 통과한다.
- `pnpm typecheck` 통과, i18n ko/en 키 대칭 검사 통과.
