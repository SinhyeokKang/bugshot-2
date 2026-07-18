import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useEditor,
  EditorContent,
  Extension,
  InputRule,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type ViewMutationRecord,
} from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { cn } from "@/lib/utils";
import { t, setLocale } from "@/i18n";
import { tokenizeJson, JSON_TOKEN_CLASS } from "@/sidepanel/lib/highlightJson";
import { countCodeLines, shouldCollapseCode } from "@/sidepanel/lib/codeCollapse";
import {
  createCodeCollapseShell,
  type CodeCollapseShell,
} from "@/sidepanel/lib/codeCollapseShell";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import {
  saveInlineImage,
  getInlineImage,
  blobToDataUrl,
  hasInlineOrigin,
} from "@/store/blob-db";
import {
  annotateInlineImage,
  resetInlineImage,
} from "@/sidepanel/lib/inlineImageAnnotation";
import {
  createBlockActions,
  type BlockActions,
} from "@/sidepanel/lib/blockActions";
import { shouldCompact, compactImage } from "@/sidepanel/lib/compactImage";
import {
  extractInlineRefs,
  replaceInlineRefs,
} from "@/sidepanel/lib/resolveInlineImages";

const AnnotationOverlay = lazy(() => import("./AnnotationOverlay"));
import { shouldLiftListItem } from "@/sidepanel/lib/listKeymap";
import { shouldInsertHrAfterBreak } from "@/sidepanel/lib/hrInputRule";
import "./tiptap-editor.css";

// 빈 list item 시작에서 Backspace → 리스트 종료 (기본은 이전 항목과 병합)
const ListExitOnBackspace = Extension.create({
  name: "listExitOnBackspace",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        const lift = shouldLiftListItem({
          selectionEmpty: empty,
          parentOffset: $from.parentOffset,
          parentContentSize: $from.parent.content.size,
          parentDepth: $from.depth,
          grandParentTypeName:
            $from.depth >= 1 ? $from.node($from.depth - 1).type.name : null,
        });
        if (!lift) return false;
        return this.editor.chain().liftListItem("listItem").run();
      },
    };
  },
});

// 문단 내 Shift+Enter(hardBreak) 뒤 `---` → 수평선. StarterKit 기본 규칙은 블록 맨 앞(`^---$`)만
// 처리해서, 줄바꿈만 하고 `---`를 치면 발동하지 않던 사각지대를 채운다. hardBreak+`---`를 지우고
// 그 자리에 수평선을 넣어 문단을 분리한다.
const HrAfterHardBreak = Extension.create({
  name: "hrAfterHardBreak",
  addInputRules() {
    return [
      new InputRule({
        find: /---$/,
        handler: ({ state, range, chain }) => {
          const before = state.doc.resolve(range.from).nodeBefore;
          if (
            !before ||
            !shouldInsertHrAfterBreak({ nodeBeforeTypeName: before.type.name })
          ) {
            return null;
          }
          chain()
            .deleteRange({ from: range.from - before.nodeSize, to: range.to })
            .setHorizontalRule()
            .run();
          return undefined;
        },
      }),
    ];
  },
});

export interface TiptapEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export interface TiptapEditorHandle {
  insertImageFile: (file: File) => void;
  insertCodeBlock: (text: string, language?: string) => void;
}

const jsonHighlightKey = new PluginKey("jsonCodeHighlight");

