# 雪山气象站

React + Vite + TypeScript 的高海拔自动气象站监控基础项目。提供山地站点环境概览、传感器阵列、观测动态、趋势图和链路状态，保留后续接入真实遥测、卫星同步、告警规则和历史数据服务的空间。

```bash
npm install
npm run dev
```

> 注意：`npm run dev:server` 使用 `node --experimental-strip-types` 直接运行 TypeScript，需要 Node.js ≥ 22.6。

## 告警规则管理

值守员可在「告警规则管理」面板中为每个传感器配置告警规则：比较条件（`>` `>=` `<` `<=` `==`）、阈值、单位和启用状态，支持新增、编辑、启停和删除。服务端根据新上报的读数评估启用中的规则，判断告警**触发**或**恢复**，结果实时反映在「观测动态」运行日志和顶部状态摘要中；每条触发/恢复事件都保留当时的读数快照和规则快照。

### API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/readings` | 各传感器最新读数 |
| POST | `/api/readings` | 上报新读数 `{ sensor, value, unit? }`（支持数组批量），返回评估产生的触发/恢复事件 |
| GET | `/api/rules` | 规则列表（含 `active` 告警中标记） |
| POST | `/api/rules` | 新增规则 `{ sensor, name, comparison, threshold, unit?, enabled? }` |
| PUT | `/api/rules/:id` | 修改规则（部分字段），变更后按最新读数重新评估 |
| DELETE | `/api/rules/:id` | 删除规则，活动中的告警自动记录恢复事件 |
| GET | `/api/events?limit=` | 运行日志（触发/恢复/系统事件，含读数与规则快照） |
| GET | `/api/summary` | 状态摘要：正常/关注传感器数、活动告警、规则启用统计 |
