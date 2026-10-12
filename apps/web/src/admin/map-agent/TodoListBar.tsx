/**
 * 执行计划条(对齐 ai-invest TodoListBar):write_todos 状态经 updates
 * 通道实时推进,展示 ✓/◐/○ 三态,进行中脉冲、完成划线。
 */
import type { MapAgentTodo } from '@sims/shared';
import type { ReactElement } from 'react';
import { useMapAgent } from './mapAgentStore';

const MARKERS: Record<MapAgentTodo['status'], string> = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
};

export function TodoListBar(): ReactElement | null {
  const todos = useMapAgent((s) => s.todos);
  if (todos === null || todos.length === 0) return null;
  return (
    <div style={{ borderBottom: '1px solid #262b47', padding: '8px 14px 6px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
        执行计划 {todos.filter((t) => t.status === 'completed').length}/{todos.length}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3 }}>
        {todos.map((todo, i) => {
          const color = todo.status === 'in_progress' ? '#ffcd75' : todo.status === 'completed' ? '#6b7280' : '#94b0c2';
          return (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color }}>
              <span className={todo.status === 'in_progress' ? 'sims-agent-pulse' : ''} style={{ width: 14, flexShrink: 0, textAlign: 'center' }}>
                {MARKERS[todo.status]}
              </span>
              <span style={todo.status === 'completed' ? { textDecoration: 'line-through' } : undefined}>{todo.content}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
