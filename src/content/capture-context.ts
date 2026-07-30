import type { ViewportRect } from "@/types/picker";

// docs/privacy.{ko,en}.md가 이 40%를 공개한다 — 값 자체는 경계 테스트가 행동으로 고정한다.
const CONTEXT_MAX_VIEWPORT_RATIO = 0.4;

// 떠 있는 UI — 시맨틱 속성만으로 확정된다.
const OVERLAY_SELECTOR =
  'dialog,[popover],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

// form·fieldset은 뺐다 — 결제·주소 입력 묶음을 통째로 캡처에 끌어들인다.
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
  // 컨테이너가 한 변이라도 0이면 확장해도 마진만 남는다 — 요소가 0×0일 때 G2가 생략되는
  // 탓에 G1·G3만으로는 이 조각이 "확장 성공"으로 통과한다.
  if (contextRect.width <= 0 || contextRect.height <= 0) return false;
  // G1
  if (
    !containsRect(
      { x: 0, y: 0, width: viewport.width, height: viewport.height },
      contextRect,
    )
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
  saved: string;
  found: Element | null;
  target: Element;
  contextRect: ViewportRect | null;
  elementRect: ViewportRect;
  viewport: { width: number; height: number };
}): { rect: ViewportRect; contextSelector: string | null } {
  const { saved, found, target, contextRect, elementRect, viewport } = args;
  const fallback = { rect: elementRect, contextSelector: null };
  if (!found || !contextRect) return fallback;
  if (!found.contains(target)) return fallback;
  if (!passesContextGates(elementRect, contextRect, viewport)) return fallback;
  return { rect: contextRect, contextSelector: saved };
}
