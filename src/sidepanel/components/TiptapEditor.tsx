import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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
import "./tiptap-editor.css";

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

function editorMarkdown(editor: Editor, urlToRef: Map<string, string>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let md = (editor.storage as any).markdown.getMarkdown() as string;
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
      isInternalChange.current = true;
      editor.commands.setContent(replaceInlineRefs(value, resolved));
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
      editor.commands.setContent(displayMd);
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
      isInternalChange.current = true;
      editor.commands.setContent(replaceInlineRefs(value, refToUrlMap.current));
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
        <div className="absolute inset-0 rounded-md bg-sky-200/30 pointer-events-none" />
      )}
    </div>
  );
});

export default TiptapEditor;
