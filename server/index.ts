import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 4002);
app.use(cors());
app.use(express.json());

// ---------- 类型 ----------
type Operator = '>' | '>=' | '<' | '<=' | '==' | '!=';
const OPERATORS: Operator[] = ['>', '>=', '<', '<=', '==', '!='];

type Reading = { sensor: string; value: number; unit: string };

type AlertRule = {
  id: string;
  sensor: string;
  name: string;
  operator: Operator;
  threshold: number;
  unit: string;
  severity: 'warning' | 'critical';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type RuleSnapshot = Pick<AlertRule, 'name' | 'operator' | 'threshold' | 'unit' | 'severity'>;

type LogEvent = {
  id: string;
  kind: 'triggered' | 'recovered' | 'info';
  ruleId: string | null;
  sensor: string | null;
  title: string;
  message: string;
  reading: Reading | null;        // 触发/恢复时的读数快照
  ruleSnapshot: RuleSnapshot | null; // 触发/恢复时的规则快照
  at: string;
};

// ---------- 数据 ----------
const readings: Reading[] = [
  { sensor: 'TMP-01', value: -8.4, unit: '°C' },
  { sensor: 'WND-02', value: 18.6, unit: 'm/s' },
  { sensor: 'SNW-03', value: 142, unit: 'cm' },
  { sensor: 'PWR-04', value: 76, unit: '%' }
];

const nowIso = () => new Date().toISOString();
const todayAt = (hhmm: string) => { const d = new Date(); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };

let ruleSeq = 0;
let eventSeq = 0;
const rules: AlertRule[] = [];
const events: LogEvent[] = [];
const activeAlerts = new Map<string, LogEvent>(); // ruleId -> 触发事件

function createRule(input: { sensor: string; name: string; operator: Operator; threshold: number; unit: string; severity?: 'warning' | 'critical'; enabled?: boolean }): AlertRule {
  const rule: AlertRule = {
    id: `rule-${++ruleSeq}`,
    severity: 'warning',
    enabled: true,
    ...input,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  rules.push(rule);
  return rule;
}

function logEvent(input: Omit<LogEvent, 'id' | 'at'> & { at?: string }): LogEvent {
  const event: LogEvent = { ...input, id: `evt-${++eventSeq}`, at: input.at ?? nowIso() };
  events.unshift(event);
  if (events.length > 100) events.pop();
  return event;
}

// 预置规则：覆盖风速、雪深、电池与温度
createRule({ sensor: 'WND-02', name: '风速超过巡检阈值', operator: '>', threshold: 15, unit: 'm/s' });
createRule({ sensor: 'SNW-03', name: '积雪深度超限', operator: '>', threshold: 150, unit: 'cm' });
createRule({ sensor: 'PWR-04', name: '电池电量过低', operator: '<', threshold: 70, unit: '%', severity: 'critical' });
createRule({ sensor: 'TMP-01', name: '极端低温', operator: '<', threshold: -15, unit: '°C' });

// 预置两条系统日志，保留原有观测动态的上下文
logEvent({ kind: 'info', ruleId: null, sensor: 'SNW-03', title: '雪深传感器完成自检', message: 'SNW-03 数据质量 99.2%', reading: null, ruleSnapshot: null, at: todayAt('08:15') });
logEvent({ kind: 'info', ruleId: null, sensor: null, title: '卫星链路已同步', message: '上行延迟 2.4 秒 · 下一次同步 12:30', reading: null, ruleSnapshot: null, at: todayAt('06:30') });

// ---------- 规则评估 ----------
function compare(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
  }
}

const snapshotRule = (rule: AlertRule): RuleSnapshot => ({ name: rule.name, operator: rule.operator, threshold: rule.threshold, unit: rule.unit, severity: rule.severity });

function evaluateRule(rule: AlertRule) {
  const reading = readings.find(r => r.sensor === rule.sensor);
  if (!reading) return;
  const active = activeAlerts.get(rule.id);
  if (!rule.enabled) {
    if (active) {
      activeAlerts.delete(rule.id);
      logEvent({ kind: 'recovered', ruleId: rule.id, sensor: rule.sensor, title: rule.name, message: `规则已停用，告警解除（当前 ${reading.value} ${reading.unit}）`, reading: { ...reading }, ruleSnapshot: active.ruleSnapshot });
    }
    return;
  }
  const violated = compare(reading.value, rule.operator, rule.threshold);
  if (violated && !active) {
    const event = logEvent({ kind: 'triggered', ruleId: rule.id, sensor: rule.sensor, title: rule.name, message: `当前 ${reading.value} ${reading.unit}，满足条件 ${rule.operator} ${rule.threshold} ${rule.unit}`, reading: { ...reading }, ruleSnapshot: snapshotRule(rule) });
    activeAlerts.set(rule.id, event);
  } else if (!violated && active) {
    activeAlerts.delete(rule.id);
    logEvent({ kind: 'recovered', ruleId: rule.id, sensor: rule.sensor, title: rule.name, message: `已恢复：当前 ${reading.value} ${reading.unit}，不再满足 ${rule.operator} ${rule.threshold} ${rule.unit}`, reading: { ...reading }, ruleSnapshot: active.ruleSnapshot });
  }
}

const evaluateAll = () => rules.forEach(evaluateRule);

// 模拟遥测：围绕当前值随机游走，让规则随新读数触发/恢复
const profiles: Record<string, { min: number; max: number; step: number; decimals: number }> = {
  'TMP-01': { min: -16, max: -4, step: 0.9, decimals: 1 },
  'WND-02': { min: 8, max: 26, step: 2.4, decimals: 1 },
  'SNW-03': { min: 120, max: 165, step: 4, decimals: 0 },
  'PWR-04': { min: 55, max: 88, step: 2, decimals: 0 }
};
function simulateTick() {
  for (const reading of readings) {
    const p = profiles[reading.sensor];
    if (!p) continue;
    const next = reading.value + (Math.random() - 0.5) * 2 * p.step;
    reading.value = Number(Math.min(p.max, Math.max(p.min, next)).toFixed(p.decimals));
  }
  evaluateAll();
}
setInterval(simulateTick, 15000);
evaluateAll(); // 启动即按当前读数评估一次

// ---------- 校验 ----------
function validateFields(f: any, requireAll: boolean): string | null {
  const need = (key: string) => (requireAll && f[key] === undefined) || f[key] !== undefined;
  if (need('sensor') && !readings.some(r => r.sensor === f.sensor)) return '未知传感器编码';
  if (need('name') && (typeof f.name !== 'string' || !f.name.trim() || f.name.trim().length > 30)) return '规则名称需为 1-30 个字符';
  if (need('operator') && !OPERATORS.includes(f.operator)) return '比较条件需为 >、>=、<、<=、==、!= 之一';
  if (need('threshold') && (f.threshold === null || f.threshold === '' || !Number.isFinite(Number(f.threshold)))) return '阈值需为数字';
  if (need('unit') && (typeof f.unit !== 'string' || !f.unit.trim() || f.unit.trim().length > 10)) return '单位需为 1-10 个字符';
  if (f.enabled !== undefined && typeof f.enabled !== 'boolean') return '启用状态需为布尔值';
  if (f.severity !== undefined && !['warning', 'critical'].includes(f.severity)) return '级别需为 warning 或 critical';
  return null;
}

const withActive = (rule: AlertRule) => ({ ...rule, active: activeAlerts.has(rule.id) });

// ---------- 路由 ----------
app.get('/api/health', (_req, res) => res.json({ status: 'ok', project: 'snow-mountain-weather-station', workflow: '采集传感器数据 → 校验质量 → 触发告警 → 同步观测记录' }));

app.get('/api/readings', (_req, res) => res.json(readings));

// 摄入新读数并立即评估规则
app.post('/api/readings', (req, res) => {
  const body = Array.isArray(req.body) ? req.body : req.body?.readings;
  if (!Array.isArray(body)) return res.status(400).json({ error: '请求体应为读数数组' });
  const updated: string[] = [];
  for (const item of body) {
    const target = readings.find(r => r.sensor === item?.sensor);
    const value = Number(item?.value);
    if (!target || !Number.isFinite(value)) continue;
    target.value = value;
    if (typeof item.unit === 'string' && item.unit.trim()) target.unit = item.unit.trim();
    updated.push(target.sensor);
  }
  if (!updated.length) return res.status(400).json({ error: '没有可更新的读数' });
  evaluateAll();
  res.json({ status: 'accepted', updated, readings, activeAlerts: [...activeAlerts.values()] });
});

app.get('/api/alert-rules', (_req, res) => res.json(rules.map(withActive)));

app.post('/api/alert-rules', (req, res) => {
  const error = validateFields(req.body ?? {}, true);
  if (error) return res.status(400).json({ error });
  const rule = createRule({ sensor: req.body.sensor, name: req.body.name.trim(), operator: req.body.operator, threshold: Number(req.body.threshold), unit: req.body.unit.trim(), severity: req.body.severity, enabled: req.body.enabled });
  evaluateRule(rule);
  res.status(201).json(withActive(rule));
});

app.put('/api/alert-rules/:id', (req, res) => {
  const rule = rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: '规则不存在' });
  const error = validateFields(req.body ?? {}, false);
  if (error) return res.status(400).json({ error });
  const f = req.body;
  if (f.sensor !== undefined) rule.sensor = f.sensor;
  if (f.name !== undefined) rule.name = f.name.trim();
  if (f.operator !== undefined) rule.operator = f.operator;
  if (f.threshold !== undefined) rule.threshold = Number(f.threshold);
  if (f.unit !== undefined) rule.unit = f.unit.trim();
  if (f.enabled !== undefined) rule.enabled = f.enabled;
  if (f.severity !== undefined) rule.severity = f.severity;
  rule.updatedAt = nowIso();
  evaluateRule(rule); // 规则变更后按当前读数重新评估
  res.json(withActive(rule));
});

