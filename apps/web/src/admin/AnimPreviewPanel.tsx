import { useEffect, useState } from 'react';
import { Alert, App as AntdApp, Button, Segmented, Select, Switch, Tooltip } from 'antd';
import { CaretRightOutlined, PauseOutlined, WarningOutlined } from '@ant-design/icons';
import type { AssetEntry } from '@sims/shared';
import { CHARACTER_ROW_OFFSETS } from '../game/assets';
import { fetchGameAssetRegistry, type GameAssetRegistry } from '../game/manifest';
import { createAssetIssue } from './api';
import './anim-preview.css';

/**
 * 动画演示器(admin 调试页): 全角色变体 × 动画组 × 四方向的逐帧 Review。
 * 角色表 32px 格契约,行 = groups[group] + 方向行偏移(up/left/down/right),
 * 与画布渲染同源(manifest anim 元数据驱动)——游戏内朝向/姿态异常时,
 * 在此页对照「该行的帧到底画的是什么」即可定位是裁切映射错误还是渲染取行错误。
 * 两种视图: 单变体全组网格(16 格)/ 全变体单格对比(25 变体并排,系统性左右颠倒一眼即见)。
 */

const GROUPS = ['walk', 'idle', 'lie', 'sit'] as const;
const DIRS = ['up', 'left', 'down', 'right'] as const;
type Group = (typeof GROUPS)[number];
type Dir = (typeof DIRS)[number];

const GROUP_LABEL: Record<Group, string> = { walk: '行走', idle: '站立', lie: '躺卧', sit: '坐姿' };
const DIR_LABEL: Record<Dir, string> = { up: '朝上', left: '朝左', down: '朝下', right: '朝右' };

