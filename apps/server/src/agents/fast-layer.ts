import {
  BASIC_ACTIVITY_IDS,
  CRAFT_RECIPE_IDS,
  findPlaceAt,
  findPlaceByRef,
  GATHER_TASKS,
  getActivityDefinition,
  getItem,
  getRecipe,
  isLeaseValid,
  JOB_CATEGORIES,
  getPropertyDefinition,
  ITEMS,
  resourceNodeLabel,
  type ActivityDefinition,
  type Intent,
  type PlaceDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { DayIntents, Want } from './cognition.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';

/** jev 冲动 want 载荷(E6 统一意图架构,System 1 输出):jev 不再直执——
 * 概率采样产出冲动,调度泵写入意图存储(origin=impulse)后立即重入 wantSelect
 * 择条执行;冲动紧迫度低、带半衰期,会自然消退 */
export interface ImpulseWant {
  activityId: string;
  why: string;
  targetCharacterId?: string;
}

/** 快层判定输出(agent-design §4.3):continue=当前行为仍有效零模型;react=产出一个意图交执行。
 * D3:plan 层改执行弹性意图(wantSelect),wantId 标记本条决策对应的 want,
 * abandonedWantIds 收录当场判不可执行须废弃的 want(调度泵落库);
 * E6:jev 层 react 改携带 impulse(冲动 want,泵落库);socialize want 贴身时
 * 携带 chatWith(聊天交还社交管线执行,want 由 social.chat 结算);
 * E6.2:doneWantIds 收录当场判已达成须收口为 done 的 want(驱力压力已过/救援已到场) */
/** 仲裁候选观测条目(观测性):wantSelect 每轮候选集的评分快照,进 select trace */
export interface WantCandidateDebug {
  id: string;
  activityId: string;
  origin: string;
  urgency: number;
  score: number;
  /** 落选原因: seize=在契保护(挑战者分差不足) | score=评分落选 | energy=体力闸 */
  reject?: string;
}

export interface Decision {
  layer: 'rule' | 'plan' | 'jev' | 'triage';
  action: 'continue' | 'react';
  /** continue 时的不可执行原因(观测性):仲裁-执行失配排查靠它免读代码——
   * energy_gate=体力闸 | drive_channel_gone/drive_satisfied/drive_stuck=驱力通道 |
   * target_missing=寻人目标不在 | chat_generating/summon_awaiting/chat_cooldown=会合协议静候 |
   * node_depleted=采集节点空 | backpack_empty=卖货无货 | no_explore_target/craft_no_place/no_spot=无处可去 */
  reason?: string;
  intent?: Intent;
  /** react 时的决策气泡文案(意图+理由模板) */
  bubble?: string;
  /** plan 层:本条决策对应的 want(调度泵标 doing 并落库) */
  wantId?: string;
  /** plan 层:当场判不可执行须标 abandoned 的 want 列表(调度泵落库) */
  abandonedWantIds?: string[];
  /** plan 层:当场判已达成须标 done 的 want 列表(调度泵落库;E6.2 驱力/事件 want 收口) */
  doneWantIds?: string[];
  /** plan 层:本轮仲裁候选集评分快照(观测性,调度泵落 select trace 后即弃) */
  debugCandidates?: WantCandidateDebug[];
  /** jev 层:选中候选标签(E5 观测口径,进 trace 供选择分布聚合) */
  choice?: string;
  /** jev 层:概率采样产出的冲动 want(调度泵落库后即时择条) */
  impulse?: ImpulseWant;
  /** plan 层:socialize want 已贴身,聊天交还社交管线两阶段会合(值=target;
   * 首触=召唤零模型,对方应答才生成) */
  chatWith?: string;
}

/** rule 层世界查询(E1 依赖注入,与 anchorsOf 同款):货架余量/可食节点/倾向分,
 * 缺省项按「不限」处理(纯单测可只传用到的) */
export interface RuleWorldQueries {
  /** 货架余量(itemId→份数):饥饿选品与让行判定读 */
  shopStock?: (itemId: string) => number;
  /** 最近有存量的可食节点(浆果丛/苹果树;null=暂无):直采逃生门读 */
  nearestEdibleNode?: (from: { x: number; y: number }) => { id: string; x: number; y: number } | null;
  /** 活动倾向分(方针/人设编译):贫困选岗保人设 */
  bias?: Readonly<Record<string, number>>;
}

// ---------- 驱力层(E6.2 rule→驱力):压力→urgency,执行归 wantSelect 分支 ----------

/** 驱力 want 词汇(E6.2,驱力专用伪活动 id,非活动定义):eat=吃/买/去商店,
 * earn=变现/贫困选岗,forage=直采逃生,sleep=回床或长椅(复用真实活动 id,
 * 结算走 activity.finished;执行可能是 start_activity sleep 或 rest) */
export const DRIVE_ACTIVITY_IDS = ['eat', 'earn', 'forage', 'sleep'] as const;
export type DriveActivityId = (typeof DRIVE_ACTIVITY_IDS)[number];

export function isDriveActivity(activityId: string): boolean {
  return (DRIVE_ACTIVITY_IDS as readonly string[]).includes(activityId);
}

/** 驱力压力(E6.2):恒稳态压力的 want 载荷——生成器只答「我多想要」(压力→urgency),
 * 「怎么做」归 wantSelect 驱力分支(01-agent-design §3.3 规则②) */
export interface DrivePressure {
  activityId: DriveActivityId;
  urgency: number;
  why: string;
}

/** 选食(E4):能量降序、同能量价低优先——高密度先吃快速脱离饥饿区,低密度浆果留存可卖 */
function pickBackpackFood(backpack: Record<string, number | undefined>): string | null {
  const foods = Object.keys(backpack)
    .filter((id) => (backpack[id] ?? 0) > 0 && getItem(id)?.category === 'food')
    .map((id) => ({
      id,
      energy: getItem(id)?.effects?.energy ?? 0,
      price: getItem(id)?.price ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => b.energy - a.energy || a.price - b.price);
  return foods[0]?.id ?? null;
}

/** 进食通道可用性:背包有食物,或商店有货且买得起(写侧预检,与执行分支同源) */
function eatChannelAvailable(char: WorldCharacter, world: RuleWorldQueries): boolean {
  if (pickBackpackFood(char.backpack) !== null) return true;
  const cheapest = cheapestStockedFood(world.shopStock);
  return cheapest !== null && char.coins >= cheapest.price;
}

/** 谋生通道可用性(E1):背包有可卖物,或贫困岗位池非空(服务岗须知识够) */
function earnChannelAvailable(char: WorldCharacter, world: RuleWorldQueries): boolean {
  const sellable = Object.entries(char.backpack).some(
    ([id, count]) => (count ?? 0) > 0 && getItem(id)?.price !== undefined,
  );
  return sellable || povertyJob(char, world.bias) !== null;
}

/** 直采通道可用性(E1/E4):背包无食物、体力在直采窗、最近有可食节点 */
function forageChannelAvailable(char: WorldCharacter, world: RuleWorldQueries): boolean {
  if (char.energy <= BALANCE.FORAGE_MIN_ENERGY) return false;
  if (Object.keys(char.backpack).some((id) => getItem(id)?.category === 'food')) return false;
  return (world.nearestEdibleNode?.({ x: char.x, y: char.y }) ?? null) !== null;
}

/** 就寝通道可用性(D3/E1):回床(居所+租约有效+床锚点)或公园长椅,总有一条落点 */
function sleepyChannelAvailable(
  char: WorldCharacter,
  day: number,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
): boolean {
  const homePlaceId = char.housing === null ? undefined : getPropertyDefinition(char.housing.propertyId)?.placeId;
  const beds =
    homePlaceId !== undefined && isLeaseValid(char.housing, day) ? anchorsOf('sleep', homePlaceId) : [];
  return beds.length > 0 || anchorsOf('rest', 'park').length > 0;
}

/** 驱力巡检(E6.2 rule→驱力,零模型):恒稳态压力→驱力 want 载荷(origin=drive)。
 * 不再产动作——饥饿族按 E1 逃生梯互斥(能买→eat,买不到→谋生 earn,也无岗→直采
 * forage);睡眠独立评估(可与饥饿并存,由评分竞争)。rent 不在此列——账单不是行为,
 * 续租保持即时结算(rentDecision)。 */
export function driveDecide(
  char: WorldCharacter,
  day: number,
  minuteOfDay: number,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
  world: RuleWorldQueries = {},
): DrivePressure[] {
  if (!char.alive || char.collapsed) return [];
  const pressures: DrivePressure[] = [];
  const hungry = char.energy <= BALANCE.HUNGER_EAT_ENERGY;
  if (hungry && eatChannelAvailable(char, world)) {
    const deficit = (BALANCE.HUNGER_EAT_ENERGY - char.energy) / BALANCE.HUNGER_EAT_ENERGY;
    pressures.push({
      activityId: 'eat',
      urgency: BALANCE.DRIVE_EAT_URGENCY_BASE + BALANCE.DRIVE_EAT_URGENCY_SCALE * deficit,
      why: '体力低了,得吃点东西',
    });
  } else if (
    char.coins < BALANCE.POVERTY_COIN_LINE &&
    char.energy >= BALANCE.POVERTY_MIN_ENERGY &&
    earnChannelAvailable(char, world)
  ) {
    pressures.push({ activityId: 'earn', urgency: BALANCE.DRIVE_EARN_URGENCY, why: '口袋见底,得挣点钱了' });
  } else if (hungry && forageChannelAvailable(char, world)) {
    pressures.push({
      activityId: 'forage',
      urgency: BALANCE.DRIVE_FORAGE_URGENCY,
      why: '饿得不行,店也没的买,采点吃的',
    });
  }
  const night = minuteOfDay >= BALANCE.NIGHT_START_MINUTE || minuteOfDay < BALANCE.NIGHT_END_MINUTE;
  const sleepyLine = night ? BALANCE.SLEEPY_NIGHT_ENERGY : BALANCE.SLEEPY_DAY_ENERGY;
  if (char.energy <= sleepyLine && sleepyChannelAvailable(char, day, anchorsOf)) {
    pressures.push({
      activityId: 'sleep',
      urgency: night ? BALANCE.DRIVE_SLEEP_NIGHT_URGENCY : BALANCE.DRIVE_SLEEP_DAY_URGENCY,
      why: night ? '夜深了,困得睁不开眼' : '困意上头,得歇会儿',
    });
  }
  return pressures;
}

/** 驱力压力是否已缓解(写侧收口口径):缓解的驱力 want 标 done,通道消失标 abandoned */
export function driveSatisfied(
  char: WorldCharacter,
  activityId: string,
  minuteOfDay: number,
): boolean {
  switch (activityId) {
    case 'eat':
    case 'forage':
      return char.energy > BALANCE.HUNGER_EAT_ENERGY;
    case 'earn':
      return char.coins >= BALANCE.POVERTY_COIN_LINE;
    case 'sleep': {
      const night = minuteOfDay >= BALANCE.NIGHT_START_MINUTE || minuteOfDay < BALANCE.NIGHT_END_MINUTE;
      return char.energy > (night ? BALANCE.SLEEPY_NIGHT_ENERGY : BALANCE.SLEEPY_DAY_ENERGY);
    }
    default:
      // 非驱力词汇活动 id(socialize 等真实活动)不属驱力收口范畴——曾有
      // default:true 把 idleSocialStep 点火的 drive 源社交 want 在写入后一个
      // fast 步就结算 done,聊天执行链永远拿不到它(对话结构性零落地),
      // hasSocialWant 去重随之失效变 2 秒点火循环;其终裁归 social.chat/寻人失败
      return false;
  }
}

/** 房租即时结算(E6 定稿口径:账单不是行为,不走意图存储):租约次日到期且有支付能力→续租 */
export function rentDecision(char: WorldCharacter, day: number): Decision | null {
  const housing = char.housing;
  if (housing === null || housing.ownership !== 'rent') return null;
  if (housing.paidThroughDay - day > 1) return null;
  const property = getPropertyDefinition(housing.propertyId);
  if (property === null || char.coins < property.rentPrice) return null;
  return {
    layer: 'rule',
    action: 'react',
    intent: { type: 'rent_property', characterId: char.id, propertyId: housing.propertyId },
    bubble: `房租快到期了,续租${property.name}`,
  };
}

/** 贫困岗位池排序(E1):服务三岗须知识够;倾向分(保人设)×10 压过时薪差,
 * 无方针/人设编译时按时薪取(服务 1.0 > 杂工 0.8) */
function povertyJob(char: WorldCharacter, bias: Readonly<Record<string, number>> = {}): string | null {
  const pool = (['waiter', 'vendor', 'librarian', 'work'] as const)
    .filter((id) => {
      const definition = getActivityDefinition(id);
      if (definition === null) return false;
      if (definition.category === undefined) return true;
      return char.knowledge >= JOB_CATEGORIES[definition.category].requiredKnowledge;
    })
    .map((id) => ({
      id,
      score: (bias[id] ?? 0) * 10 + getActivityDefinition(id)!.effects.coins,
    }))
    .sort((a, b) => b.score - a.score);
  return pool[0]?.id ?? null;
}

/** 驱力 want 执行结果(E6.2 唯一执行器侧):done=压力已过(收口 done);
 * stuck=通道消失(废弃改道,写侧重评);intent=两段式动作;null=本轮跳过 */
interface DriveExecution {
  intent?: Intent;
  bubble: string;
  done?: boolean;
  stuck?: boolean;
}

/** 驱力 want 执行分支(E6.2):「怎么做」自旧 rule 直执逐字平移——饥饿三段
 * (吃背包→店内买→去商店,E4 选食策略)、谋生两段(变现→贫困选岗,E1 保人设)、
 * 直采两段(远 node 邻位→贴身接单,E4)、就寝两段(回床→长椅兜底,E1 租约感知) */
function driveExecution(
  char: WorldCharacter,
  want: Want,
  day: number,
  night: boolean,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
  world: WantWorldQueries,
): DriveExecution | null {
  switch (want.activityId) {
    case 'eat': {
      if (char.energy > BALANCE.HUNGER_EAT_ENERGY) return { bubble: '', done: true };
      const foodId = pickBackpackFood(char.backpack);
      if (foodId !== null) {
        const food = getItem(foodId);
        return {
          intent: { type: 'eat_item', characterId: char.id, itemId: foodId },
          bubble: `体力低了,吃个${food?.name ?? foodId}`,
        };
      }
      const shop = findPlaceByRef(map, 'shop');
      if (shop === null) return { bubble: '', stuck: true };
      const cheapest = cheapestStockedFood(world.shopStock);
      if (findPlaceAt(map, char.x, char.y)?.id === shop.id) {
        if (cheapest !== null && char.coins >= cheapest.price) {
          return {
            intent: { type: 'buy_item', characterId: char.id, itemId: cheapest.id },
            bubble: `就在商店,买份${cheapest.name}垫垫肚子`,
          };
        }
        return { bubble: '', stuck: true }; // 没钱或店空:废弃改道(写侧逃生梯重评)
      }
      if (cheapest !== null && char.coins >= cheapest.price) {
        return {
          intent: { type: 'move_to', characterId: char.id, x: shop.entrance.x, y: shop.entrance.y },
          bubble: '肚子饿了,去商店买点吃的',
        };
      }
      return { bubble: '', stuck: true };
    }
    case 'earn': {
      if (char.coins >= BALANCE.POVERTY_COIN_LINE) return { bubble: '', done: true };
      const sellable = Object.entries(char.backpack).find(
        ([id, count]) => (count ?? 0) > 0 && getItem(id)?.price !== undefined,
      );
      if (sellable !== undefined) {
        const [itemId, count] = sellable;
        const shop = findPlaceByRef(map, 'shop');
        if (shop === null) return { bubble: '', stuck: true };
        const name = getItem(itemId)?.name ?? itemId;
        if (findPlaceAt(map, char.x, char.y)?.id === shop.id) {
          return {
            intent: { type: 'sell_item', characterId: char.id, itemId, count: count! },
            bubble: `口袋见底,把${name}卖给商店换点钱`,
          };
        }
        return {
          intent: { type: 'move_to', characterId: char.id, x: shop.entrance.x, y: shop.entrance.y },
          bubble: `口袋见底,拿${name}去商店卖钱`,
        };
      }
      const job = povertyJob(char, world.bias);
      if (job === null) return { bubble: '', stuck: true };
      const definition = getActivityDefinition(job)!;
      const anchors = anchorsOf(job, null);
      if (anchors.length > 0 ? onSpot(char, anchors) : inAnyPlace(map, char, definition.placeIds)) {
        return {
          intent: { type: 'start_activity', characterId: char.id, activityId: job },
          bubble: `得挣点钱了,去干${definition.name}`,
        };
      }
      const spot = activitySpot(map, job, definition.placeIds, anchors);
      if (spot === null) return { bubble: '', stuck: true };
      const placePart = spot.placeName === '' ? definition.name : `${spot.placeName}${definition.name}`;
      return {
        intent: { type: 'move_to', characterId: char.id, x: spot.x, y: spot.y },
        bubble: `得挣点钱了,去${placePart}`,
      };
    }
    case 'forage': {
      if (
        char.energy > BALANCE.HUNGER_EAT_ENERGY ||
        char.energy <= BALANCE.FORAGE_MIN_ENERGY ||
        Object.keys(char.backpack).some((id) => getItem(id)?.category === 'food')
      ) {
        return { bubble: '', done: true };
      }
      const node = world.nearestEdibleNode?.({ x: char.x, y: char.y }) ?? null;
      if (node === null) return { bubble: '', stuck: true };
      const dist = Math.abs(char.x - node.x) + Math.abs(char.y - node.y);
      if (dist > BALANCE.FORAGE_MOVE_THRESHOLD) {
        return {
          intent: { type: 'move_to', characterId: char.id, x: node.x, y: node.y },
          bubble: '饿得不行,店也没的买,过去采点吃的',
        };
      }
      return {
        intent: { type: 'work_task', characterId: char.id, targetId: node.id },
        bubble: '饿得不行,店也没的买,采点吃的',
      };
    }
    case 'sleep': {
      if (char.energy > (night ? BALANCE.SLEEPY_NIGHT_ENERGY : BALANCE.SLEEPY_DAY_ENERGY)) {
        return { bubble: '', done: true };
      }
      const homePlaceId = char.housing === null ? undefined : getPropertyDefinition(char.housing.propertyId)?.placeId;
      const beds =
        homePlaceId !== undefined && isLeaseValid(char.housing, day) ? anchorsOf('sleep', homePlaceId) : [];
      if (beds.length > 0) {
        if (onSpot(char, beds)) {
          return {
            intent: { type: 'start_activity', characterId: char.id, activityId: 'sleep' },
            bubble: night ? '夜深了,困得睁不开眼,上床睡觉' : '困意上头,回去补一觉',
          };
        }
        const home = findPlaceByRef(map, homePlaceId!);
        if (home !== null) {
          return {
            intent: { type: 'move_to', characterId: char.id, x: beds[0]!.x, y: beds[0]!.y },
            bubble: `困了,回${home.name}睡觉`,
          };
        }
      }
      // 长椅兜底(E1 租约感知):睡不了整觉但能回体力,消灭撞床循环
      const benches = anchorsOf('rest', 'park');
      if (benches.length === 0) return { bubble: '', stuck: true };
      if (onSpot(char, benches)) {
        return {
          intent: { type: 'start_activity', characterId: char.id, activityId: 'rest' },
          bubble: night ? '夜深了回不了家,公园长椅上眯一晚' : '困了,长椅上歇会儿',
        };
      }
      return {
        intent: { type: 'move_to', characterId: char.id, x: benches[0]!.x, y: benches[0]!.y },
        bubble: '困了,去公园长椅歇会儿',
      };
    }
    default:
      return null;
  }
}

/** 救援查看 want 执行(E6.2 respond→冲动):目标仍倒地→过去看;到场即完成查看
 * (救治走救治窗口自身机制);目标已起/已不在→当场完成(没事了/人散了) */
function rescueExecution(
  char: WorldCharacter,
  want: Want,
  world: WantWorldQueries,
): DriveExecution | null {
  if (want.targetCharacterId === undefined) return { bubble: '', done: true };
  const pos = world.posOfAny?.(want.targetCharacterId) ?? null;
  if (pos === null) return { bubble: '', done: true };
  if (pos.alive) return { bubble: '', done: true };
  const dist = Math.abs(char.x - pos.x) + Math.abs(char.y - pos.y);
  if (dist === 0) return { bubble: '', done: true };
  return {
    intent: { type: 'move_to', characterId: char.id, x: pos.x, y: pos.y },
    bubble: `过去看看${pos.name}`,
  };
}

function cheapestStockedFood(stockOf?: (itemId: string) => number): { id: string; name: string; price: number } | null {
  let best: { id: string; name: string; price: number } | null = null;
  for (const item of ITEMS) {
    if (item.category !== 'food' || item.price === undefined) continue;
    if (stockOf !== undefined && stockOf(item.id) <= 0) continue;
    if (best === null || item.price < best.price) {
      best = { id: item.id, name: item.name, price: item.price };
    }
  }
  return best;
}

/** jev 社交候选(10-cognition §7.2):动机引擎产出、调度泵拼好位置的异地熟人 */
export interface JevSocialCandidate {
  characterId: string;
  name: string;
  affinity: number;
  x: number;
  y: number;
}

/** jev 上下文(E5 状态感知):候选文案与题面按数值状态/当日意图动态化——
 * 散心加权/卖货导向/深夜降权全是文案级倾向(数值压力表达),无硬规则禁令 */
export interface JevContext {
  /** 深夜(NIGHT_START~NIGHT_END):公园文案降权 */
  night: boolean;
  /** 情绪效价(-1~1):低落时散心文案加权 */
  valence: number;
  /** 背包有带价物:商店候选(冲动=变现)仅此时出现 */
  hasSellable: boolean;
  /** 当日未完成 wants 的第一人称理由(顶 3):惦记的事进题面参与直觉竞争 */
  wantWhys: string[];
}

const EMPTY_JEV_CONTEXT: JevContext = {
  night: false,
  valence: 0,
  hasSellable: false,
  wantWhys: [],
};

/** 低落效价线:≤ 此值时公园候选改「散心加权」文案(情绪压力→行动倾向,非强制) */
const JEV_SAD_VALENCE = -0.3;

type JevCandidate =
  | { kind: 'place'; ref: 'shop' | 'park'; label: string; desc: string }
  | { kind: 'wander'; label: string; desc: string }
  | { kind: 'social'; characterId: string; label: string; desc: string };

/** 候选→冲动 want 映射(E6):直觉选中的是「此刻想做的事」而非动作——
 * 每个候选对应一个冲动活动 want,寻路/两段式等执行细节归 wantSelect 唯一执行器 */
function impulseFor(picked: JevCandidate): ImpulseWant {
  switch (picked.kind) {
    case 'social':
      return { activityId: 'socialize', why: picked.desc, targetCharacterId: picked.characterId };
    case 'wander':
      return { activityId: 'explore', why: picked.desc };
    case 'place':
      return picked.ref === 'park'
        ? { activityId: 'stroll', why: picked.desc }
        : { activityId: 'sell_goods', why: picked.desc };
  }
}

/** 概率采样(E6 System 1 通道变宽):优先按 probabilities 分布采样——直觉天然带
 * 不确定性,不必永远 argmax;分布缺失/非法回落 choice。confidence 低于门限视为
 * 没产生直觉(本次调用作废,回落 continue)。 */
function sampleChoice(
  candidates: readonly JevCandidate[],
  answer: { choice: string; probabilities: Record<string, number>; confidence: number } | undefined,
): JevCandidate | null {
  if (answer === undefined || answer.confidence < BALANCE.JEV_CONFIDENCE_MIN) return null;
  const weighted = candidates
    .map((candidate) => ({ candidate, p: answer.probabilities[candidate.label] }))
    .filter(
      (e): e is { candidate: JevCandidate; p: number } => typeof e.p === 'number' && e.p > 0,
    );
  const total = weighted.reduce((sum, e) => sum + e.p, 0);
  if (weighted.length > 0 && total > 0) {
    let roll = Math.random() * total;
    for (const e of weighted) {
      roll -= e.p;
      if (roll <= 0) return e.candidate;
    }
  }
  return candidates.find((c) => c.label === answer.choice) ?? null;
}

/** jev 冲动生成(E6 统一意图架构,System 1 通道):空闲角色在事件触发时用 systemone
 * choice 题「现在最想做什么」选一,产出**冲动 want**(origin=impulse)交意图存储——
 * 永不直接执行。C4 起社交候选与地点同池竞争(好感≥65 文案加权);E5 起状态感知
 * (题面注入惦记的 wants,候选按情绪/背包/昼夜动态措辞);E6 候选终点化到活动:
 * 公园→stroll want、出去转转→explore want、商店(仅背包有货时出现)→sell_goods want、
 * 找X聊天→socialize want(带 target)。选中标签落 decision.choice 供 trace 聚合。
 * 调用失败/无直觉返回 null(回落 continue)。 */
export async function jevDecide(
  llm: MemoryLlm,
  char: WorldCharacter,
  map: TileMapDefinition,
  socialCandidates: readonly JevSocialCandidate[] = [],
  persona?: string,
  context: JevContext = EMPTY_JEV_CONTEXT,
): Promise<Decision | null> {
  if (!char.alive || char.collapsed) return null; // 失能不越权(与 driveDecide 同门槛)
  if (char.activity !== null || char.path.length > 0) return null; // jev 只服务空闲角色,忙角色不白烧 LLM
  const here = findPlaceAt(map, char.x, char.y)?.id ?? null;
  const parkPlace = findPlaceByRef(map, 'park');
  const atPark = parkPlace !== null && here === parkPlace.id;
  const parkDesc = atPark
    ? '就在公园散会儿步'
    : context.night
      ? '夜深了,公园不是好去处'
      : context.valence <= JEV_SAD_VALENCE
        ? '心情有点沉,去公园透透气会舒服些'
        : '去公园走走散心';
  const candidates: JevCandidate[] = [
    // 商店候选仅在背包有货时出现(冲动=变现;买食物是 rule 层生存压力不归直觉)
    ...(context.hasSellable
      ? [{ kind: 'place' as const, ref: 'shop' as const, label: '商店', desc: '背包有货,拿去商店卖掉换钱' }]
      : []),
    { kind: 'place', ref: 'park', label: '公园', desc: parkDesc },
    { kind: 'wander', label: '出去转转', desc: '换个地方随便看看' },
    ...socialCandidates.map(
      (c): JevCandidate => ({
        kind: 'social',
        characterId: c.characterId,
        label: `找${c.name}聊天`,
        desc: c.affinity >= 65 ? `去找${c.name}聊聊,你们很投缘` : `去找${c.name}聊聊天`,
      }),
    ),
  ];
  // 当前所在处不再候选——公园例外:在园内候选语义变为「就地散步」(终点化)
  const eligible = candidates.filter((c) => c.kind !== 'place' || c.ref !== here || c.ref === 'park');
  if (eligible.length === 0) return null;
  const wantPart =
    context.wantWhys.length > 0 ? `(心里还惦记着: ${context.wantWhys.join(';')})` : '';
  try {
    const result = await llm.systemOne(
      'jev',
      `${char.name}${persona !== undefined ? `(人设: ${persona})` : ''}现在空闲${wantPart},凭直觉选一个此刻最想做的事`,
      {
        next: {
          type: 'choice',
          instructions: '选出此刻最想做的选择',
          criteria: Object.fromEntries(eligible.map((c) => [c.label, c.desc])),
        },
      },
      { taskType: 'agent.jev_micro', characterId: char.id },
    );
    const answer = result.answers.next;
    const picked = sampleChoice(eligible, answer?.type === 'choice' ? answer : undefined);
    if (picked === null) return null;
    return { layer: 'jev', action: 'react', choice: picked.label, impulse: impulseFor(picked) };
  } catch {
    return null; // jev 槽不可用:快层回落 rule/continue,绝不阻塞泵
  }
}

/** 活动目标格:锚点活动(书桌/床/跑步机)取使用格,无锚点取首个场所入口 */
function activitySpot(
  map: TileMapDefinition,
  activityId: string,
  placeIds: readonly string[],
  anchors: Array<{ x: number; y: number }>,
): { x: number; y: number; placeName: string } | null {
  // 合法集合内随机选点:同类活动逐次换工位/入园口,行动不再天天钉死同一格
  if (anchors.length > 0) {
    const a = anchors[Math.floor(Math.random() * anchors.length)]!;
    return { x: a.x, y: a.y, placeName: '' };
  }
  const places = placeIds.map((id) => findPlaceByRef(map, id)).filter((p) => p !== null);
  const place = places[Math.floor(Math.random() * places.length)];
  if (place === undefined || place === null) return null;
  return { x: place.entrance.x, y: place.entrance.y, placeName: place.name };
}

/** 探索目标:FNV-1a 按(角色,want)散列在场所集合内确定性选点——同一 want 重复决策
 * 命中同一目标(粘性,到位即开始),跨 want 自然换地方,不引入额外随机状态 */
export function exploreTarget(
  key: string,
  placeIds: readonly string[],
  map: TileMapDefinition,
): PlaceDefinition | null {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const places = placeIds.map((ref) => findPlaceByRef(map, ref)).filter((p) => p !== null);
  if (places.length === 0) return null;
  return places[Math.abs(hash) % places.length]!;
}

/** 探索 want 执行:目标场所内即就地开始;不在则走向目标入口 */
function exploreDecision(
  char: WorldCharacter,
  map: TileMapDefinition,
  wantKey: string,
  placeIds: readonly string[],
): { bubble: string; intent: Intent } | null {
  const target = exploreTarget(`${char.id}|${wantKey}`, placeIds, map);
  if (target === null) return null;
  const here = findPlaceAt(map, char.x, char.y);
  if (here?.id === target.id) {
    return {
      intent: { type: 'start_activity', characterId: char.id, activityId: 'explore' },
      bubble: `就在${target.name}逛逛,探索一下`,
    };
  }
  return {
    intent: { type: 'move_to', characterId: char.id, x: target.entrance.x, y: target.entrance.y },
    bubble: `去${target.name}一带探索`,
  };
}

function onSpot(char: WorldCharacter, spots: Array<{ x: number; y: number }>): boolean {
  return spots.some((s) => s.x === char.x && s.y === char.y);
}

function inAnyPlace(map: TileMapDefinition, char: WorldCharacter, placeIds: readonly string[]): boolean {
  return placeIds.some((id) => findPlaceAt(map, char.x, char.y)?.id === id);
}

function hasAnyPlace(map: TileMapDefinition, placeIds: readonly string[]): boolean {
  return placeIds.some((id) => findPlaceByRef(map, id) !== null);
}

/** 数值需求增益(D3 弹性意图择行;E4 缺钱扩容):缺钱工作欲↑/卖货变现↑/采集备货↑,
 * 钱多工作↓,疲惫休息就餐↑,没学识想学 */
function needBoost(char: WorldCharacter, activityId: string): number {
  if (char.coins < BALANCE.WANT_WORK_COIN_PRESSURE) {
    if (activityId === 'work') return 1.5;
    if (activityId === 'sell_goods') return 1.5; // 缺钱导向变现
    if (gatherNodeKind(activityId) !== null) return 1.3; // 缺钱导向采集备货
  }
  if (activityId === 'work' && char.coins >= BALANCE.WANT_WORK_COIN_SATIETY) return 0.6;
  if ((activityId === 'rest' || activityId === 'meal') && char.energy <= BALANCE.WANT_TIRED_ENERGY) {
    return 1.4;
  }
  if (activityId === 'study' && char.knowledge <= BALANCE.WANT_KNOWLEDGE_LOW) return 1.3;
  return 1;
}

/** 背包最值钱带价物(E4 卖货 want;E5 jev 商店文案导向复用):总价(价×量)最高者优先变现 */
export function bestSellable(backpack: Record<string, number | undefined>): { id: string; count: number } | null {
  let best: { id: string; count: number; total: number } | null = null;
  for (const [id, count] of Object.entries(backpack)) {
    const item = getItem(id);
    if (item?.price === undefined || (count ?? 0) <= 0) continue;
    const total = item.price * (count ?? 0);
    if (best === null || total > best.total) best = { id, count: count!, total };
  }
  return best === null ? null : { id: best.id, count: best.count };
}

/** 决策附加簿记(仅在有内容时携带,防空数组字段噪声) */
function extraOf(
  abandoned: string[],
  done: string[],
): Pick<Decision, 'abandonedWantIds' | 'doneWantIds'> {
  const extra: Pick<Decision, 'abandonedWantIds' | 'doneWantIds'> = {};
  if (abandoned.length > 0) extra.abandonedWantIds = abandoned;
  if (done.length > 0) extra.doneWantIds = done;
  return extra;
}

/**
 * 意图执行(D3,agent-design §3.3 慢思考产 want、快层择条执行;E1 三通路;E6.2 驱力/事件):
 * 空闲角色从当日 wants 中按 评分=urgency×(1+倾向分 bias)×数值需求 needBoost 择条。
 * - 基础/服务岗:两段式 start_activity(服务岗带知识门槛预检,不够跳过不打无效意图)
 * - 采集岗(E1;E4 两段式):查最近有存量节点邻位——远处 move_to、贴身 work_task
 *   (接单即到位计时,消灭移动中/途中掉力的错位拒单)
 * - 制作岗(E1):背包含料预检→站点锚点 craft{recipeId}/先 move_to 站点
 * - 卖货(E4):背包有带价物→在店 sell_item 整叠变现/先 move_to 商店(空包跳过)
 * - 人指向社交(E2→E6 两段式):带 target 的 socialize 远处 move_to 寻人,贴身交还
 *   社交管线生成对话(chatWith),want 由 social.chat 事件结算 done;对方不在则废弃
 * - 驱力 want(E6.2 rule→驱力):生存压力由写侧巡检产 want,执行走 driveExecution
 *   专属分支——压力已过收口 done、通道消失废弃改道,不再直执 intent
 * - 救援 want(E6.2 triage respond→冲动):rescueExecution 到场即完成
 * 不可执行的 want 当场废弃(rest 无居所/无锚点无场所);门槛不够/缺料/无节点
 * 只是本轮跳过(pending 保留——学了知识/采到料/节点重生后可再评);
 * 体力见底时非基础块让位生存压力(驱力/救援豁免)。无意图/意图耗尽返回 null。
 */
export function wantSelect(
  char: WorldCharacter,
  intents: DayIntents | null | undefined,
  day: number,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
  bias: Readonly<Record<string, number>> = {},
  world: WantWorldQueries = {},
  debug?: { candidates: WantCandidateDebug[] },
): Decision | null {
  if (!char.alive || char.collapsed) return null;
  if (char.activity !== null || char.path.length > 0) return null; // 忙碌不越权打断(rule/jev 同门槛)
  if (intents === undefined || intents === null || intents.day !== day) return null;
  const abandoned: string[] = [];
  const doneIds: string[] = [];
  const candidates = intents.wants.filter((w) => {
    if (w.status !== 'pending' && w.status !== 'doing') return false;
    // 冲动半衰期(E6):过期冲动直接废弃——冲动会消退,不留陈年旧念
    if (w.expiresAtMin !== undefined && world.nowMin !== undefined && world.nowMin > w.expiresAtMin) {
      abandoned.push(w.id);
      return false;
    }
    // 驱力 want(E6.2):伪活动 id(eat/earn/forage/sleep)不查活动定义,有效性由
    // 写侧压力巡检保证(过期/收口处理);真实活动 id(社交动机的 socialize)落回常规校验
    if (w.origin === 'drive' && isDriveActivity(w.activityId)) {
      return true;
    }
    // 事件 want(E6.2 respond→冲动):救援查看(伪活动 id);道谢=socialize 走下方人指向分支
    if (w.activityId === 'rescue') {
      if (w.targetCharacterId === undefined) {
        abandoned.push(w.id); // 无 target 的救援残片:收口废弃不悬挂
        return false;
      }
      return true;
    }
    const definition = getActivityDefinition(w.activityId);
    if (definition === null) {
      abandoned.push(w.id);
      return false;
    }
    if (knowledgeShort(char, definition)) return false; // 门槛不够先跳过(pending 保留,学成再干)
    if (w.activityId === 'socialize' && w.targetCharacterId !== undefined) return true; // 人指向寻人不看场所
    if (gatherNodeKind(w.activityId) !== null) {
      return gatherTarget(w.activityId, char, world) !== null; // 无可采节点先跳过
    }
    if (isCraftActivity(w.activityId)) {
      return world.recipeReady !== undefined
        ? world.recipeReady(w.activityId)
        : staticRecipeReady(char, w.activityId); // 缺料先跳过,先去采集
    }
    if (w.activityId === 'rest' && char.housing === null) {
      abandoned.push(w.id); // rest 锚点=住宅床(须本人租约),无居所角色走过去必被拒
      return false;
    }
    if (w.activityId !== 'explore' && anchorsOf(w.activityId, null).length === 0 && !hasAnyPlace(map, definition.placeIds)) {
      abandoned.push(w.id); // 既无锚点又无可达场所,这条 want 永远无法执行
      return false;
    }
    return true;
  });
  const eligible = candidates.filter(
    (w) =>
      w.origin === 'drive' ||
      w.activityId === 'rescue' ||
      char.energy > BALANCE.LOW_ENERGY_THRESHOLD ||
      (BASIC_ACTIVITY_IDS as readonly string[]).includes(w.activityId),
  );
  if (eligible.length === 0) {
    // 全被体力闸拦下:wants 保留(pending 不动),驱力生存压力照旧评分先行
    return abandoned.length > 0
      ? { layer: 'plan', action: 'continue', reason: 'energy_gate', abandonedWantIds: abandoned }
      : null;
  }
  const scored = eligible
    .map((w) => ({
      want: w,
      score:
        w.urgency *
        (1 + (bias[w.activityId] ?? 0)) *
        needBoost(char, w.activityId) *
        (0.95 + Math.random() * 0.1),
    }))
    .sort((a, b) => b.score - a.score);
  // 执行契约(E6.3): 曾被选中(doing)=在契——空闲重评走「挑战者 vs 在位者」,
  // 挑战者须显著更高分(WANT_SEIZE_RATIO)才许插队,否则在契者免评续做(从当前
  // 进度重放执行分支,已走近则重新寻路更短,进度天然保留)。无记忆每拍贪心在
  // urgency 密集池里每拍换王,复合行为(寻人会合/采集→制作→出售)被逐拍拆散;
  // 契约把调度升级为带抢占阈值的优先级调度——抢占仍纯评分裁决(E6 哲学),只是
  // 把「更高分」从隐含 1.01 倍显式为比例阈值。doing 多条并存=历次插队残留,
  // 在契集中评分最高者为在位者;死契由上方过期/失效过滤清出,不占坑。
  const incumbent = scored.find((s) => s.want.status === 'doing');
  let picked = scored[0]!.want;
  if (
    incumbent !== undefined &&
    incumbent !== scored[0] &&
    scored[0]!.score <= incumbent.score * BALANCE.WANT_SEIZE_RATIO
  ) {
    picked = incumbent.want;
  }
  if (debug !== undefined) {
    debug.candidates = scored.map((s) => ({
      id: s.want.id,
      activityId: s.want.activityId,
      origin: s.want.origin,
      urgency: s.want.urgency,
      score: Math.round(s.score * 1000) / 1000,
      ...(s.want.id === picked.id
        ? {}
        : {
            reject:
              s === scored[0]
                ? 'seize'
                : s.want.status === 'doing'
                  ? 'incumbent_lost'
                  : 'score',
          }),
    }));
    for (const w of candidates) {
      if (!eligible.includes(w)) {
        debug.candidates.push({
          id: w.id,
          activityId: w.activityId,
          origin: w.origin,
          urgency: w.urgency,
          score: 0,
          reject: 'energy',
        });
      }
    }
  }
  // 驱力 want 执行(E6.2):「怎么做」归专属分支——压力已过收口 done,通道消失
  // 废弃改道(写侧巡检重评),其余两段式动作;want 生命周期与其他来源同轨
  if (picked.origin === 'drive' && isDriveActivity(picked.activityId)) {
    const night =
      world.night ??
      false;
    const ex = driveExecution(char, picked, day, night, map, anchorsOf, world);
    if (ex === null)
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'drive_channel_gone',
        wantId: picked.id,
        ...extraOf(abandoned, doneIds),
      };
    if (ex.done) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'drive_satisfied',
        wantId: picked.id,
        doneWantIds: [...doneIds, picked.id],
        ...(abandoned.length > 0 ? { abandonedWantIds: abandoned } : {}),
      };
    }
    if (ex.stuck) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'drive_stuck',
        wantId: picked.id,
        abandonedWantIds: [...abandoned, picked.id],
        ...(doneIds.length > 0 ? { doneWantIds: doneIds } : {}),
      };
    }
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extraOf(abandoned, doneIds),
      intent: ex.intent,
      bubble: ex.bubble,
    };
  }
  // 救援查看 want(E6.2 respond→冲动):到场即完成,详见 rescueExecution
  if (picked.activityId === 'rescue') {
    const ex = rescueExecution(char, picked, world);
    if (ex === null)
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'rescue_gone',
        wantId: picked.id,
        ...extraOf(abandoned, doneIds),
      };
    if (ex.done) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'rescue_done',
        wantId: picked.id,
        doneWantIds: [...doneIds, picked.id],
        ...(abandoned.length > 0 ? { abandonedWantIds: abandoned } : {}),
      };
    }
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extraOf(abandoned, doneIds),
      intent: ex.intent,
      bubble: ex.bubble,
    };
  }
  const definition = getActivityDefinition(picked.activityId)!;
  const extra = extraOf(abandoned, doneIds);
  // 人指向社交 want(E2→E6 两段式):远处 move_to 寻人,到场经 character.arrived
  // 重入再评;贴身交还社交管线(E6.2 两阶段会合:首触=召唤零模型,对方应答才生成),
  // want 由 social.chat 结算 done;对方不在(亡故/下线)则 want 废弃
  if (picked.activityId === 'socialize' && picked.targetCharacterId !== undefined) {
    const pos = world.positionOf?.(picked.targetCharacterId) ?? null;
    if (pos === null) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'target_missing',
        abandonedWantIds: [...abandoned, picked.id],
        wantId: picked.id,
      };
    }
    const distance = Math.abs(char.x - pos.x) + Math.abs(char.y - pos.y);
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) {
      return {
        layer: 'plan',
        action: 'react',
        wantId: picked.id,
        ...extra,
        intent: { type: 'move_to', characterId: char.id, x: pos.x, y: pos.y },
        bubble: `${picked.why},去找${pos.name}`,
      };
    }
    // 贴身:对话生成在途(E6.2 会合协议)——原地静候 social.chat 结算,零模型零移动
    if (world.chatGeneratingWith?.(char.id, picked.targetCharacterId) === true) {
      return { layer: 'plan', action: 'continue', reason: 'chat_generating', wantId: picked.id, ...extra };
    }
    // 贴身:我召唤的对方还没应答(E6.2 两阶段会合)——不重复点火也不代答,
    // 静候对方自行应答(其 event want 赢得评分即 commit);放鸽子由会合超时回收
    if (world.summonAwaiting?.(picked.targetCharacterId) === true) {
      return { layer: 'plan', action: 'continue', reason: 'summon_awaiting', wantId: picked.id, ...extra };
    }
    // 贴身:短冷却口径(E6)——落地聊天先簿记,簿记未出短窗本轮不重入聊天,
    // want 留待下轮再评(防连场聊天气泡刷屏)
    const lastChatAt =
      world.pairLastChatAt?.(char.id, picked.targetCharacterId) ?? Number.NEGATIVE_INFINITY;
    if (world.nowMin !== undefined && world.nowMin - lastChatAt < BALANCE.SOCIAL_RETRY_COOLDOWN_MINUTES) {
      return { layer: 'plan', action: 'continue', reason: 'chat_cooldown', wantId: picked.id, ...extra };
    }
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      chatWith: picked.targetCharacterId,
      bubble: `${picked.why}`,
    };
  }
  if (picked.activityId === 'explore') {
    const decision = exploreDecision(char, map, picked.id, definition.placeIds);
    if (decision === null) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'no_explore_target',
        abandonedWantIds: [...abandoned, picked.id],
        wantId: picked.id,
      };
    }
    return { layer: 'plan', action: 'react', wantId: picked.id, ...extra, ...decision };
  }
  const nodeKind = gatherNodeKind(picked.activityId);
  if (nodeKind !== null) {
    const node = gatherTarget(picked.activityId, char, world);
    if (node === null) {
      // 节点刚被采空:本轮不动,want 留 pending 待重生
      return { layer: 'plan', action: 'continue', reason: 'node_depleted', ...extra, wantId: picked.id };
    }
    // 两段式(E4):远处 move_to 节点邻位,到达经 character.arrived 重入再接单
    // (消灭「移动中接单」与途中体力跌破的状态错位拒单)
    const dist = Math.abs(char.x - node.x) + Math.abs(char.y - node.y);
    if (dist > BALANCE.FORAGE_MOVE_THRESHOLD) {
      return {
        layer: 'plan',
        action: 'react',
        wantId: picked.id,
        ...extra,
        intent: { type: 'move_to', characterId: char.id, x: node.x, y: node.y },
        bubble: `${picked.why},去${resourceNodeLabel(nodeKind)}`,
      };
    }
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      intent: { type: 'work_task', characterId: char.id, targetId: node.id },
      bubble: `${picked.why},去${resourceNodeLabel(nodeKind)}`,
    };
  }
  if (isCraftActivity(picked.activityId)) {
    const anchors = anchorsOf(picked.activityId, null);
    const atStation = anchors.length > 0 ? onSpot(char, anchors) : inAnyPlace(map, char, definition.placeIds);
    if (atStation) {
      return {
        layer: 'plan',
        action: 'react',
        wantId: picked.id,
        ...extra,
        intent: { type: 'craft', characterId: char.id, recipeId: picked.activityId },
        bubble: `开始${definition.name}:${picked.why}`,
      };
    }
    const spot = activitySpot(map, picked.activityId, definition.placeIds, anchors);
    if (spot === null) {
      return {
        layer: 'plan',
        action: 'continue',
        reason: 'craft_no_place',
        abandonedWantIds: [...abandoned, picked.id],
        wantId: picked.id,
      };
    }
    const placePart = spot.placeName === '' ? definition.name : `${spot.placeName}${definition.name}`;
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      intent: { type: 'move_to', characterId: char.id, x: spot.x, y: spot.y },
      bubble: `${picked.why},去${placePart}`,
    };
  }
  // 卖货 want(E4 生产经济闭环):背包有带价物——在店 sell_item 整叠变现/店外先去
  // 商店;空背包本轮跳过(pending 保留,采到货再变现)
  if (picked.activityId === 'sell_goods') {
    const sellable = bestSellable(char.backpack);
    if (sellable === null) {
      return { layer: 'plan', action: 'continue', reason: 'backpack_empty', ...extra, wantId: picked.id };
    }
    const shop = findPlaceByRef(map, 'shop');
    if (shop === null) return null;
    const name = getItem(sellable.id)?.name ?? sellable.id;
    if (findPlaceAt(map, char.x, char.y)?.id === shop.id) {
      return {
        layer: 'plan',
        action: 'react',
        wantId: picked.id,
        ...extra,
        intent: { type: 'sell_item', characterId: char.id, itemId: sellable.id, count: sellable.count },
        bubble: `${picked.why},把${name}卖给商店`,
      };
    }
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      intent: { type: 'move_to', characterId: char.id, x: shop.entrance.x, y: shop.entrance.y },
      bubble: `${picked.why},去商店卖${name}`,
    };
  }
  const anchors = anchorsOf(picked.activityId, null);
  const atTarget = anchors.length > 0 ? onSpot(char, anchors) : inAnyPlace(map, char, definition.placeIds);
  if (atTarget) {
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      intent: { type: 'start_activity', characterId: char.id, activityId: picked.activityId },
      bubble: `开始${definition.name}:${picked.why}`,
    };
  }
  const spot = activitySpot(map, picked.activityId, definition.placeIds, anchors);
  if (spot === null) {
    return {
      layer: 'plan',
      action: 'continue',
      reason: 'no_spot',
      abandonedWantIds: [...abandoned, picked.id],
      wantId: picked.id,
    };
  }
  const placePart = spot.placeName === '' ? definition.name : `${spot.placeName}${definition.name}`;
  return {
    layer: 'plan',
    action: 'react',
    wantId: picked.id,
    ...extra,
    intent: { type: 'move_to', characterId: char.id, x: spot.x, y: spot.y },
    bubble: `${picked.why},去${placePart}`,
  };
}

