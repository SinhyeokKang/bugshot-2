import { classifyTabSupport } from "@/lib/url-support";
import { useEditorStore } from "@/store/editor-store";
import { onPickerPermissionExpired, onPickerUnavailable } from "@/types/messages";
import { isActiveTabPermissionError } from "./lib/capture-error";
import { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder } from "@/sidepanel/recorder-control";
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
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
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
    await chrome.scripting.executeScript({ target: { tabId }, files });
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
  const entry = manifest.content_scripts?.find(
    (cs) =>
      cs.all_frames === true && (cs as { world?: string }).world !== "MAIN",
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

async function send<R = void>(
  tabId: number,
  msg: PickerMessage,
): Promise<R | undefined> {
  try {
    return await chrome.tabs.sendMessage<PickerMessage, R>(tabId, msg);
  } catch {
    return undefined;
  }
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
  const res = await send<{ url: string }>(tabId, { type: "picker.pageUrl" });
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
  await send(tabId, { type: "picker.clear" });
  useEditorStore.getState().cancelPicking();
}

export async function clearPicker(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.clear" });
}

export async function navigatePicker(
  tabId: number,
  direction: "parent" | "child",
): Promise<void> {
  await send(tabId, { type: "picker.navigate", direction });
}

export async function applyClasses(
  tabId: number,
  classList: string[],
): Promise<void> {
  await send(tabId, { type: "picker.applyClasses", classList });
}

export async function applyStyles(
  tabId: number,
  inlineStyle: Record<string, string>,
): Promise<void> {
  await send(tabId, { type: "picker.applyStyles", inlineStyle });
}

export async function applyText(tabId: number, text: string): Promise<void> {
  await send(tabId, { type: "picker.applyText", text });
}

export async function resetAllEdits(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.resetAllEdits" });
}

export async function collectTokens(tabId: number): Promise<Token[]> {
  const res = await send<PickerTokensResponse>(tabId, {
    type: "picker.collectTokens",
  });
  return res?.tokens ?? [];
}

export async function describeInitialTree(
  tabId: number,
): Promise<DescribeInitialResponse | null> {
  const res = await send<DescribeInitialResponse>(tabId, {
    type: "picker.describeInitial",
  });
  return res ?? null;
}

export async function describeChildren(
  tabId: number,
  selector: string,
): Promise<DescribeChildrenResponse> {
  const res = await send<DescribeChildrenResponse>(tabId, {
    type: "picker.describeChildren",
    selector,
  });
  return res ?? { children: [] };
}

export async function previewHover(
  tabId: number,
  selector: string,
): Promise<void> {
  await send(tabId, { type: "picker.previewHover", selector });
}

export async function previewClear(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.previewClear" });
}

export async function selectByPath(
  tabId: number,
  selector: string,
): Promise<void> {
  await send(tabId, { type: "picker.selectByPath", selector });
}

export async function applyEditsBySelector(
  tabId: number,
  selector: string,
  edits: {
    classList: string[];
    inlineStyle: Record<string, string>;
    text: string | null;
  },
): Promise<boolean> {
  const res = await send<{ found: boolean }>(tabId, {
    type: "picker.applyEditsBySelector",
    selector,
    classList: edits.classList,
    inlineStyle: edits.inlineStyle,
    text: edits.text,
  });
  return res?.found ?? false;
}

export async function prepareCapture(
  tabId: number,
): Promise<PrepareCaptureResponse | null> {
  const res = await send<PrepareCaptureResponse>(tabId, {
    type: "picker.prepareCapture",
  });
  return res ?? null;
}

export async function prepareCaptureBySelector(
  tabId: number,
  selector: string,
): Promise<PrepareCaptureResponse | null> {
  const res = await send<PrepareCaptureResponse>(tabId, {
    type: "picker.prepareCaptureBySelector",
    selector,
  });
  return res ?? null;
}

export async function endCapture(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.endCapture" });
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
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.startAreaSelect",
    });
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
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.startAreaSelect",
      restoreAfter: captureMode === "element",
    });
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
  await send(tabId, { type: "picker.cancelAreaSelect" });
  useEditorStore.getState().reset();
}

export async function activateNetworkRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "network", sentinel);
  await send(tabId, { type: "networkRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopNetworkRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "network");
  await send(tabId, { type: "networkRecorder.stop" });
}

export async function syncNetworkRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "networkRecorder.sync" });
}

export async function activateConsoleRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "console", sentinel);
  await send(tabId, { type: "consoleRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopConsoleRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "console");
  await send(tabId, { type: "consoleRecorder.stop" });
}

export async function syncConsoleRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "consoleRecorder.sync" });
}

export async function activateActionRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  await ensureRecorderBridge(tabId);
  await ensureMainWorldRecorders(tabId);
  const sentinel = crypto.randomUUID();
  rememberSentinel(tabId, "action", sentinel);
  await send(tabId, { type: "actionRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopActionRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "action");
  await send(tabId, { type: "actionRecorder.stop" });
}

export async function syncActionRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "actionRecorder.sync" });
}

export { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder };

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

  let viewport: { width: number; height: number } | null = null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: window.innerWidth, height: window.innerHeight }),
    });
    viewport = result?.result ?? null;
  } catch {
    // host permission이 없거나 정책 차단 페이지
  }
  useEditorStore.setState({
    freeformViewport: viewport,
    freeformCapturedAt: Date.now(),
  });
}
