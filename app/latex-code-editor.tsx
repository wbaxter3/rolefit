"use client";

import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import CodeMirror from "@uiw/react-codemirror";
import type { KeyboardEvent } from "react";

const latexLanguage = StreamLanguage.define(stex);

const roleFitEditorTheme = createTheme({
  theme: "light",
  settings: {
    background: "#fbfbf7",
    foreground: "#30362f",
    caret: "#1f513d",
    selection: "#ddeb7266",
    selectionMatch: "#ddeb7238",
    lineHighlight: "#eef1e7",
    gutterBackground: "#f3f2eb",
    gutterForeground: "#92978e",
    gutterActiveForeground: "#1f513d",
    gutterBorder: "1px solid #deded5",
    fontFamily: "var(--font-mono), monospace",
  },
  styles: [
    { tag: [tags.macroName, tags.keyword, tags.controlKeyword, tags.tagName], color: "#146548", fontWeight: "700" },
    { tag: [tags.definitionKeyword, tags.moduleKeyword, tags.processingInstruction], color: "#9a472f", fontWeight: "650" },
    { tag: [tags.string, tags.atom, tags.bool], color: "#9a552d" },
    { tag: [tags.number, tags.integer, tags.float], color: "#76509a" },
    { tag: [tags.brace, tags.bracket, tags.paren, tags.angleBracket], color: "#b36b22" },
    { tag: [tags.operator, tags.escape], color: "#9a472f" },
    { tag: [tags.propertyName, tags.labelName, tags.link, tags.url], color: "#356b88" },
    { tag: [tags.heading, tags.strong], color: "#153e2d", fontWeight: "750" },
    { tag: tags.emphasis, color: "#4d6358", fontStyle: "italic" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#798078", fontStyle: "italic" },
    { tag: [tags.meta, tags.documentMeta], color: "#66756c" },
    { tag: tags.invalid, color: "#a33125", textDecoration: "underline wavy" },
  ],
});

type LatexCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
};

export function LatexCodeEditor({ value, onChange, onSave }: LatexCodeEditorProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className="code-editor-shell" onKeyDown={handleKeyDown}>
      <CodeMirror
        aria-label="Project source editor"
        basicSetup={{
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          highlightSelectionMatches: true,
          lineNumbers: true,
        }}
        className="code-editor"
        extensions={[latexLanguage, EditorView.lineWrapping]}
        height="100%"
        onChange={onChange}
        placeholder="Select a LaTeX project file to begin editing."
        theme={roleFitEditorTheme}
        value={value}
      />
    </div>
  );
}
