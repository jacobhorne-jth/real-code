import ReactMarkdown, { type Components } from "react-markdown";

// Problem prompts are plain Markdown; raw HTML is not rendered.
const components: Components = {
  h1: (p) => <h2 className="mb-3 text-lg font-semibold tracking-tight" {...p} />,
  h2: (p) => <h3 className="mt-5 mb-2 text-base font-semibold" {...p} />,
  h3: (p) => <h4 className="mt-4 mb-2 text-sm font-semibold" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1.5 pl-5" {...p} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1.5 pl-5" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  a: (p) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  pre: (p) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[0.8rem] leading-relaxed" {...p} />
  ),
  code: ({ className, ...p }) =>
    className ? (
      <code className={className} {...p} />
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />
    ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
