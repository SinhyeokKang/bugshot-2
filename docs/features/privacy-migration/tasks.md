# Privacy 정책 이관 — 남은 정리 (store 리뷰 통과 후)

> 상태 스냅샷: **2026-07-04** 이관 완료, **Chrome 웹스토어 리뷰 대기 중**.
> 이 문서는 리뷰 통과 뒤 며칠 후 마무리할 잔여 작업 트래커. 완료하면 이 폴더째 삭제.

## 배경 (이미 완료된 것)

privacy 정책을 GitHub Pages(Jekyll) → `bug-shot.com/{ko,en}/privacy`(bugshot-web, 빌드타임 fetch)로 이관.

- `docs/privacy.ko.md`(원본) + `docs/privacy.en.md`(번역) = bugshot-web fetch 소스 (`raw.githubusercontent.com/SinhyeokKang/bugshot-2/main/docs/privacy.{ko,en}.md`)
- `docs/privacy.html` = **임시 리디렉트 스텁**. `github.io/bugshot-2/privacy` → `bug-shot.com/ko/privacy`. 스토어 리뷰 창 동안 old URL 살려두는 용도.
- `.github/workflows/trigger-web-deploy.yml` = privacy 소스 변경 시 Vercel Deploy Hook 자동 호출.
- README·bugshot-web·스토어 대시보드 privacy URL 전부 신규 URL로 갱신 완료.

## 남은 작업 (⚠️ 스토어 승인 확인 후에만)

승인 전에 하면 리뷰 중인 스토어 URL(→ 스텁 경유)이 깨지므로 **반드시 승인 후**.

- [ ] **1. 리디렉트 스텁 제거 (내가 = Claude, main 반영)**
  - `docs/privacy.html` 삭제
  - `docs/DIRECTORY.md`에서 `privacy.html` 스텁 라인 제거
  - 이 폴더(`docs/features/privacy-migration/`) 삭제
  - dev 커밋 → `/merge`로 main (범프 없음, docs/ci-only)
- [ ] **2. GitHub Pages off (사용자, 수동)**
  - repo Settings → Pages → 빌드 소스 해제
  - (참고: Pages가 `docs/` 하위 md 전부 공개 서빙 중이라 끄면 ARCHITECTURE/PERMISSION 등 노출도 같이 정리됨)

## 검증

승인 후 정리하기 전 현재 상태 확인:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" -L https://bug-shot.com/ko/privacy   # 200
curl -sS -o /dev/null -w "%{http_code}\n" -L https://bug-shot.com/en/privacy   # 200
curl -sSL https://sinhyeokkang.github.io/bugshot-2/privacy | grep bug-shot.com # 스텁 리디렉트 확인
```

## 관련 후속 (별건)

- guide 포털(`bug-shot.com/docs`, bugshot-web `docs/features/docs-portal/`) 붙일 때 `.github/workflows/trigger-web-deploy.yml`의 `paths`에 `guide/**` 한 줄 추가 → privacy·guide 공용 훅.
