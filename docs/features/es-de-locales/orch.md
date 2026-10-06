# es/de 로케일 오케스트레이션

계획 원본: [tasks.md](./tasks.md). 별도 PRD/design 없음(기존 fr 추가 구조 재사용).

## 착수·결정

- 시작 dev: `3f0d44a377c0ece19fcdd6f4f40621d4b60df348`, 미커밋 변경 없음.
- 사용자 요청: 스페인어·독일어 i18n을 orch로 진행, 원어민 검수 없음.
- 모델 합의: 구현 sol high, 리뷰 astra medium. astra high는 비용 사유로 제외. 다른 모델/effort를 임의로 추가하지 않는다.
- 구현은 두 언어를 한 워커가 담당한다. 사전 파일이 겹치므로 언어별 병렬 분할을 하지 않는다.
- 종착점: 사용자 제공 AGENTS.md에 따라 로컬 dev 통합·커밋 후 Claude Code `/push` 인계. 원격 CI는 이 세션에서 완료 주장하지 않는다.

## 배치·소유권

| 배치 | 소유 범위 | 선행 | 모델 / effort | 게이트 | 상태 |
|---|---|---|---|---|---|
| 구현 | src/i18n, src/log-viewer/i18n.ts, public/_locales, localeLabels/aiLanguage, 관련 unit/e2e, 가이드·README 등 지원 언어 안내 | 계획 커밋 | gpt-6-sol / high — 기존 패턴의 번역·등록 | TDD, typecheck, 전체 test, mirror check, 관련 e2e | 완료 |
| 독립 리뷰 | 구현 diff 읽기, .scratch 리뷰 보고만 | 구현 완료 | gpt-6-astra / medium — 누락·회귀 검증, 사용자 비용 제한 | 계획·증거 대조, 미해소 red/yellow 판정 | 재리뷰 완료, 기존 3건 해소·신규 0건 |
| 수정 | 리뷰 지적의 구현 소유 파일 | 리뷰 결과 | gpt-6-sol / high | 변경 범위 검증 및 필수 게이트 | 1라운드 완료 |
| 통합 | cherry-pick, tasks/orch 상태·문서 신선도 | 리뷰 통과 | 지휘자 | typecheck, 전체 test, mirror check | 로컬 dev 통합·게이트 완료 |

## 겹침·순서

| 작업 쌍 | 겹침 | 운영 |
|---|---|---|
| es / de 구현 | namespaces 전체·레지스트리·로그 뷰어·테스트 | 구현 한 배치 |
| 구현 / 리뷰 | 같은 diff, 리뷰는 읽기 전용 | 직렬 |
| 구현 / 지휘자 | 계획 상태·공통 문서 | 지휘자는 배치 코드 수정 금지, 구현 종료 후 문서 통합 |

## 실행 기록

