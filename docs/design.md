# Design Guide

BugShot-2의 UI 스택과 톤앤매너. 구현 시 시각 의사결정의 근거로 삼는다.

## UI 스택

| 항목 | 선택 |
|---|---|
| Framework | React 18 + TypeScript |
| 스타일 | Tailwind CSS v3 (CSS variables 기반) |
| 컴포넌트 | shadcn/ui — style `new-york`, base color `slate` |
| 아이콘 | Lucide (thin-line) |
| 폰트 | 시스템 산세리프 (Inter 계열 fallback) |

설정 파일:
- `tailwind.config.js` — shadcn CSS variables 연동
- `components.json` — shadcn CLI 설정
- `src/styles/globals.css` — CSS variables (light/dark 정의)

## 톤앤매너

### 분위기
- **미니멀 / 제품성(product-like) / 차분함**
- 장식 최소화, 콘텐츠와 플로우 우선

### 컬러
- **모노크롬 기조** — 포인트 컬러 없음
- 베이스: 화이트 / 라이트 그레이 (shadcn `slate` 팔레트)
- 텍스트: 진한 블랙
- 시맨틱 컬러(destructive, muted 등)는 shadcn 기본값 그대로

### 타이포그래피
- 산세리프, 굵기 대비로 위계 (볼드/레귤러 조합)
- 한/영 혼용 자연스럽게
- 섹션 헤더: `작은 아이콘 + 볼드 타이틀 + (선택) 카운트 뱃지`

### 레이아웃
- **세로 리듬에 여유를** — 빽빽하게 채우지 않는다
- 카드보다 **헤어라인 디바이더**(`<Separator />`)로 섹션 구분
- Card 컴포넌트를 쓸 때도 border/shadow는 최소화

### 컴포넌트 룩
- **인풋/셀렉트**: 라운드 6–8px, 1px 라이트 그레이 보더, 여유 있는 패딩
- **뱃지**: 알약 형태, 아주 연한 톤 (진행 표시 `2/4`, 섹션 카운트 `1` 등)
- **CTA 계층**:
  - **Primary**: 솔리드 블랙 풀폭
  - **Secondary**: 화이트 + 블랙 보더
  - **Tertiary (취소/닫기)**: 플레인 텍스트 (버튼 박스 없음)
- **이미지 썸네일**: 라운드 코너 + 우상단에 오버레이 액션 아이콘 (편집/삭제)

### 아이콘
- Lucide thin-line, 크기 16px 기본 (헤더 아이콘도 동일 크기로 일관)

### 공간감
- 풍부한 white space — 모든 주요 영역 사이 최소 여백 확보
- 패널 상단/하단 고정 영역(헤더, CTA)은 얇게

### 반응형 (Side Panel 너비)
- **Chrome Side Panel은 사용자가 드래그로 리사이즈 가능 (네이티브 동작)**. 최대 너비를 고정하지 않고, 유동 레이아웃으로 설계한다
- **최소 너비**: `320px` (body `min-width`로 지정). 더 좁으면 가로 스크롤 허용 — 자주 쓰이지 않는 극단 케이스
- **활용 시나리오**: 사용자가 Side Panel을 넓혀 브라우저 페이지 영역을 좁히면 **모바일 뷰포트처럼 페이지가 rendering** → 모바일 디자인 이슈를 그 자리에서 확인 가능
- 레이아웃 원칙:
  - 주요 컨테이너는 `w-full`, 고정 `max-width` 지양
  - 2열 이상 그리드는 **컨테이너 쿼리(`@container`)** 또는 Tailwind breakpoint로 좁아지면 자연스럽게 스택되게
  - 버튼/인풋은 풀폭 기본, 좁은 폭에서 텍스트 자르기(`truncate`) 대신 줄바꿈 허용
- 모바일(터치 디바이스) 자체는 타겟 아님 (Chrome 확장은 데스크톱 전용)

## 참고 스크린

`~/Desktop/butshot-ui/IMG_9619~9622.PNG` — 전 버전 UI 시안.

**주의**: 이 시안의 플로우·기능은 v1 스펙과 다르며 **참고하지 않는다**. 오직 톤앤매너 레퍼런스로만 사용한다. (예: 마법사 단계 분할, GitHub 통합, Record Video, Epic 필드 등은 v1에 포함되지 않음 — PRD §7 참고)
