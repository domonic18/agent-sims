import Phaser from 'phaser';
import { speechTextStyle } from './text-style';

/** 气泡挂在角色头顶(高于活动气泡 -38 与幽灵徽标 -52) */
const SPEECH_Y = -62;
const SPEECH_DURATION_MS = 3500;
/** 同一角色新对话替换旧气泡( WeakMap 挂在角色容器上,角色销毁自动回收) */
const active = new WeakMap<Phaser.GameObjects.Container, Phaser.GameObjects.Container>();

export interface BubbleStyle {
  /** 描边色,缺省对话蓝灰;决策气泡用暖金区分 */
  stroke?: number;
}

/**
 * 头顶对话气泡(社交 v1):白底圆角矩形+对话文本,数秒后自动消散。
 * 双方头顶同显一条内容,呈现面对面交谈;幽灵态由调用方过滤。
 */
export function showSpeechBubble(
  scene: Phaser.Scene,
  node: Phaser.GameObjects.Container,
  content: string,
  style: BubbleStyle = {},
): void {
  const stroke = style.stroke ?? 0x39516a;
  active.get(node)?.destroy();
  // 文本在框内垂直居中(框底 y=-4): 旧版 origin(0.5,1) 贴底,中文字形下沉被
  // 描边压住显得「靠下且不全」;按框高对称内边距 6px 居中
  const text = scene.add.text(0, 0, content, speechTextStyle(150)).setOrigin(0.5, 0.5);
  const width = Math.max(text.width + 18, 30);
  const height = text.height + 12;
  text.setPosition(0, -4 - height / 2);
  const bg = scene.add.graphics();
  // 白底不透明+墨色描边直角框(贴像素气质): 深描边在夜色/浅草地上都清晰;
  // 尾巴三角最后重涂盖掉框底边穿过段,再描尾巴两条斜边,与框融为一体
  bg.fillStyle(0xffffff, 0.97);
  bg.fillRect(-width / 2, -height - 4, width, height);
  bg.lineStyle(2, 0x1a1c2c, 0.9);
  bg.strokeRect(-width / 2, -height - 4, width, height);
  bg.fillStyle(0xffffff, 0.97);
  bg.fillTriangle(-6, -5, 6, -5, 0, 3);
  bg.lineStyle(2, 0x1a1c2c, 0.9);
  bg.lineBetween(-6, -5, 0, 3);
  bg.lineBetween(6, -5, 0, 3);
  // 决策气泡暖金内衬线(缺省对话蓝灰): 紧贴墨色描边内侧一圈,1px 区分类型
  bg.lineStyle(1, stroke, 1);
  bg.strokeRect(-width / 2 + 2, -height - 2, width - 4, height - 4);
  const bubble = scene.add.container(0, SPEECH_Y, [bg, text]);
  bubble.setDepth(60);
  node.add(bubble);
  active.set(node, bubble);
  bubble.setScale(0.6);
  scene.tweens.add({ targets: bubble, scale: 1, duration: 130, ease: 'Back.Out' });
  scene.time.delayedCall(SPEECH_DURATION_MS, () => {
    if (active.get(node) === bubble) active.delete(node);
    bubble.destroy();
  });
}
