/** 助手消息气泡(批C):MessagePrimitive.Content 渲染文本;工具调用细节 v1 不展示。 */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';

export function UserMessage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: '10px 10px 2px 10px',
          background: 'rgba(94,106,210,0.28)',
          color: '#e6e8ef',
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

export function AssistantMessage() {
  const isLast = useAuiState((s) => s.message.isLast);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <div style={{ display: 'flex', marginBottom: 12 }}>
      <div
        style={{
          maxWidth: '92%',
          padding: '8px 12px',
          borderRadius: '10px 10px 10px 2px',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid #2b3157',
          color: '#c9cdd4',
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <MessagePrimitive.Content />
        {isLast !== undefined && isRunning !== undefined && isLast && isRunning && (
          <span style={{ color: '#6b7280' }}> ▍</span>
        )}
      </div>
    </div>
  );
}
