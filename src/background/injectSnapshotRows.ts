// jira(ADF) 제출 후처리: buildIssueAdf가 만든 styleChanges 텍스트 table들에 업로드된
// before-${i}/after-${i} 이미지 Snapshot 행을 i번째 table = i번째 element 인덱스로 splice한다.
// messages.ts 후처리는 빌더 단위 테스트로 안 잡히므로 순수 함수로 분리해 단위 테스트한다.
// styleChanges table 식별은 헤더 행의 "As is"/"To be"(비-로컬라이즈 리터럴)로 — 로케일 무관·견고.

interface AdfTextNode {
  text?: string;
  content?: AdfTextNode[];
}

function tableHeaderTexts(node: unknown): string[] {
  const firstRow = (node as { content?: AdfTextNode[] })?.content?.[0];
  if (!firstRow?.content) return [];
  return firstRow.content.map(
    (cell) => cell?.content?.[0]?.content?.[0]?.text ?? "",
  );
}

// "As is"/"To be" 헤더로 styleChanges table 식별 — 로케일 무관. 안전 전제: markdownToAdf의
// convertTokens가 table 토큰을 ADF 노드로 변환하지 않아(파서 룰은 켜져 있어도) 사용자 본문은
// type:"table" 노드를 만들지 못한다 → 동일 헤더의 user table 오탐 불가. markdownToAdf에 table
// 변환을 추가하면 user table이 오탐될 수 있으니 그때 식별을 강화할 것.
export function isStyleChangesTable(node: unknown): boolean {
  if ((node as { type?: string })?.type !== "table") return false;
  const headers = tableHeaderTexts(node);
  return headers.includes("As is") && headers.includes("To be");
}

// content의 styleChanges table을 순서대로 순회하며 i번째 table에 i번째 before-${i}/after-${i}
// Snapshot 행을 index 1에 splice. 파일 lookup·snapshotRow 생성은 호출부 주입(순수 유지).
export function injectSnapshotRows<T>(
  content: unknown[],
  getFile: (name: string) => T | undefined,
  makeSnapshotRow: (before: T | undefined, after: T | undefined) => unknown,
): void {
  let elementIndex = 0;
  for (let idx = 0; idx < content.length; idx++) {
    if (!isStyleChangesTable(content[idx])) continue;
    const before = getFile(`before-${elementIndex}.webp`);
    const after = getFile(`after-${elementIndex}.webp`);
    if (before || after) {
      const tbl = JSON.parse(JSON.stringify(content[idx])) as { content: unknown[] };
      tbl.content.splice(1, 0, makeSnapshotRow(before, after));
      content[idx] = tbl;
    }
    elementIndex++;
  }
}
