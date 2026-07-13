import { classifyTabSupport } from "@/lib/url-support";
import { pageKeyOf } from "@/lib/session-keys";
import { useEditorStore } from "@/store/editor-store";
import { onPickerPermissionExpired, onPickerUnavailable } from "@/types/messages";
import { isActiveTabPermissionError } from "./lib/capture-error";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  PickerMessage,
  PickerTokensResponse,
  PrepareCaptureResponse,
  Token,
} from "@/types/picker";

class PickerUnavailableError extends Error {
  constructor() {
    super("Picker unavailable on this page");
    this.name = "PickerUnavailableError";
  }
}

async function pingOk(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" }, { frameId: 0 });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingOk(tabId)) return;

  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) throw new PickerUnavailableError();
  try {
    // picker는 all_frames 정적 주입 — 재주입도 동일 범위(iframe picker 자가복구).
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files,
    });
  } catch {
    // URL 사전 검사는 통과했지만 정책/제한으로 주입 불가한 케이스
    // (e.g. enterprise runtime_blocked_hosts, file:// 권한 미허용, 또는 검사 후 탭이 unsupported로 이동).
    throw new PickerUnavailableError();
  }

  // executeScript는 inject 완료까지 await하지만 onMessage listener 등록 시점이
  // 살짝 뒤따르는 케이스가 있어 picker.start가 "Receiving end does not exist"로
  // 깨지는 race. ping이 통과할 때까지 짧게 폴링.
  for (let i = 0; i < 10; i++) {
    if (await pingOk(tabId)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new PickerUnavailableError();
}

// recorder-bridge.ts(ISOLATED, all_frames)를 programmatic 재주입한다. 정적 주입만으론 확장
// reload 후 기존 탭에서 ISOLATED world가 재생성돼 브리지가 dormant로 남는데(picker.ts는
// ensureContentScript로 되살아나지만 분리된 브리지는 별도), capture 시작 시 재주입해 자가복구한다.
// 브리지의 BRIDGE_FLAG 가드가 멱등성을 보장하므로 정상 케이스에선 리스너 중복 없음.
async function ensureRecorderBridge(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  // picker(content_scripts[0])도 all_frames라 index 0을 제외해야 브리지가 잡힌다.
  const entry = manifest.content_scripts?.find(
    (cs, i) =>
      i > 0 &&
      cs.all_frames === true &&
      (cs as { world?: string }).world !== "MAIN",
  );
  const files = entry?.js;
  if (!files?.length) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files,
    });
  } catch {
    // host permission이 없거나 정책 차단 페이지
  }
}

async function ensureMainWorldRecorders(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const entry = manifest.content_scripts?.find(
    (cs) => (cs as { world?: string }).world === "MAIN",
  );
  const files = entry?.js;
  if (!files?.length) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files,
    });
  } catch {
    // host permission이 없거나 정책 차단 페이지
  }
}

// frameId required — undefined면 top이 아니라 전 프레임 broadcast되는 함정 방지.
// 정규화(selection.frameId ?? 0)는 소비 지점(호출부)에서 수행한다.
async function send<R = void>(
  tabId: number,
  msg: PickerMessage,
  frameId: number,
): Promise<R | undefined> {
  try {
    return await chrome.tabs.sendMessage<PickerMessage, R>(tabId, msg, {
      frameId,
    });
  } catch {
    return undefined;
  }
}

// 전 프레임 broadcast — picker.start/stop/clear/endCapture·레코더 제어 등 프레임 무관 메시지 전용.
async function sendAll<R = void>(
  tabId: number,
  msg: PickerMessage,
): Promise<R | undefined> {
  try {
    return await chrome.tabs.sendMessage<PickerMessage, R>(tabId, msg);
  } catch {
    return undefined;
  }
}

// picking 세션의 PRESENT 등록 token — 커밋된 iframe에 picker.start를 재전송할 때 같은
// token을 실어야 top registry 검증을 통과한다(tabSentinels와 동형의 탭별 보유).
const tabFrameTokens = new Map<number, string>();

function newFrameToken(tabId: number): string {
  const token = crypto.randomUUID();
  tabFrameTokens.set(tabId, token);
  return token;
}

