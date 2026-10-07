import Phaser from 'phaser';
import { speechTextStyle } from './text-style';

/** 气泡挂在角色头顶(高于活动气泡 -38 与幽灵徽标 -52) */
const SPEECH_Y = -62;
const SPEECH_DURATION_MS = 3500;
/** 同一角色新对话替换旧气泡( WeakMap 挂在角色容器上,角色销毁自动回收) */
const active = new WeakMap<Phaser.GameObjects.Container, Phaser.GameObjects.Container>();

/**
 * 头顶对话气泡(社交 v1):白底圆角矩形+对话文本,数秒后自动消散。
 * 双方头顶同显一条内容,呈现面对面交谈;幽灵态由调用方过滤。
 */
export function showSpeechBubble(
  scene: Phaser.Scene,
  node: Phaser.GameObjects.Container,
  content: string,
): void {
  active.get(node)?.destroy();
  const text = scene.add.text(0, -3, content, speechTextStyle(128)).setOrigin(0.5, 1);
  const width = Math.max(text.width + 14, 26);
  const height = text.height + 7;
  const bg = scene.add.graphics();
  bg.fillStyle(0xffffff, 0.95);
  bg.fillRoundedRect(-width / 2, -height - 3, width, height, 6);
  bg.fillTriangle(-4, -3, 4, -3, 0, 2);
  bg.lineStyle(1, 0x39516a, 0.6);
  bg.strokeRoundedRect(-width / 2, -height - 3, width, height, 6);
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
