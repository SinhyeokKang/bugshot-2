import type { ViewportRect } from "@/types/picker";

export const CONTEXT_MAX_VIEWPORT_RATIO = 0.4;

// 떠 있는 UI — 시맨틱 속성만으로 확정된다.
const OVERLAY_SELECTOR =
  'dialog,[popover],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

// 일반 페이지의 강한 구조 단위. 후보여도 산술 게이트와 after 재검증을 거친다.
// form과 fieldset은 뺐다 — fieldset은 form의 한 섹션이라 결제·주소 입력 묶음을
// 통째로 캡처에 끌어들인다(같은 사유, 같은 노출 면적).
const STRUCTURE_SELECTOR =
  "tr,li,article,figure," +
  '[role="row"],[role="listitem"],[role="tabpanel"],' +
  '[role="option"],[role="menuitem"],[role="treeitem"],[role="alert"],[role="status"]';

const CONTEXT_SELECTOR = `${OVERLAY_SELECTOR},${STRUCTURE_SELECTOR}`;

// 최근접 우선 — 모달 안 테이블 셀이면 다이얼로그가 아니라 <tr>.
// 요소 자신은 후보에서 제외한다(확장 실익 0).
export function findContextAncestor(el: Element): Element | null {
  return el.parentElement?.closest(CONTEXT_SELECTOR) ?? null;
}

function containsRect(outer: ViewportRect, inner: ViewportRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// 컨테이너 전체를 보여줄 수 있을 때만 컨테이너를 보여준다 — 클램프하지 않는다.
export function passesContextGates(
  elementRect: ViewportRect,
  contextRect: ViewportRect,
  viewport: { width: number; height: number },
): boolean {
  const vpArea = viewport.width * viewport.height;
  if (vpArea <= 0) return false;
  // G1
  if (
    contextRect.x < 0 ||
    contextRect.y < 0 ||
    contextRect.x + contextRect.width > viewport.width ||
    contextRect.y + contextRect.height > viewport.height
  ) {
    return false;
  }
  // G2: 요소 rect가 0×0(display:none·detach)이면 기하 포함 검사가 무의미하므로 생략하고,
  // 호출부가 ancestor.contains(el)로 대체 검증한다.
  const elHidden = elementRect.width === 0 && elementRect.height === 0;
  if (!elHidden && !containsRect(contextRect, elementRect)) return false;
  // G3
  return (
    contextRect.width * contextRect.height <= vpArea * CONTEXT_MAX_VIEWPORT_RATIO
  );
}

// after 재검증. DOM 조회·rect 측정은 호출부(picker.ts)가 하고 판정만 여기서 한다.
export function resolveContextRect(args: {
  saved: string | null;
  found: Element | null;
  target: Element;
  contextRect: ViewportRect | null;
  elementRect: ViewportRect;
  viewport: { width: number; height: number };
}): { rect: ViewportRect; contextSelector: string | null } {
  const { saved, found, target, contextRect, elementRect, viewport } = args;
  const fallback = { rect: elementRect, contextSelector: null };
  if (!saved || !found || !contextRect) return fallback;
  if (!found.contains(target)) return fallback;
  if (!passesContextGates(elementRect, contextRect, viewport)) return fallback;
  return { rect: contextRect, contextSelector: saved };
}
