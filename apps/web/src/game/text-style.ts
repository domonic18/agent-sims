import Phaser from 'phaser';

/**
 * 文字光栅化倍率: 高分屏按设备像素密度(封顶 3)。
 * 全局 pixelArt 最近邻过滤会把 9~10px 小字按整数格放大出点阵感,
 * resolution 提高纹理密度后文字在相机 zoom 下保持锐利,素材像素风不受影响。
 */
export const TEXT_RESOLUTION = Math.min(window.devicePixelRatio || 1, 3);

/** 角色名字标签(头顶白字黑底条) */
export function nameTextStyle(): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontSize: '11px', color: '#ffffff', resolution: TEXT_RESOLUTION };
}

/** 头顶徽标(👻 幽灵倒计时 / ⚡ 低体力警示) */
export function badgeTextStyle(color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontSize: '11px', color, resolution: TEXT_RESOLUTION };
}

/** 活动气泡内 emoji 图标 */
export function bubbleEmojiTextStyle(): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontSize: '10px', color: '#222222', resolution: TEXT_RESOLUTION };
}

/** 对话气泡正文(白底气泡内深色小字) */
export function speechTextStyle(wrapWidth: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize: '10px',
    color: '#333333',
    align: 'center',
    wordWrap: { width: wrapWidth },
    resolution: TEXT_RESOLUTION,
  };
}
