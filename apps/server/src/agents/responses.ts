import { type WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { eventSubjects } from './perception.js';
import type { ResponseAction, ResponseResolver, TriageContext } from './triage.js';

/**
 * 响应动作注册表(10-cognition §7.1 ④):世界事件→明确响应动作的查表层,
 * 与 triage 解耦(triageEvent 经 resolver 参数调用,避免循环依赖)。
 * 现阶段两条规则:附近有人倒下→前往查看(move,打断当前块);自己获救→当面道谢
 * (instant chat,不打断活动)。其余事件返回 null(g4_no_action),C4 社交通路再扩充。
 */

const RESCUE_THANKS_LINE = '多谢相救！';

export class ResponseRegistry {
  /** 救援台账:待救角色 id→救援者 id(获救道谢依据) */
  private readonly rescueBy = new Map<string, string>();

  /** 事件簿记:台账只由 work_task.accepted(task=rescue) 喂——revived 先于
   * completed 发出,若由 completed 喂则 revived 时查无救援者 */
  observe(event: WorldEvent): void {
    if (event.type === 'work_task.accepted' && event.task === 'rescue') {
      this.rescueBy.set(event.targetId, event.characterId);
    } else if (event.type === 'work_task.completed' && event.task === 'rescue') {
      this.rescueBy.delete(event.targetId);
    } else if (event.type === 'character.auto_revived') {
      this.rescueBy.delete(event.characterId);
    }
  }

  /** 注册表查询(triageEvent 的 resolver 入口) */
  readonly resolve: ResponseResolver = (event, ctx) => this.describe(event, ctx);

  private describe(event: WorldEvent, ctx: TriageContext): ResponseAction | null {
    if (event.type === 'character.died') return this.goLook(event, ctx);
    if (event.type === 'character.revived') return this.thanksRescuer(event, ctx);
    return null;
  }

  /** 附近有人倒下:前往查看(move)——可救治窗口内才有可执行的动作 */
  private goLook(
    event: Extract<WorldEvent, { type: 'character.died' }>,
    ctx: TriageContext,
  ): ResponseAction | null {
    if (!event.revivable) return null;
    const subjectId = eventSubjects(event)[0];
    if (subjectId === undefined || subjectId === ctx.characterId) return null;
    const pos = ctx.positionOf(subjectId);
    if (pos === null) return null;
    const name = ctx.nameOf(subjectId);
    return {
      kind: 'move',
      label: `过去看看${name}`,
      semantic: `${name}倒下了,情况危急`,
      subjectId,
      intent: { type: 'move_to', characterId: ctx.characterId, x: pos.x, y: pos.y },
    };
  }

  /** 自己获救:当面道谢(instant chat);救援者已不在身边则无从谢起 */
  private thanksRescuer(
    event: Extract<WorldEvent, { type: 'character.revived' }>,
    ctx: TriageContext,
  ): ResponseAction | null {
    if (event.characterId !== ctx.characterId) return null;
    const rescuerId = this.rescueBy.get(ctx.characterId);
    if (rescuerId === undefined) return null;
    const pos = ctx.positionOf(rescuerId);
    if (pos === null) return null;
    const distance = Math.abs(pos.x - ctx.x) + Math.abs(pos.y - ctx.y);
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) return null;
    const name = ctx.nameOf(rescuerId);
    return {
      kind: 'instant',
      label: `感谢${name}相救`,
      semantic: `我刚被救醒,救我的是${name}`,
      subjectId: rescuerId,
      intent: {
        type: 'chat',
        characterId: ctx.characterId,
        targetId: rescuerId,
        line: RESCUE_THANKS_LINE,
      },
    };
  }
}
