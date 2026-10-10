import { type WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { eventSubjects } from './perception.js';
import type { ResponseAction, ResponseResolver, TriageContext } from './triage.js';

/**
 * 响应动作注册表(10-cognition §7.1 ④;E6.2 respond→冲动):世界事件→明确响应
 * 意图的查表层,与 triage 解耦(triageEvent 经 resolver 参数调用,避免循环依赖)。
 * 产出「此刻想做的一件事」(事件 want 载荷)而非动作——调度泵写入意图存储后由
 * wantSelect 评分择条,抢占=评分不是特批。现阶段两条规则:附近有人倒下→去看看
 * (救援查看 want,urgency 按好感加权);自己获救→找恩人道谢(人指向社交 want,
 * 复用两阶段会合管线)。其余事件返回 null(g4_no_action),C4 社交通路再扩充。
 */

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

  /** 附近有人倒下:去看看(move 门控)——救援查看 want,urgency 按好感加权
   * (陌生人 0.85 起步,挚友可达 0.95);到场即完成,救治走救治窗口自身机制 */
  private goLook(
    event: Extract<WorldEvent, { type: 'character.died' }>,
    ctx: TriageContext,
  ): ResponseAction | null {
    if (!event.revivable) return null;
    const subjectId = eventSubjects(event)[0];
    if (subjectId === undefined || subjectId === ctx.characterId) return null;
    const pos = ctx.positionOf(subjectId);
    if (pos === null) return null;
    const affinity = ctx.affinityOf?.(subjectId) ?? 0;
    const name = ctx.nameOf(subjectId);
    return {
      kind: 'move',
      label: `过去看看${name}`,
      semantic: `${name}倒下了,情况危急`,
      subjectId,
      want: {
        activityId: 'rescue',
        targetCharacterId: subjectId,
        urgency:
          BALANCE.EVENT_WANT_RESCUE_URGENCY +
          BALANCE.EVENT_WANT_URGENCY_AFFINITY_SCALE * (affinity / 100),
      },
    };
  }

  /** 自己获救:找恩人道谢(instant 门控)——人指向社交 want,带 target 走
   * 两阶段会合管线生成对话;恩人不在则无从谢起 */
  private thanksRescuer(
    event: Extract<WorldEvent, { type: 'character.revived' }>,
    ctx: TriageContext,
  ): ResponseAction | null {
    if (event.characterId !== ctx.characterId) return null;
    const rescuerId = this.rescueBy.get(ctx.characterId);
    if (rescuerId === undefined) return null;
    const pos = ctx.positionOf(rescuerId);
    if (pos === null) return null;
    const name = ctx.nameOf(rescuerId);
    return {
      kind: 'instant',
      label: `感谢${name}相救`,
      semantic: `我刚被救醒,救我的是${name}`,
      subjectId: rescuerId,
      want: {
        activityId: 'socialize',
        targetCharacterId: rescuerId,
        urgency: BALANCE.EVENT_WANT_THANKS_URGENCY,
      },
    };
  }
}