// 삽입된 로그(language=json) 코드블럭만 칠한다 — preview(renderMarkdown)와 같은 tokenizeJson을
// 써서 두 표면이 발산하지 않게 한다. inline decoration은 contentDOM 안에 렌더되므로
// CodeBlockCollapse가 같은 codeBlock에 제공하는 NodeView와 충돌 없이 공존한다.
const JsonCodeHighlight = Extension.create({
  name: "jsonCodeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: jsonHighlightKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock" || node.attrs.language !== "json") return;
              let offset = pos + 1;
              for (const token of tokenizeJson(node.textContent)) {
                if (token.kind) {
                  decorations.push(
                    Decoration.inline(offset, offset + token.text.length, {
                      class: JSON_TOKEN_CLASS[token.kind],
                    }),
                  );
                }
                offset += token.text.length;
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

const codeCollapseKey = new PluginKey("codeBlockCollapse");

// NodeView는 vanilla라 훅을 못 쓴다 → 모듈 레벨 t. collapse가 getter인 건 즉시 평가하면
// 셸이 그 문자열을 클로저로 잡아 NodeView 수명 내내 첫 locale로 얼어붙기 때문이다.
// 다시 그리는 건 아래 locale 구독이 맡는다(PM은 locale 변경으로 update()를 안 부른다).
function editorCollapseLabels() {
  return {
    expand: (lines: number) => t("codeBlock.expand", { count: lines }),
    get collapse() {
      return t("codeBlock.collapse");
    },
    get copy() {
      return t("codeBlock.copy");
    },
    get copied() {
      return t("codeBlock.copied");
    },
  };
}

class CodeCollapseNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private shell: CodeCollapseShell;
  private node: ProseMirrorNode;
  private unsubLocale: () => void;

  constructor(
    node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    const pre = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    this.syncLanguage(node);
    pre.appendChild(this.contentDOM);
    // 삭제는 에디터 전용 — 읽기 표면엔 지울 문서 모델이 없다.
    this.shell = createCodeCollapseShell(pre, editorCollapseLabels(), [
      {
        icon: "trash",
        get label() {
          return t("codeBlock.delete");
        },
        testId: "code-collapse-delete",
        onClick: () => this.deleteNode(),
      },
    ]);
    this.shell.onCollapse = () => this.moveCaretOut();
    this.dom = this.shell.wrapper;
    this.shell.update(countCodeLines(node.textContent));

    // 라벨은 t()라 살아있지만 아무도 다시 그려주지 않는다 — PM은 locale 변경으로 update()를
    // 부르지 않으니 pill이 옛 언어로 굳는다(preview는 훅 dep이 있어 무사). 직접 구독한다.
    // setLocale까지 부르는 건 t()가 읽는 모듈 전역이 React 렌더 중에만 동기화되기 때문 —
    // 구독자가 렌더보다 먼저 깨면 t()가 아직 옛 locale을 준다.
    this.unsubLocale = useSettingsUiStore.subscribe((s, prev) => {
      if (s.locale === prev.locale) return;
      setLocale(s.locale);
      this.shell.update(countCodeLines(this.node.textContent));
    });
  }

  update(node: ProseMirrorNode) {
    if (node.type.name !== "codeBlock") return false;
    const wasCollapsible = shouldCollapseCode(countCodeLines(this.node.textContent));
    this.node = node;
    // NodeView를 재사용하므로(true 반환) 노드가 바뀐 만큼은 여기서 직접 따라가야 한다.
    this.syncLanguage(node);
    const lineCount = countCodeLines(node.textContent);
    // 편집 중(caret이 블럭 안) 타이핑·붙여넣기로 임계값을 넘으면 접지 않고 펼친 채 둔다 —
    // 그대로 접으면 caret이 잘린 영역에 갇히고(setExpanded의 보정도 이 경로는 못 탄다),
    // keymap 키(Enter 등)가 안 보이는 줄을 계속 편집한다. read/edit 모델: 편집 중 = 펼침.
    if (!wasCollapsible && shouldCollapseCode(lineCount) && this.selectionInside()) {
      this.shell.setExpanded(true);
    }
    this.shell.update(lineCount);
    return true;
  }

  private selectionInside() {
    const pos = this.getPos();
    if (pos == null) return false;
    const { from, to } = this.view.state.selection;
    return from < pos + this.node.nodeSize && to > pos;
  }

  // 접힌 블럭은 readonly라 caret이 잘린 영역에 갇힌다 — 그대로 두면 PM이 그 caret을 보이게
  // pre를 스크롤해 로그 중간이 보인 채 접힌다. 블럭 바로 뒤로 빼야 실제로 풀린다.
  private moveCaretOut() {
    const pos = this.getPos();
    if (pos == null) return;
    const { state } = this.view;
    const end = pos + this.node.nodeSize;
    if (state.selection.from >= end || state.selection.to <= pos) return;
    this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(end))));
  }

  private deleteNode() {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
  }

  private syncLanguage(node: ProseMirrorNode) {
    this.contentDOM.className = node.attrs.language ? `language-${node.attrs.language}` : "";
  }

  // fade·toggle은 contentDOM 밖이다 — PM이 자기 DOM이 훼손됐다고 오해하지 않게 막는다.
  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }

  // pill 클릭과 "접힌 블럭 클릭 = 펼침"은 셸이 처리한다 — PM이 같은 클릭을 selection으로
  // 가로채면 안 된다. 펼친 뒤엔 코드 영역을 PM에 그대로 넘겨 caret이 정상 동작한다.
  stopEvent(e: Event) {
    const target = e.target as Node;
    return (
      this.shell.toggle.contains(target) ||
      this.shell.actionsEl.contains(target) ||
      this.shell.readonly
    );
  }

  destroy() {
    this.unsubLocale();
    this.shell.destroy();
  }
}

