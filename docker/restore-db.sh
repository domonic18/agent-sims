#!/bin/sh
# 从 workspace/backups 每日备份一键恢复 agent-sims 生产库(覆盖现有全部数据!)
# 前提: 生产容器栈在跑(app 已完成 migrate,表结构就绪——postgres 卷被清后
#       compose up 即自动重建结构,无需手工建表)。
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
