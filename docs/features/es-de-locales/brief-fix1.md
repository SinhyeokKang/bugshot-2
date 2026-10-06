# Review fixes, round 1

Model is user-selected gpt-6-sol/high. Do not spawn additional agents. Work in the existing implementation worktree and read `.scratch/review-locales.md` and `.scratch/handoff-locales.md`. Follow the existing implementation brief constraints; no remote writes, release builds, unrelated refactors or translation polishing. Coordinator owns orch.md/task status and will independently review your fixes with astra/medium.

Fix all three review findings surgically:

1. German settings footer clips at 400px. Add a deterministic e2e assertion on the contact/review buttons and their text bounds relative to the panel/clipping ancestor; observe red on the existing long labels. Shorten the German labels (prefer dictionary-only change), then verify green and inspect both es/de 400px screenshots. Merely checking document scrollWidth does not catch clipped children.
2. Add real es/de rendered-output assertions for representative standalone-only log-viewer strings (report tab, report environment heading, timeline search or another timeline-only label), with literal expected values. Demonstrate the tests reject an English/raw-key replacement of a standalone value, restoring mutations afterward. Coverage prose must state the actual representative coverage rather than claim all 34 standalone keys have rendered-output tests.
3. Correct ARCHITECTURE.md: REVIEWED_LOCALES ko/en are trusted reference dictionaries; fr/es/de are already checked against that reference. Preserve REVIEWED_LOCALES and tests. Human/native-speaker review was explicitly excluded.

Read `/postmortem` and add a concise relevant entry for the clipping that escaped document-width checks (only if its nontrivial-trap filter applies). Do not expand into other audit work. No need to repeat unchanged translation generation or dependencies install (node_modules already present). Dummy .env.local from .env.ci is already present; never copy real secrets.

Gates: meaningful red→green for the fixes, pnpm typecheck, full pnpm test, pnpm sync:agents:check, mandatory i18n/log-viewer parity test, focused changed e2e followed by one repeat on final source. build:e2e only inside e2e-write. Record actual exit codes without piping away failure. Commit tests first where possible, implementation and documentation separately with Codex trailer. After final checks, stop modifying source; avoid needless repeated builds.

Write `.scratch/handoff-fix1.md` with commit hashes, evidence, exit codes, screenshot paths, and disposition of each finding. Guide screenshots remain a distinct acknowledged remainder; do not claim they were updated. Read coordinator mail and send worker_done once with truthful outcome/report path, then idle.