const CodeBlockCollapse = Extension.create({
  name: "codeBlockCollapse",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeCollapseKey,
        props: {
          nodeViews: {
            codeBlock: (node, view, getPos) => new CodeCollapseNodeView(node, view, getPos),
          },
        },
      }),
    ];
  },
});

// --- 본문 삽입 이미지 어노테이션 NodeView ---
// stock Image는 그대로 두고, 코드블럭과 동일하게 별도 Extension이 props.nodeViews.image에
// 팩토리를 등록한다. 스키마·직렬화·setImage 커맨드는 기본 Image 상속(추가 attr 없음).

interface ImageAnnotationOptions {
  /** blobUrl(node.attrs.src) → refId. urlToRefMap 조회. 미해소면 undefined. */
  resolveRefId: (src: string) => string | undefined;
  onAnnotate: (ctx: { refId: string; getPos: () => number | undefined }) => void;
  onReset: (ctx: { refId: string; getPos: () => number | undefined }) => void;
  labels: () => { annotate: string; reset: string; delete: string };
}

const imageAnnotationKey = new PluginKey("imageAnnotation");

class ImageAnnotationNodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private actions: BlockActions;
  private node: ProseMirrorNode;
  private refId: string | undefined;
  private unsubLocale: () => void;

  constructor(
    node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private options: ImageAnnotationOptions,
  ) {
    this.node = node;
    const wrapper = document.createElement("div");
    wrapper.className = "inline-image";

    this.img = document.createElement("img");
    this.img.setAttribute("contenteditable", "false");
    this.img.setAttribute("src", node.attrs.src ?? "");
    if (node.attrs.alt) this.img.alt = node.attrs.alt as string;
    if (node.attrs.title) this.img.title = node.attrs.title as string;

    this.refId = options.resolveRefId(node.attrs.src ?? "");

    const labels = options.labels();
    this.actions = createBlockActions([
      {
        icon: "rotateCcw",
        label: labels.reset,
        testId: "inline-image-reset",
        onClick: () => {
          if (this.refId) this.options.onReset({ refId: this.refId, getPos: this.getPos });
        },
      },
      {
        icon: "pencil",
        label: labels.annotate,
        testId: "inline-image-annotate",
        onClick: () => {
          if (this.refId) this.options.onAnnotate({ refId: this.refId, getPos: this.getPos });
        },
      },
      {
        icon: "trash",
        label: labels.delete,
        testId: "inline-image-delete",
        onClick: () => this.deleteNode(),
      },
    ]);
    // 초기화 버튼은 어노테이션 기록이 있을 때만 — 첫 렌더는 숨김, 마운트 조회 후 반영.
    this.actions.setHidden("inline-image-reset", true);
    void this.refreshReset();

    wrapper.append(this.img, this.actions.el);
    this.dom = wrapper;

    this.unsubLocale = useSettingsUiStore.subscribe((s, prev) => {
      if (s.locale === prev.locale) return;
      setLocale(s.locale);
      const l = this.options.labels();
      this.actions.setLabel("inline-image-reset", l.reset);
      this.actions.setLabel("inline-image-annotate", l.annotate);
      this.actions.setLabel("inline-image-delete", l.delete);
    });
  }

  private async refreshReset() {
    const ref = this.refId;
    if (!ref) {
      this.actions.setHidden("inline-image-reset", true);
      return;
    }
    const has = await hasInlineOrigin(ref);
    // 비동기 조회 사이 refId가 바뀌었으면 버린다(레이스 방어).
    if (this.refId !== ref) return;
    this.actions.setHidden("inline-image-reset", !has);
  }

  private deleteNode() {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
  }

  update(node: ProseMirrorNode) {
    if (node.type.name !== "image") return false;
    this.node = node;
    const newSrc = (node.attrs.src ?? "") as string;
    if (this.img.getAttribute("src") !== newSrc) {
      this.img.setAttribute("src", newSrc);
      this.refId = this.options.resolveRefId(newSrc);
      // src 교체(어노테이션·초기화)는 origin 상태를 뒤집으므로 항상 재조회.
      void this.refreshReset();
    }
    return true;
  }

  // 버튼(actions)에서 난 클릭·이벤트는 PM이 selection으로 가로채면 안 된다. img는 leaf라
  // contentDOM이 없으므로 그 외 mutation은 전부 무시한다.
  stopEvent(e: Event) {
    return this.actions.el.contains(e.target as Node);
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.unsubLocale();
    this.actions.destroy();
  }
}

