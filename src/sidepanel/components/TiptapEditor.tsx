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
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { cn } from "@/lib/utils";
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
}

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
  }), []);

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
