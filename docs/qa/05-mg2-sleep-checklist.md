# M-G.2 睡眠机制走查清单

> **时效性**: 本清单为 M-G.2 时点(2026-10-06)的走查记录——sleep 活动/睡眠账本/缺觉软惩罚纯手动闭环。
> 服务器真值断言经 `/debug/state` + `POST /debug/tick?n=`(暂停+手动推进)+ `/debug/intent` 直发意图;
> UI 文本经 DOM 程序化断言,渲染取证以截图为准;数值分支(速率/floor/系数)另有 server 单测 14 例。
> 时间线纪元: gameMinutes 480 = 第 1 日 08:00;窗口 22:00(1320)~06:00(360)。

- 载体: 容器重建(development)`docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env up -d --build app web`
  (缺 `--env-file .env` 时 NODE_ENV 回退 production,/debug/* 整族 404);内置 TOWN_MAP 世界,/debug/spawn 自建角色
- 走查环境: /lab 调试台 + `/debug/intent` + `/api/world/settings`(paused/timeScale/params)
- 记法: ✅ 通过 / ❌ 缺陷

## 1. 入睡校验(须自家床,租约有效)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| SL-01 | 面板点「睡觉」(在自家床格) | 直接入睡 anchorKind=bed | `activity:{activityId:'sleep',anchorKind:'bed'}` | ✅ |
| SL-02 | 不在家点「睡觉」 | 自动走回**自家**床使用格后入睡(go-and-do) | toast「回家上床,到达后自动入睡」→ 到床 start sleep ✓ | ✅ |
| SL-03 | 公园长椅使用格 start_activity sleep | 拒绝: 非 sleep 锚点 | 「附近没有可用的床铺」类回执(七床使用格对照) | ✅ |
| SL-04 | 站他人公寓床 start_activity sleep | 拒绝: 床位归属 | 「不是你的床位」(单测+走查) | ✅ |
| SL-05 | 租约过期睡床 | 拒绝: 先续租 | 「租约已过期(付至第 2 日,今日第 3 日)」——走查期真实触发,续租后可睡 | ✅ |
| SL-06 | 无租房角色 | 面板睡觉按钮置灰 | title「无住房,先在资产页租住公寓才能睡觉」(DOM 断言) | ✅ |

## 2. 睡眠恢复与自然醒

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| SL-07 | 床上睡眠每分结算 | 体力 +0.35/分,幸福 +0.05/分,不叠待机衰减 | 10 分 50→53.5/50→50.5 精确 | ✅ |
| SL-08 | 睡满 480 分 | 自然醒 completed | activity=null,activity.finished{reason:completed} | ✅ |
| SL-09 | 中途醒来再睡 | 窗口账本续累计 | 100+140=240 分不缺觉(单测) | ✅ |
| SL-10 | 白天(08:00)开睡 480 分 | 照常完成,但窗口账本分文不记 | sleepWindowMinutes=0(单测+走查) | ✅ |

## 3. 缺觉结算与软惩罚(阈值 240 分,系数 0.7)

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| SL-11 | 22:00 睡至 06:00(479 分) | 无缺觉事件,账本清零 | debt_applied 不发,sleepWindowMinutes=0 | ✅ |
| SL-12 | 只睡 239 分至 06:00 | sleep.debt_applied+😪 | 停时 window=239,06:00 结算 debt=true+账本清零 | ✅ |
| SL-13 | 缺觉日 UI 徽标 | 😪 缺觉中 + title 说明 | CharactersSection 显「😪 缺觉中」,截图取证 | ✅ |
| SL-14 | 缺觉日工时 | 金币 ×0.7 | 杂工 120 分 0.8×0.7×120=**67.2**(非 96) | ✅ |
| SL-15 | 缺觉日幸福增益 | 正幸福 ×0.7,体力不折 | workout 40 分 happiness +0.35×0.7,energy 原速(单测) | ✅ |
| SL-16 | 缺觉日采集 | floor(2×0.7)=1 入包,扣存量照常 | berry 1,charges 扣 2(单测) | ✅ |
| SL-17 | 缺觉日制作 | floor(1×0.7)=0 派不出,材料已扣不退(有意) | berry_pie 0,berry 3→0,craft.completed(单测) | ✅ |

## 4. 惩罚到期与参数热调

| 编号 | 操作 | 预期 | 实际/证据 | 结果 |
|------|------|------|-----------|------|
| SL-18 | 次夜睡满(≥240) | 06:00 结算旧惩罚到期,sleepDebt=false | 次日工时全额 +96(120 分) | ✅ |
| SL-19 | 热调 SLEEP_MIN_MINUTES=0 | 当夜整夜不睡也不缺觉 | 06:00 day5 debt=false | ✅ |
| SL-20 | 恢复默认 240 | 缺觉判定回归 | 次夜不睡 → 06:00 day6 debt=true | ✅ |

## 5. 顺带修复

| 编号 | 场景 | 处置 | 结果 |
|------|------|------|------|
| FX-01 | C1 泛化锚点绑定漏改 web 侧 place.ts activityAnchors(仍精确匹配),床绑 rest 致 sleep 锚点集为空,面板点「睡觉」静默无反应 | place.ts 换 furnitureServesActivity 谓词与服务端同源(1f49f30) | ✅ |

> 走查截图(😴 睡眠中/😪 缺觉徽标)已发汇报,用后即清不留仓库。
