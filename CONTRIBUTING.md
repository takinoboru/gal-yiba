# 贡献指南

感谢你帮助改进旮一把与 NPC Lab。

## 开始之前

- 新功能或大范围改动请先提交 Issue，说明用例、数据边界与预期行为。
- 自动化对战只能用于项目方授权的测试，不得读取隐藏答案、绕过限制或干扰真实玩家。
- 不要提交特征码、管理密钥、数据库、运行日志或 `.env` 文件。

## 本地验证

需要 Node.js 22+ 与 pnpm 9.15.1。

```bash
pnpm install --frozen-lockfile
pnpm check
```

NPC Lab 的快速验证：

```bash
pnpm npc:lab:build
pnpm --filter @gal-yiba/npc test
```

## Pull Request

- 一个 PR 聚焦一个问题，写清动机、实现方式与验证结果。
- 新行为需要自动化测试；界面改动请附上说明。
- 保持向后兼容；需要数据迁移时，在 PR 中写明回滚方案。