/** want 层世界查询(E1 依赖注入):节点寻址与每世界配方就绪判定 */
export interface WantWorldQueries {
  /** 指定 kind 中最近的有存量节点(null=暂无,采集 want 跳过) */
  nearestNode?: (kind: string, from: { x: number; y: number }) => { id: string; x: number; y: number } | null;
  /** 配方就绪(存在+启用+背包含料;缺省按 shared 源表验料,不查每世界启用位) */
  recipeReady?: (recipeId: string) => boolean;
  /** 存活角色位置(E2 人指向社交寻人;null=不存在/已亡故,want 跳过) */
  positionOf?: (characterId: string) => { x: number; y: number; name: string } | null;
  /** 当前游戏分钟(E6):冲动 want 半衰期(expiresAtMin)判定 */
  nowMin?: number;
  /** 我→TA 最近一次主动社交簿记时刻(E6:贴身 chatWith 的短冷却口径——
   * wantSelect 每步重评,无此门槛会在落地聊天短窗内反复重入,气泡刷屏) */
  pairLastChatAt?: (characterId: string, targetId: string) => number;
  /** 该对是否正在生成对话(E6.2 会合协议):生成窗口双方原地静候 social.chat 结算,
   * 零模型零移动;原 onPath 门控由会合协议取代(走路中的目标可被召唤) */
  chatGeneratingWith?: (characterId: string, targetId: string) => boolean;
  /** 我召唤 TA 且会合未收口(E6.2 两阶段聊天):候召期不重复点火——对方应答
   * (event want 赢得评分即 commit)或会合超时回收驱动后续 */
  summonAwaiting?: (targetId: string) => boolean;
  /** 商店货架存量(E6.2 驱力 eat 通道预检/执行:有货才吃得起,无货改道) */
  shopStock?: (itemId: string) => number;
  /** 最近可食用采集节点(E6.2 驱力 forage 通道预检/执行;null=暂无) */
  nearestEdibleNode?: (from: { x: number; y: number }) => { id: string; x: number; y: number } | null;
  /** 是否夜间(E6.2 驱力 sleep urgency 档位与回床目标判定) */
  night?: boolean;
  /** 任意角色位置含倒地者(E6.2 救援 want:倒地 alive=false,positionOf 查不到);
   * null=不存在,alive=false=已倒地待救援,dist 0/已起=done */
  posOfAny?: (characterId: string) => { x: number; y: number; name: string; alive: boolean } | null;
  /** 活动倾向分(E6.2 驱力 earn 分支贫困选岗保人设) */
  bias?: Readonly<Record<string, number>>;
}

