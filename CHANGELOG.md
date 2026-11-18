# 更新日志

## 0.3.0

- 新增 DSH 原生设置卡片：设置 → Tvendo 工具市场，配置服务地址、API Key、默认费用上限及超时。
- 使用宿主的 configForms / SettingsForm 保存配置，支持修订冲突检查、只读状态与 secret 脱敏；密钥留空不覆盖已有值。
- 配置字段改为 volatile 引用，每次工具调用读取最新值，保存即生效。
- 服务地址更换时清除旧插件密钥，环境变量密钥绑定所属地址，避免跨服务泄露。
- 修正 locale 元信息为 DSH 要求的 meta.title / meta.description，增加客户端导出与 dsh.client 清单。
- 新增设置卡片、校验、密钥保留及动态配置回归测试，打包校验同时检查客户端产物。
- 最低 DSH 版本升级至 0.2.2-rc.1。

## 0.2.0

- 仓库改为「根目录即包」：克隆下来的仓库可直接用 `github:<owner>/<repo>` 安装，不再需要 `dsh-tvendo/` 子目录。
- 补齐开发资产：`test/` 四组 `node:test` 单测（假 fetch 无网络）、`scripts/pack.mjs` / `verify-package.mjs` / `live-check.mjs`、GitHub Actions CI。
- `check:pack` 现在会在空目录安装 tarball，再用本地假服务加载入口、驱动 `tvendo_info` / `tvendo_search`，验证发布物自洽。
- README 重写：安装、配置、密钥来源、费用与安全、与 Skill/CLI 的关系。

## 0.1.6

- 从 Tvendo 仓库中抽出为独立仓库：`dsh-tvendo/` 自带 `package.json`、`cordis.patch.yml`、License、测试与 CI，可直接上传 GitHub 后以 `github:<owner>/<repo>` 安装。
- 新增 `npm run check:pack`：打包后在空目录安装 tarball、加载入口并驱动一个工具，验证发布物完整。
- 新增 `npm run check:live`：只调用免费接口（info / 余额预算 / 目录搜索）检查真实部署，不产生费用。

## 0.1.5

- `tvendo_run` 的 `parameters` 参数在 Schema 中声明为对象，减少模型传错类型。
- 错误映射按平台 code 细化：`COST_LIMIT_EXCEEDED` 明确“未开始也未扣费，提高上限需要用户授权”。

## 0.1.4

- 工具定义改为原生 JSON Schema + 自校验参数，不再依赖 Host 侧 `@deepseek-ai/dsh-tools`；profile 安装只需解析插件自身依赖。

## 0.1.3

- 修复搜索描述重复省略号；`tvendo_show` 兼容字符串形式的 Schema 与示例。
- 增加工具面单测（假部署驱动全部工具）。

## 0.1.2

- 增加设置页字段说明与密钥来源顺序；密钥不会跨服务地址转发。

## 0.1.1

- 支持本地 `.tgz` 安装；补充开发文档。

## 0.1.0

- 首版：`tvendo_info` / `tvendo_search` / `tvendo_show` / `tvendo_run` / `tvendo_runs` / `tvendo_account`，Config 设置页，`cordis.patch.yml` bundle 清单。
