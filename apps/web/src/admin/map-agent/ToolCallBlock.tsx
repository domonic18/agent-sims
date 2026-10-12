/**
 * 工具调用卡(对齐 ai-invest ToolCallBlock):运行中 spinner,完成后
 * 可折叠查看参数/结果 JSON。assistant-ui tools.Fallback 渲染入口。
 */
import { CaretRightOutlined, LoadingOutlined } from '@ant-design/icons';
import { useState, type ReactNode } from 'react';

const MUTED = '#94b0c2';
const BORDER = '#343a58';

const TOOL_LABELS: Record<string, string> = {
  read_map: '读取地图',
  read_map_full: '读取完整地图',
  edit_map: '编辑地图',
  write_map: '重写地图',
  generate_map: '生成地图',
  validate_map: '布局体检',
  ask_user: '向用户提问',
  write_todos: '更新执行计划',
};

function JsonView({ label, value }: { label: string; value: unknown }): ReactNode {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{label}</div>
      <pre
        style={{
          margin: 0, maxHeight: 180, overflow: 'auto', padding: 8, fontSize: 11, lineHeight: 1.5,
          borderRadius: 6, border: `1px solid ${BORDER}`, background: '#141628', color: '#c9cdd4', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function ToolCallBlock({ toolName, args, result }: { toolName: string; args: unknown; result?: unknown }) {
  const [open, setOpen] = useState(false);
  const running = result === undefined || result === null;
  const hasBody = args !== undefined && args !== null && Object.keys(args as object).length > 0;
  return (
    <div style={{ margin: '6px 0', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'rgba(122,162,247,0.06)', fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', gap: 6, padding: '5px 8px',
          border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, textAlign: 'left',
        }}
      >
        <CaretRightOutlined style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: 10 }} />
        {running ? <LoadingOutlined style={{ color: '#ffcd75' }} /> : <span style={{ color: '#7aa2f7' }}>✓</span>}
        <span style={{ color: '#c9cdd4' }}>{TOOL_LABELS[toolName] ?? toolName}</span>
        <span style={{ fontSize: 11 }}>{running ? '运行中…' : '已完成'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          {hasBody && <JsonView label="参数" value={args} />}
          {!running && <JsonView label="结果" value={result} />}
        </div>
      )}
    </div>
  );
}