/** 采集岗→节点 kind(GATHER_TASKS 表驱动;非采集活动返回 null) */
function gatherNodeKind(activityId: string): string | null {
  return (GATHER_TASKS as Record<string, { nodeKind: string } | undefined>)[activityId]?.nodeKind ?? null;
}

function isCraftActivity(activityId: string): boolean {
  return (CRAFT_RECIPE_IDS as readonly string[]).includes(activityId);
}

/** 岗位类别知识门槛预检(E1):不够则该 want 本轮跳过,不打必被拒的意图 */
function knowledgeShort(char: WorldCharacter, definition: ActivityDefinition): boolean {
  if (definition.category === undefined) return false;
  return char.knowledge < JOB_CATEGORIES[definition.category].requiredKnowledge;
}

/** 最近可采节点(依赖注入优先,缺省 null) */
function gatherTarget(
  activityId: string,
  char: WorldCharacter,
  world: WantWorldQueries,
): { id: string; x: number; y: number } | null {
  const kind = gatherNodeKind(activityId);
  if (kind === null || world.nearestNode === undefined) return null;
  return world.nearestNode(kind, { x: char.x, y: char.y });
}

/** 静态验料(shared 源表;仅世界查询缺省时兜底,不查每世界启用位) */
function staticRecipeReady(char: WorldCharacter, recipeId: string): boolean {
  const recipe = getRecipe(recipeId);
  return recipe !== null && recipe.inputs.every((input) => (char.backpack[input.itemId] ?? 0) >= input.count);
}

/** lab 观测辅助:地点列表(气泡文案/测试用) */
export function placeLabel(places: PlaceDefinition[], ref: string): string | null {
  return places.find((p) => p.id === ref)?.name ?? null;
}
