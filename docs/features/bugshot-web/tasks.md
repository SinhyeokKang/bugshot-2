# bugshot-web — 구현 태스크

## 선행 조건

- [ ] GitHub에 `bugshot-web` 레포지토리 생성
- [ ] Node.js 18+ / pnpm 설치 확인
- [ ] Vercel 계정 + 프로젝트 연결 (배포 단계에서)
- [ ] 플레이스홀더 목업 이미지 방향 결정 (단색 배경 + 아이콘 / 실제 스크린샷 / AI 생성)

## 태스크

### Task 1: 프로젝트 초기화

- **작업 내용**:
  - `/Users/sinhyeok/code/bugshot-web/` 디렉터리에서 진행
  - `npx create-next-app@latest` 실행 (TypeScript, Tailwind, App Router, src/ 디렉터리, ESLint)
  - `output: 'export'` 설정 (`next.config.ts`)
  - shadcn/ui 초기화 (`npx shadcn@latest init`, style: `new-york`, base color: `slate`)
  - Pretendard + Inter 폰트 설정
  - git init + GitHub remote 연결
- **검증**:
  - [ ] `pnpm dev`로 로컬 서버 기동 확인
  - [ ] `pnpm build`로 `out/` 정적 파일 생성 확인
  - [ ] Tailwind 클래스가 정상 적용되는 빈 페이지 확인

### Task 2: 공통 레이아웃 + 상수

- **변경 대상**: `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/constants.ts`
- **작업 내용**:
  - RootLayout: html lang 설정, 폰트, 메타데이터(title/description/OG/Twitter/JSON-LD)
  - globals.css: Tailwind directives + shadcn CSS 변수 (dark mode는 스코프 외, light only)
  - constants.ts: 웹스토어 URL, GitHub URL, Privacy Policy URL
- **검증**:
  - [ ] `<head>`에 OG 메타 태그·JSON-LD 정상 삽입 (빌드 후 `out/index.html` 확인)
  - [ ] 폰트 로딩 정상 (DevTools Network 탭)

### Task 3: Header 컴포넌트

- **변경 대상**: `src/components/Header.tsx`
- **작업 내용**:
  - sticky 헤더 (scroll 시 backdrop-blur + border-bottom)
  - 좌: Bugshot 로고 (SVG 또는 텍스트)
  - 우: "Add to Chrome" Button (shadcn Button, 웹스토어 링크)
  - 모바일 반응형 (로고 + CTA만)
- **검증**:
  - [ ] 스크롤 시 sticky 동작 + blur 효과 확인
  - [ ] CTA 클릭 시 웹스토어 URL로 이동 (새 탭)
  - [ ] 모바일 뷰포트에서 레이아웃 정상

### Task 4: Hero 섹션

- **변경 대상**: `src/components/Hero.tsx`
- **작업 내용**:
  - 2-column 레이아웃 (lg:grid-cols-2, 모바일은 stacked)
  - 좌: h1 헤드라인 + p 서브카피 + CTA Button + 부가 텍스트
  - 우: 제품 목업 이미지 (next/image, priority, placeholder 이미지)
- **검증**:
  - [ ] 데스크톱: 좌우 2-column
  - [ ] 모바일: 이미지 아래로 stacked
  - [ ] CTA 버튼 클릭 → 웹스토어
  - [ ] Lighthouse Performance 영향 없음 (이미지 LCP 최적화)

### Task 5: FeatureCards 섹션

- **변경 대상**: `src/components/FeatureCards.tsx`
- **작업 내용**:
  - 2×2 그리드 (lg:grid-cols-2, 모바일은 1-column)
  - shadcn Card 컴포넌트 사용
  - 4개 카드: Pick & Edit CSS / Capture Everything / Auto-Collect Logs / AI-Powered Drafts
  - 각 카드: 목업 이미지 (aspect-video placeholder) + 제목 + 2-3문장 설명
- **검증**:
  - [ ] 4개 카드 정상 렌더링
  - [ ] 이미지 플레이스홀더 자연스러움 (배경색 + 텍스트)
  - [ ] 모바일 1-column 스택

### Task 6: HowItWorks 섹션

- **변경 대상**: `src/components/HowItWorks.tsx`
- **작업 내용**:
  - 4-step 가로 플로우 (lg:) / 세로 (모바일)
  - 각 스텝: 번호 Badge + lucide 아이콘 + 제목 + 한 줄 설명
  - 스텝 간 연결선 (border-dashed)
  - Pick → Edit → Capture → File