- 계획 커밋: `266903e8`.
- Orca Run: `run_641efb0b48d5`, 구현 Task: `task_bef729a635da`.
- 구현 worktree: `/Users/sinhyeokkang/orca/workspaces/bugshot-2/es-de-locales`, 시작 HEAD `266903e8`, 시작 상태 clean 확인.
- 최초 Dispatch `ctx_5c33af04e509`는 Codex CLI 업데이트 안내에서 task 전달 전 실패. 업데이트를 건너뛰고 동일 sol/high 프로세스를 재사용했다(설치·권한 변경 없음).
- 활성 Dispatch: `ctx_5321c45c9d2d`, terminal `term_4be190ca-0e55-4a6f-a718-1841ff7e36ac`. 모델/effort는 최초 launch.effective에서 `gpt-6-sol`/`high` 확인. 재사용 작업의 turn_started 확인.
- 구현 완료: `ed13ff7d`(test red) → `ac217a75`(구현) → `032314e5`(좁은 패널 문구) → `919c1c0c`(e2e) → `4931deb7`(문서). 인계 `.scratch/handoff-locales.md`; worker_done 성공 수신 후 구현 terminal release 완료.
- 구현 검증: typecheck/test/sync check/parity/e2e 종료 코드 0. 전체 434파일·8,560테스트 통과·2 skipped; 사전 대칭 21건; 집중 e2e 44건 연속 2회. 400px 패널의 es/de Debug·Integrations·Issue Settings 6화면 확인. 초기 전체 테스트의 Jira OAuth 설정 누락은 `.env.ci`만 복사 후 해결.
- 번역 초안은 Google Translate를 scratch에서 사용한 뒤 sol이 문맥·기술 용어·오류 안내·placeholder·좁은 UI 문구를 보정했다. 배포 코드에 외부 번역 서비스/의존성 추가 없음. 원어민 검수 없음.
- 리뷰 Task `task_119d98a93a37`, Dispatch `ctx_e9c85707b542`, terminal `term_a46ae22b-f84a-48f9-a689-57c69e786194`. 최초 `ctx_67bdc9a2ebea`에서 업데이트 안내로 task 전달 전 실패했으며 같은 astra/medium 프로세스로 복구, turn_started 확인. 리뷰 범위 `266903e8..4931deb7`.
- 1차 리뷰 완료: `.scratch/review-locales.md`. P2 독일어 400px 설정 푸터 버튼 잘림(문서 너비 단언의 사각), P2 독립 로그 뷰어 34키를 검증한다는 설명과 실제 공유키 단언의 불일치, P3 REVIEWED_LOCALES 기준/검사 대상의 문서 오해. 리뷰 terminal release 완료. 수정 브리프 [brief-fix1.md](./brief-fix1.md)로 sol/high에 라우팅.
- 수정 Task `task_2ab711876f96` / Dispatch `ctx_e3e88c50ba8a`(초기 `ctx_e49d7e26fc19`의 업데이트 안내를 동일 프로세스로 복구). `bb1a428f` → `f77c9277` → `3b435b13` → `9896ec39` → `7a5092bf`. 독일어 footer를 `Kontakt`/`Bewerten`으로 축약; 버튼/텍스트와 클리핑 조상 경계를 재는 e2e 추가. 기존 오른쪽 427px > 400px red 확인. 독립 뷰어 3키 표본의 실제 출력과 영어/raw-key 변이 2건 red 확인; 34키 전량 렌더 검증이라는 과장 제거. 고유명사 문서 정정 및 회고 추가.
- 수정 게이트 모두 exit 0: typecheck, 전체 434파일·8,560테스트(2 skipped), 대칭 21건, mirror, postmortem check/report. 수정 대상 e2e 40건 2회 통과. 중간 변이 복원 누락으로 1회 실패한 뒤 원본 복원·재빌드·연속 통과 확인; 최종 log-viewer 사전에 변이 diff 없음. 수정 worker release 완료.
- 재리뷰 Task `task_5c4612764825` / Dispatch `ctx_5796ded5ed84`(초기 `ctx_cc8398ca1342`의 업데이트 안내를 동일 astra/medium 프로세스로 복구). 범위 `4931deb7..7a5092bf` 6파일. 기존 3건 해소·신규 차단/권장/사소 발견 0, es/de 400px footer 이미지 직접 확인. `.scratch/review-fix1.md` 보고 후 reviewer release 완료.
- dev 통합: 구현·수정 10커밋 모두 cherry-pick, 마지막 통합 해시 `904ca878`. 통합된 production/test/문서 내용은 워커 최종 HEAD와 동일. 통합 후 `pnpm typecheck`, `pnpm test`, `pnpm sync:agents:check` 각각 exit 0. 전체 434파일·8,560테스트 통과, 2 skipped. 배포 build/push/CI 실행 없음.
- 원어민 검수 없이 자동 검증과 코드 리뷰만 수행했다. 레이아웃 확인 범위는 400px의 es/de Debug·Integrations·Issue Settings이며 전 화면·다른 폭·테마 전체를 승인한 것은 아니다.
- 삭제 전 tracked 수정 0 및 `git cherry dev SinhyeokKang/es-de-locales`의 `+` 0 확인. 모든 워커 terminal release 후 Orca worktree·작업 브랜치 제거 완료(`git worktree list`는 원래 dev만, 작업 브랜치 조회 0). 인계·리뷰·로그·수정 후 이미지는 `/var/folders/3q/sr52cksn1ps_1q74ppwr3kjm0000gn/T/bugshot-es-de-evidence-5xnvdp_7/worker/`에 보관했고 통합 게이트 로그는 같은 상위 폴더에 보관했다. 장기 결론은 이 문서에 기록했다.

## 잔여

- 코드 구현·리뷰·로컬 통합 완료. 원격 완료/배포 완료로 표시하지 않는다.
- `guide/{ko,en}/assets/settings-general-1.jpg` 두 장은 언어 선택 목록이 오래됨. 구현 워커는 촬영 스킬의 특권 확장 런타임 부재를 보고했다. 테스트 화면 캡처는 가이드 규격 대체물이 아니다.
- 원어민 검수 제외(사용자 결정). push 및 원격 CI는 Claude Code 인계 대상.

## 후속 push 허가

- 사용자가 `/push` 요청 후 "걍 해 허가할게"로 이번 Codex 세션의 원격 push를 명시 허가했다. 위 로컬 종착점 결정은 최초 구현 작업 기록이며, 이번 push에는 사용자 추가 지시가 우선한다.
- `source-command-push`로 dev 상태·upstream·문서 신선도·미러를 점검했다. CLAUDE.md의 복제 사전 목록에 es/de를 추가하고 AGENTS.md를 생성해 함께 커밋했다.
- 가이드 이미지 두 장은 기존 잔여로 유지한다. push 이후 CI는 `/push` 규칙대로 해당 HEAD의 run URL만 안내하며 완료를 기다리지 않는다. merge·deploy는 허가 범위에 없다.
