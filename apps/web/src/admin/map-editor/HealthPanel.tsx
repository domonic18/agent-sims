/**
 * 体检面板(批B+问题3):checkLayout 结果可视化——发布门禁摘要+密度档位+
 * 问题清单。计算在 MapEditorPanel 统一做(与发布门禁/属性面板告警同一份),
 * 此处只展示;家具类问题「定位家具」直达单件选中,修复后随 doc 实时消账。
 */
import { Alert, Button, Tag, Typography } from 'antd';
import { useEditor } from './editorStore';
import type { HealthCode, HealthFinding, HealthResult } from './health';

const CODE_LABELS: Record<HealthCode, string> = {
  structure: '结构',
  connectivity: '连通',
  spacing: '间距',
  resource: '资源',
  density: '密度',
  quota: '配额',
};

const TIER_LABELS = { dense: '偏紧凑', balanced: '均衡', sparse: '偏宽松' } as const;

function FindingRow({ finding, onLocate }: { finding: HealthFinding; onLocate?: () => void }) {
  const select = useEditor((s) => s.select);
  const placeId = finding.placeIds?.[0];
  const toFurniture = finding.furnitureIndex !== undefined;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 0' }}>
      <Tag color={finding.level === 'error' ? 'error' : 'warning'} style={{ flexShrink: 0, marginInlineEnd: 0 }}>
        {CODE_LABELS[finding.code]}
      </Tag>
      <span style={{ fontSize: 12, lineHeight: '20px' }}>{finding.message}</span>
      {placeId !== undefined && (
        <Button
          size="small"
          type="link"
          style={{ flexShrink: 0, padding: 0, height: 20 }}
          onClick={() => {
            if (toFurniture) select({ kind: 'furniture', placeId, index: finding.furnitureIndex! });
            else select({ kind: 'place', id: placeId });
            onLocate?.();
          }}
        >
          {toFurniture ? '定位家具' : '定位'}
        </Button>
      )}
    </div>
  );
}

export function HealthPanel({ result, onLocate }: { result: HealthResult; onLocate?: () => void }) {
  const errors = result.findings.filter((f) => f.level === 'error');
  const warnings = result.findings.filter((f) => f.level === 'warning');
  const d = result.density;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <Alert
        type={result.ok ? 'success' : 'error'}
        showIcon
        message={result.ok ? '体检通过:零硬错误,可发布' : `${errors.length} 个硬错误,修复后才能发布`}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {`密度档位:${TIER_LABELS[d.tier]} · 场所面积 ${(d.areaRatio * 100).toFixed(0)}% · 活动锚点 ${d.anchorCount} · 入口近邻对 ${d.closePairs} · 最近入口距 ${d.minPairDistance ?? '—'}`}
      </Typography.Text>
      <div>
        {result.findings.length === 0 && (
          <Typography.Text type="secondary">没有任何问题,布局很干净</Typography.Text>
        )}
        {errors.map((f, i) => (
          <FindingRow key={`e${i}`} finding={f} onLocate={onLocate} />
        ))}
        {warnings.map((f, i) => (
          <FindingRow key={`w${i}`} finding={f} onLocate={onLocate} />
        ))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {`硬错误=发布门禁(结构/连通);建议=优化提示(入口间距<6 推高旁观类 LLM 调用,资源>25 格拉长采集往返)。`}
      </Typography.Text>
    </div>
  );
}
