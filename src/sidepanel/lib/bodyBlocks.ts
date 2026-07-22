import type { IssueSection, TextSectionId } from "@/store/settings-ui-store";

// 텍스트 본문을 갖는 섹션. bodyBlocks의 section 블록은 구성상 media가 아니므로,
// 소비처가 sectionPlaceholderKey·sectionHelpKey 같은 텍스트 전용 헬퍼를 그대로 쓸 수 있다.
export type TextIssueSection = IssueSection & {
  id: TextSectionId;
  renderAs: "paragraph" | "orderedList";
};

export type BodyBlock =
  | { kind: "section"; section: TextIssueSection }
  // 미디어/스타일 diff + 로그 요약 클러스터. 본문 emit은 데이터 기반이라 캡처가 없으면 비어 있다.
  | { kind: "meta" };

// 이슈 본문의 블록 순서 단일 출처. draft 패널·프리뷰·8개 플랫폼 빌더가 모두 이 결과를
// 순회한다 — 순서 규칙이 소비처마다 복제되면 한 곳만 고쳐도 나머지가 조용히 어긋난다.
export function bodyBlocks(sections: IssueSection[]): BodyBlock[] {
  return sections
    // media는 enabled와 무관하게 항상 포함 — 오염된 enabled:false로 미디어가 소실되지 않게.
    .filter((s) => s.id === "media" || s.enabled)
    .map((s) =>
      s.id === "media"
        ? ({ kind: "meta" } as const)
        : ({ kind: "section", section: s as TextIssueSection } as const),
    );
}
