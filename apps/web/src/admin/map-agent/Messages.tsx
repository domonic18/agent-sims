/**
 * 助手消息气泡(对齐 ai-invest):用户纯文本右对齐;助手 markdown 渲染
 * (Text 组件)+ 工具调用卡(tools.Fallback)+ 流式闪烁光标。
 */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { MarkdownText } from './MarkdownText';
import { ToolCallBlock } from './ToolCallBlock';

export function UserMessage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: '10px 10px 2px 10px',
          background: 'rgba(255,205,117,0.16)',
          color: '#f4f4f4',
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return <MarkdownText text={text} />;
}

function ToolCall({ toolName, args, result }: ToolCallMessagePartProps) {
  return <ToolCallBlock toolName={toolName} args={args} result={result} />;
}

export function AssistantMessage() {
  const isRunning = useAuiState((s) => s.message.status?.type === 'running');
  return (
    <div style={{ display: 'flex', marginBottom: 12 }}>
      <div
        style={{
          maxWidth: '92%',
          padding: '8px 12px',
          borderRadius: '10px 10px 10px 2px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid #343a58',
          fontSize: 13,
          lineHeight: 1.55,
          wordBreak: 'break-word',
        }}
      >
        <MessagePrimitive.Content components={{ Text: AssistantText, tools: { Fallback: ToolCall } }} />
        {isRunning === true && <span className="sims-agent-caret" style={{ marginLeft: 2, width: 7, height: 14, background: '#ffcd75' }}>▍</span>}
      </div>
    </div>
  );
}
