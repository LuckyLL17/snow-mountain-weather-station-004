import express from 'express';
import cors from 'cors';
const app = express();
const port = Number(process.env.PORT || 4002);
app.use(cors());
app.use(express.json());
const COMPARISONS = ['>', '>=', '<', '<=', '=='];
const sensors = [
    { code: 'TMP-01', name: '山脊温度' },
    { code: 'WND-02', name: '风速 / 风向' },
    { code: 'SNW-03', name: '积雪深度' },
    { code: 'PWR-04', name: '电池组电量' }
];
const latestReadings = new Map();
const rules = [];
const activeAlerts = new Map(); // ruleId -> 触发事件
const events = []; // 运行日志，新的在前
const MAX_EVENTS = 200;
let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${++seq}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
function compare(value, comparison, threshold) {
    switch (comparison) {
        case '>': return value > threshold;
        case '>=': return value >= threshold;
        case '<': return value < threshold;
        case '<=': return value <= threshold;
        case '==': return value === threshold;
    }
}
const ruleText = (rule) => `${rule.name} ${rule.comparison} ${rule.threshold} ${rule.unit}`.trim();
function pushEvent(evt) {
    events.unshift(evt);
    if (events.length > MAX_EVENTS)
        events.pop();
    return evt;
}
function recordInfo(title, detail, at = new Date().toISOString()) {
    return pushEvent({ id: nextId('evt'), type: 'info', at, title, detail, ruleId: null, reading: null, rule: null });
}
/** 记录一条触发/恢复事件，并保留当时的读数与规则快照 */
function recordRuleEvent(type, rule, reading) {
    const evt = pushEvent({
        id: nextId('evt'),
        type,
        at: new Date().toISOString(),
        title: type === 'triggered' ? rule.name : `${rule.name} · 已恢复`,
        detail: reading ? `读数 ${reading.value} ${reading.unit} · 规则 ${ruleText(rule)}` : `规则 ${ruleText(rule)} 已解除`,
        ruleId: rule.id,
        reading: reading ? clone(reading) : null,
        rule: clone(rule)
    });
    if (type === 'triggered')
        activeAlerts.set(rule.id, evt);
    else
        activeAlerts.delete(rule.id);
    return evt;
}
/** 根据一条新读数评估该传感器的所有启用规则，产生触发/恢复事件 */
function evaluateReading(reading) {
    const emitted = [];
    for (const rule of rules) {
        if (rule.sensor !== reading.sensor || !rule.enabled)
            continue;
        const breached = compare(reading.value, rule.comparison, rule.threshold);
        const active = activeAlerts.has(rule.id);
        if (breached && !active)
            emitted.push(recordRuleEvent('triggered', rule, reading));
        else if (!breached && active)
            emitted.push(recordRuleEvent('recovered', rule, reading));
    }
    return emitted;
}
/** 规则新增/修改/启停后，用该传感器最新读数重新评估，保持告警状态一致 */
function reevaluateRule(rule) {
    const reading = latestReadings.get(rule.sensor) ?? null;
    const active = activeAlerts.has(rule.id);
    if (!rule.enabled) {
        return active ? [recordRuleEvent('recovered', rule, reading)] : [];
    }
    if (!reading)
        return [];
    const breached = compare(reading.value, rule.comparison, rule.threshold);
    if (breached && !active)
        return [recordRuleEvent('triggered', rule, reading)];
    if (!breached && active)
        return [recordRuleEvent('recovered', rule, reading)];
    return [];
}
/* ---------- 初始数据 ---------- */
function seed() {
    const now = Date.now();
    const seedReadings = [
        ['TMP-01', -8.4, '°C'],
        ['WND-02', 18.6, 'm/s'],
        ['SNW-03', 142, 'cm'],
        ['PWR-04', 76, '%']
    ];
    seedReadings.forEach(([sensor, value, unit], index) => {
        latestReadings.set(sensor, { sensor, value, unit, at: new Date(now - (seedReadings.length - index) * 10 * 60000).toISOString() });
    });
    const createdAt = new Date(now - 24 * 3600000).toISOString();
    rules.push({ id: 'rule-wind', sensor: 'WND-02', name: '风速超过巡检阈值', comparison: '>', threshold: 15, unit: 'm/s', enabled: true, createdAt, updatedAt: createdAt }, { id: 'rule-snow', sensor: 'SNW-03', name: '积雪深度过高', comparison: '>=', threshold: 150, unit: 'cm', enabled: true, createdAt, updatedAt: createdAt }, { id: 'rule-battery', sensor: 'PWR-04', name: '电池电量过低', comparison: '<', threshold: 30, unit: '%', enabled: true, createdAt, updatedAt: createdAt });
    recordInfo('卫星链路已同步', '上行延迟 2.4 秒 · 下一次同步 12:30', new Date(now - 3.5 * 3600000).toISOString());
    recordInfo('雪深传感器完成自检', 'SNW-03 数据质量 99.2%', new Date(now - 2 * 3600000).toISOString());
    // 用当前读数做首次评估，让满足条件的规则立即进入告警状态
    for (const reading of latestReadings.values())
        evaluateReading(reading);
}
seed();
/* ---------- 读数 ---------- */
app.get('/api/health', (_req, res) => res.json({ status: 'ok', project: 'snow-mountain-weather-station', workflow: '采集传感器数据 → 校验质量 → 触发告警 → 同步观测记录' }));
app.get('/api/readings', (_req, res) => res.json([...latestReadings.values()]));
app.post('/api/readings', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const accepted = [];
    const emitted = [];
    for (const item of items) {
        const sensor = String(item?.sensor ?? '');
        if (!sensors.some(s => s.code === sensor)) {
            return res.status(400).json({ error: `未知传感器: ${sensor || '(空)'}`, knownSensors: sensors.map(s => s.code) });
        }
        const value = Number(item?.value);
        if (!Number.isFinite(value))
            return res.status(400).json({ error: '读数 value 必须是数字' });
        const unit = String(item?.unit ?? latestReadings.get(sensor)?.unit ?? '');
        const reading = { sensor, value, unit, at: new Date().toISOString() };
        latestReadings.set(sensor, reading);
        accepted.push(reading);
        emitted.push(...evaluateReading(reading));
    }
    res.json({ readings: accepted, events: emitted });
});
/* ---------- 告警规则管理 ---------- */
const publicRule = (rule) => ({ ...rule, active: activeAlerts.has(rule.id) });
app.get('/api/rules', (_req, res) => res.json(rules.map(publicRule)));
app.post('/api/rules', (req, res) => {
    const body = req.body ?? {};
    const sensor = String(body.sensor ?? '');
    if (!sensors.some(s => s.code === sensor))
        return res.status(400).json({ error: '未知传感器' });
    const name = String(body.name ?? '').trim();
    if (!name)
        return res.status(400).json({ error: '缺少规则名称' });
    if (!COMPARISONS.includes(body.comparison))
        return res.status(400).json({ error: `比较条件必须是 ${COMPARISONS.join(' / ')}` });
    const threshold = Number(body.threshold);
    if (!Number.isFinite(threshold))
        return res.status(400).json({ error: '阈值必须是数字' });
    const now = new Date().toISOString();
    const rule = {
        id: nextId('rule'),
        sensor,
        name,
        comparison: body.comparison,
        threshold,
        unit: String(body.unit ?? latestReadings.get(sensor)?.unit ?? ''),
        enabled: body.enabled !== false,
        createdAt: now,
        updatedAt: now
    };
    rules.push(rule);
    const emitted = reevaluateRule(rule);
    res.status(201).json({ rule: publicRule(rule), events: emitted });
});
app.put('/api/rules/:id', (req, res) => {
    const rule = rules.find(r => r.id === req.params.id);
    if (!rule)
        return res.status(404).json({ error: '规则不存在' });
    const body = req.body ?? {};
    // 传感器变更前，先解除旧传感器上的活动告警
    if (body.sensor !== undefined && body.sensor !== rule.sensor) {
        if (!sensors.some(s => s.code === body.sensor))
            return res.status(400).json({ error: '未知传感器' });
        if (activeAlerts.has(rule.id))
            recordRuleEvent('recovered', rule, latestReadings.get(rule.sensor) ?? null);
        rule.sensor = String(body.sensor);
    }
    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name)
            return res.status(400).json({ error: '规则名称不能为空' });
        rule.name = name;
    }
    if (body.comparison !== undefined) {
        if (!COMPARISONS.includes(body.comparison))
            return res.status(400).json({ error: `比较条件必须是 ${COMPARISONS.join(' / ')}` });
        rule.comparison = body.comparison;
    }
    if (body.threshold !== undefined) {
        const threshold = Number(body.threshold);
        if (!Number.isFinite(threshold))
            return res.status(400).json({ error: '阈值必须是数字' });
        rule.threshold = threshold;
    }
    if (body.unit !== undefined)
        rule.unit = String(body.unit);
    if (body.enabled !== undefined)
        rule.enabled = Boolean(body.enabled);
    rule.updatedAt = new Date().toISOString();
    const emitted = reevaluateRule(rule);
    res.json({ rule: publicRule(rule), events: emitted });
});
app.delete('/api/rules/:id', (req, res) => {
    const index = rules.findIndex(r => r.id === req.params.id);
    if (index === -1)
        return res.status(404).json({ error: '规则不存在' });
    const [rule] = rules.splice(index, 1);
    if (activeAlerts.has(rule.id))
        recordRuleEvent('recovered', rule, latestReadings.get(rule.sensor) ?? null);
    res.json({ status: 'deleted', id: rule.id });
});
/* ---------- 运行日志与状态摘要 ---------- */
app.get('/api/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, MAX_EVENTS);
    res.json(events.slice(0, limit));
});
app.get('/api/summary', (_req, res) => {
    const sensorStatus = sensors.map(sensor => {
        const activeCount = rules.filter(r => r.sensor === sensor.code && activeAlerts.has(r.id)).length;
        return { ...sensor, reading: latestReadings.get(sensor.code) ?? null, status: activeCount > 0 ? '告警' : '正常', activeAlerts: activeCount };
    });
    res.json({
        station: 'M-07',
        at: new Date().toISOString(),
        normal: sensorStatus.filter(s => s.status === '正常').length,
        attention: sensorStatus.filter(s => s.status !== '正常').length,
        activeAlerts: [...activeAlerts.values()],
        rules: { total: rules.length, enabled: rules.filter(r => r.enabled).length },
        sensors: sensorStatus
    });
});
app.post('/api/sync', (_req, res) => res.json({ status: 'accepted', syncedAt: new Date().toISOString() }));
app.listen(port, () => console.log(`Weather station API running at http://localhost:${port}`));