- **검증**:
  - [ ] 데스크톱: 4개 스텝 가로 배치 + 연결선
  - [ ] 모바일: 세로 배치
  - [ ] 아이콘·뱃지 정상 렌더링

### Task 7: Integrations 섹션

- **변경 대상**: `src/components/Integrations.tsx`
- **작업 내용**:
  - 4개 플랫폼 로고 가로 정렬 (flex, gap)
  - Jira / GitHub / Linear / Notion
  - 각 로고 아래 한 줄 설명
  - 로고: `@icons-pack/react-simple-icons` 또는 SVG 직접 배치
- **검증**:
  - [ ] 4개 로고 정상 표시
  - [ ] 모바일에서 2×2 또는 세로 스택

### Task 8: BottomCta + Footer

- **변경 대상**: `src/components/BottomCta.tsx`, `src/components/Footer.tsx`
- **작업 내용**:
  - BottomCta: 배경 대비 섹션 + 헤드라인 + CTA Button
  - Footer: 3-column 링크 (Product / Legal / Source) + 저작권
- **검증**:
  - [ ] CTA 클릭 → 웹스토어
  - [ ] Privacy Policy 링크 정상 (GitHub Pages)
  - [ ] 모바일 레이아웃

### Task 9: 페이지 조립 + 전체 스타일 정리

- **변경 대상**: `src/app/page.tsx`
- **작업 내용**:
  - 모든 섹션 컴포넌트를 순서대로 조합
  - 섹션 간 간격 통일 (py-16 lg:py-24 등)
  - max-w-screen-xl mx-auto 컨테이너 일관성
  - 스크롤 flow 자연스러운지 전체 확인
- **검증**:
  - [ ] 전체 스크롤 플로우 자연스러움
  - [ ] 섹션 간 간격·정렬 일관
  - [ ] 데스크톱·모바일 양쪽에서 전체 확인

### Task 10: SEO + OG + 파비콘

- **변경 대상**: `src/app/layout.tsx`, `public/`
- **작업 내용**:
  - OG 이미지 (1200×630) 플레이스홀더 배치
  - favicon.ico 배치 (Bugshot 로고 기반)
  - JSON-LD SoftwareApplication 스키마 삽입
  - robots.txt, sitemap.xml (next-sitemap 또는 수동)
- **검증**:
  - [ ] 빌드 후 `out/index.html`에 OG·JSON-LD 태그 정상
  - [ ] SNS 공유 시 썸네일 미리보기 (https://opengraph.dev 등으로 확인)
  - [ ] Lighthouse SEO ≥ 90

### Task 11: Vercel 배포

- **작업 내용**:
  - Vercel에 프로젝트 연결 (`vercel link`)
  - 빌드 설정 확인 (Framework: Next.js, Output: Static)
  - 초기 배포 → `.vercel.app` 도메인으로 확인
  - 커스텀 도메인 연결 (DNS 설정)
- **검증**:
  - [ ] `.vercel.app` URL 접속 가능
  - [ ] 커스텀 도메인 접속 가능 (HTTPS)
  - [ ] Lighthouse Performance ≥ 90, SEO ≥ 90

## 테스트 계획

- **단위 테스트**: 정적 랜딩 사이트이므로 별도 로직 없음. 테스트 스코프 외.
- **수동 테스트**:
  - [ ] Chrome 데스크톱 (1440px, 1024px)
  - [ ] Chrome 모바일 (375px, 414px)
  - [ ] Safari 모바일 (iOS)
  - [ ] CTA → 웹스토어 이동 정상
  - [ ] 외부 링크 (Privacy Policy, GitHub) 정상
  - [ ] Lighthouse 전 카테고리 ≥ 90
  - [ ] OG 메타 공유 미리보기

## 구현 순서 권장

```
Task 1 (프로젝트 초기화)
  ↓
Task 2 (레이아웃 + 상수)
  ↓
Task 3~8 (섹션 컴포넌트) — 병렬 가능하나, 순차 권장 (스크롤 flow 확인)
  ↓
Task 9 (조립 + 스타일 정리)
  ↓
Task 10 (SEO)
  ↓
Task 11 (배포)
```

Task 3~8은 독립적이라 병렬 가능하지만, 전체 시각적 흐름을 확인하며 순차적으로 진행하는 게 자연스럽다.
