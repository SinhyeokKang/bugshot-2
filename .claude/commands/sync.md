---
description: dev를 origin/main으로 hard reset + force push (배포/머지 후 동기화)
---

main에 새 커밋(squash 머지, deploy 버전 범프 등)이 들어간 후 작업 브랜치 `dev`를 main과 같은 상태로 맞춘다. 1인 운영 + dev 단일 브랜치 모델 가정.

## 워크플로우 위치

```
1. dev pull → 작업 (/pull → 코드 → /build)
2. /push
3. /merge — dev → main squash PR
4. (배포 시) main 체크아웃 + git pull → /deploy
5. /sync ← 여기. dev를 main 상태로 fast-forward
```

`/merge` 직후나 `/deploy` 직후 호출하면 됨. main에 새 commit이 없을 땐 안내만 하고 종료.

## 절차

1. **사전 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 있으면 즉시 중단:
     > 미커밋 변경이 있습니다. 커밋하거나 stash한 뒤 다시 실행하세요.
   - `git fetch origin` — 원격 최신 받아옴
   - `git branch --show-current` — 현재 브랜치 기록
   - `git log dev..origin/main --oneline` — main에 dev로 가져올 새 커밋 목록
   - `git log origin/main..dev --oneline` — dev에만 있는 커밋 목록 (있으면 hard reset으로 사라짐)

2. **변경 분석.**
   - main에 새 커밋이 0개면 "이미 동기화됨" 알리고 종료.
   - dev에만 있는 커밋이 있으면 그 목록을 보여주고 **내용 유실 여부를 직접 검증**한다: `git diff origin/main dev`가 비어있거나, dev 전용 커밋이 전부 squash 머지로 main에 반영된 내용이면(직전 `/merge` PR과 대조) 안전 — **별도 승인 없이 바로 진행**.
   - 검증 결과 main에 없는 실제 작업 내용이 dev에 있으면 그때만 중단하고 사용자에게 알린다.

3. **동기화 실행**
   ```
   git checkout dev          # 이미 dev면 no-op
   git reset --hard origin/main
   git push -f origin dev
   ```
   - 각 단계 결과 짧게 보고.

4. **완료 보고.**
   - `git log -1 --oneline` — dev HEAD 확인
   - 한 줄 요약: "dev → origin/main 동기화 완료 (HEAD: <sha> <subject>)"

## 금지 사항

- 미커밋 변경이 있으면 절대 진행하지 않는다.
- dev에만 있는 커밋이 main에 반영 안 된 실제 작업 내용을 담고 있으면 진행하지 않는다 (작업 손실 방지). 반영 여부는 diff 검증으로 판단.
- 현재 브랜치가 `main`이면 즉시 중단 (main을 reset할 위험).
- 다른 사람이 푸시한 dev 변경(다른 머신/협업)이 있을 가능성 점검: `git log origin/dev..dev` / `git log dev..origin/dev`로 차이 확인 후 진행.
