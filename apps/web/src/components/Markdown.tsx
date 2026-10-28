import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ source }: { source: string }) {
  return (
    <div className="docs-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // scrollable code blocks must be reachable with the keyboard
          pre: ({ node: _node, ...props }) => <pre tabIndex={0} {...props} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
