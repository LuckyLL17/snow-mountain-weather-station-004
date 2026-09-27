import { useCallback, useEffect, useState } from 'react';

type Operator = '>' | '>=' | '<' | '<=' | '==' | '!=';
const OPERATORS: Operator[] = ['>', '>=', '<', '<=', '==', '!='];
const OPERATOR_LABEL: Record<Operator, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', '!=': '≠' };

type SensorMeta = { id: string; name: string; code: string; color: string; trend: string; points: number[] };
const sensorMeta: SensorMeta[] = [
  { id: 'temp', name: '山脊温度', code: 'TMP-01', color: '#78d7ef', trend: '↓ 1.2°', points: [20, 24, 21, 31, 28, 34, 42, 38, 47, 50] },
  { id: 'wind', name: '风速 / 风向', code: 'WND-02', color: '#f2bc71', trend: '↑ 3.8', points: [31, 28, 38, 40, 34, 47, 45, 56, 54, 62] },
  { id: 'snow', name: '积雪深度', code: 'SNW-03', color: '#bba4ff', trend: '↑ 4 cm', points: [58, 53, 52, 50, 45, 42, 38, 35, 30, 28] },
  { id: 'power', name: '电池组电量', code: 'PWR-04', color: '#94df9a', trend: '↓ 2%', points: [72, 70, 76, 72, 70, 76, 80, 79, 78, 76] }
];

type Reading = { sensor: string; value: number; unit: string };
type RuleSnapshot = { name: string; operator: Operator; threshold: number; unit: string; severity: 'warning' | 'critical' };
type AlertRule = { id: string; sensor: string; name: string; operator: Operator; threshold: number; unit: string; severity: 'warning' | 'critical'; enabled: boolean; active: boolean; updatedAt: string };
type LogEvent = { id: string; kind: 'triggered' | 'recovered' | 'info'; sensor: string | null; title: string; message: string; reading: Reading | null; ruleSnapshot: RuleSnapshot | null; at: string };
type Summary = { sensorsNormal: number; sensorsAttention: number; activeAlerts: number; rulesEnabled: number; rulesTotal: number; triggeredToday: number; linkLatencySeconds: number; generatedAt: string };

