# 实论 + 剧创：SafeLine + 证书配置单

> 2026-10-21 ／ 与哲思（zhesi）同模式：每线一个站点，回源 NodePort，证书装雷池侧。

## 1. 两个站点

| 线 | 域名 | 回源 | 说明 |
|---|---|---|---|
| 实论 | `shilun.finddatatech.cloud` | `http://100.64.0.8:31902`（fd-shilun-web，任一 cheap 节点可回源：100.64.0.8/.9/.13/.14/.15） | API 经 web 的 `/api/` 反代，无需单独暴露 |
| 剧创 | `juchuang.finddatatech.cloud` | `http://100.64.0.8:31903`（fd-juchuang-web，同上） | 同上；其哲思契约走集群内直连（fd-zhesi-api ClusterIP），不经公网 |

证书：泛域名 `*.finddatatech.cloud` 复用即可；HTTP→HTTPS 跳转。

## 2. 站点行为要点（与哲思完全一致）

- 健康检查 `GET /healthz` → `ok`；`index.html` 不缓存（SPA）。
- `/api/` 读超时 ≥ 60s（LLM 调用）。

## 3. 雷池已知坑（同哲思配置单，处理过一次的话照抄规则）

1. `^/api/` 的 POST body 放行或降级 body 检测（实论的公文草稿、剧创的台词文本引号密集）。
2. 不剥 `Authorization: Bearer` 头。
3. SPA 出不来先硬刷新再排障。

## 4. 验收清单（两域名各跑一遍）

```bash
curl -s https://shilun.finddatatech.cloud/healthz            # -> ok
curl -s https://juchuang.finddatatech.cloud/healthz          # -> ok
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://shilun.finddatatech.cloud/api/v1/search/works \
  -H 'Content-Type: application/json' -d '{"query":"test"}'   # -> 401（鉴权边界）
```

浏览器：两站 `/workbench` 顶栏有「登录」（Logto，与哲思同一账号体系，SSO 已登录则静默通过）。

## 5. Logto 应用（已建好，无需再配）

- shilun-workbench = `aqqinerulglscp6tw1fy0`（redirect=/workbench，CORS=origin）
- juchuang-workbench = `xlp6cjguc16zkxz7hc3d9`（同上）