function FrameCrop({ url, row, col, scale }: { url: string; row: number; col: number; scale: number }) {
  return (
    <div
      style={{
        width: 32 * scale,
        height: 32 * scale,
        flex: 'none',
        backgroundImage: `url(${url})`,
        backgroundSize: `${288 * scale}px ${512 * scale}px`,
        backgroundPosition: `-${col * 32 * scale}px -${row * 32 * scale}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

function AnimCell({
  entry,
  group,
  dir,
  scale,
  speed,
  playing,
  showRibbon,
  heading,
}: {
  entry: AssetEntry;
  group: Group;
  dir: Dir;
  scale: number;
  speed: number;
  playing: boolean;
  showRibbon: boolean;
  heading?: string;
}) {
  const { message } = AntdApp.useApp();
  const [reported, setReported] = useState(false);
  const anim = entry.anim;
  if (anim === null) return null;
  const fps = anim.fps[group] ?? 4;
  const frames = anim.framesPerGroup[group] ?? 1;
  const row = (anim.groups[group] ?? 0) + CHARACTER_ROW_OFFSETS[dir];
  const url = `/assets/${entry.url}`;
  const report = (): void => {
    createAssetIssue({
      scope: 'anim',
      refSlug: entry.slug,
      context: { key: `${group}/${dir}`, group, dir, row, frames, fps },
    })
      .then(() => {
        setReported(true);
        message.success(`${entry.slug} ${group}/${dir} 已上报`);
      })
      .catch((err: unknown) => {
        message.error(err instanceof Error ? err.message : '上报失败');
      });
  };
  return (
    <div className="anim-cell">
      <div className="anim-cell-label">
        {heading !== undefined && <b>{heading}</b>}
        <span style={{ display: 'block' }}>
          {group}·{dir} 行{row} · {frames}帧 {fps}fps
        </span>
      </div>
      <Tooltip title="该行动画有问题(朝向反/残帧/错组)?上报到素材问题清单">
        <Button
          size="small"
          type="text"
          icon={reported ? <span style={{ color: '#389e0d' }}>✓</span> : <WarningOutlined />}
          onClick={report}
          style={{ position: 'absolute', top: 2, right: 2, padding: '0 4px', height: 18 }}
        />
      </Tooltip>
      <div className="anim-preview-viewport" style={{ width: 32 * scale, height: 32 * scale }}>
        <div
          style={{
            display: 'flex',
            width: frames * 32 * scale,
            animation: playing
              ? `anim-preview-slide ${((frames / fps) / speed).toFixed(3)}s steps(${frames}) infinite`
              : 'none',
          }}
        >
          {Array.from({ length: frames }, (_, f) => (
            <FrameCrop key={f} url={url} row={row} col={f} scale={scale} />
          ))}
        </div>
      </div>
      {showRibbon && (
        <div className="anim-preview-ribbon">
          {Array.from({ length: frames }, (_, f) => (
            <figure key={f}>
              <FrameCrop url={url} row={row} col={f} scale={2} />
              <figcaption>f{f}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnimPreviewPanel() {
  const [registry, setRegistry] = useState<GameAssetRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'one' | 'all'>('one');
  const [slug, setSlug] = useState<string>('');
  const [group, setGroup] = useState<Group>('walk');
  const [dir, setDir] = useState<Dir>('left');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(3);
  const [showRibbon, setShowRibbon] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchGameAssetRegistry()
      .then((r) => {
        if (cancelled) return;
        setRegistry(r);
        setSlug((prev) => prev || (r.characterSlugs[0] ?? ''));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return <Alert type="error" showIcon message={error} />;
  }
  if (registry === null) {
    return <p>加载素材清单中…</p>;
  }

  const entries = registry.characterSlugs
    .map((s) => registry.bySlug.get(s))
    .filter((e): e is AssetEntry => e !== undefined && e.anim !== null);
  const current = entries.find((e) => e.slug === slug) ?? entries[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon={false}
        message="角色表动画 Review:行序 = 动画组基行 + 方向偏移(up0/left1/down2/right3)。帧带展示该行每一帧原像素,朝向画反/残帧在此一眼定位。"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as 'one' | 'all')}
          options={[
            { value: 'one', label: '单变体全组' },
            { value: 'all', label: '全变体对比' },
          ]}
        />
        {mode === 'one' ? (
          <Select
            style={{ minWidth: 220 }}
            value={current?.slug}
            onChange={setSlug}
            options={entries.map((e) => ({ value: e.slug, label: `${e.name}(${e.slug})` }))}
          />
        ) : (
          <>
            <Segmented value={group} onChange={(v) => setGroup(v as Group)} options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
            <Segmented value={dir} onChange={(v) => setDir(v as Dir)} options={DIRS.map((d) => ({ value: d, label: DIR_LABEL[d] }))} />
          </>
        )}
        <Tooltip title={playing ? '暂停' : '播放'}>
          <Button
            icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
            onClick={() => setPlaying((p) => !p)}
          />
        </Tooltip>
        <Segmented
          value={speed}
          onChange={(v) => setSpeed(v as number)}
          options={[
            { value: 0.25, label: '0.25x' },
            { value: 0.5, label: '0.5x' },
            { value: 1, label: '1x' },
            { value: 2, label: '2x' },
          ]}
        />
        <Segmented
          value={scale}
          onChange={(v) => setScale(v as number)}
          options={[
            { value: 2, label: '2x' },
            { value: 3, label: '3x' },
            { value: 4, label: '4x' },
            { value: 6, label: '6x' },
          ]}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          帧带 <Switch size="small" checked={showRibbon} onChange={setShowRibbon} />
        </span>
      </div>

      {mode === 'one' ? (
        current !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {GROUPS.map((g) => (
              <div key={g} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    width: 56,
                    flex: 'none',
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 600,
                    paddingTop: 4,
                  }}
                >
                  {GROUP_LABEL[g]}
                  <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 400 }}>{g}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto' }}>
                  {DIRS.map((d) => (
                    <AnimCell
                      key={d}
                      entry={current}
                      group={g}
                      dir={d}
                      scale={scale}
                      speed={speed}
                      playing={playing}
                      showRibbon={showRibbon}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="anim-preview-grid">
          {entries.map((e) => (
            <AnimCell
              key={e.slug}
              entry={e}
              group={group}
              dir={dir}
              scale={scale}
              speed={speed}
              playing={playing}
              showRibbon={showRibbon}
              heading={`${e.name} ${e.slug}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
