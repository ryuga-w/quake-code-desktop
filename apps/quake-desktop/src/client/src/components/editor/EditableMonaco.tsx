import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { apiPost } from "../../lib/api";
import { configureLocalMonaco } from "../../lib/monaco";
import { registerQuakeMonacoThemes } from "../../lib/theme";
import { useAppStore } from "../../state/app-store";
import { fileUndoManager } from "../../lib/undo-stack";
import { EditorToolbar } from "./EditorToolbar";

configureLocalMonaco();

export interface EditableMonacoProps {
  path: string;
  content: string;
  language?: string;
  readOnly?: boolean;
  onClose?: () => void;
  onSave?: (path: string, content: string) => void;
}

export function EditableMonaco({ path, content, language, readOnly = false, onClose, onSave }: EditableMonacoProps) {
  const [currentContent, setCurrentContent] = useState(content);
  const [originalContent, setOriginalContent] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const editorRef = useRef<any>(null);
  const showToast = useAppStore((s) => s.showToast);
  const undoStack = fileUndoManager.getStack(path);

  const detectedLanguage = useMemo(() => {
    if (language) return language;
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      json: "json", css: "css", scss: "scss", html: "html", md: "markdown",
      py: "python", sh: "shell", bash: "shell", yaml: "yaml", yml: "yaml",
      xml: "html", sql: "sql", graphql: "graphql", go: "go", rs: "rust",
      java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    };
    return map[ext] || "plaintext";
  }, [path, language]);

  useEffect(() => {
    setCurrentContent(content);
    setOriginalContent(content);
    setIsDirty(false);
  }, [path, content]);

  useEffect(() => {
    setIsDirty(currentContent !== originalContent);
    setCanUndo(fileUndoManager.canUndo(path));
    setCanRedo(fileUndoManager.canRedo(path));
  }, [currentContent, originalContent, path]);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.addAction({
      id: "save-file",
      label: "Kaydet",
      keybindings: [2048 | 49], // Ctrl+S
      run: () => handleSave(),
    });
  }, [currentContent, originalContent]);

  async function handleSave() {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      const result = await apiPost<{ path: string; bytes: number; backedUp: boolean }>("/api/file/write", {
        path,
        content: currentContent,
        createBackup: true,
      });
      setOriginalContent(currentContent);
      setIsDirty(false);
      fileUndoManager.pushEdit(path, originalContent, currentContent, "Kaydet");
      setCanUndo(fileUndoManager.canUndo(path));
      setCanRedo(fileUndoManager.canRedo(path));
      showToast(`Kaydedildi: ${result.path}${result.backedUp ? " (yedeklendi)" : ""}`, "success");
      onSave?.(path, currentContent);
    } catch (error: any) {
      showToast(`Kaydetme başarısız: ${error.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  }

  function handleRevert() {
    setCurrentContent(originalContent);
    setIsDirty(false);
    showToast("Değişiklikler geri alındı", "info");
  }

  function handleUndo() {
    const prev = fileUndoManager.undo(path);
    if (prev !== undefined) {
      setCurrentContent(prev);
      setCanUndo(fileUndoManager.canUndo(path));
      setCanRedo(fileUndoManager.canRedo(path));
    }
  }

  function handleRedo() {
    const next = fileUndoManager.redo(path);
    if (next !== undefined) {
      setCurrentContent(next);
      setCanUndo(fileUndoManager.canUndo(path));
      setCanRedo(fileUndoManager.canRedo(path));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <EditorToolbar
        path={path}
        isDirty={isDirty}
        isSaving={isSaving}
        isReadOnly={readOnly}
        canUndo={canUndo}
        canRedo={canRedo}
        onSave={handleSave}
        onRevert={handleRevert}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClose={() => onClose?.()}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap(!wordWrap)}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          theme={typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "quake-light" : "quake-dark"}
          beforeMount={registerQuakeMonacoThemes}
          language={detectedLanguage}
          value={currentContent}
          onChange={(value) => setCurrentContent(value || "")}
          onMount={handleMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: wordWrap ? "on" : "off",
            fontSize: 14,
            lineNumbers: "on",
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}

