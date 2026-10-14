"use client";

import dynamic from "next/dynamic";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-muted-foreground">Loading editor…</div>,
});

export function CodeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Monaco
      height="100%"
      language="python"
      theme="vs"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      options={{
        fontSize: 14,
        tabSize: 4,
        insertSpaces: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderWhitespace: "selection",
        padding: { top: 12 },
      }}
    />
  );
}