// 활성 sentinel 보유 — 캡처 시작 이후 커밋된 iframe에 재발행하기 위해 탭별로 최신값을 기억한다.
type TabSentinels = { network?: string; console?: string; action?: string };
const tabSentinels = new Map<number, TabSentinels>();

function rememberSentinel(
  tabId: number,
  kind: keyof TabSentinels,
  sentinel: string,
): void {
  const s = tabSentinels.get(tabId) ?? {};
  s[kind] = sentinel;
  tabSentinels.set(tabId, s);
}

// stop 시 호출 — 종료된 sentinel이 이후 커밋된 iframe에 재발행되는 것을 막고 맵 누적을 정리한다.
function forgetSentinel(tabId: number, kind: keyof TabSentinels): void {
  const s = tabSentinels.get(tabId);
  if (!s) return;
  delete s[kind];
  if (!s.network && !s.console && !s.action) tabSentinels.delete(tabId);
}

// 특정 프레임에만 setSentinel을 재전송(frameId 지정). setSentinel은 recording=true만 켜고 버퍼를
// 비우지 않아(코드 검증), 기존 프레임이 동일 sentinel을 재수신해도 누적 로그가 보존된다.
export function rebroadcastSentinelsToFrame(tabId: number, frameId: number): void {
  const s = tabSentinels.get(tabId);
  if (!s) return;
  const sendToFrame = (msg: PickerMessage): void => {
    chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => {});
  };
  if (s.network) sendToFrame({ type: "networkRecorder.setSentinel", sentinel: s.network });
  if (s.console) sendToFrame({ type: "consoleRecorder.setSentinel", sentinel: s.console });
  if (s.action) sendToFrame({ type: "actionRecorder.setSentinel", sentinel: s.action });
}

async function getPageUrl(tabId: number): Promise<string | undefined> {
  const res = await send<{ url: string }>(tabId, { type: "picker.pageUrl" }, 0);
  return res?.url;
}

// 지원 페이지면 true. 아니면 적절한 다이얼로그 이벤트를 발화하고 false.
// tab.url을 못 읽으면(activeTab 만료) content script가 보고한 실제 URL로 판별해,
// 지원 페이지인데 권한만 풀린 경우 permission-expired로 분기한다.
async function ensureSupportedTab(tab: chrome.tabs.Tab): Promise<boolean> {
  const contentUrl =
    tab.url || tab.id == null ? undefined : await getPageUrl(tab.id);
  const state = classifyTabSupport({ url: tab.url, contentUrl });
  if (state === "supported") return true;
  if (state === "permission-expired") onPickerPermissionExpired.fire();
  else onPickerUnavailable.fire();
  return false;
}

// 캡처(captureVisibleTab)가 activeTab 만료로 실패하면 권한만료 다이얼로그를 띄운다. 처리 시 true.
// (진입 가드는 통과했지만 캡처 시점에 activeTab이 풀린 케이스)
export function maybeSurfacePermissionExpired(err: unknown): boolean {
  if (!isActiveTabPermissionError(err)) return false;
  onPickerPermissionExpired.fire();
  return true;
}

export async function startPicker(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] picker start failed", err);
    return;
  }
  if (!(await ensureSupportedTab(tab))) return;
  useEditorStore.getState().startPicking({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.start",
      frameToken: newFrameToken(tabId),
    });
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] picker start failed", err);
    }
    useEditorStore.getState().cancelPicking();
  }
}

export async function stopPicker(tabId: number): Promise<void> {
  tabFrameTokens.delete(tabId);
  await sendAll(tabId, { type: "picker.clear" });
  useEditorStore.getState().cancelPicking();
}