app.delete('/api/alert-rules/:id', (req, res) => {
  const index = rules.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: '规则不存在' });
  const [rule] = rules.splice(index, 1);
  const active = activeAlerts.get(rule.id);
  if (active) {
    activeAlerts.delete(rule.id);
    logEvent({ kind: 'recovered', ruleId: rule.id, sensor: rule.sensor, title: rule.name, message: '规则已删除，对应告警解除', reading: null, ruleSnapshot: active.ruleSnapshot });
  }
  res.json({ status: 'deleted', id: rule.id });
});

app.get('/api/alerts', (_req, res) => res.json({ active: [...activeAlerts.values()], events: events.slice(0, 50) }));

app.get('/api/summary', (_req, res) => {
  const alertedSensors = new Set([...activeAlerts.values()].map(e => e.sensor));
  const today = nowIso().slice(0, 10);
  res.json({
    sensorsTotal: readings.length,
    sensorsNormal: readings.length - alertedSensors.size,
    sensorsAttention: alertedSensors.size,
    activeAlerts: activeAlerts.size,
    rulesTotal: rules.length,
    rulesEnabled: rules.filter(r => r.enabled).length,
    triggeredToday: events.filter(e => e.kind === 'triggered' && e.at.slice(0, 10) === today).length,
    linkLatencySeconds: 2.4,
    generatedAt: nowIso()
  });
});

app.post('/api/sync', (_req, res) => res.json({ status: 'accepted', syncedAt: nowIso() }));

app.listen(port, () => console.log(`Weather station API running at http://localhost:${port}`));
