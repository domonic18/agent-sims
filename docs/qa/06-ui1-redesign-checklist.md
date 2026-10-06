# UI-1 界面重设计走查清单

> **时效性**: 本清单为 UI-1 时点(2026-10-06)的走查记录——像素主题基座/全屏画布+相机/HUD 重构/日志抽屉+历史回填/SidePanel 迁主界面/Lab 三栏。
> 服务器推进经 `/api/world/settings`(暂停/倍率)+ Lab 时钟控制(`/debug/tick` 快进);UI 断言经 Playwright DOM 程序化检查;
> go-and-do 接续经 DB 事件流(event_log 表 started/arrived/finished 真值)取证;像素渲染取证以截图为准。

- 载体: 容器重建(development)`docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env up -d --build app web`
  (在仓库根执行;缺 `--env-file .env` 时 NODE_ENV 回退 production,/debug/* 整族 404,Lab 居民管理区块自动隐藏)
- 走查环境: 主界面(全屏 HUD)+ 日志抽屉 + 📦 物品弹层 + /lab 三栏;spawn 角色「小满/鲁大」
- 记法: ✅ 通过 / ❌ 缺陷

## 1. 全屏画布与相机(C1)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| U1-01 | 打开主界面 | 画布铺满视口,无 letterbox 黑边 | Scale.RESIZE 画布=宿主尺寸,页面底色 --px-ink 融入地图夜色 | ✅ |
| U1-02 | 拖拽窗口 resize | 画布随窗口自适应重排 | resize 后 bounds/相机每帧自适应(_updateCamera) | ✅ |
| U1-03 | 默认相机 | follow 模式 zoom=2 跟随选中角色 | _updateCamera 消费 worldStore.cameraMode | ✅ |
| U1-04 | 点右下 📷 cam-chip | 切 overview: 全图缩至动态下限居中 | 小窗也能看全图(_minZoom clamp) | ✅ |
| U1-05 | 滚轮缩放 | 围绕指针缩放,zoom>1 自动回 follow | 保留原行为 | ✅ |

## 2. 主界面 HUD(C2)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| U1-06 | 观察左上 CharacterHud | 头像=atlas 切帧(pixelated)+‹›切换+体力/幸福分格条+金币/繁荣/知识+行动 chip+🏠住房摘要 | PixelAvatar CSS background-position 切 down 行首帧;‹›循环角色面板即更新 | ✅ |
| U1-07 | 睡眠不足角色 | 😪 缺觉徽标+😴 行动 chip「42/480」进度 | ACTIVITY_EMOJI+elapsed/durationMinutes | ✅ |
| U1-08 | 点 ⏸ 与倍率钮 | 真实生效(暂停/1x·4x·16x) | 走 /api/world/settings,时钟条同步显示 | ✅ |
| U1-09 | 观察顶栏 | 无状态栏标题、无「lab 调试台」链接 | 顶中 ClockBar+右上 📜/⚙/连接点替代 | ✅ |

## 3. 底部动作条(C2/C5)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| U1-10 | 睡觉中点「🍞 吃饭」 | 先 move_to 餐厅,到达后自动接续 meal | DB 事件流: arrived(984)→started(meal)(984) 同 tick 接续(修复后) | ✅ |
| U1-11 | 「😴 睡觉」(离家) | toast「回家上床,到达后自动入睡」→到自家床自动睡 | 只认自家床(placeId===housing.propertyId) | ✅ |
| U1-12 | 「🔨 工作」→清洁 | 接单寻路作业,完成 +12 币 | 日志 tone-good「✅ 完成」;接单/抵达/完成三连 | ✅ |
| U1-13 | 「⛏ 采集」→浆果 | 接最近浆果丛单,产出入包 | 以物代薪标签 | ✅ |
| U1-14 | 点「📦 物品」→商店→买面包 | 弹层内嵌 SidePanel,到店自动购入 | go-and-do: 前往商店入口→buy_item;店内直接购 | ✅ |

## 4. 世界日志抽屉(C3/C4)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| U1-15 | 首开 📜 抽屉 | 历史 100 条回填+「以上为历史」分隔线+实时段在下 | GET /api/world/events limit=100,倒序取回正序渲染 | ✅ |
| U1-16 | 历史与实时去重 | 页面加载后双源事件不重复 | dedupeKey=type\|tick\|characterId | ✅ |
| U1-17 | 时间标注 | 历史段=游戏时间(第 N 天 hh:mm),实时段=到达时刻快照时钟 | server 端 tick+480 换算 GameClock | ✅ |
| U1-18 | 筛选 chips | 按类别过滤条目 | 工作/事件/聊天/睡眠/世界 | ✅ |
| U1-19 | 抽屉关时来事件 | 📜 未读 badge 计数,打开清零 | events seq 增量 | ✅ |
| U1-20 | 点条目 | 定位选中该角色 | selectCharacter | ✅ |

## 5. Lab 三栏控制台(C5)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| U1-21 | 打开 /lab | 三栏无画布: 左时钟/参数热调/居民管理·中意图+回执终端·右事件流 | 「← 返回游戏」回主界面 | ✅ |
| U1-22 | 点「+60分」「+1天」 | 世界快进 | tick 578→638(+60),走 /debug/tick?n= | ✅ |
| U1-23 | dev 容器 spawn 居民 | 新角色入场 | debugSpawn 生成「访客N」 | ✅ |
| U1-24 | 修改参数→保存 | 热调生效,dirty 门控 | SYS_CONFIG_GROUPS 表单原样迁移 | ✅ |
| U1-25 | 中栏下发 move_to | 回执终端记录 ✓/✗+时间/tick | 13 意图全量保留 | ✅ |
| U1-26 | 生产构建看 /lab | 「居民管理(dev)」区块隐藏 | probeDebugAvailable 探测 /debug/state 404 | ✅ |

## 6. 顺带修复

| 编号 | 场景 | 处置 | 结果 |
|------|------|------|------|
| FX-01 | go-and-do 接续: 睡觉中点吃饭,move_to 受理但到达后 meal 未接续(DB 流 arrived(860) 后无 started)——接续 effect 见 activity 非空即清 pending,而 server 打断旧活动滞后一帧 | 仅当 activityId===pending.id 才 finish,其余活动保留 pending(7c1d80f);重放实证 arrived→started 同 tick | ✅ |

> 走查截图(主界面 HUD/📦 物品弹层/Lab 三栏)已发汇报,用后即清不留仓库。