// repick 취소(페이지 ESC·패널 취소·iframe 차단)용 복귀: 버퍼의 마지막 요소를 재선택해
// styling으로 돌아간다(onElementSelected 승격 경로가 편집·baseline·이미지를 복원).
// 어떤 버퍼 요소도 DOM에서 못 찾으면 false — 호출부가 전체 취소로 폴백한다.
// 취소 연타 시 두 번째 picker.selected가 승격 직후 fresh 분기로 빠져 편집을 다시
// 잃을 수 있어, 복귀 진행 중 재진입은 true로 흡수한다.
let resumeInFlight = false;
export async function resumeBufferedElement(tabId: number): Promise<boolean> {
  if (resumeInFlight) return true;
  resumeInFlight = true;
  try {
    const { bufferedElements } = useEditorStore.getState();
    for (let i = bufferedElements.length - 1; i >= 0; i--) {
      const b = bufferedElements[i];
      if (await selectByPath(tabId, b.frameId ?? 0, b.selector)) return true;
    }
    return false;
  } finally {
    resumeInFlight = false;
  }
}

// 패널의 picking 취소 버튼: 버퍼가 있으면(repick 중 취소) 작업을 버리지 않고 직전 요소로
// 복귀, 아니면 기존대로 전체 정리(picker.clear + cancelPicking).
export async function stopPickerOrResume(tabId: number): Promise<void> {
  const { captureMode, bufferedElements } = useEditorStore.getState();
  if (captureMode === "element" && bufferedElements.length > 0) {
    if (await resumeBufferedElement(tabId)) return;
  }
  await stopPicker(tabId);
}

export async function clearPicker(tabId: number): Promise<void> {
  tabFrameTokens.delete(tabId);
  await sendAll(tabId, { type: "picker.clear" });
}

// picking 중 네비게이션·신규 커밋된 iframe의 picker는 idle인데 top registry엔 옛
// <iframe>이 남아 blocker 핸드오프로 클릭이 페이지에 유실된다 — picker.start를 그 프레임에
// 재전송해 복구. onCommitted 시점엔 content script(document_idle)가 아직 없을 수 있어
// 짧게 재시도하고, 대기 중 picking이 끝나면 중단(종료 후 유령 hover blocker 방지).
export async function restartPickerInFrame(
  tabId: number,
  frameId: number,
): Promise<void> {
  const frameToken = tabFrameTokens.get(tabId);
  if (!frameToken) return;
  for (let i = 0; i < 10; i++) {
    if (useEditorStore.getState().phase !== "picking") return;
    if (tabFrameTokens.get(tabId) !== frameToken) return;
    const res = await send<{ ok?: boolean }>(
      tabId,
      { type: "picker.start", frameToken },
      frameId,
    );
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// 선택 확정 후 나머지 프레임의 hover 유령(blocker·inspector) 종료. 선택 프레임은
// 이미 selected라 no-op — handleStop이 selectedEl 유무로 selected/idle 분기.
export async function stopHoverAllFrames(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "picker.stop" });
}

export async function navigatePicker(
  tabId: number,
  frameId: number,
  direction: "parent" | "child",
): Promise<void> {
  await send(tabId, { type: "picker.navigate", direction }, frameId);
}

export async function applyClasses(
  tabId: number,
  frameId: number,
  classList: string[],
): Promise<void> {
  await send(tabId, { type: "picker.applyClasses", classList }, frameId);
}

export async function applyStyles(
  tabId: number,
  frameId: number,
  inlineStyle: Record<string, string>,
): Promise<void> {
  await send(tabId, { type: "picker.applyStyles", inlineStyle }, frameId);
}

export async function applyText(
  tabId: number,
  frameId: number,
  text: string,
): Promise<void> {
  await send(tabId, { type: "picker.applyText", text }, frameId);
}

export async function resetAllEdits(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "picker.resetAllEdits" });
}

export async function collectTokens(
  tabId: number,
  frameId: number,
): Promise<Token[]> {
  const res = await send<PickerTokensResponse>(
    tabId,
    { type: "picker.collectTokens" },
    frameId,
  );
  return res?.tokens ?? [];
}

export async function describeInitialTree(
  tabId: number,
  frameId: number,
): Promise<DescribeInitialResponse | null> {
  const res = await send<DescribeInitialResponse>(
    tabId,
    { type: "picker.describeInitial" },
    frameId,
  );
  return res ?? null;
}

