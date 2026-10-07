-- data-only 备份恢复前置(被 restore-db.sh 消费): 清空 public 全部表,
-- 防灌入时主键冲突(migrate+seed 已写入的行一并清,备份自含全部表数据与 setval)。
-- replica 模式绕过 FK/触发器,TRUNCATE 级联无阻;调用方以单事务 -1 执行,失败即整体回滚。
SET session_replication_role = replica;
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $do$;
