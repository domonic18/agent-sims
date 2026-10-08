import type { AgentDecisionMessage } from '@sims/shared';
import Phaser from 'phaser';
import { showSpeechBubble } from './speech';
import type { CharacterRender } from './character-view';

/** Agent 决策气泡(M4c):socket 线程推入,Phaser update 轮询排出——
 * 不进 React store,免每决策一次全页重渲染 */
const queue: AgentDecisionMessage[] = [];

export function pushDecisionMessage(message: AgentDecisionMessage): void {
  queue.push(message);
}

export function drainDecisionMessages(): AgentDecisionMessage[] {
  return queue.splice(0);
}

/** 决策气泡(暖金描边区分社交对话),角色视图未就绪/幽灵态静默丢弃 */
export function flushDecisionBubbles(
  scene: Phaser.Scene,
  views: Map<string, CharacterRender>,
): void {
  for (const message of drainDecisionMessages()) {
    const view = views.get(message.characterId);
    if (view === undefined || !view.alive) continue;
    showSpeechBubble(scene, view.node, message.text, { stroke: 0xc98a2d });
  }
}
