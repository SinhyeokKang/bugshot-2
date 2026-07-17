import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import { countCodeLines } from "@/sidepanel/lib/codeCollapse";
import {
  createCodeCollapseShell,
  type CodeCollapseShell,
} from "@/sidepanel/lib/codeCollapseShell";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { saveInlineImage, getInlineImage } from "@/store/blob-db";
import { shouldCompact, compactImage } from "@/sidepanel/lib/compactImage";
import {
  extractInlineRefs,
  replaceInlineRefs,
} from "@/sidepanel/lib/resolveInlineImages";
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
    this.node = node;
    // NodeView를 재사용하므로(true 반환) 노드가 바뀐 만큼은 여기서 직접 따라가야 한다.
    this.syncLanguage(node);
    this.shell.update(countCodeLines(node.textContent));
    return true;
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
    </div>
  );
});

export default TiptapEditor;
