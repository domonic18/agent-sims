import { getActivityDefinition } from '@sims/shared';
import type { ActivityFinishedEvent } from '@sims/shared';

/**
 * 记忆评价引擎(D4,agent-design §4.3 记忆层):把「我做了 X N 分钟」的执行器流水账
 * 升级为带主观判定的经历。verdict 由确定性数值分纯函数裁决(偏好匹配/体力收益/
 * 社交获得/计划-实际偏差/当时 mood 五维),评价句从第一人称措辞池随机取——
 * 同样是散步,昨天「透透气」,今天「没什么特别」。重要活动(|bias|满/有社交获得/
 * 被打断)由调用方追加轻槽 LLM 一句话复盘,本模块只管模板层。
 */

export type ActivityVerdict = 'good' | 'ok' | 'bad';

export interface ActivityEvalInput {
  activityId: string;
  elapsedMinutes: number;
  reason: ActivityFinishedEvent['reason'];
  /** 活动倾向分(biasOf 编译偏好):+1 喜欢/-1 排斥/0 中性 */
  bias: number;
  /** 当时情绪 valence(-1~1,innerState.mood),无镜像传 null */
  moodValence: number | null;
  /** 进行中 want 的第一人称理由(计划对齐时措辞更有「如愿感」),无意图传 null */
  wantWhy: string | null;
  /** 活动期间与人的聊天次数(社交获得),默认 0 */
  socialGain?: number;
}

export interface ActivityEvalResult {
  verdict: ActivityVerdict;
  /** 第一人称评价句(拼在事实行之后,替换裸流水账) */
  sentence: string;
  /** 值得轻槽 LLM 复盘(高偏好偏差/社交获得/被打断) */
  important: boolean;
}

/** 按活动的第一人称评价句池(随机取一,消灭同款模板) */
const VERDICT_SENTENCES: Record<ActivityVerdict, readonly string[]> = {
  good: ['这趟挺对味', '不虚此行,心情不错', '没想到这么带劲', '这波很值'],
  ok: ['就那样吧,平平常常', '说不上好坏,反正过去了', '没什么特别的感觉'],
  bad: ['挺不尽兴的', '有点憋屈,不想再来一次', '感觉浪费了时间'],
};

export function evaluateActivity(input: ActivityEvalInput): ActivityEvalResult {
  const definition = getActivityDefinition(input.activityId);
  const socialGain = input.socialGain ?? 0;

  // 五维数值分(确定性):verdict 裁决与措辞解耦,情绪/记忆两侧可独立取用
  let score = 0;
  if (input.bias === 1) score += 1;
  if (input.bias === -1) score -= 1;
  if (input.reason === 'completed') score += 0.4;
  if (input.reason === 'stopped') score -= 0.3;
  // 体力收益:净速率×时长,大耗体扣分,净回复加分(rest/meal 速率为正时)
  const netEnergy = (definition?.effects.energy ?? 0) * input.elapsedMinutes;
  if (netEnergy <= -12) score -= 0.25;
  if (netEnergy > 0) score += 0.2;
  if (socialGain > 0) score += 0.3;
  if (input.moodValence !== null) {
    if (input.moodValence >= 0.3) score += 0.2;
    if (input.moodValence <= -0.3) score -= 0.2;
  }
  const verdict: ActivityVerdict = score >= 0.8 ? 'good' : score <= -0.8 ? 'bad' : 'ok';

  const parts: string[] = [];
  const pool = VERDICT_SENTENCES[verdict];
  parts.push(pool[Math.floor(Math.random() * pool.length)]!);
  // 计划-实际偏差:如愿完成/半路被打断/囊中羞涩,偏差叙述是最有信息量的素材
  if (input.reason === 'interrupted') parts.push('半路被打断,心里有点堵');
  if (input.reason === 'insufficient_coins') parts.push('囊中羞涩没能尽兴');
  if (input.reason === 'completed' && input.wantWhy !== null && input.wantWhy.trim() !== '') {
    parts.push(`本来想着「${input.wantWhy.trim()}」,算是如愿了`);
  }
  if (socialGain > 0) parts.push('顺道还聊了几句');
  if (input.bias === 1 && verdict !== 'bad') parts.push('正合我的心意');
  if (input.bias === -1) parts.push('本就不爱这一口');
  if (netEnergy <= -12 && verdict === 'good') parts.push('就是累得够呛');

  return {
    verdict,
    sentence: parts.join(','),
    important: Math.abs(input.bias) === 1 || socialGain > 0 || input.reason === 'interrupted',
  };
}
