# bugshot-web — 기술 설계

## 개요

Next.js 14 App Router + SSG(`output: 'export'`)로 정적 싱글 페이지를 생성하고, Vercel에 배포한다. Tailwind CSS v3 + shadcn/ui로 스타일링하며, 제품 소개 콘텐츠는 컴포넌트에 직접 작성한다(CMS 없음). 별도 GitHub 레포지토리 `bugshot-web`으로 운영.

## 프로젝트 구조

```
bugshot-web/
├── public/
│   ├── images/           # 목업 이미지·로고·OG 이미지
│   │   ├── hero-mockup.png
│   │   ├── feature-*.png  # 피처 카드별 목업
│   │   ├── logo.svg
│   │   ├── og-image.png   # 1200×630 OG 썸네일
│   │   └── integrations/  # Jira/GitHub/Linear/Notion 로고
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx      # RootLayout — 폰트, 메타, Analytics
│   │   ├── page.tsx        # 랜딩 페이지 (섹션 컴포넌트 조합)
│   │   └── globals.css     # Tailwind directives + CSS 변수
│   ├── components/
│   │   ├── ui/             # shadcn/ui 컴포넌트
│   │   ├── Header.tsx      # sticky 헤더 — 로고 + CTA
│   │   ├── Hero.tsx        # 히어로 — 헤드라인·서브카피·CTA·목업
│   │   ├── FeatureCards.tsx # 기능 카드 4-5개 그리드
│   │   ├── HowItWorks.tsx  # 워크플로우 스텝 시각화
│   │   ├── Integrations.tsx# 플랫폼 로고 + 한 줄 설명
│   │   ├── BottomCta.tsx   # 하단 CTA 배너
│   │   └── Footer.tsx      # 링크·저작권
│   └── lib/
│       └── constants.ts    # 웹스토어 URL, 외부 링크 상수
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .gitignore
```

## 기술 스택 상세

| 영역 | 선택 | 이유 |
|------|------|------|
| Framework | Next.js 14 App Router | SSG + Image Optimization + 메타데이터 API |
| Rendering | `output: 'export'` (정적 내보내기) | Vercel에서 정적 호스팅, CDN 캐시 최대화. `images: { unoptimized: true }` 필수 |
| Styling | Tailwind CSS v3 + shadcn/ui (`new-york` style) | bugshot-2와 동일 컨벤션, Button·Badge 등 재사용 |
| Font | Pretendard | bugshot-2와 동일 |
| Animation | CSS transitions + `@keyframes` | JS 런타임 불필요, Lighthouse 점수 유지 |
| Analytics | Vercel Analytics (opt-in) | 별도 설정 최소화 |
| SEO | Next.js Metadata API + JSON-LD | 정적 생성 시 메타 태그 자동 삽입 |

## 섹션별 설계

### Header

```tsx
// sticky top-0, 스크롤 시 backdrop-blur
// 좌: 로고 (SVG)
// 우: "Add to Chrome" Button (size="xl", 웹스토어 링크)
```

모바일: 로고 + CTA만 유지 (네비 항목 없으므로 햄버거 불필요). 모바일 CTA 텍스트는 "View in Web Store"로 조건부 변경.

### Hero

```tsx
// 2-column (lg:) / 1-column (mobile)
// 좌: 헤드라인 (h1) + 서브카피 (p) + CTA Button (size="xl") + 부가 텍스트 ("Free · No account required")
// 우: 제품 목업 이미지 (next/image, priority)
```

헤드라인 후보: "Bug reporting, built into your browser" / "Report bugs with context, not screenshots alone"

### FeatureCards

```tsx
// 그리드 (lg:grid-cols-2) / 1-column (mobile)
// 5번째 카드는 full-width 또는 센터 정렬
// 각 카드: 목업 이미지 (aspect-video) + 제목 + 설명 (2-3문장)
// shadcn Card 컴포넌트 사용
```

5개 카드:
1. **Pick & Edit CSS** — 요소 선택 + 실시간 편집 + 디자인 토큰 + before/after diff
2. **Capture Everything** — 스크린샷 어노테이션 + 화면 녹화 + 키보드 단축키
3. **Auto-Collect Logs** — 네트워크·콘솔 로그 자동 캡처 + 이슈 첨부
4. **AI-Powered Drafts** — BYOK AI 이슈 초안 + 스타일 제안
5. **One-Click Issue Filing** — Jira/GitHub/Linear/Notion 원클릭 등록 + 메타 동기화