const ImageAnnotation = Extension.create<ImageAnnotationOptions>({
  name: "imageAnnotation",
  addOptions() {
    return {
      resolveRefId: () => undefined,
      onAnnotate: () => {},
      onReset: () => {},
      labels: () => ({ annotate: "", reset: "", delete: "" }),
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: imageAnnotationKey,
        props: {
          nodeViews: {
            image: (node, view, getPos) =>
              new ImageAnnotationNodeView(node, view, getPos, options),
          },
        },
      }),
    ];
  },
});

const imagePluginKey = new PluginKey("imageDropPaste");

function createImageDropPlugin(
  onImageFile: (file: File) => void,
  onDragOver: (active: boolean) => void,
) {
  return new Plugin({
    key: imagePluginKey,
    props: {
      handleDOMEvents: {
        dragenter(_view: EditorView, event: DragEvent) {
          if (event.dataTransfer?.types.includes("Files")) onDragOver(true);
          return false;
        },
        dragleave(view: EditorView, event: DragEvent) {
          const related = event.relatedTarget as Node | null;
          if (!related || !view.dom.contains(related)) onDragOver(false);
          return false;
        },
        drop() {
          onDragOver(false);
          return false;
        },
      },
      handleDrop(_view: EditorView, event: DragEvent) {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const imageFiles = Array.from(files).filter((f: File) =>
          f.type.startsWith("image/"),
        );
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        for (const f of imageFiles) onImageFile(f);
        return true;
      },
      handlePaste(_view: EditorView, event: ClipboardEvent) {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        const imageFiles = Array.from(files).filter((f: File) =>
          f.type.startsWith("image/"),
        );
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        for (const f of imageFiles) onImageFile(f);
        return true;
      },
    },
  });
}

