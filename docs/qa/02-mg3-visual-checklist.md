# M-G.3 UI 与素材优化走查清单

> **时效性**: 本清单为 M-G.3 时点(2026-10-06)的走查记录——坐姿矩阵/主题挂点家具丰富度/灶台归档。
> 姿态断言以 `window.__worldScene._views.get(id).animKey` 程序化读取为准(比像素目测可靠);
> 后续新增活动或姿态映射演进时,应按当时 ACTIVITY_POSES 契约重走本矩阵。

- 载体: 容器重建后 admin API 创建 growth 世界(seed 42,size medium,density normal),/debug/spawn 三角色(阿紫/阿黄/阿蓝)
- 走查环境: /lab 调试台 + `/debug/intent` 直发意图;相机经 `__worldScene.cameras.main.setZoom()` 控制
- 记法: ✅ 通过 / ❌ 缺陷;animKey 组名含变体前缀(如 `char-xx-sit-up`),下表省略前缀

## 1. 姿态矩阵(ACTIVITY_POSES 映射)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| PM-01 | 阿紫 go-and-do 图书馆书桌 study | 坐姿+面向桌台(up) | animKey `sit-up`,留使用格不位移 | ✅ |
| PM-02 | 阿紫 办公室工位 work | 坐姿面向工位 | animKey `sit-up` | ✅ |
| PM-03 | 阿紫 餐厅餐桌 meal(先打工攒币) | 坐姿面向餐桌 | animKey `sit-up`;0 币直启会被 insufficient_coins 1 tick 中断(见 §4) | ✅ |
| PM-04 | 阿紫 餐厅柜台 waiter | 坐姿面向柜台 | animKey `sit-up`,与就餐者同框互不干扰 | ✅ |
| PM-05 | 阿黄 商店柜台 vendor | 坐姿面向柜台 | animKey `sit-up` | ✅ |
| PM-06 | 阿紫 图书馆馆员桌 librarian | 坐姿面向馆员桌 | animKey `sit-up`(先补 study 攒 knowledge) | ✅ |
| PM-07 | 阿蓝 旅馆床 rest | 躺卧帧+吸附床位中心 | animKey `lie-down`,`resting=true`,横陈床占地 | ✅ |
| PM-08 | 阿蓝 健身房跑步机 workout | 原地跑(walk 动画不位移) | animKey `walk-*`,位置不随动画变化 | ✅ |
| PM-09 | 公园长椅 stroll | 站立待机 | animKey `idle-*` | ✅ |

## 2. 主题挂点家具丰富度(indoor theme 池)

| 编号 | 场所 | 挂点池 | 预期 | 实际/证据 | 结果 |
|------|------|--------|------|-----------|------|
| TF-01 | 餐厅 | kitchen | 厨房角道具出现 | 厨房白罐(kitchen 主题池素材)入图 | ✅ |
| TF-02 | 商店 | grocery-store + clothing-store | 货架区双主题道具 | 香蕉类 grocery 道具+画框类 clothing 道具同店;双侧货架+柜台齐备 | ✅ |
| TF-03 | 图书馆 | museum | 展品装饰出现 | museum 桌台道具入图 | ✅ |
| TF-04 | 旅馆 | japanese-interiors | 和风客房道具 | 和风立柜(japanese-interiors-68)入图 | ✅ |

> 域隔离由 worldgen.test.ts 批量断言兜底(50 种子: themePick 槽位不越池/池空槽不发件/占地不越界);
> 本清单仅抽样现图观感。多 seed 布局差异属预期(挂点 chance 概率)。

## 3. 灶台归档(M-G.6 预置,本轮不消费)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| SV-01 | admin /admin/assets 查 indoor/furniture/stove | 5 张 active,1x2 占地 | kitchen-148/149/150/151/153 全部「已启用」 | ✅ |

## 4. 顺带验证(走查途中实证的既有机制)

| 编号 | 场景 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| EX-01 | 0 币角色 start_activity meal | 结算前中断,回执 insufficient_coins | 1 tick 后活动结束(每分钟 -0.4 币入不敷出) | ✅ |
| EX-02 | 体力 ≤20 启动非基础活动(waiter/vendor) | 拒绝 | 回执仅允许基础活动(rest/stroll/meal) | ✅ |
| EX-03 | 0 币且租约过期在家 rest | 拒绝 | 「租约已过期(付至第 2 日,今日第 3 日)」 | ✅ |
| EX-04 | 体力归零 | 幽灵态: 半透明+👻+飘浮 | 渲染正常,alive=false | ✅ |
| EX-05 | POST /debug/revive {characterId} | 复活恢复可操作 | 复活后在床旁可直接 rest | ✅ |
| EX-06 | 低体力(>20 但偏低)角色 | ⚡ 徽标闪烁 | 渲染正常 | ✅ |
