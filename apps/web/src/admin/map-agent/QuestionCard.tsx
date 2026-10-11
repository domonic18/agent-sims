/**
 * ask_user 问题卡(批C):渲染在输入框上方,选项点击即作为用户消息续跑
 * (`我选择:{label}`),同时清卡。close 仅收起不续跑。
 */
import { useAui } from '@assistant-ui/react';
import { CloseOutlined } from '@ant-design/icons';
import { useMapAgent } from './mapAgentStore';

export function MapAgentQuestionCard() {
  const question = useMapAgent((s) => s.question);
  const setQuestion = useMapAgent((s) => s.setQuestion);
  const aui = useAui();
  if (question === null) return null;

  return (
    <div
      style={{
        margin: '0 12px 8px',
        padding: 12,
        borderRadius: 8,
        border: '1px solid rgba(94,106,210,0.45)',
        background: 'rgba(21,24,36,0.95)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: '#c9cdd4' }}>{question.question}</p>
        <button
          type="button"
          aria-label="关闭问题卡"
          style={{ flexShrink: 0, border: 'none', background: 'transparent', padding: 0, fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
          onClick={() => setQuestion(null)}
        >
          <CloseOutlined />
        </button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {question.options.map((option) => {
          const recommended = question.default === option.value;
          return (
            <button
              key={option.value}
              type="button"
              style={{
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                transition: 'background 0.2s',
                border: `1px solid ${recommended ? '#5e6ad2' : 'rgba(255,255,255,0.14)'}`,
                color: recommended ? '#aeb4ff' : '#c9cdd4',
                background: recommended ? 'rgba(94,106,210,0.16)' : 'transparent',
              }}
              onClick={() => {
                aui.thread.append(`我选择:${option.label}`);
                setQuestion(null);
              }}
            >
              {option.label}
              {recommended ? '(推荐)' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