### HowItWorks

```tsx
// 4-step 가로 플로우 (lg:) / 세로 (mobile)
// 각 스텝: 번호 뱃지 + 아이콘 + 제목 + 한 줄 설명
// 스텝 사이 연결선 (border-dashed 또는 SVG)
```

스텝: Detect → Resolve → Capture → Deliver (제품 자동화 관점)
- Detect: DOM 요소를 선택하면 CSS 토큰과 스타일 체인을 실시간 추출
- Resolve: 디자인 토큰을 인식하고 스타일 수정·비교를 자동 생성
- Capture: 스크린샷·녹화·네트워크/콘솔 로그를 자동 수집해 맥락 완성
- Deliver: 플랫폼에 맞는 이슈 포맷을 자동 생성·등록

### Integrations

```tsx
// 4개 플랫폼 로고 가로 정렬
// 각 로고 아래 한 줄 설명 ("OAuth · Auto-upload · Metadata sync" 등)
// 플랫폼: Jira, GitHub, Linear, Notion
```

로고: `@icons-pack/react-simple-icons` (`SiJirasoftware`, `SiGithub`, `SiLinear`, `SiNotion`). bugshot-2와 동일 패턴 (GitHub만 `dark:invert`).

### BottomCta

```tsx
// 배경색 대비 섹션
// 헤드라인 + "Add to Chrome" Button (size="xl", 히어로와 동일 CTA)
```

### Footer

```tsx
// 3-column: Product (Chrome Web Store) | Legal (Privacy Policy) | Source (GitHub)
// 하단: © 2026 Bugshot
```

## 인터페이스 설계

주요 타입은 없음 (정적 콘텐츠 사이트). 상수만 관리:

```typescript
// src/lib/constants.ts
export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig";
export const GITHUB_URL = "https://github.com/sinhyeokkang/bugshot-2";
export const PRIVACY_POLICY_URL =
  "https://sinhyeokkang.github.io/bugshot-2/privacy";
```

## SEO / 메타데이터

```typescript
// src/app/layout.tsx — Next.js Metadata API
export const metadata: Metadata = {
  title: "Bugshot — Bug Reporting Chrome Extension",
  description:
    "Pick elements, edit CSS, capture screenshots & recordings, and file issues to Jira, GitHub, Linear, or Notion — all from a side panel.",
  openGraph: {
    title: "Bugshot — Bug Reporting Chrome Extension",
    description: "...",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};
```

JSON-LD `SoftwareApplication` 스키마로 검색 리치 결과 노출:

```json
{
  "@type": "SoftwareApplication",
  "name": "Bugshot",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Chrome",
  "offers": { "@type": "Offer", "price": "0" }
}
```

## 대안 검토

### Astro 대신 Next.js를 선택한 이유

Astro가 정적 콘텐츠 사이트에 더 가볍지만, Next.js를 선택했다. 실질적 트레이드오프:
- Astro: 제로 JS 번들 가능, 하지만 shadcn/ui 사용 시 결국 React island 필요
- Next.js: Metadata API, Vercel 네이티브 지원이 즉시 사용 가능. 단, `output: 'export'`에서는 On-Demand Image Optimization이 불가하므로 `unoptimized: true` 설정 필수
- 추후 블로그·멀티 페이지 확장 시 Next.js App Router의 파일 기반 라우팅이 자연스러움

번들 크기 차이는 싱글 페이지 + 정적 내보내기에서 무시할 수준.

## 위험 요소

1. **목업 이미지 부재**: 모든 이미지가 플레이스홀더로 시작. 실제 소재 없이 배포하면 전환율이 낮을 수 있으므로, 플레이스홀더가 자연스럽게 보이도록 배경색 + 아이콘 조합의 일러스트 스타일 목업을 고려.
2. **`output: 'export'` 제약**: API Routes, 서버 컴포넌트의 동적 기능 사용 불가. 현재 스코프에서는 문제 없으나, 추후 폼(뉴스레터 등) 추가 시 외부 서비스 필요.
3. **`next/image` 정적 export 제약**: `output: 'export'`에서는 On-Demand Image Optimization이 불가. `next.config.ts`에 `images: { unoptimized: true }` 설정 필수. `next/image`의 lazy loading·레이아웃 안정성(width/height) 이점은 유지.
