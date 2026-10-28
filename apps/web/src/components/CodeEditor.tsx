"use client";
import { useEffect, useRef, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StateEffect, StateField, type Range, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Language } from "@codeautopsy/schemas";

const cppSyntax = () => import("@codemirror/lang-cpp").then((module) => module.cpp());
const syntaxLoaders: Record<Language, () => Promise<Extension>> = {
  cpp: cppSyntax,
  c: cppSyntax,
  python: () => import("@codemirror/lang-python").then((module) => module.python()),
  javascript: () => import("@codemirror/lang-javascript").then((module) => module.javascript()),
  java: () => import("@codemirror/lang-java").then((module) => module.java()),
};

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
  const [syntax, setSyntax] = useState<Extension[]>([]);
  useEffect(() => {
    let active = true;
    setSyntax([]);
    syntaxLoaders[language ?? "cpp"]()
      .then((extension) => {
        if (active) setSyntax([extension]);
      })
      .catch(() => {
        /* Editing remains available without optional syntax highlighting. */
      });
    return () => {
      active = false;
    };
  }, [language]);
  const extensions = useMemo(() => [...syntax, highlightField, EditorView.lineWrapping], [syntax]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setHighlights.of({ currentLine, markerLine, markerClass }),
    });
    if (currentLine != null && viewRef.current) {
      const view = viewRef.current;
      const line = view.state.doc.line(Math.max(1, Math.min(currentLine, view.state.doc.lines)));
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    }
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
