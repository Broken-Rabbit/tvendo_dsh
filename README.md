# dsh-tvendo

把 [Tvendo](https://t.zhitoken.com) 平台接成 DeepSeek Harness 的原生插件：在任意 DSH 会话里直接搜索、查看并调用平台上的工具，**不用先装 CLI，也不用安装 Skill**。

Tvendo 的 Skill（`/SKILL.md`）描述的是「先查目录、看参数和价格、再带费用上限调用、丢了响应只查账不重试」这套流程；它的 CLI 把这些动作做成终端命令。本插件把这套流程变成六个原生工具，并把 Skill 里的约束直接写进工具描述和结果渲染里：

- 目录、价格、鉴权、余额、预算和结算仍然由你部署的 Tvendo 服务决定，插件只做一层薄接入，不缓存、不代理、不存储结果；
- 是否允许调用、要不要人工确认，仍然由 DSH 自己的权限与审批管线决定；
- 收费调用只发一次，绝不自动重试。

仓库本身就是一个完整的 npm 包（`package.json` / `cordis.patch.yml` / License / 测试 / CI），可以直接用 `github:<owner>/<repo>` 或本地 `.tgz` 安装。

## 提供的工具

| 工具 | 作用 | 计费 |
| --- | --- | --- |
| `tvendo_info` | 读取服务公开信息：品牌、版本、API 版本、币种、CLI/Skill 是否可用 | 免费 |
| `tvendo_search` | 按需求或关键词搜索工具目录，返回 `tool_ref`、名称、供应商、描述与单次价格 | 免费 |
| `tvendo_show` | 读取单个工具的输入 Schema、输入示例与价格 | 免费 |
| `tvendo_run` | 同步调用一个工具，返回结果与本次费用 | 按平台配置的单次价格 |
| `tvendo_runs` | 查询本账户调用记录；按 `request_id` 核对丢失的响应 | 免费 |
| `tvendo_account` | 查询余额、单次上限、每日预算与 UTC 重置时间 | 免费 |

典型流程：`tvendo_search` → `tvendo_show` → `tvendo_run`；响应丢失时用 `request_id` 走 `tvendo_runs` 对账，**不重试**。

## 安装

### 方式一：GitHub（推荐）

在 **设置 → 插件 → 添加插件** 中填仓库地址：

```text
https://github.com/Broken-Rabbit/tvendo_dsh
```

或 SSH 简写：

```text
github:Broken-Rabbit/tvendo_dsh
```

DSH 会用 profile 的包管理器克隆仓库并安装 `@deepseek-ai/schemastery`，不需要构建步骤。

### 方式二：本地 tarball（开发调试）

必须装 `.tgz`：`file:` 指向目录会变成软链，插件自己的依赖不会被装进去，运行时会报 `Cannot find package '@deepseek-ai/schemastery'`。

```sh
npm run pack     # 产出 dist/dsh-tvendo-<版本>.tgz
```

然后在 **设置 → 插件 → 添加插件** 中填：

```text
file:E:/github/tvendo_dsh/dist/dsh-tvendo-0.3.0.tgz
```

装完重启该 profile（桌面端未开启 HMR 时同样需要重开 App）。

### 方式三：npm（包发布后）

```sh
dsh plugin --profile <profile> add dsh-tvendo
```

## 配置

0.3.0 起提供独立的浏览器设置卡片（不是自动生成的表单）。安装后刷新 DSH 界面，打开设置侧栏新增的 **Tvendo 工具市场** 页面即可配置（插件页也提供同一张配置卡片）：

1. 填入服务地址与平台 API Key。
2. 按需设置默认费用上限、请求超时。
3. 点击「保存」。配置写入当前 profile，工具下次调用立即生效，无需重启。

密钥输入框始终为空，仅提示是否已保存；不修改密钥时留空即可。服务地址更换时，若没有同时输入新密钥，插件中原有密钥会一并清除；环境变量和 CLI 密钥也不能跨地址复用。密钥按 DSH 的 secret 规则从配置读取响应中移除，但仍以明文保存在本机 profile 配置中。

升级后没有看到卡片时，先刷新界面；如果宿主提示需要重启，请完整退出并重新启动 DSH。此 UI 需要 DSH **>= 0.2.2-rc.1**。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `server` | `https://t.zhitoken.com` | Tvendo 服务地址，必须带 `http(s)://` |
| `apiKey` | 空 | 平台 API Key，在控制台「API 密钥」页创建 |
| `defaultMaxCostMicros` | `0` | 每次调用的默认单次费用上限，单位微元（1000000 = 1 元）；`0` 表示不额外限制，仍受账户预算约束 |
| `requestTimeoutMs` | `120000` | 单次 HTTP 请求超时（毫秒） |

`apiKey` 是 `secret` 字段，设置页不会回显已保存的值。

### 密钥与地址的来源顺序

不填也能用。插件按下面的顺序解析，并且**不会把某个地址的密钥发往另一个地址**：

1. 插件设置里的 `server` / `apiKey`；
2. 环境变量 `TVENDO_SERVER` / `TVENDO_API_KEY`；
3. `tvendo` CLI 的本地配置（Windows 为 `%APPDATA%\tvendo\config.json`，可用 `TVENDO_CONFIG` 覆盖路径）。

已经用 CLI 配好接入的机器，装完插件即可直接使用，无需重复输入密钥。

> 设置页里填写的密钥会随 profile 配置文档保存在本机；希望密钥只留在环境变量里的用户请把该字段留空。

## 花费与安全

- **搜索、详情、查账免费**，只有 `tvendo_run` 按平台配置的单次价格计费。
- `tvendo_run` 的 `max_cost_micros` 会随请求发送；实际售价高于它时平台在扣费前拒绝调用（`403 COST_LIMIT_EXCEEDED`，`settlement=not_started`）。不传时使用插件默认值，仍不绕过账户预算。
- 账户余额与预算**不是**用户对本次任务的费用授权；只应在用户明确同意的额度内调用。
- 每次调用只发一次请求，从不自动重试可能已计费的调用。失败信息里带 `request_id`（以及已知时的 `run_id`、`settlement`），用于 `tvendo_runs` 对账。
- 密钥只出现在发往你配置的服务地址的请求头里，不写日志、不进工具输出；插件对上游响应设置 `redirect: 'error'`，不跟随重定向。

## 与 Skill / CLI 的关系

三者可以共存，共用一个平台账户与预算：

| 接入方式 | 适用 |
| --- | --- |
| 本插件 | DSH 内的会话，工具即原生能力，有设置页 |
| 中文 Skill（`/SKILL.md`） | 其他支持 Skill 的 Agent |
| `tvendo` CLI | 终端、脚本、其他 MCP 客户端 |

插件不依赖 CLI 安装；CLI 只作为密钥与环境变量的一个兜底来源。

## 从零验证

只需要 Node.js 22+ 和一个 Tvendo 服务地址：

```sh
npm install
npm test            # 单测：API、连接解析、金额格式、六个工具（假部署，无网络）
npm run check:pack  # 打包 → 空目录装 tarball → 本地假服务加载入口并驱动工具
```

对真实部署做一次**不花钱**的检查（只调用 info、余额预算和目录搜索，不调用 `/v1/run`）：

```sh
TVENDO_SERVER=https://t.zhitoken.com TVENDO_API_KEY=tv_live_... npm run check:live
```

尚未创建平台密钥时只跑公开检查：把 `TVENDO_API_KEY` 留空即可，脚本会跳过鉴权部分。

## 已知边界

- 平台执行超时 60 秒，插件默认等 120 秒给结算留时间；超时后只能用 `request_id` 对账，不能重放结果。
- 平台不保存可恢复的结果正文，`tvendo_runs` 只用于对账与诊断。
- 平台目前只提供同步调用，没有异步任务/回调。
- 工具名固定为 `tvendo_*`，不会与 DSH 自带工具冲突。
- 需要 DSH `>= 0.2.2-rc.1`（`engines.dsh`），更低版本会被插件管理器拒绝。

## 目录结构

```text
package.json          包与 bundle 清单（dsh.bundle.patch、卡片 meta/icon）
cordis.patch.yml      插入的插件行：id=tvendo, name=dsh-tvendo
lib/index.js          插件入口：导出 apply / Config / inject
lib/tools.js          六个工具的 JSON Schema、校验、render 与调用
lib/api.js            /v1 HTTP 客户端：错误映射、超时、request_id
lib/connection.js     服务地址与密钥的来源解析
lib/config.js         设置页表单的 Config schema
lib/format.js         金额、截断与 JSON 预览
lib/constants.js      默认地址、环境变量名、微元换算
test/                 node:test 单测（假 fetch / 临时配置文件，无网络）
scripts/pack.mjs              打包到 dist/
scripts/verify-package.mjs    装 tarball 后从零加载入口并驱动工具
scripts/live-check.mjs        真实部署的只读检查
locale/、icon.svg     插件管理页的卡片元数据
```

设计约束：工具定义是普通 `ToolDefinition` 对象（原生 JSON Schema），**不 import Host 侧的 `@deepseek-ai/dsh-tools`**。profile 安装只会解析插件自己的依赖，引用 Host 包会解析失败或复制一份；Schema 必须停留在注册表支持的子集内（type/oneOf/properties/required/additionalProperties/items/enum/const + annotations），参数由各工具自己校验。

## 开发

```sh
npm install
npm test           # 单测
npm run check:pack # 打包 + 从零安装校验
npm run check:live # 需要 TVENDO_SERVER / TVENDO_API_KEY
```

## 许可

[GNU LGPL v3](LICENSE)（`LGPL-3.0-only`）。

本仓库基于上游 `dsh-tvendo` 0.1.6（作者 dyunwei）整理而来，沿用同一许可证；修改点见 [CHANGELOG](CHANGELOG.md)。