export async function describeChildren(
  tabId: number,
  frameId: number,
  selector: string,
): Promise<DescribeChildrenResponse> {
  const res = await send<DescribeChildrenResponse>(
    tabId,
    { type: "picker.describeChildren", selector },
    frameId,
  );
  return res ?? { children: [] };
}

export async function previewHover(
  tabId: number,
  frameId: number,
  selector: string,
): Promise<void> {
  await send(tabId, { type: "picker.previewHover", selector }, frameId);
}

export async function previewClear(
  tabId: number,
  frameId: number,
): Promise<void> {
  await send(tabId, { type: "picker.previewClear" }, frameId);
}

export async function selectByPath(
  tabId: number,
  frameId: number,
  selector: string,
): Promise<boolean> {
  const res = await send<{ found: boolean }>(
    tabId,
    { type: "picker.selectByPath", selector },
    frameId,
  );
  return res?.found ?? false;
}

export async function applyEditsBySelector(
  tabId: number,
  frameId: number,
  selector: string,
  edits: {
    classList: string[];
    inlineStyle: Record<string, string>;
    text: string | null;
  },
): Promise<boolean> {
  const res = await send<{ found: boolean }>(
    tabId,
    {
      type: "picker.applyEditsBySelector",
      selector,
      classList: edits.classList,
      inlineStyle: edits.inlineStyle,
      text: edits.text,
    },
    frameId,
  );
  return res?.found ?? false;
}

// 패널 재오픈으로 styling 세션이 하이드레이트됐을 때 store-DOM 분기를 봉합한다.
// 패널이 닫히면 port disconnect로 content가 모든 편집을 원복하므로(handleClear→restoreAll),
// 재오픈 시 버퍼·현재 요소 편집을 DOM에 재적용하고 picker 선택을 재바인딩한다.
// 페이지가 바뀌었거나 현재 요소가 사라졌으면 기존 cross-page 정책과 동일하게 sessionExpired.
// 한계: same-URL reload는 pageKey가 같아 rebind를 진행하지만 chrome이 iframe frameId를
// 재발급하므로 옛 frameId send가 조용히 실패한다 — 결말은 요소 소실과 동일(sessionExpired/ghost 카드).
export async function rebindStylingSession(tabId: number): Promise<void> {
  // 기존 expiry 경로(useEditorSessionSync)와 동일하게 만료와 페이지 정리를 쌍으로 수행.
  const expire = async () => {
    useEditorStore.setState({ sessionExpired: true });
    await clearPicker(tabId).catch(() => {});
  };
  try {
    await ensureContentScript(tabId);
  } catch {
    await expire();
    return;
  }
  const state = useEditorStore.getState();
  const prevKey = pageKeyOf(state.target?.url);
  const newKey = pageKeyOf(await getPageUrl(tabId));
  if (!prevKey || !newKey || prevKey !== newKey) {
    await expire();
    return;
  }
  // 현재 요소 존재 확인 겸 편집 재적용을 버퍼보다 먼저 — 실패(만료) 시 DOM에 아무것도
  // 재적용하지 않은 채로 끝나야 한다.
  const sel = state.selection;
  const selFrameId = sel?.frameId ?? 0;
  if (sel) {
    const found = await applyEditsBySelector(tabId, selFrameId, sel.selector, {
      classList: state.styleEdits.classList,
      inlineStyle: state.styleEdits.inlineStyle,
      text: sel.text === null ? null : state.styleEdits.text,
    });
    if (!found) {
      await expire();
      return;
    }
  }
  for (const b of state.bufferedElements) {
    // 요소 소실(found=false)은 ghost 카드로 유지 — 다이얼로그 행 초기화의 기존 한계와 동일.
    await applyEditsBySelector(tabId, b.frameId ?? 0, b.selector, {
      classList: b.styleEdits.classList,
      inlineStyle: b.styleEdits.inlineStyle,
      text: b.selectionSnapshot.text === null ? null : b.styleEdits.text,
    });
  }
  if (!sel) return;
  // 승격 경로 재사용: 현재 요소를 버퍼에 넣고 재선택하면 onElementSelected가
  // styleEdits·snapshot baseline·before/after 이미지를 그대로 복원한다.
  useEditorStore.getState().bufferCurrentElement(state.afterImage);
  await selectByPath(tabId, selFrameId, sel.selector);
}

