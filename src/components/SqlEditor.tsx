import { forwardRef, useImperativeHandle, useRef } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { configureMonaco } from "@/lib/monaco";

configureMonaco();

export interface SqlEditorHandle {
  getValue: () => string;
  getSelection: () => string;
  hasSelection: () => boolean;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** Run selection if present, otherwise the full editor contents. */
  onRunSmart: () => void;
  running: boolean;
  disabled?: boolean;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, onRunSmart, running, disabled },
  ref,
) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => editorRef.current?.getValue() ?? "",
    getSelection: () => {
      const ed = editorRef.current;
      if (!ed) return "";
      const sel = ed.getSelection();
      const model = ed.getModel();
      if (!sel || !model || sel.isEmpty()) return "";
      return model.getValueInRange(sel);
    },
    hasSelection: () => {
      const ed = editorRef.current;
      const sel = ed?.getSelection();
      return !!sel && !sel.isEmpty();
    },
    focus: () => editorRef.current?.focus(),
  }));

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    // Ctrl+Enter and Cmd+Enter both map to CtrlCmd in Monaco.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunSmart());
  };

  return (
    <div className="relative h-full">
      <Editor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        language="sql"
        theme={isDark() ? "vs-dark" : "vs"}
        loading={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          lineNumbers: "on",
          matchBrackets: "always",
          autoIndent: "advanced",
          formatOnPaste: true,
          formatOnType: true,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          scrollBeyondLastLine: false,
          renderLineHighlight: "all",
          tabSize: 2,
          wordWrap: "on",
          bracketPairColorization: { enabled: true },
          scrollbar: { vertical: "auto", horizontal: "auto", verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          readOnly: disabled,
          domReadOnly: disabled,
          cursorBlinking: "smooth",
          smoothScrolling: true,
        }}
      />
      {running && (
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-primary/90 px-2 py-0.5 text-xs font-medium text-primary-foreground">
          Running…
        </div>
      )}
    </div>
  );
});

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}