const fallbackReadings: Reading[] = [
  { sensor: 'TMP-01', value: -8.4, unit: '°C' },
  { sensor: 'WND-02', value: 18.6, unit: 'm/s' },
  { sensor: 'SNW-03', value: 142, unit: 'cm' },
  { sensor: 'PWR-04', value: 76, unit: '%' }
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options ? { headers: { 'Content-Type': 'application/json' }, ...options } : undefined);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `请求失败 (${res.status})`);
  return data as T;
}

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const formatStamp = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function MiniChart({ points, color }: { points: number[]; color: string }) { const coords = points.map((p, index) => `${(index / (points.length - 1)) * 100},${70 - p}`).join(' '); return <svg className="mini-chart" viewBox="0 0 100 70" preserveAspectRatio="none"><defs><linearGradient id={`fill-${color.replace('#','')}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><polygon points={`0,70 ${coords} 100,70`} fill={`url(#fill-${color.replace('#','')})`} /><polyline points={coords} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" /></svg>; }
function MountainScene() { return <div className="mountain-scene"><div className="stars"/><div className="sun-glow"/><div className="mountain back"/><div className="mountain mid"/><div className="mountain front"/><div className="station"><span className="mast"/><span className="station-box"/><span className="antenna"/></div><div className="scene-caption"><span>海拔 4,820 m</span><span>自动观测站 · M-07</span></div></div>; }

function RuleRow({ rule, sensorName, onUpdate, onDelete }: { rule: AlertRule; sensorName: string; onUpdate: (id: string, patch: Record<string, unknown>) => void; onDelete: (id: string) => void }) {
  const commit = (key: 'threshold' | 'unit', e: React.FocusEvent<HTMLInputElement>) => {
    const trimmed = e.target.value.trim();
    const current = String(rule[key]);
    if (!trimmed || trimmed === current || (key === 'threshold' && !Number.isFinite(Number(trimmed)))) { e.target.value = current; return; }
    onUpdate(rule.id, key === 'threshold' ? { threshold: Number(trimmed) } : { unit: trimmed });
  };
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  return <div className={rule.enabled ? 'rule-row' : 'rule-row disabled'}>
    <div className="rule-main">
      <span className="rule-sensor">{rule.sensor}</span>
      <b>{rule.name}</b>
      <span className="rule-sensor-name">{sensorName}</span>
      {rule.active && <span className={`rule-badge ${rule.severity}`}>触发中</span>}
      {!rule.enabled && <span className="rule-badge off">已停用</span>}
    </div>
    <div className="rule-condition">
      <select value={rule.operator} disabled={!rule.enabled} onChange={e => onUpdate(rule.id, { operator: e.target.value })}>{OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}</select>
      <input key={`t-${rule.threshold}`} type="number" step="any" defaultValue={rule.threshold} disabled={!rule.enabled} onKeyDown={blurOnEnter} onBlur={e => commit('threshold', e)} />
      <input key={`u-${rule.unit}`} className="unit" defaultValue={rule.unit} maxLength={10} disabled={!rule.enabled} onKeyDown={blurOnEnter} onBlur={e => commit('unit', e)} />
    </div>
    <div className="rule-actions">
      <button className={rule.enabled ? 'toggle on' : 'toggle'} title={rule.enabled ? '点击停用' : '点击启用'} onClick={() => onUpdate(rule.id, { enabled: !rule.enabled })}><i/></button>
      <button className="icon-btn" title="删除规则" onClick={() => onDelete(rule.id)}>✕</button>
    </div>
  </div>;
}

export default function App() {
  const [selectedId, setSelectedId] = useState('wind');
  const [range, setRange] = useState('24 小时');
  const [notice, setNotice] = useState('');
  const [readings, setReadings] = useState<Reading[]>(fallbackReadings);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [draft, setDraft] = useState({ sensor: 'WND-02', name: '', operator: '>' as Operator, threshold: '', unit: 'm/s' });

  const load = useCallback(async () => {
    try {
      const [readingData, ruleData, alertData, summaryData] = await Promise.all([
        api<Reading[]>('/api/readings'),
        api<AlertRule[]>('/api/alert-rules'),
        api<{ events: LogEvent[] }>('/api/alerts'),
        api<Summary>('/api/summary')
      ]);
      setReadings(readingData);
      setRules(ruleData);
      setEvents(alertData.events);
      setSummary(summaryData);
    } catch { /* 服务端暂不可用时保留当前数据 */ }
  }, []);

  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    try { await action(); await load(); setNotice(ok); return true; } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败'); return false; }
  };
  const updateRule = (id: string, patch: Record<string, unknown>) => run(() => api(`/api/alert-rules/${id}`, { method: 'PUT', body: JSON.stringify(patch) }), '告警规则已更新');
  const deleteRule = (id: string) => run(() => api(`/api/alert-rules/${id}`, { method: 'DELETE' }), '告警规则已删除');
  const addRule = async () => {
    const threshold = Number(draft.threshold);
    if (!draft.name.trim()) return setNotice('请填写规则名称');
    if (!Number.isFinite(threshold) || draft.threshold.trim() === '') return setNotice('请填写数字阈值');
    if (!draft.unit.trim()) return setNotice('请填写单位');
    const created = await run(() => api('/api/alert-rules', { method: 'POST', body: JSON.stringify({ sensor: draft.sensor, name: draft.name.trim(), operator: draft.operator, threshold, unit: draft.unit.trim() }) }), '告警规则已创建');
    if (created) setDraft({ ...draft, name: '', threshold: '' });
  };

  const alertingSensors = new Set(rules.filter(r => r.active).map(r => r.sensor));
  const sensors = sensorMeta.map(meta => {
    const reading = readings.find(r => r.sensor === meta.code);
    return { ...meta, value: reading ? String(reading.value) : '–', unit: reading?.unit ?? '', status: (alertingSensors.has(meta.code) ? '注意' : '正常') as '注意' | '正常' };
  });
  const selected = sensors.find(sensor => sensor.id === selectedId) ?? sensors[0];
  const sensorName = (code: string) => sensorMeta.find(m => m.code === code)?.name ?? code;

  return <div className="dashboard"><header className="topbar"><div className="brand"><div className="brand-icon">✦</div><div><span className="eyebrow">ALPINE OBSERVATORY / M-07</span><h1>雪线气象站 · 运行总览</h1></div></div><div className="top-meta"><span className="sync"><i/>数据已同步 · {summary ? formatStamp(summary.generatedAt) : '连接中…'}</span><button onClick={() => setNotice('已请求最新卫星数据同步')}>↻ 刷新数据</button><div className="profile">陈 <span>值守员</span></div></div></header><main className="main"><section className="status-strip"><div><span className="eyebrow">STATION STATUS</span><h2>高海拔自动气象观测站</h2><p>北麓冰川保护区 · 当前气象窗口良好</p></div><div className="status-numbers"><div><strong className="cyan">{summary?.sensorsNormal ?? '–'}</strong><span>传感器正常</span></div><div><strong className="amber">{summary?.sensorsAttention ?? '–'}</strong><span>需要关注</span></div><div><strong className={summary?.activeAlerts ? 'amber' : ''}>{summary?.activeAlerts ?? '–'}</strong><span>告警中</span></div><div><strong>{summary?.linkLatencySeconds ?? 2.4}s</strong><span>链路延迟</span></div></div></section><section className="overview-grid"><div className="mountain-card"><div className="card-title"><div><span className="eyebrow">LIVE TERRAIN</span><h3>站点环境</h3></div><span className="live"><i/> LIVE</span></div><MountainScene/><div className="terrain-footer"><div><span>体感温度</span><b>-14.2°C</b></div><div><span>能见度</span><b>16.8 km</b></div><div><span>气压</span><b>582 hPa</b></div><div><span>降雪</span><b>0.8 mm/h</b></div></div></div><div className="alert-card"><div className="card-title"><div><span className="eyebrow">OPERATION LOG</span><h3>观测动态</h3></div><button className="more" onClick={() => setNotice('已打开全部运行日志')}>全部 →</button></div><div className="alerts">{events.length === 0 && <p className="empty">暂无运行日志</p>}{events.map(event => <div className="alert" key={event.id}><span className={`alert-mark ${event.kind === 'triggered' ? (event.ruleSnapshot?.severity === 'critical' ? 'critical' : 'warning') : 'good'}`}>{event.kind === 'triggered' ? '!' : '✓'}</span><div><div className="alert-line"><b>{event.title}{event.kind === 'recovered' ? ' · 已恢复' : ''}</b><time>{formatTime(event.at)}</time></div><p>{event.message}</p>{event.ruleSnapshot && <p className="snapshot">快照 · 读数 {event.reading ? `${event.reading.value} ${event.reading.unit}` : '—'} ｜ 规则 {event.ruleSnapshot.name} {event.ruleSnapshot.operator} {event.ruleSnapshot.threshold} {event.ruleSnapshot.unit}</p>}</div></div>)}</div><button className="log-btn" onClick={() => setNotice('已创建巡检任务草稿')}>＋ 创建巡检任务</button></div></section><section className="rules-section"><div className="section-title"><div><span className="eyebrow">ALERT RULES</span><h3>告警规则管理</h3></div><span className="rules-count">{summary ? `${summary.rulesEnabled}/${summary.rulesTotal} 条规则生效 · 今日触发 ${summary.triggeredToday} 次` : '规则加载中…'}</span></div><div className="rules-head"><span>传感器 / 规则</span><span>触发条件（读数 · 比较 · 阈值 · 单位）</span><span>启用</span></div><div className="rules-list">{rules.map(rule => <RuleRow key={rule.id} rule={rule} sensorName={sensorName(rule.sensor)} onUpdate={updateRule} onDelete={deleteRule}/>)}{rules.length === 0 && <p className="empty">暂无规则，请在下方新增</p>}</div><div className="rule-add"><select value={draft.sensor} onChange={e => { const code = e.target.value; setDraft({ ...draft, sensor: code, unit: readings.find(r => r.sensor === code)?.unit ?? draft.unit }); }}>{sensorMeta.map(m => <option key={m.code} value={m.code}>{m.name} · {m.code}</option>)}</select><input className="name" placeholder="规则名称，如：风速超过巡检阈值" value={draft.name} maxLength={30} onChange={e => setDraft({ ...draft, name: e.target.value })}/><select value={draft.operator} onChange={e => setDraft({ ...draft, operator: e.target.value as Operator })}>{OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}</select><input className="threshold" type="number" step="any" placeholder="阈值" value={draft.threshold} onChange={e => setDraft({ ...draft, threshold: e.target.value })}/><input className="unit" placeholder="单位" value={draft.unit} maxLength={10} onChange={e => setDraft({ ...draft, unit: e.target.value })}/><button className="add-btn" onClick={addRule}>＋ 新增规则</button></div></section><section className="sensor-section"><div className="section-title"><div><span className="eyebrow">SENSOR ARRAY / 04</span><h3>传感器阵列</h3></div><div className="range-switch">{['6 小时','24 小时','7 天'].map(item => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className="sensor-grid">{sensors.map(sensor => <button key={sensor.id} className={selectedId === sensor.id ? 'sensor-card selected' : 'sensor-card'} onClick={() => setSelectedId(sensor.id)}><div className="sensor-top"><div><span className="sensor-code">{sensor.code}</span><h4>{sensor.name}</h4></div><span className={`sensor-status ${sensor.status === '注意' ? 'warn' : ''}`}><i/>{sensor.status}</span></div><div className="sensor-reading"><strong>{sensor.value}</strong><span>{sensor.unit}</span><em className={sensor.trend.startsWith('↓') ? 'down' : ''}>{sensor.trend}</em></div><MiniChart points={sensor.points} color={sensor.color}/><div className="sensor-time">过去 {range} <span>点击查看详情</span></div></button>)}</div></section><section className="detail-section"><div className="detail-copy"><span className="eyebrow">SELECTED SENSOR / {selected.code}</span><h3>{selected.name}历史曲线</h3><p>基于自动校准后的连续观测数据，当前设备状态为 <b>{selected.status}</b>。</p><div className="detail-tags"><span>采样间隔 10 min</span><span>质量评分 98.6</span><span>海拔 4,820 m</span></div></div><div className="big-chart"><div className="chart-y"><span>20</span><span>10</span><span>0</span><span>-10</span></div><svg viewBox="0 0 520 150" preserveAspectRatio="none"><path d="M0 92 L58 78 L110 83 L168 58 L220 66 L274 44 L330 57 L381 33 L438 45 L520 20" fill="none" stroke={selected.color} strokeWidth="3"/><path d="M0 92 L58 78 L110 83 L168 58 L220 66 L274 44 L330 57 L381 33 L438 45 L520 20 L520 150 L0 150 Z" fill={selected.color} opacity=".09"/></svg><div className="chart-x"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div></div></section>{notice && <div className="toast" onClick={() => setNotice('')}>{notice}<span>×</span></div>}</main></div>;
}
