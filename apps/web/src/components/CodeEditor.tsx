"use client";
import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Language } from "@codeautopsy/schemas";

function langExtension(language: Language | undefined) {
  switch (language) {
    case "python":
      return [python()];
    case "javascript":
      return [javascript()];
    case "java":
      return [java()];
    case "c":
    case "cpp":
    default:
      return [cpp()];
  }
}

interface Highlights {
  currentLine: number | null;
  markerLine: number | null;
  markerClass: string;
}

const setHighlights = StateEffect.define<Highlights>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next: Highlights | null = null;
    for (const e of tr.effects) {
      if (e.is(setHighlights)) next = e.value;
    }
    if (next) {
      const marks: Array<Range<Decoration>> = [];
      if (next.markerLine != null && tr.state.doc.lines > 0) {
        const lineNo = Math.max(1, Math.min(next.markerLine, tr.state.doc.lines));
        marks.push(Decoration.line({ class: next.markerClass }).range(tr.state.doc.line(lineNo).from));
      }
      if (next.currentLine != null && tr.state.doc.lines > 0) {
        const lineNo = Math.max(1, Math.min(next.currentLine, tr.state.doc.lines));
        marks.push(Decoration.line({ class: "cm-current-line" }).range(tr.state.doc.line(lineNo).from));
      }
      if (marks.length === 0) return Decoration.none;
      return Decoration.set(marks, true);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function CodeEditor({
  value,
  onChange,
  language,
  currentLine = null,
  markerLine = null,
  markerClass = "cm-divergence-line",
  height = "340px",
  readOnly = true,
}: {
  value: string;
  onChange?: (value: string) => void;
  language?: Language;
  currentLine?: number | null;
  markerLine?: number | null;
  markerClass?: string;
  height?: string;
  readOnly?: boolean;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const [extensions] = useState(() => [...langExtension(language), highlightField, EditorView.lineWrapping]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setHighlights.of({ currentLine, markerLine, markerClass }),
    });
  }, [currentLine, markerLine, markerClass, value]);

  return (
    <CodeMirror
      value={value}
      height={height}
      theme="light"
      extensions={extensions}
      editable={!readOnly}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        view.dispatch({ effects: setHighlights.of({ currentLine, markerLine, markerClass }) });
      }}
      basicSetup={{ foldGutter: false, autocompletion: false, highlightActiveLine: false }}
    />
  );
}
