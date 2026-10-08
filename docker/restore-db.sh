#!/bin/sh
# 从 workspace/backups 每日备份一键恢复 agent-sims 生产库(覆盖现有全部数据!)
# 前提: 先 docker compose stop app 再恢复——app 在跑会实时写库(直播访客经 frpc
#       重连即触发 C8 建世界),与灌入数据撞主键;恢复完再 up app(自动按档还原现场)。
#       表结构由 app 启动 migrate 自动重建,无需手工建表。
# 注意: data-only 备份含 drizzle.__drizzle_migrations 块,若新库已 migrate 需过滤该块
#       (awk 跳过 "-- Data for Name: __drizzle_migrations" 至行内 \\.),否则撞主键。
# 用法: sh docker/restore-db.sh workspace/backups/agent_sims-20261007-2320.sql.gz
# 恢复动作(见 docker/restore-truncate.sql): 清空 public 全表 → 单事务灌入备份
# (pg_dump --data-only 自含 setval 序列位,无需手工补;asset_categories 自引用
#  顺序由 dump 依赖排序保证,psql 可能打无害警告)。
set -eu
file=${1:?用法: $0 <workspace/backups/agent_sims-*.sql.gz>}
[ -f "$file" ] || { echo "备份文件不存在: $file" >&2; exit 1; }
echo "⚠ 即将用 $file 覆盖恢复 agent_sims 库(3 秒后执行,Ctrl+C 取消)"
sleep 3
docker exec -i agent-sims-postgres-1 \
  psql -U sims -d agent_sims -1 -q -v ON_ERROR_STOP=1 < "$(dirname "$0")/restore-truncate.sql"
gunzip -c "$file" | docker exec -i agent-sims-postgres-1 \
  psql -U sims -d agent_sims -1 -q -v ON_ERROR_STOP=1
echo "✓ 恢复完成: $file"
