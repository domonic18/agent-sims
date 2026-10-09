import Phaser from 'phaser';

/**
 * 渲染倍率: 画布栅格 = CSS 尺寸 × DPR(WorldCanvas 按此建画布,CSS 拉伸回 100%),
 * Retina 下逐设备像素渲染不再整屏发糊;封顶 2(3x 屏收益递减、栅格面积翻倍伤性能)。
 */
export const RENDER_DPR = Math.min(window.devicePixelRatio || 1, 2);

/**
 * 文字光栅化倍率: 跟随「画布 DPR × 相机默认 2x」的有效缩放(封顶 4)——
 * 全局 pixelArt 最近邻过滤会把小字按整数格放大出点阵感,纹理密度对齐有效缩放后
 * 文字在相机 zoom 下保持锐利;素材像素风不受影响(纹理只是更密,不引入平滑)。
 */
export const TEXT_RESOLUTION = Math.min(RENDER_DPR * 2, 4);

/** 角色名字标签(头顶白字黑底条) */
export function nameTextStyle(): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize: '11px',
    color: '#ffffff',
    resolution: TEXT_RESOLUTION,
    padding: { x: 3, y: 1 },
  };
}

/** 头顶徽标(👻 幽灵倒计时 / ⚡ 低体力警示) */
export function badgeTextStyle(color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize: '11px',
    color,
    resolution: TEXT_RESOLUTION,
    padding: { x: 2, y: 1 },
    backgroundColor: 'rgba(26,28,44,0.55)',
  };
}

/** 活动气泡内 emoji 图标 */
export function bubbleEmojiTextStyle(): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontSize: '10px', color: '#222222', resolution: TEXT_RESOLUTION };
}

/** 对话气泡正文(白底气泡内深色小字) */
export function speechTextStyle(wrapWidth: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize: '11px',
    color: '#2a2e3d',
    align: 'center',
    wordWrap: { width: wrapWidth },
    resolution: TEXT_RESOLUTION,
  };
}
