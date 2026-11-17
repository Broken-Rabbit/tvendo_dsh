# 更新日志

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
