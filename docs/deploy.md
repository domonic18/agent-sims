# 生产部署指南

从零在一台云服务器(或任何有 Docker 的 Linux/macOS 主机)上部署 agent-sims 生产栈。
栈结构: `web`(nginx,9000 单入口)+ `app`(世界模拟+API,3100 仅容器内)+ `postgres`(pgvector)+ `db-backup`(每日备份 sidecar)。

## 前置要求

- Docker(含 compose 插件): `docker compose version` 可执行
- git
- (可选,公网访问)frpc 或其他隧道:穿透目标为 web 容器的 9000 端口

## 首次部署

```bash
# 1. 拉取仓库
git clone git@github.com:domonic18/agent-sims.git && cd agent-sims

# 2. 准备环境变量(必改: POSTGRES_PASSWORD / MASTER_KEY / ADMIN_INITIAL_PASSWORD)
cp .env.example .env
vi .env

# 3. 构建并启动(在仓库根目录执行;首启自动完成 migrate → seed → 素材自检 → 起服务)
docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env build && \
docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env up -d

# 4. 观察启动(healthcheck 全绿即就绪;首启含建表+种子,约 30 秒)
docker compose -f docker/docker-compose.yml -p agent-sims ps
docker compose -f docker/docker-compose.yml -p agent-sims logs -f app
```

### 导入素材

全新库素材表为空,游戏可跑但贴图缺失。用付费素材包(LimeZu)或自备包导入:

```bash
pnpm install
pnpm --filter @sims/server assets:import <素材包目录>
# 单件精修补充: pnpm --filter @sims/server assets:import-singles <目录> <outdoor|indoor> [limit] [theme]
```

导入后到后台(`/admin` → 素材)**发布**,nginx 即时对外生效。

### 验证清单

```bash
curl -s http://localhost:9000/health        # {"ok":true}(经 nginx 反代到 app)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/   # 200
nc -z localhost 3100 && echo BAD || echo GOOD   # 3100 不应对外开放(OPS-2 单入口)
```

浏览器打开 `http://<服务器IP>:9000`,右上角登录管理员(初始密码即 `ADMIN_INITIAL_PASSWORD`,**登录后立即在 ⚙ 设置里改密**),再到 `/admin`「模型配置」页录入四槽位模型(Base URL 含 `/v1`、模型名、API Key)。

## 日常升级

```bash
git pull
# 重建镜像(带构建信息注入,OPS-1;web 角落可见 sha/时间)
BUILD_SHA=$(git rev-parse --short HEAD) BUILD_TIME="$(date '+%F %H:%M')" \
  docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env build && \
docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env up -d
```

- 数据不受影响: postgres 落 `workspace/postgres`、素材落 `workspace/asset-library` 等宿主机 bind mount
- app 容器重建会丢**内存运行态**(在线 socket、进程内缓存),世界状态自 PG 续跑,观众刷新页面即恢复
- 迁移/种子由容器启动 CMD 自动执行,无需手工跑

## 备份与恢复

### 备份(自动)

`db-backup` sidecar 启动即备一份,之后每 24 小时一轮,`pg_dump --data-only | gzip` 落 `workspace/backups/agent_sims-<时间戳>.sql.gz`,保留 14 天。

素材文件不在数据库内,定期手工归档即可:

```bash
tar -czf workspace/backups/asset-library-$(date +%Y%m%d).tar.gz -C workspace asset-library
```

### 恢复(覆盖现有全部数据!)

```bash
docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env stop app
sh docker/restore-db.sh workspace/backups/agent_sims-20260109-2320.sql.gz
docker compose -f docker/docker-compose.yml -p agent-sims --env-file .env up -d app
```

注意事项(详见 `docker/restore-db.sh` 头注):

- 必须先停 app——它在跑会实时写库,与灌入数据撞主键
- 表结构由 app 重启时 migrate 自动重建,无需手工建表
- data-only 备份含 drizzle 迁移水位块,脚本已处理;素材恢复=解包 tar 回 `workspace/asset-library`

## 安全与暴露面(OPS-2)

- **单入口**: 公网仅 9000(web nginx)。API/WebSocket 经其反代 `/api`、`/socket.io`、`/health`;3100 不映射宿主机
- **登录防暴力**: 连续 5 次失败锁 15 分钟(按 IP+用户名双键),nginx 另有登录口 6r/m 限流;公网自查测试会消耗自己 IP 的配额,连错被锁属预期,等窗口滑出或 `docker compose restart app` 清零
- **限流**: 常规 API 按来源 IP 30r/s(burst 60),超限 429
- **CORS**: 默认仅同源;除非页面与 API 不同域,不要配置 `CORS_ORIGINS`

## TLS 反代建议(项目内不做 TLS)

9000 是明文 HTTP,公网加密在它前面加一层现成反代(任选其一,均为每域一条配置的量级):

- **Caddy(推荐,自动签发续期)**:

  ```caddy
  # Caddyfile
  sims.example.com {
      reverse_proxy 127.0.0.1:9000
  }
  ```

- **Traefik**: 声明式 label/file provider 指向 `127.0.0.1:9000`,启用 certificatesResolver
- **云 LB/CDN**: 腾讯云 CLB、Cloudflare 等,回源 `http://<服务器IP>:9000`;如源站限 IP,用防火墙把 9000 收窄到 LB 网段

要点:

- WebSocket(`/socket.io`)需反代支持升级头(Caddy/Traefik/主流云 LB 默认支持)
- 无需在 TLS 层再传 `X-Forwarded-For` 链——应用信任边界在自带 nginx(它以 `$remote_addr` 覆写 XFF),TLS 反代只管 443→9000 转发
- 若用 frpc 穿透无固定 IP 的家用机,建议套 Cloudflare 等前置获得 HTTPS 与域名

## 故障排查速查

| 症状 | 排查 |
|---|---|
| `/health` 不通 | `docker compose logs app` 看首启 migrate/seed 报错;确认 postgres healthcheck 绿 |
| 页面开但无图 | 素材未导入或未发布;`/admin` → 素材 → 发布 |
| 登录一直 429 | 触发防暴力锁;等 15 分钟或重启 app 容器清内存态 |
| socket 连不上(观众 0) | TLS 反代未放行 WebSocket 升级;`curl -i http://localhost:9000/socket.io/?EIO=4&transport=polling` 应返回 200 |
| 磁盘满 | `docker system df` 看 build cache;`docker builder prune -f` 清构建缓存 |
