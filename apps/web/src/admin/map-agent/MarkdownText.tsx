/**
 * 助手消息 Markdown 渲染(对齐 ai-invest):react-markdown + remark-gfm,
 * 表格/列表/代码块(带复制)/引用/链接按 admin 主题配色。inline 与块级
 * code 用 Context 区分(ai-invest 同款 pre 包 Provider 技巧)。
 */
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TEXT = '#f4f4f4';
const MUTED = '#94b0c2';
const BORDER = '#343a58';

const CodeBlockContext = createContext(false);

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用静默
    }
  };
  return (
    <div style={{ position: 'relative', margin: '8px 0', overflow: 'hidden', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#141628' }}>
      <button
        type="button"
        onClick={() => void copy()}
        title="复制"
        style={{
          position: 'absolute', right: 6, top: 6, padding: 2, fontSize: 11, lineHeight: 1,
          border: 'none', borderRadius: 4, cursor: 'pointer', color: MUTED, background: 'transparent',
        }}
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
      </button>
      <pre style={{ maxHeight: 320, overflow: 'auto', margin: 0, padding: '8px 28px 8px 10px', fontSize: 12, lineHeight: 1.55, color: '#c9cdd4' }}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  code({ children }) {
    const text = String(children ?? '');
    const insideBlock = useContext(CodeBlockContext);
    if (insideBlock) return <CodeBlock text={text} />;
    return <code style={{ padding: '1px 4px', borderRadius: 4, background: 'rgba(255,205,117,0.16)', color: '#ffcd75', fontSize: '0.92em' }}>{text}</code>;
  },
  pre({ children }) {
    return <CodeBlockContext.Provider value={true}><div>{children}</div></CodeBlockContext.Provider>;
  },
  p({ children }) {
    return <p style={{ margin: '0 0 6px', lineHeight: 1.65 }}>{children}</p>;
  },
  strong({ children }) {
    return <strong style={{ color: TEXT }}>{children}</strong>;
  },
  ul({ children }) {
    return <ul style={{ margin: '4px 0 8px', paddingLeft: 18, listStyle: 'disc', display: 'grid', gap: 2 }}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={{ margin: '4px 0 8px', paddingLeft: 18, listStyle: 'decimal', display: 'grid', gap: 2 }}>{children}</ol>;
  },
  blockquote({ children }) {
    return (
      <blockquote style={{ margin: '8px 0', padding: '2px 0 2px 10px', borderLeft: `2px solid rgba(255,205,117,0.5)`, background: 'rgba(255,205,117,0.05)', color: MUTED }}>
        {children}
      </blockquote>
    );
  },
  table({ children }) {
    return (
      <div style={{ margin: '8px 0', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead style={{ background: 'rgba(255,255,255,0.06)' }}>{children}</thead>;
  },
  th({ children }) {
    return <th style={{ border: `1px solid ${BORDER}`, padding: '4px 8px', textAlign: 'left', fontWeight: 500, color: TEXT }}>{children}</th>;
  },
  td({ children }) {
    return <td style={{ border: `1px solid ${BORDER}`, padding: '4px 8px', color: '#c9cdd4' }}>{children}</td>;
  },
  h1({ children }) {
    return <h1 style={{ margin: '10px 0 6px', fontSize: 15, fontWeight: 600, color: TEXT }}>{children}</h1>;
  },
  h2({ children }) {
    return <h2 style={{ margin: '10px 0 6px', fontSize: 14, fontWeight: 600, color: TEXT }}>{children}</h2>;
  },
  h3({ children }) {
    return <h3 style={{ margin: '8px 0 4px', fontSize: 13, fontWeight: 600, color: TEXT }}>{children}</h3>;
  },
  a({ children, href }) {
    return <a href={href} target="_blank" rel="noreferrer" style={{ color: '#7aa2f7', textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>;
  },
  hr() {
    return <hr style={{ margin: '10px 0', border: 'none', borderTop: `1px solid ${BORDER}` }} />;
  },
};

export function MarkdownText({ text }: { text: string }) {
  return (
    <div style={{ color: '#c9cdd4', wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}