// iframe 캡처는 자식의 offset 요청 전에 top 응답기를 1회성 arm — 무인증 postMessage
// 요청이 top overlay를 임의로 숨기지 못하게 chrome 메시지 경로로만 연다.
async function armFrameOffsetIfIframe(
  tabId: number,
  frameId: number,
): Promise<void> {
  if (frameId === 0) return;
  await send(tabId, { type: "picker.armFrameOffset" }, 0);
}

export async function prepareCapture(
  tabId: number,
  frameId: number,
): Promise<PrepareCaptureResponse | null> {
  await armFrameOffsetIfIframe(tabId, frameId);
  const res = await send<PrepareCaptureResponse>(
    tabId,
    { type: "picker.prepareCapture" },
    frameId,
  );
  return res ?? null;
}

export async function prepareCaptureBySelector(
  tabId: number,
  frameId: number,
  selector: string,
): Promise<PrepareCaptureResponse | null> {
  await armFrameOffsetIfIframe(tabId, frameId);
  const res = await send<PrepareCaptureResponse>(
    tabId,
    { type: "picker.prepareCaptureBySelector", selector },
    frameId,
  );
  return res ?? null;
}

// 캡처 프레임(+ iframe 캡처가 top overlay 숨김을 유발하므로 top)만 좁혀 전송 —
// broadcast면 다른 프레임의 진행 중 캡처 inflight를 조기에 깎는다(인터리브 aliasing).
// top 전송은 cleanup 표시 — 미소비 arm(자식 조기 실패)이면 top이 inflight를 깎지 않는다.
export async function endCapture(tabId: number, frameId: number): Promise<void> {
  await send(tabId, { type: "picker.endCapture" }, frameId);
  if (frameId !== 0) {
    await send(tabId, { type: "picker.endCapture", cleanup: true }, 0);
  }
}

export async function startAreaCapture(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] area capture start failed", err);
    return;
  }
  if (!(await ensureSupportedTab(tab))) return;
  useEditorStore.getState().startCapturing({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await ensureContentScript(tabId);
    // area select는 top 한정 — 전 프레임 broadcast면 프레임마다 crosshair가 뜬다.
    // top blocker가 iframe 영역 위 드래그도 가로채므로 top 좌표만으로 충분(기존 동작 유지).
    await chrome.tabs.sendMessage<PickerMessage>(
      tabId,
      { type: "picker.startAreaSelect" },
      { frameId: 0 },
    );
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] area capture start failed", err);
    }
    useEditorStore.getState().reset();
  }
}

export async function startElementShot(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] element shot start failed", err);
    return;
  }
  if (!(await ensureSupportedTab(tab))) return;
  useEditorStore.getState().startElementShot({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.start",
      frameToken: newFrameToken(tabId),
    });
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] element shot start failed", err);
    }
    useEditorStore.getState().reset();
  }
}

export async function startInlineAreaCapture(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    useEditorStore.getState().cancelInlineCapture();
    return;
  }
  if (!(await ensureSupportedTab(tab))) {
    useEditorStore.getState().cancelInlineCapture();
    return;
  }
  const { captureMode } = useEditorStore.getState();
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(
      tabId,
      { type: "picker.startAreaSelect", restoreAfter: captureMode === "element" },
      { frameId: 0 },
    );
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] inline area capture start failed", err);
    }
    useEditorStore.getState().cancelInlineCapture();
  }
}

export async function cancelAreaCapture(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.cancelAreaSelect" }, 0);
  useEditorStore.getState().reset();
}

// 드래그 없이 뷰포트 전체를 선택 — phase 전이는 기존 picker.areaSelected 수신부가 담당한다.
// false면 content가 area-select 상태가 아니거나(레이스) 주입이 끊긴 것.
export async function captureFullViewport(tabId: number): Promise<boolean> {
  const res = await send<{ ok: boolean }>(tabId, { type: "picker.selectFullViewport" }, 0);
  return res?.ok === true;
}

