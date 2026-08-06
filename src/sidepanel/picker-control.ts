import { classifyTabSupport } from "@/lib/url-support";
import { pageKeyOf } from "@/lib/session-keys";
import { useEditorStore } from "@/store/editor-store";
import { onPickerPermissionExpired, onPickerUnavailable, sendBg } from "@/types/messages";
import type { DeviceDocumentsResponse } from "@/types/messages";
import { isActiveTabPermissionError } from "./lib/capture-error";
import { sameCaptureBasis } from "./lib/capture-basis";
import {
  resolveSentinelTargets,
  type SentinelScope,
} from "./lib/device-sentinel-gate";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  DeviceSetResponse,
  DeviceStateResponse,
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

export function isCurrentPickerSession(tabId: number, sessionId: string): boolean {
  return tabFrameTokens.get(tabId) === sessionId;
}

function newFrameToken(tabId: number): string {
  const token = crypto.randomUUID();
  tabFrameTokens.set(tabId, token);
  return token;
}

function currentOrNewFrameToken(tabId: number): string {
  return tabFrameTokens.get(tabId) ?? newFrameToken(tabId);
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

// background가 유일한 문서 열거원이다 — 사이드패널은 프레임 트리를 모르고 캐시도 두지 않는다.
//
// 실패는 대개 SW 콜드스타트라 한 번 재시도한다. 그래도 실패하면 null로 구분해
// fail-closed한다. 성공한 빈 트리(모드 OFF)와 통신 실패를 합치면 숨겨진 top이 다시 살아난다.
// activate 3종은 useBackgroundRecorder가 Promise.all로 동시에 부른다 — 같은 tick의 요청을
// 하나로 합쳐 SW 왕복과 getAllFrames를 3배로 돌리지 않는다. 캐시가 아니라 in-flight 병합이라
// "모드 판정을 캐시하지 않는다"는 원칙과 충돌하지 않는다(정착 즉시 슬롯을 비운다).
const inflightDocuments = new Map<number, Promise<DeviceDocumentsResponse | null>>();

function fetchDeviceDocuments(tabId: number): Promise<DeviceDocumentsResponse | null> {
  const inflight = inflightDocuments.get(tabId);
  if (inflight) return inflight;
  const task = requestDeviceDocuments(tabId).finally(() => {
    inflightDocuments.delete(tabId);
  });
  inflightDocuments.set(tabId, task);
  return task;
}

async function requestDeviceDocuments(tabId: number): Promise<DeviceDocumentsResponse | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await sendBg<DeviceDocumentsResponse>({ type: "device.documents", tabId });
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 100));
    }
  }
  return null;
}

/**
 * **sentinel을 발행하는 유일한 지점.** 모드 ON이면 래퍼 서브트리로 좁히고, OFF면 기존
 * broadcast/frameId 경로 그대로다. 이 헬퍼를 우회하는 신규 발행 코드가 하나만 생겨도 숨겨진
 * top이 되살아나 로그가 조용히 2벌이 된다(에러가 아니라 중복 엔트리라 무증상이다).
 */
async function emitSentinel(
  tabId: number,
  msg: PickerMessage,
  scope: SentinelScope,
): Promise<void> {
  const documents = await fetchDeviceDocuments(tabId);
  const deviceTree = documents?.deviceTree ?? null;
  const target = resolveSentinelTargets({ deviceTree, scope });
  switch (target.kind) {
    case "broadcast":
      await sendAll(tabId, msg);
      return;
    case "frame":
      await send(tabId, msg, target.frameId);
      return;
    case "documents":
      await Promise.all(
        target.documentIds.map((documentId) =>
          chrome.tabs.sendMessage(tabId, msg, { documentId }).catch(() => {}),
        ),
      );
      return;
    case "none":
      return;
    default:
      target satisfies never;
  }
}

