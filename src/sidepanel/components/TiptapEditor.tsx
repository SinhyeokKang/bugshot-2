import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { cn } from "@/lib/utils";
import { saveInlineImage } from "@/store/blob-db";
import { shouldCompact, compactImage } from "@/sidepanel/lib/compactImage";
import "./tiptap-editor.css";

export interface TiptapEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

const blobUrlToRefId = new Map<string, string>();
const imagePluginKey = new PluginKey("imageDropPaste");

function createImageDropPlugin(onImageFile: (file: File) => void) {
  return new Plugin({
    key: imagePluginKey,
    props: {
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

function getEditorMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let md = (editor.storage as any).markdown.getMarkdown() as string;
  for (const [blobUrl, refId] of blobUrlToRefId) {
    md = md.replaceAll(blobUrl, `inline:${refId}`);
  }
  return md;
}

export default function TiptapEditor({
  value,
  onChange,
  placeholder: placeholderText,
  className,
  ariaLabel,
}: TiptapEditorProps) {
  const isInternalChange = useRef(false);
  const blobUrls = useRef<string[]>([]);

  const getMarkdown = useCallback(
    (editor: Editor | null) => {
      if (!editor) return "";
      return getEditorMarkdown(editor);
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
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
      onChange(getEditorMarkdown(ed));
    },
    editorProps: {
      attributes: {
        class: "text-sm",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const handleImageFile = async (file: File) => {
      const bitmap = await createImageBitmap(file);
      const { width: w, height: h } = bitmap;
      bitmap.close();

      let blob: Blob = file;
      if (shouldCompact(w, h, file.type)) {
        blob = await compactImage(file);
      }

      const refId = crypto.randomUUID().slice(0, 8);
      await saveInlineImage(refId, blob);
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.current.push(blobUrl);
      blobUrlToRefId.set(blobUrl, refId);

      editor.chain().focus().setImage({ src: blobUrl }).run();
    };

    const plugin = createImageDropPlugin(handleImageFile);
    editor.registerPlugin(plugin);

    return () => {
      editor.unregisterPlugin(imagePluginKey);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const currentMd = getMarkdown(editor);
    if (value !== currentMd) {
      editor.commands.setContent(value);
    }
  }, [value, editor, getMarkdown]);

  useEffect(() => {
    return () => {
      for (const url of blobUrls.current) URL.revokeObjectURL(url);
      blobUrls.current = [];
    };
  }, []);

  return (
    <div
      className={cn(
        "tiptap-editor w-full rounded-md border border-input bg-transparent text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring min-h-32",
        className,
      )}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