// 스크롤 캡처 오케스트레이터(scroll-capture.ts) 전용 — top frame 한정 송신.
export async function sendPickerTop<R = void>(
  tabId: number,
  msg: PickerMessage,
): Promise<R | undefined> {
  return send<R>(tabId, msg, 0);
}

export async function activateNetworkRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "network", sentinel);
  await sendAll(tabId, { type: "networkRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopNetworkRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "network");
  await sendAll(tabId, { type: "networkRecorder.stop" });
}

export async function syncNetworkRecorder(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "networkRecorder.sync" });
}

export async function activateConsoleRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "console", sentinel);
  await sendAll(tabId, { type: "consoleRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopConsoleRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "console");
  await sendAll(tabId, { type: "consoleRecorder.stop" });
}

export async function syncConsoleRecorder(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "consoleRecorder.sync" });
}

export async function activateActionRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "action", sentinel);
  await sendAll(tabId, { type: "actionRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopActionRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "action");
  await sendAll(tabId, { type: "actionRecorder.stop" });
}

export async function syncActionRecorder(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "actionRecorder.sync" });
}

// capture 시 sync broadcast가 누적기에 머지될 때까지 대기하는 상한. 머지 도착 즉시 조기 탈출.
const LOG_SYNC_SETTLE_MS = 300;

// 양 레코더 sync를 보낸 뒤, data round-trip(usePickerMessages 머지)이 누적기에 반영될 때까지 대기한다.
// sync는 메시지 전달까지만 await하고 실제 데이터는 별도 비동기 경로로 도착하므로, store의 endedAt 증가로
// 머지 도착을 감지해 조기 탈출하고 상한(LOG_SYNC_SETTLE_MS)에서 멈춘다. 호출부는 이후 누적기를 읽어
// 트림/프리즈한다. 활성 레코더는 빈 버퍼라도 dispatch하므로 endedAt이 항상 증가 → 정상 경로 즉시 탈출.
export async function syncAndSettleLogs(
  tabId: number,
  settleMs: number = LOG_SYNC_SETTLE_MS,
): Promise<void> {
  const prevNetEnded = useEditorStore.getState().networkLog?.endedAt ?? 0;
  const prevConEnded = useEditorStore.getState().consoleLog?.endedAt ?? 0;
  // action도 함께 flush(freeform 진입 freeze 전 tail 보존). 빈 버퍼면 endedAt이 안 올라
  // settle 무한대기 위험이 있으므로 settle 조건엔 넣지 않고 net/con settle 동안 머지에 묻어가게 둔다.
  await Promise.all([
    syncNetworkRecorder(tabId).catch(() => {}),
    syncConsoleRecorder(tabId).catch(() => {}),
    syncActionRecorder(tabId).catch(() => {}),
  ]);
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const s = useEditorStore.getState();
    if (
      (s.networkLog?.endedAt ?? 0) > prevNetEnded &&
      (s.consoleLog?.endedAt ?? 0) > prevConEnded
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

// top 프레임의 브라우저 뷰포트 조회. iframe 선택의 payload viewport(iframe 내부 크기)를
// 환경 메타용 브라우저 뷰포트로 교체할 때와 freeform 진입 메타에 쓴다.
export async function getTopViewport(
  tabId: number,
): Promise<{ width: number; height: number } | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: window.innerWidth, height: window.innerHeight }),
    });
    return result?.result ?? null;
  } catch {
    // host permission이 없거나 정책 차단 페이지
    return null;
  }
}

export async function startFreeformDraft(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] freeform start failed", err);
    return;
  }
  if (!(await ensureSupportedTab(tab))) return;
  const target = { tabId, url: tab.url ?? "", title: tab.title ?? "" };

  // freeform은 진입 즉시 drafting(=머지 프리즈)이라, 진입 직전 누적이 첨부에 반영되도록
  // sync 데이터가 누적기에 머지될 때까지(settle) idle 상태에서 기다린 뒤 drafting으로 전환한다.
  await syncAndSettleLogs(tabId);

  useEditorStore.getState().startFreeform(target);

  useEditorStore.setState({
    freeformViewport: await getTopViewport(tabId),
    freeformCapturedAt: Date.now(),
  });
}