// 특정 프레임에만 setSentinel을 재전송(frameId 지정). setSentinel은 recording=true만 켜고 버퍼를
// 비우지 않아(코드 검증), 기존 프레임이 동일 sentinel을 재수신해도 누적 로그가 보존된다.
// 모드 ON에서는 위 게이트가 래퍼 서브트리 밖 프레임을 튕긴다 — 숨겨진 top의 자식 iframe이
// 커밋될 때마다 그 레코더가 살아나는 경로다.
export function rebroadcastSentinelsToFrame(
  tabId: number,
  frameId: number,
  documentId?: string,
): void {
  const s = tabSentinels.get(tabId);
  if (!s) return;
  const msgs: PickerMessage[] = [];
  if (s.network) msgs.push({ type: "networkRecorder.setSentinel", sentinel: s.network });
  if (s.console) msgs.push({ type: "consoleRecorder.setSentinel", sentinel: s.console });
  if (s.action) msgs.push({ type: "actionRecorder.setSentinel", sentinel: s.action });
  if (msgs.length === 0) return;
  // 문서 열거는 한 번만 — 프레임이 잦게 커밋되는 광고성 페이지에서 3배로 왕복하지 않는다.
  void (async () => {
    const documents = await fetchDeviceDocuments(tabId);
    const deviceTree = documents?.deviceTree ?? null;
    const scope: SentinelScope = { kind: "frame", frameId, documentId };
    const target = resolveSentinelTargets({ deviceTree, scope });
    if (target.kind !== "frame") return;
    for (const msg of msgs) void send(tabId, msg, target.frameId);
  })();
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
  sessionId?: string,
): Promise<boolean> {
  const res = await send<{ found: boolean }>(
    tabId,
    { type: "picker.selectByPath", selector, sessionId },
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
// 선택 노드만 DOM에서 빠진 경우(SPA 리렌더·key 교체) — 페이지가 바뀐 게 아니므로 버퍼에
// 쌓아둔 요소별 편집과 캡처는 살리고 현재 선택만 놓는다. sessionExpired는 cross-page 신호라
// 여기서 세우지 않는다: 세우면 다이얼로그가 뜨고 확인 시 reset이라 버퍼가 통째로 사라진다.
export async function releaseDetachedSelection(tabId: number): Promise<void> {
  await clearPicker(tabId).catch(() => {});
  useEditorStore.setState({
    selection: null,
    styleEdits: { classList: [], inlineStyle: {}, text: "", cssText: null },
    beforeImage: null,
    afterImage: null,
    beforeAnnotated: null,
    afterAnnotated: null,
    captureContext: null,
  });
}

export async function expireStylingSession(tabId: number): Promise<void> {
  await clearPicker(tabId).catch(() => {});
  useEditorStore.setState({
    sessionExpired: true,
    selection: null,
    bufferedElements: [],
    styleEdits: { classList: [], inlineStyle: {}, text: "", cssText: null },
    beforeImage: null,
    afterImage: null,
    beforeAnnotated: null,
    afterAnnotated: null,
    captureContext: null,
  });
}

export async function rebindStylingSession(tabId: number): Promise<void> {
  try {
    await ensureContentScript(tabId);
  } catch {
    await expireStylingSession(tabId);
    return;
  }
  const state = useEditorStore.getState();
  const prevKey = pageKeyOf(state.target?.url);
  const newKey = pageKeyOf(await getPageUrl(tabId));
  if (!prevKey || !newKey || prevKey !== newKey) {
    await expireStylingSession(tabId);
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
    }).catch(() => false);
    if (!found) {
      await expireStylingSession(tabId);
      return;
    }
  }
  for (const b of state.bufferedElements) {
    // 요소 소실(found=false)은 ghost 카드로 유지 — 다이얼로그 행 초기화의 기존 한계와 동일.
    // 하나가 안 붙었다고 세션을 파기하면 나머지 버퍼의 편집·before/after까지 같이 날아간다.
    await applyEditsBySelector(tabId, b.frameId ?? 0, b.selector, {
      classList: b.styleEdits.classList,
      inlineStyle: b.styleEdits.inlineStyle,
      text: b.selectionSnapshot.text === null ? null : b.styleEdits.text,
    }).catch(() => false);
  }
  if (!sel) return;
  // 승격 경로 재사용: 현재 요소를 버퍼에 넣고 재선택하면 onElementSelected가
  // styleEdits·snapshot baseline·before/after 이미지를 그대로 복원한다.
  // 위 await들 사이에 before가 착지해 기준이 갈렸으면 낡은 기준의 after는 버린다.
  const now = useEditorStore.getState();
  const stale = !sameCaptureBasis(state.captureContext, now.captureContext);
  now.bufferCurrentElement(
    stale ? null : state.afterImage,
    now.captureContext ?? undefined,
  );
  await selectByPath(tabId, selFrameId, sel.selector, newFrameToken(tabId));
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
  options: { expandContext?: boolean; contextSelector?: string } = {},
): Promise<PrepareCaptureResponse | null> {
  await armFrameOffsetIfIframe(tabId, frameId);
  const res = await send<PrepareCaptureResponse>(
    tabId,
    {
      type: "picker.prepareCapture",
      expandContext: options.expandContext,
      contextSelector: options.contextSelector,
    },
    frameId,
  );
  return res ?? null;
}