export function editorMarkdown(editor: Editor, urlToRef: Map<string, string>): string {
  const storage = editor.storage as unknown as {
    markdown?: { getMarkdown(): string };
  };
  // 정리(destroy)/마운트 레이스 중 stale editor 접근 방어 — markdown storage가 없는 인스턴스에
  // getMarkdown을 호출하면 throw돼 트리 전체가 unmount된다. 근본 원인(trim overlay와 동시 마운트)은
  // IssueTab에서 제거했고, 이 가드는 그 외 경로의 stale 접근까지 막는 조용한 안전망이다.
  if (!storage.markdown) return "";
  let md = storage.markdown.getMarkdown();
  for (const [blobUrl, refId] of urlToRef) {
    md = md.replaceAll(blobUrl, `inline:${refId}`);
  }
  return md;
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor({
  value,
  onChange,
  placeholder: placeholderText,
  className,
  ariaLabel,
}, ref) {
  const [isDragOver, setIsDragOver] = useState(false);
  const isInternalChange = useRef(false);
  const blobUrls = useRef<string[]>([]);
  const urlToRefMap = useRef(new Map<string, string>());
  const refToUrlMap = useRef(new Map<string, string>());

  // 인라인 이미지 어노테이션: NodeView(1회 생성)가 최신 핸들러를 부르도록 ref로 우회.
  type InlineCtx = { refId: string; getPos: () => number | undefined };
  const annotateRef = useRef<(ctx: InlineCtx) => void>(() => {});
  const resetRef = useRef<(ctx: InlineCtx) => void>(() => {});
  const completeRef = useRef<(ctx: InlineCtx, annotatedUrl: string) => void>(() => {});
  const [annotatingInline, setAnnotatingInline] = useState<
    { refId: string; getPos: () => number | undefined; url: string } | null
  >(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        link: false,
        dropcursor: {
          color: "hsl(199 89% 70%)",
          width: 2,
        },
      }),
      ListExitOnBackspace,
      JsonCodeHighlight,
      CodeBlockCollapse,
      HrAfterHardBreak,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Image,
      ImageAnnotation.configure({
        resolveRefId: (src) => urlToRefMap.current.get(src),
        onAnnotate: (ctx) => annotateRef.current(ctx),
        onReset: (ctx) => resetRef.current(ctx),
        labels: () => ({
          annotate: t("editor.image.annotate"),
          reset: t("editor.image.reset"),
          delete: t("editor.image.delete"),
        }),
      }),
      Placeholder.configure({
        placeholder: placeholderText,
      }),
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      isInternalChange.current = true;
      onChange(editorMarkdown(ed, urlToRefMap.current));
    },
    editorProps: {
      attributes: {
        class: "text-sm",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
  });

  const handleImageFileRef = useRef<(file: File) => void>(() => {});

  useEffect(() => {
    if (!editor) return;

    const handleImageFile = async (file: File) => {
      const bitmap = await createImageBitmap(file);
      const { width: w } = bitmap;

      let blob: Blob;
      if (shouldCompact(w, file.type)) {
        blob = await compactImage(bitmap);
      } else {
        bitmap.close();
        blob = file;
      }

      const refId = crypto.randomUUID().slice(0, 8);
      await saveInlineImage(refId, blob);
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.current.push(blobUrl);
      urlToRefMap.current.set(blobUrl, refId);
      refToUrlMap.current.set(refId, blobUrl);

      editor
        .chain()
        .focus("end")
        .setImage({ src: blobUrl })
        .run();
    };

    handleImageFileRef.current = handleImageFile;

    // 어노테이션 완료 콜백에서 getPos 클로저는 setContent로 무효화될 수 있다 — refId로 doc를
    // 다시 스캔해 최신 pos를 찾는다(node.attrs.src의 blobUrl이 아직 이 refId에 매핑돼 있는 동안).
    const rescanPos = (refId: string): number | undefined => {
      let found: number | undefined;
      editor.state.doc.descendants((n, pos) => {
        if (found !== undefined) return false;
        if (n.type.name === "image") {
          const ref = urlToRefMap.current.get((n.attrs.src ?? "") as string);
          if (ref === refId) found = pos;
        }
        return found === undefined;
      });
      return found;
    };

    // 어노테이션·초기화 후 새 blob을 표시로 반영: URL 재매핑을 여기(TiptapEditor)서 단일 관리한다.
    // NodeView가 직접 createObjectURL 하면 urlToRefMap/blobUrls 갱신을 빠뜨려 raw blob:이
    // 마크다운에 새거나 revoke가 누락된다.
    const swapInlineDisplay = (
      refId: string,
      blob: Blob,
      getPos: () => number | undefined,
    ) => {
      // 재매핑 전에 pos를 먼저 찾는다 — 아직 node.attrs.src(oldUrl)가 refId에 매핑돼 있다.
      const pos = rescanPos(refId) ?? getPos();
      const oldUrl = refToUrlMap.current.get(refId);
      const newUrl = URL.createObjectURL(blob);
      blobUrls.current.push(newUrl);
      urlToRefMap.current.set(newUrl, refId);
      refToUrlMap.current.set(refId, newUrl);
      if (pos != null) {
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(pos, "src", newUrl);
            return true;
          })
          .run();
      }
      if (oldUrl && oldUrl !== newUrl) {
        urlToRefMap.current.delete(oldUrl);
        // 다음 tick에 revoke — setNodeAttribute 반영 전 revoke하면 이미지가 깨진다.
        setTimeout(() => URL.revokeObjectURL(oldUrl), 0);
      }
    };

    annotateRef.current = ({ refId, getPos }) => {
      void (async () => {
        const blob = await getInlineImage(refId);
        if (!blob) return;
        const url = await blobToDataUrl(blob);
        setAnnotatingInline({ refId, getPos, url });
      })();
    };

    resetRef.current = ({ refId, getPos }) => {
      void (async () => {
        const blob = await resetInlineImage(refId);
        if (blob) swapInlineDisplay(refId, blob, getPos);
      })();
    };

    completeRef.current = ({ refId, getPos }, annotatedUrl) => {
      void (async () => {
        const blob = await annotateInlineImage(refId, annotatedUrl);
        swapInlineDisplay(refId, blob, getPos);
        setAnnotatingInline(null);
      })();
    };

    const plugin = createImageDropPlugin(handleImageFile, setIsDragOver);
    editor.registerPlugin(plugin);

    return () => {
      editor.unregisterPlugin(imagePluginKey);
    };
  }, [editor]);

  useImperativeHandle(ref, () => ({
    insertImageFile: (file: File) => handleImageFileRef.current(file),
    // 코드블럭 뒤에 빈 문단을 함께 넣어 커서가 블럭 끝에 갇히지 않게 한다.
    insertCodeBlock: (text: string, language?: string) => {
      editor
        ?.chain()
        .focus()
        .insertContent([
          {
            type: "codeBlock",
            attrs: { language: language ?? null },
            content: text ? [{ type: "text", text }] : [],
          },
          { type: "paragraph" },
        ])
        .run();
    },
  }), [editor]);

  // Resolve inline:refId → blob URL on editor mount
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    const refs = extractInlineRefs(value);
    if (refs.length === 0) return;

    (async () => {
      const resolved = new Map<string, string>();
      await Promise.all(
        refs.map(async (refId) => {
          const blob = await getInlineImage(refId);
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          blobUrls.current.push(url);
          urlToRefMap.current.set(url, refId);
          refToUrlMap.current.set(refId, url);
          resolved.set(refId, url);
        }),
      );
      if (cancelled || resolved.size === 0) return;
      editor.commands.setContent(replaceInlineRefs(value, resolved), {
        emitUpdate: false,
      });
    })();

    return () => { cancelled = true; };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor || isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const currentMd = editorMarkdown(editor, urlToRefMap.current);
    if (value === currentMd) return;

    const refs = extractInlineRefs(value);
    const unresolvedRefs = refs.filter((r) => !refToUrlMap.current.has(r));

    if (unresolvedRefs.length === 0) {
      const displayMd = refs.length > 0
        ? replaceInlineRefs(value, refToUrlMap.current)
        : value;
      editor.commands.setContent(displayMd, { emitUpdate: false });
      return;
    }

    let cancelled = false;
    (async () => {
      await Promise.all(
        unresolvedRefs.map(async (refId) => {
          const blob = await getInlineImage(refId);
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          blobUrls.current.push(url);
          urlToRefMap.current.set(url, refId);
          refToUrlMap.current.set(refId, url);
        }),
      );
      if (cancelled) return;
      editor.commands.setContent(replaceInlineRefs(value, refToUrlMap.current), {
        emitUpdate: false,
      });
    })();
    return () => { cancelled = true; };
  }, [value, editor]);

  useEffect(() => {
    return () => {
      for (const url of blobUrls.current) URL.revokeObjectURL(url);
      blobUrls.current = [];
      urlToRefMap.current.clear();
      refToUrlMap.current.clear();
    };
  }, []);

  return (
    <div
      className={cn(
        "tiptap-editor relative w-full rounded-md border border-input bg-transparent text-sm shadow-sm focus-within:ring-2 focus-within:ring-ring min-h-32",
        className,
      )}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} />
      {isDragOver && (
        <div className="absolute inset-0 rounded-md bg-sky-200/30 pointer-events-none dark:bg-sky-400/20" />
      )}
      {annotatingInline &&
        createPortal(
          <Suspense fallback={null}>
            <AnnotationOverlay
              imageUrl={annotatingInline.url}
              onComplete={(url) => completeRef.current(annotatingInline, url)}
              onCancel={() => setAnnotatingInline(null)}
            />
          </Suspense>,
          document.body,
        )}
    </div>
  );
});

export default TiptapEditor;
