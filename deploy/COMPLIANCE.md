# 交付前合规核查

本文件登记 `shilun-citation-hardening` 归档时仍未闭环的两项外部依赖，以及各自的
**核查方式**。两项都不是代码问题——代码侧已按「未就绪即显式失败」实现——但它们
决定产品能否对外交付，因此必须在 go-live 前逐项签掉。

第 1 项（中文文献授权通道）自 `add-chinese-open-metadata-fallback` 起**不再是
上线的硬前置**：无通道时走开放元数据兜底，签约只影响覆盖率；但它仍是「未注册
DOI 的中文文献能否查到」的前提，签收标准保留。

---

## 1. 中文文献授权通道（万方等）

### 现状

`server/fd_shilun_api/channels.py` 的 HTTP 响应契约是**假定**的：请求体
`{"query", "page", "per_page"}`，响应接受 `results` / `items` / `data.records`
三种顶层形状，字段接受英文与中文别名。解析是防御性的：认不出的响应判 `upstream`，
绝不猜测语义。

未配置通道时检索**不再**返回 `reason=no_authorized_channel`：中文检索先走开放
元数据兜底（Crossref → OpenAlex，免费无密钥），结果逐条标 `coverage=partial` /
`metadata_only=true` 并附 `coverage_note`，两者都无命中才返回 `reason=not_indexed`。
`no_authorized_channel` 只保留给需要原文全文的能力（引用核验三级「支持」）。
授权通道的价值因此是**提升覆盖率**（未注册 DOI 的中文期刊/学位论文只有授权通道有），
不再是「能不能检索」的开关。回滚档：`FD_SHILUN_CN_OPEN_FALLBACK=0` 恢复旧口径。

凭据可由使用者自备（BYOK）：请求体 `channel_credentials: {"wanfang": "<key>"}`，
优先级高于 `api_key_env`，只在单次调用内存中存活、不落库不进日志不回显。
因此**签约前也能先上生产**：默认走免费兜底，有授权的客户按请求带自己的 key。

### 为什么没闭环

厂商开放平台文档（`apps.wanfangdata.com.cn/open`）需登录后查看，无账号无法逐字段
复核；签约本身是商务动作。

### 核查方式（拿到账号后一条命令）

```bash
export FD_SHILUN_CN_CHANNELS='[
  {"id":"wanfang","kind":"http","license":"<合同号>",
   "base_url":"<厂商给的检索端点>","api_key_env":"WANFANG_API_KEY",
   "auth_scheme":"header","header_name":"<厂商要求的头名>"}
]'
export WANFANG_API_KEY='<厂商给的 key>'

python3 server/scripts/check_cn_channel.py --query 乡村振兴
```

脚本逐字段比对「厂商实际返回」与「我们的解析假设」，输出：

- 请求是否成功（HTTP 状态、鉴权是否被接受）
- 响应顶层形状是否被识别
- 每条记录能否解析出 标识/题名/作者/年份/来源/摘要/doi
- 不匹配的字段逐条列出，并给出该改哪一行配置

**退出码 0 = 契约吻合，可以上线；非 0 = 契约不符，按输出修正后再跑。**

### 签收标准

- [ ] `check_cn_channel.py` 退出码为 0
- [ ] `FD_SHILUN_CN_CHANNELS` 的 `license` 字段填的是真实合同号/授权依据
- [ ] 生产环境已注入 `api_key_env` 指向的密钥，或确认走 BYOK（客户自带 key）
- [ ] 检索命中时 `provenance.authorization.basis` 能在响应里看到
- [ ] 未配置通道时响应带 `coverage_note` 且 `reason` 不为 `no_authorized_channel`

---

## 2. 商业字体授权

### 现状

代码**不分发任何字体文件**（`gongwen/fonts.py` 只读本机字体目录的元数据）。
`tests/test_font_licensing.py` 守卫这条不变量：仓库里出现商业中文字体二进制即失败。

仓库里唯一的字体二进制是 `web/dist/assets/` 下的 Noto Serif SC，采用 SIL Open
Font License 1.1，可自由分发。

缺字体时按声明顺序回退并在验收报告里列明（spec「字体授权与降级」）；严格模式
（`FD_SHILUN_FONT_STRICT=1`）缺首选字体直接失败，作为交付前门。

### 为什么没闭环

方正小标宋 / 仿宋_GB2312 / 楷体_GB2312 的授权范围（尤其「是否允许随私有化交付
分发」）需法务确认，不是工程可判定的事项。

### 核查方式

```bash
cd fd-shilun && python3 -m pytest server/tests/test_font_licensing.py -q
```

再对目标部署环境跑一次严格模式验收：

```bash
FD_SHILUN_FONT_STRICT=1 python3 -c "
from fd_shilun_api.gongwen import fonts
r = fonts.resolve_fonts(strict=True)
print('严格模式通过：', {k: v.chosen for k, v in r.roles.items()})
"
```

严格模式通过 = 该环境已装齐标准公文字体，可交付。

### 签收标准

- [ ] 法务书面确认商业字体的分发范围
- [ ] 若允许随产品分发：确认授权覆盖私有化交付，并把字体文件加入部署镜像（**不进本仓**）
- [ ] 若不允许：保持回退链 + 严格模式前门，交付时由客户环境自备字体
- [ ] `test_font_licensing.py` 通过（仓库无商业字体二进制）

---

## 3. 其余上线前检查

| 项 | 命令 | 期望 |
| --- | --- | --- |
| 全量测试 | `cd server && python -m pytest -q` | 全绿 |
| 前端类型与测试 | `cd web && npx tsc --noEmit && npx vitest run` | 无错、全绿 |
| enforce 可切可回滚 | `python3 server/scripts/rollback_drill.py` | PASS |
| shadow 回放比例 | `python3 server/scripts/replay_shadow.py -o /tmp/replay.json` | block 比例可接受 |
