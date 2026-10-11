/** 助手 Thread 视图(批C):消息流+问题卡+输入框;历史加载骨架与运行中指示。 */
import { ComposerPrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { AssistantMessage, UserMessage } from './Messages';
import { MapAgentQuestionCard } from './QuestionCard';

function RunningIndicator() {
  return (
    <ThreadPrimitive.If running>
      <div style={{ marginBottom: 12, paddingLeft: 12 }} aria-label="助手正在处理">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: '#6b7280',
                animation: 'bounce 1s infinite',
                animationDelay: `${i * 160}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </ThreadPrimitive.If>
  );
}

export function MapAgentThread() {
  const isLoading = useAuiState((s) => s.thread.isLoading);
  return (
    <ThreadPrimitive.Root style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ThreadPrimitive.Viewport
        autoScroll
        style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', minHeight: 0 }}
      >
        {isLoading ? (
          <div aria-busy="true" aria-label="正在加载会话记录" style={{ padding: 8 }}>
            {[140, 220, 180].map((w, i) => (
              <div
                key={i}
                style={{
                  height: 14,
                  width: w,
                  marginBottom: 10,
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.08)',
                  animation: 'pulse 1.4s infinite',
                }}
              />
            ))}
          </div>
        ) : (
          <>
            <ThreadPrimitive.Empty>
              <div style={{ padding: '24px 8px', textAlign: 'center', color: '#6b7280', fontSize: 12, lineHeight: 1.8 }}>
                描述你想要的改动,例如:
                <br />
                「生成一张紧凑的 survival 小镇」
                <br />
                「把商店移到广场东侧,门口加路灯」
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <RunningIndicator />
          </>
        )}
      </ThreadPrimitive.Viewport>
      <MapAgentQuestionCard />
      <ComposerPrimitive.Root
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          margin: '0 12px 12px',
          padding: 8,
          borderRadius: 8,
          border: '1px solid #2b3157',
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        <ComposerPrimitive.Input
          rows={1}
          placeholder="描述改图需求…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: '#e6e8ef',
            fontSize: 13,
            resize: 'none',
          }}
        />
        <ComposerPrimitive.Send
          style={{
            border: 'none',
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            cursor: 'pointer',
            background: '#5e6ad2',
            color: '#fff',
          }}
        >
          发送
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}
