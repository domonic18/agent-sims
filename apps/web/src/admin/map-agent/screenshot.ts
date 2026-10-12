/**
 * 地图效果截图(问题4):编辑器当前文档按游戏贴图渲染到离屏画布出 PNG。
 * 与编辑器「效果视图」同一渲染器(mapRenderReal),保证 AI 看到的就是
 * 所见即所玩的外观;素材未发布时降级色块布局照常出图。
 */
import { useEditor } from '../map-editor/editorStore';
import { ensureTownRenderAssets, renderTownMapReal } from '../mapRenderReal';

/** 长边目标像素(控制 vision 输入体积;64×48 图 → 16px/格 1024×768) */
const MAX_EDGE = 1024;

export async function captureMapScreenshot(): Promise<string | null> {
  const doc = useEditor.getState().doc;
  const tile = Math.max(4, Math.min(24, Math.floor(MAX_EDGE / Math.max(doc.width, doc.height))));
  const canvas = document.createElement('canvas');
  canvas.width = doc.width * tile;
  canvas.height = doc.height * tile;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  try {
    await ensureTownRenderAssets(doc);
  } catch {
    // 素材装载失败降级色块,布局仍可评
  }
  renderTownMapReal(ctx, doc, { tile });
  return canvas.toDataURL('image/png');
}