export async function prepareCaptureBySelector(
  tabId: number,
  frameId: number,
  selector: string,
  options: { expandContext?: boolean; contextSelector?: string } = {},
): Promise<PrepareCaptureResponse | null> {
  await armFrameOffsetIfIframe(tabId, frameId);
  const res = await send<PrepareCaptureResponse>(
    tabId,
    {
      type: "picker.prepareCaptureBySelector",
      selector,
      expandContext: options.expandContext,
      contextSelector: options.contextSelector,
    },
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
      { type: "picker.startAreaSelect", sessionId: newFrameToken(tabId) },
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
      {
        type: "picker.startAreaSelect",
        restoreAfter: captureMode === "element",
        sessionId:
          captureMode === "element"
            ? currentOrNewFrameToken(tabId)
            : newFrameToken(tabId),
      },
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

// area-select는 top(frameId 0)에서만 시작하므로 취소도 top에만 보낸다 — broadcast하면
// 자기는 area-select를 켠 적 없는 iframe들이 handleClear를 타 그 프레임의 스타일 편집이 날아간다.
export async function cancelAreaSelect(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.cancelAreaSelect" }, 0);
}

export async function cancelAreaCapture(tabId: number): Promise<void> {
  await cancelAreaSelect(tabId);
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
  await emitSentinel(tabId, { type: "networkRecorder.setSentinel", sentinel }, { kind: "all" });
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
  await emitSentinel(tabId, { type: "consoleRecorder.setSentinel", sentinel }, { kind: "all" });
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
  await emitSentinel(tabId, { type: "actionRecorder.setSentinel", sentinel }, { kind: "all" });
  return sentinel;
}

export async function stopActionRecorder(tabId: number): Promise<void> {
  forgetSentinel(tabId, "action");
  await sendAll(tabId, { type: "actionRecorder.stop" });
}

export async function syncActionRecorder(tabId: number): Promise<void> {
  await sendAll(tabId, { type: "actionRecorder.sync" });
}

const RECORDER_KINDS = ["networkRecorder", "consoleRecorder", "actionRecorder"] as const;

/**
 * 한 document에 메시지 묶음을 응답 확인식으로 보낸다.
 *
 * `retries`가 필요한 이유: 갓 커밋된 래퍼의 content script는 document_idle에 붙으므로,
 * 커밋 직후의 첫 송신이 "Receiving end does not exist"로 튕긴다. 그걸 실패로 접으면 정상
 * 로드된 래퍼가 레코더 재무장 한 번 늦었다는 이유로 통째로 롤백된다 — `ensureContentScript`가
 * 같은 창을 짧은 폴링으로 흡수하는 것과 같은 상황이다.
 */
async function ackDocument(
  tabId: number,
  documentId: string,
  msgs: PickerMessage[],
  retries = 0,
): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      for (const msg of msgs) {
        await chrome.tabs.sendMessage(tabId, msg, { documentId });
      }
      return true;
    } catch {
      if (attempt >= retries) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

// 커밋~document_idle 창을 덮는 상한. ensureContentScript(10×50ms)와 같은 계열이되, 여기는
// 프레임이 이미 커밋된 뒤라 조금 더 여유를 준다.
const START_ACK_RETRIES = 10;
// stop은 실패해도 전이를 깨지 않지만 **재시도는 필요하다** — 숨겨진 top의 레코더를 끄는
// 수단이 이것뿐이라(게이트는 *재*발행만 막지 이미 무장된 레코더를 못 끈다), 일시 실패를
// 그냥 넘기면 top이 같은 sentinel로 계속 dispatch해 로그가 조용히 2벌이 된다.
const STOP_ACK_RETRIES = 3;

/**
 * 현재 문서 전부를 정지한 뒤 래퍼 서브트리만 활성화한다. 각 단계는 응답 확인식이다.
 * 정확도가 우선이라 broadcast 후 top만 재정지하는 경쟁 구조는 쓰지 않는다.
 *
 * **clear는 반드시 stop ACK 뒤, start ACK 앞이다.** 이유가 둘이고 하나만 알고 순서를
 * 되돌리면 나머지가 조용히 깨진다. ① clear가 mount보다 앞이면 mount~stop 사이에 숨겨진
 * 원본이 뱉은 로그가 경계를 통과하는데 래퍼와 top은 같은 origin이라 필터로도 못 가른다.
 * ② 그 구간엔 binding이 없어 sentinel 게이트가 일시적으로 "모드 OFF"로 판정하고, 하필
 * 그때가 tabs.onUpdated(complete)로 activate 3종이 가장 잘 도는 구간이다 — 숨겨진 top이
 * 잠깐 되살아나는 걸 막을 수 없고, stop ACK가 다시 죽인 뒤의 clear만이 그 로그를 지운다.
 *
 * 래퍼의 pre-arm 버퍼는 start 시점에 flush되므로 clear를 뒤로 미뤄도 손실이 없다.
 *
 * clear를 콜백으로 받는 이유: 실제 clear는 store와 persist guard를 건드리는데 그건
 * usePickerMessages 쪽에 있고, 그걸 여기서 import하면 순환이 된다.
 */
export async function activateRecordersInDeviceTree(
  tabId: number,
  clearLogs: () => void,
): Promise<boolean> {
  const documents = await fetchDeviceDocuments(tabId);
  if (!documents) return false;
  const { all, deviceTree } = documents;
  if (deviceTree.length === 0) return false;

  // stop 실패는 전이를 깨지 않는다 — 열거와 송신 사이에 이동한 문서는 애초에 그 레코더가
  // 죽었고, 새 문서는 frameCommitted → 게이트가 다시 판정한다. 여기서 실패로 접으면 광고
  // 프레임 하나의 타이밍으로 정상 로드된 래퍼까지 롤백된다.
  const stops = RECORDER_KINDS.map((kind) => ({ type: `${kind}.stop` }) as PickerMessage);
  await Promise.all(
    all.map((documentId) => ackDocument(tabId, documentId, stops, STOP_ACK_RETRIES)),
  );

  clearLogs();

  const sentinels = tabSentinels.get(tabId);
  if (!sentinels) return true; // 레코더가 애초에 비활성 — 전이 자체는 성공이다
  const starts: PickerMessage[] = [];
  if (sentinels.network) {
    starts.push({ type: "networkRecorder.setSentinel", sentinel: sentinels.network });
  }
  if (sentinels.console) {
    starts.push({ type: "consoleRecorder.setSentinel", sentinel: sentinels.console });
  }
  if (sentinels.action) {
    starts.push({ type: "actionRecorder.setSentinel", sentinel: sentinels.action });
  }
  const started = await Promise.all(
    deviceTree.map((documentId) => ackDocument(tabId, documentId, starts, START_ACK_RETRIES)),
  );
  return started.every(Boolean);
}

// capture 시 sync broadcast가 누적기에 머지될 때까지 대기하는 상한. 머지 도착 즉시 조기 탈출.
const LOG_SYNC_SETTLE_MS = 300;
// sync 메시지 왕복 상한. 페이지가 멈춰 응답이 없어도 호출부가 진행하게 한다.
const LOG_SYNC_SEND_CAP_MS = 500;

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
  // sendMessage 단계에 상한이 필수다 — content 리스너는 페이지 메인 스레드에서 디스패치되므로
  // 대상 탭이 alert()·동기 무한루프에 걸려 있으면(BugShot이 겨냥하는 바로 그 페이지) 응답이
  // 영영 안 오고, sendAll의 catch는 예외만 삼킬 뿐 pending은 못 푼다. 호출부 셋(녹화 정지·
  // 리플레이 캡처·freeform 진입)이 전부 이 await 뒤에서 세션을 커밋하므로 여기서 멈추면
  // 녹화 유실·영구 스피너가 된다. 꼬리 몇 건보다 그쪽 손실이 크다.
  await Promise.race([
    Promise.all([
      syncNetworkRecorder(tabId).catch(() => {}),
      syncConsoleRecorder(tabId).catch(() => {}),
      syncActionRecorder(tabId).catch(() => {}),
    ]),
    new Promise<void>((r) => setTimeout(r, LOG_SYNC_SEND_CAP_MS)),
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

// **캡처 대상 뷰포트** 조회(과거의 "브라우저 뷰포트"에서 의미가 넓어졌다). iframe 선택의
// payload viewport(iframe 내부 크기)를 환경 메타로 교체할 때, freeform 진입 메타, 그리고
// 영상·30s Replay 메타에 쓴다 — 캡처 5종의 단일 출처다.
//
// 주입 함수는 직렬화·재평가되므로 클로저가 안 살아남는다. 프레임 id는 반드시 **인라인
// 리터럴**이어야 하고 device-frame.ts의 DEVICE_FRAME_ID와 복제 관계다 — 상수를 import하면
// typecheck·유닛이 전부 green인데 런타임만 ReferenceError로 죽고 아래 catch가 그걸 삼켜
// 조용히 null로 폴백한다. 동기화는 device-viewport-meta.test.ts가 두 값을 대조해 고정한다.
export async function getTopViewport(
  tabId: number,
): Promise<{ width: number; height: number } | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const frame = document.getElementById("__bugshot_device_frame__");
        return frame
          ? { width: frame.clientWidth, height: frame.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight };
      },
    });
    return result?.result ?? null;
  } catch {
    // host permission이 없거나 정책 차단 페이지
    return null;
  }
}

/* ── 디바이스 뷰포트 ─────────────────────────────────────────── */

// send는 모듈 내부 전용이라 사이드패널이 직접 못 쓴다 — navigatePicker·prepareCapture와 같은
// 패턴으로 top 지정 송신 래퍼를 노출한다.
export async function deviceSet(
  tabId: number,
  width: number | null,
): Promise<DeviceSetResponse | undefined> {
  return send<DeviceSetResponse>(tabId, { type: "device.set", width }, 0);
}

export async function deviceState(
  tabId: number,
): Promise<DeviceStateResponse | undefined> {
  try {
    await ensureContentScript(tabId);
    return send<DeviceStateResponse>(tabId, { type: "device.state" }, 0);
  } catch {
    return undefined;
  }
}

export async function deviceWatch(tabId: number, on: boolean): Promise<void> {
  await send(tabId, { type: "device.watch", on }, 0);
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
