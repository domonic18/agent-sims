import type Phaser from 'phaser';
import type { FurnitureDefinition } from '@sims/shared';
import { TILE } from './assets';
import { FURNITURE_COLORS } from './palette';

/**
 * 家具程序化像素画(M3.6h 自 terrain.ts 独立):每格 16px,
 * 锚点家具(床/桌/跑步机等)即活动使用位;色值全部取自 palette.ts。
 */
export function drawFurniture(g: Phaser.GameObjects.Graphics, f: FurnitureDefinition): void {
  const px = f.x * TILE;
  const py = f.y * TILE;
  const w = f.w * TILE;
  const h = f.h * TILE;
  const r = (x: number, y: number, ww: number, hh: number, color: number): void => {
    g.fillStyle(color, 1);
    g.fillRect(px + x, py + y, ww, hh);
  };
  switch (f.kind) {
    case 'bed': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.frame); // 床架
      r(2, 2, w - 4, h - 4, c.mattress); // 床垫
      r(3, 3, w - 6, 6, c.pillow); // 枕头(床头在上)
      r(2, 11, w - 4, h - 15, c.quilt); // 被子
      r(2, 11, w - 4, 2, c.quiltEdge); // 被沿
      break;
    }
    case 'desk': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 2, w, h - 5, c.top); // 桌面
      r(0, 2, w, 2, c.edge); // 桌沿高光
      r(2, h - 3, 3, 3, c.leg); // 桌腿
      r(w - 5, h - 3, 3, 3, c.leg);
      r(w - 12, 5, 8, 5, c.book); // 桌上的书
      r(w - 12, 5, 8, 2, c.bookEdge);
      break;
    }
    case 'workstation': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 9, w, h - 11, c.top); // 桌面(下半)
      r(0, 9, w, 2, c.edge);
      r(w / 2 - 8, 0, 16, 8, c.monitor); // 显示器
      r(w / 2 - 6, 1, 12, 5, c.screen); // 屏
      break;
    }
    case 'treadmill': {
      const c = FURNITURE_COLORS[f.kind];
      r(2, 3, w - 4, h - 5, c.body); // 机身
      r(4, h / 2, w - 8, h / 2 - 4, c.belt); // 跑带
      r(4, h / 2, w - 8, 2, c.beltEdge);
      r(1, 0, w - 2, 6, c.console); // 仪表台
      r(3, 1, 4, 3, c.screen); // 仪表屏
      break;
    }
    case 'table': {
      const c = FURNITURE_COLORS[f.kind];
      r(1, 2, w - 2, h - 6, c.top); // 桌面
      r(1, 2, w - 2, 2, c.edge);
      r(3, h - 4, 3, 3, c.leg); // 桌腿
      r(w - 6, h - 4, 3, 3, c.leg);
      r(w / 2 - 3, 5, 6, 4, c.plate); // 餐盘
      break;
    }
    case 'bookshelf': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.body); // 柜体
      const books = c.books;
      for (let i = 1; i < w - 2; i += 3) {
        r(i, 2, 2, 5, books[i % books.length]!);
        r(i, 9, 2, 5, books[(i + 2) % books.length]!);
      }
      g.lineStyle(1, c.divider, 1);
      g.lineBetween(px + 1, py + 7.5, px + w - 1, py + 7.5); // 中层隔板
      break;
    }
    case 'shelf': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.frame); // 货架框架
      g.lineStyle(1, c.line, 1);
      for (let i = 1; i < 4; i += 1) {
        g.lineBetween(px + 1, py + (h / 4) * i, px + w - 1, py + (h / 4) * i);
      }
      r(2, 3, w - 4, 4, c.boxA); // 货箱
      r(2, h / 2 + 1, w - 4, 4, c.boxB);
      r(2, h - 5, w - 4, 4, c.boxC);
      break;
    }
    case 'counter': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.body); // 柜体
      r(0, 0, w, 4, c.top); // 台面
      r(0, h - 2, w, 2, c.base); // 底沿
      break;
    }
    case 'sofa': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.back); // 靠背
      r(0, h / 2, w, h / 2, c.seat); // 座
      r(0, h / 2, w, 2, c.seatEdge);
      r(0, 0, 3, h, c.arm); // 扶手
      r(w - 3, 0, 3, h, c.arm);
      break;
    }
    case 'plant': {
      const c = FURNITURE_COLORS[f.kind];
      r(4, h - 7, w - 8, 6, c.pot); // 花盆
      r(4, h - 7, w - 8, 2, c.potEdge);
      g.fillStyle(c.leaf, 1);
      g.fillCircle(px + w / 2, py + 6, 5); // 叶冠
      g.fillStyle(c.leafHighlight, 1);
      g.fillCircle(px + w / 2 - 2, py + 5, 3);
      break;
    }
    case 'fridge': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.body); // 箱体
      r(0, 0, w, 2, c.shade); // 顶盖
      r(1, h / 2, w - 2, 2, c.seal); // 冷冻/冷藏分界
      r(w - 3, 3, 2, h / 2 - 6, c.handle); // 双门把手
      r(w - 3, h / 2 + 3, 2, h / 2 - 6, c.handle);
      break;
    }
    case 'tv': {
      const c = FURNITURE_COLORS[f.kind];
      r(2, h - 5, w - 4, 4, c.stand); // 电视柜
      r(w / 2 - 8, 1, 16, 10, c.body); // 机壳
      r(w / 2 - 6, 3, 12, 6, c.screen); // 屏
      r(w / 2 - 6, 3, 12, 2, c.screenGlow); // 屏上高光
      break;
    }
    case 'wardrobe': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 0, w, h, c.body); // 柜体
      r(0, 0, w, 3, c.top); // 顶沿
      r(1, 4, w / 2 - 2, h - 6, c.door); // 左门
      r(w / 2 + 1, 4, w / 2 - 2, h - 6, c.door); // 右门
      r(w / 2 - 1, h / 2, 2, 4, c.handle); // 把手
      break;
    }
    case 'bench': {
      const c = FURNITURE_COLORS[f.kind];
      r(0, 1, w, h - 6, c.wood); // 座面
      r(0, 1, w, 2, c.woodEdge);
      r(1, h - 5, 3, 4, c.leg); // 凳腿
      r(w - 4, h - 5, 3, 4, c.leg);
      break;
    }
  }
}
