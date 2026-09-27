import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

/* ================= 类型 ================= */

type Comparison = '>' | '>=' | '<' | '<=' | '==';
const COMPARISONS: Comparison[] = ['>', '>=', '<', '<=', '=='];

interface AlertRule {
  id: string;
  sensor: string;
  name: string;
  comparison: Comparison;
  threshold: number;
  unit: string;
  enabled: boolean;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface NewRule {
  sensor: string;
  name: string;
  comparison: Comparison;
  threshold: number;
  unit: string;
}

interface Reading { sensor: string; value: number; unit: string; at: string }

interface AlertEvent {
  id: string;
  type: 'triggered' | 'recovered' | 'info';
  at: string;
  title: string;
  detail: string;
  ruleId: string | null;
  reading: Reading | null;   // 告警发生时的读数快照
  rule: AlertRule | null;    // 告警发生时的规则快照
}

interface SensorStatus { code: string; name: string; status: string; reading: Reading | null; activeAlerts: number }

interface Summary {
  station: string;
  at: string;
  normal: number;
  attention: number;
  activeAlerts: AlertEvent[];
  rules: { total: number; enabled: number };
  sensors: SensorStatus[];
}

interface SensorMeta { id: string; name: string; code: string; trend: string; color: string; points: number[] }

/* ================= 静态展示数据（API 不可用时作为回退） ================= */

const sensorMeta: SensorMeta[] = [
  { id: 'temp', name: '山脊温度', code: 'TMP-01', trend: '↓ 1.2°', color: '#78d7ef', points: [20, 24, 21, 31, 28, 34, 42, 38, 47, 50] },
  { id: 'wind', name: '风速 / 风向', code: 'WND-02', trend: '↑ 3.8', color: '#f2bc71', points: [31, 28, 38, 40, 34, 47, 45, 56, 54, 62] },
  { id: 'snow', name: '积雪深度', code: 'SNW-03', trend: '↑ 4 cm', color: '#bba4ff', points: [58, 53, 52, 50, 45, 42, 38, 35, 30, 28] },
  { id: 'power', name: '电池组电量', code: 'PWR-04', trend: '↓ 2%', color: '#94df9a', points: [72, 70, 76, 72, 70, 76, 80, 79, 78, 76] }
];

const fallbackReadings: Reading[] = [
  { sensor: 'TMP-01', value: -8.4, unit: '°C', at: '2026-09-26T09:40:00+08:00' },
  { sensor: 'WND-02', value: 18.6, unit: 'm/s', at: '2026-09-26T09:40:00+08:00' },
  { sensor: 'SNW-03', value: 142, unit: 'cm', at: '2026-09-26T09:30:00+08:00' },
  { sensor: 'PWR-04', value: 76, unit: '%', at: '2026-09-26T09:40:00+08:00' }
];

const fallbackRules: AlertRule[] = [
  { id: 'rule-wind', sensor: 'WND-02', name: '风速超过巡检阈值', comparison: '>', threshold: 15, unit: 'm/s', enabled: true, active: true, createdAt: '', updatedAt: '' },
  { id: 'rule-snow', sensor: 'SNW-03', name: '积雪深度过高', comparison: '>=', threshold: 150, unit: 'cm', enabled: true, active: false, createdAt: '', updatedAt: '' },
  { id: 'rule-battery', sensor: 'PWR-04', name: '电池电量过低', comparison: '<', threshold: 30, unit: '%', enabled: true, active: false, createdAt: '', updatedAt: '' }
];

const fallbackEvents: AlertEvent[] = [
  { id: 'evt-demo-1', type: 'triggered', at: '2026-09-26T09:42:00+08:00', title: '风速超过巡检阈值', detail: '读数 18.6 m/s · 规则 风速超过巡检阈值 > 15 m/s', ruleId: 'rule-wind', reading: fallbackReadings[1], rule: fallbackRules[0] },
  { id: 'evt-demo-2', type: 'info', at: '2026-09-26T08:15:00+08:00', title: '雪深传感器完成自检', detail: 'SNW-03 数据质量 99.2%', ruleId: null, reading: null, rule: null },
  { id: 'evt-demo-3', type: 'info', at: '2026-09-26T06:30:00+08:00', title: '卫星链路已同步', detail: '上行延迟 2.4 秒 · 下一次同步 12:30', ruleId: null, reading: null, rule: null }
];

const fallbackSummary: Summary = {
  station: 'M-07',
  at: '2026-09-26T10:04:00+08:00',
  normal: 3,
  attention: 1,
  activeAlerts: [fallbackEvents[0]],
  rules: { total: 3, enabled: 3 },
  sensors: [
    { code: 'TMP-01', name: '山脊温度', status: '正常', reading: fallbackReadings[0], activeAlerts: 0 },
    { code: 'WND-02', name: '风速 / 风向', status: '告警', reading: fallbackReadings[1], activeAlerts: 1 },
    { code: 'SNW-03', name: '积雪深度', status: '正常', reading: fallbackReadings[2], activeAlerts: 0 },
    { code: 'PWR-04', name: '电池组电量', status: '正常', reading: fallbackReadings[3], activeAlerts: 0 }
  ]
};

/* ================= 工具 ================= */

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 运行日志条目展示：优先使用事件携带的读数/规则快照 */
function eventView(evt: AlertEvent): { kind: string; mark: string; title: string; desc: string } {
  if (evt.type === 'triggered') {
    const { rule, reading } = evt;
    return {
      kind: 'warning',
      mark: '!',
      title: evt.title || rule?.name || '告警触发',
      desc: rule && reading ? `读数 ${reading.value} ${reading.unit} · 规则 ${rule.name} ${rule.comparison} ${rule.threshold} ${rule.unit}` : evt.detail
    };
  }
  if (evt.type === 'recovered') {
    const { rule, reading } = evt;
    return {
      kind: 'good',
      mark: '✓',
      title: evt.title || (rule ? `${rule.name} · 已恢复` : '告警恢复'),
      desc: rule && reading ? `最新读数 ${reading.value} ${reading.unit} · 已回到规则 ${rule.comparison} ${rule.threshold} ${rule.unit} 范围内` : evt.detail
    };
  }
  return { kind: 'good', mark: '✓', title: evt.title, desc: evt.detail };
}

function describeEvents(list: AlertEvent[]): string {
  return list.map(e => {
    if (e.type === 'triggered') return `触发告警「${e.title}」`;
    if (e.type === 'recovered') return `「${e.title.replace(/ · 已恢复$/, '')}」已恢复`;
    return e.title;
  }).join('；');
}

/* ================= 小组件 ================= */

function MiniChart({ points, color }: { points: number[]; color: string }) {
  const coords = points.map((p, index) => `${(index / (points.length - 1)) * 100},${70 - p}`).join(' ');
  return (
    <svg className="mini-chart" viewBox="0 0 100 70" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`fill-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,70 ${coords} 100,70`} fill={`url(#fill-${color.replace('#', '')})`} />
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MountainScene() {
  return (
    <div className="mountain-scene">
      <div className="stars" /><div className="sun-glow" />
      <div className="mountain back" /><div className="mountain mid" /><div className="mountain front" />
      <div className="station"><span className="mast" /><span className="station-box" /><span className="antenna" /></div>
      <div className="scene-caption"><span>海拔 4,820 m</span><span>自动观测站 · M-07</span></div>
    </div>
  );
}

/** 单条告警规则行：可编辑比较条件、阈值、单位，可启停、保存、删除 */
function RuleRow({ rule, onSave, onToggle, onRemove }: {
  rule: AlertRule;
  onSave: (draft: AlertRule) => void;
  onToggle: (rule: AlertRule) => void;
  onRemove: (rule: AlertRule) => void;
}) {
  const [draft, setDraft] = useState(rule);
  useEffect(() => setDraft(rule), [rule.id, rule.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft.name !== rule.name || draft.comparison !== rule.comparison || Number(draft.threshold) !== rule.threshold || draft.unit !== rule.unit;
  return (
    <div className={rule.enabled ? 'rule-row' : 'rule-row disabled'}>
      <span className={rule.active ? 'rule-state on' : 'rule-state'} title={rule.active ? '告警中' : '未触发'} />
      <span className="rule-code">{rule.sensor}</span>
      <input className="rule-name-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      <select className="rule-op" value={draft.comparison} onChange={e => setDraft({ ...draft, comparison: e.target.value as Comparison })}>
        {COMPARISONS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input className="rule-threshold" type="number" step="any" value={draft.threshold} onChange={e => setDraft({ ...draft, threshold: Number(e.target.value) })} />
      <input className="rule-unit" value={draft.unit} placeholder="单位" onChange={e => setDraft({ ...draft, unit: e.target.value })} />
      <button type="button" className={rule.enabled ? 'switch on' : 'switch'} title={rule.enabled ? '点击停用' : '点击启用'} onClick={() => onToggle(rule)}><i /></button>
      <span className="switch-label">{rule.enabled ? '启用' : '停用'}</span>
      <div className="rule-actions">
        <button type="button" disabled={!dirty} onClick={() => onSave(draft)}>保存</button>
        <button type="button" className="danger" onClick={() => onRemove(rule)}>删除</button>
      </div>
    </div>
  );
}

/* ================= 主应用 ================= */

export default function App() {
  const [selectedId, setSelectedId] = useState('wind');
  const [range, setRange] = useState('24 小时');
  const [notice, setNotice] = useState('');
  const [rules, setRules] = useState<AlertRule[]>(fallbackRules);
  const [events, setEvents] = useState<AlertEvent[]>(fallbackEvents);
  const [summary, setSummary] = useState<Summary>(fallbackSummary);
  const [readings, setReadings] = useState<Reading[]>(fallbackReadings);
  const [newRule, setNewRule] = useState<NewRule>({ sensor: 'WND-02', name: '', comparison: '>', threshold: 0, unit: 'm/s' });
  const [simSensor, setSimSensor] = useState('WND-02');
  const [simValue, setSimValue] = useState('18.6');

  const loadAll = useCallback(async () => {
    const [ruleList, eventList, summaryData, readingList] = await Promise.all([
      api<AlertRule[]>('/api/rules'),
      api<AlertEvent[]>('/api/events?limit=50'),
      api<Summary>('/api/summary'),
      api<Reading[]>('/api/readings')
    ]);
    if (ruleList) setRules(ruleList);
    if (eventList) setEvents(eventList);
    if (summaryData) setSummary(summaryData);
    if (readingList) setReadings(readingList);
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 15000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const selected = sensorMeta.find(sensor => sensor.id === selectedId) ?? sensorMeta[0];
  const statusMap = useMemo(() => new Map(summary.sensors.map(s => [s.code, s.status] as const)), [summary]);
  const readingMap = useMemo(() => new Map(readings.map(r => [r.sensor, r] as const)), [readings]);

  /* ---------- 规则操作 ---------- */

  const saveRule = async (draft: AlertRule) => {
    const res = await api<{ rule: AlertRule; events: AlertEvent[] }>(`/api/rules/${draft.id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(draft) });
    if (!res) return setNotice('保存失败：无法连接服务端');
    setNotice(res.events.length ? `规则已保存 · ${describeEvents(res.events)}` : `规则「${res.rule.name}」已保存`);
    loadAll();
  };

  const toggleRule = (rule: AlertRule) => saveRule({ ...rule, enabled: !rule.enabled });

  const removeRule = async (rule: AlertRule) => {
    const res = await api<{ status: string }>(`/api/rules/${rule.id}`, { method: 'DELETE' });
    if (!res) return setNotice('删除失败：无法连接服务端');
    setNotice(`规则「${rule.name}」已删除`);
    loadAll();
  };

  const handleAddRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!newRule.name.trim()) return setNotice('请填写规则名称');
    const res = await api<{ rule: AlertRule; events: AlertEvent[] }>('/api/rules', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ...newRule, name: newRule.name.trim() }) });
    if (!res) return setNotice('新增失败：请检查输入或服务端连接');
    setNotice(res.events.length ? `规则已创建 · ${describeEvents(res.events)}` : `规则「${res.rule.name}」已创建`);
    setNewRule(prev => ({ ...prev, name: '', threshold: 0 }));
    loadAll();
  };

  /* ---------- 模拟读数上报 ---------- */

  const handleSimSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(simValue);
    if (!Number.isFinite(value)) return setNotice('请输入有效的读数数值');
    const res = await api<{ readings: Reading[]; events: AlertEvent[] }>('/api/readings', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ sensor: simSensor, value }) });
    if (!res) return setNotice('上报失败：无法连接服务端');
    setNotice(res.events.length ? describeEvents(res.events) : `读数已接收（${simSensor} ${value}），无告警变化`);
    loadAll();
  };

  const refresh = async () => {
    await api('/api/sync', { method: 'POST' });
    await loadAll();
    setNotice('已请求最新卫星数据同步');
  };

  const pickSimSensor = (code: string) => {
    setSimSensor(code);
    const reading = readingMap.get(code);
    if (reading) setSimValue(String(reading.value));
  };

  const pickNewRuleSensor = (code: string) => {
    const unit = readingMap.get(code)?.unit ?? '';
    setNewRule(prev => ({ ...prev, sensor: code, unit }));
  };

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">✦</div>
          <div><span className="eyebrow">ALPINE OBSERVATORY / M-07</span><h1>雪线气象站 · 运行总览</h1></div>
        </div>
        <div className="top-meta">
          <span className="sync"><i />数据已同步 · {formatDateTime(summary.at)}</span>
          <button onClick={refresh}>↻ 刷新数据</button>
          <div className="profile">陈 <span>值守员</span></div>
        </div>
      </header>
      <main className="main">
        <section className="status-strip">
          <div>
            <span className="eyebrow">STATION STATUS</span>
            <h2>高海拔自动气象观测站</h2>
            <p>北麓冰川保护区 · 当前气象窗口良好</p>
          </div>
          <div className="status-numbers">
            <div><strong className="cyan">{summary.normal}</strong><span>传感器正常</span></div>
            <div><strong className="amber">{summary.attention}</strong><span>需要关注</span></div>
            <div><strong className={summary.activeAlerts.length ? 'amber' : ''}>{summary.activeAlerts.length}</strong><span>活动告警</span></div>
            <div><strong>2.4s</strong><span>链路延迟</span></div>
          </div>
        </section>

        <section className="overview-grid">
          <div className="mountain-card">
            <div className="card-title">
              <div><span className="eyebrow">LIVE TERRAIN</span><h3>站点环境</h3></div>
              <span className="live"><i /> LIVE</span>
            </div>
            <MountainScene />
            <div className="terrain-footer">
              <div><span>体感温度</span><b>-14.2°C</b></div>
              <div><span>能见度</span><b>16.8 km</b></div>
              <div><span>气压</span><b>582 hPa</b></div>
              <div><span>降雪</span><b>0.8 mm/h</b></div>
            </div>
          </div>
          <div className="alert-card">
            <div className="card-title">
              <div><span className="eyebrow">OPERATION LOG</span><h3>观测动态</h3></div>
              <button className="more" onClick={() => setNotice('已打开全部运行日志')}>全部 →</button>
            </div>
            <div className="alerts">
              {events.map(evt => {
                const view = eventView(evt);
                return (
                  <div className="alert" key={evt.id}>
                    <span className={`alert-mark ${view.kind}`}>{view.mark}</span>
                    <div>
                      <div className="alert-line"><b>{view.title}</b><time>{formatTime(evt.at)}</time></div>
                      <p>{view.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="log-btn" onClick={() => setNotice('已创建巡检任务草稿')}>＋ 创建巡检任务</button>
          </div>
        </section>

        <section className="sensor-section">
          <div className="section-title">
            <div><span className="eyebrow">SENSOR ARRAY / 04</span><h3>传感器阵列</h3></div>
            <div className="range-switch">
              {['6 小时', '24 小时', '7 天'].map(item => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}
            </div>
          </div>
          <div className="sensor-grid">
            {sensorMeta.map(sensor => {
              const reading = readingMap.get(sensor.code);
              const status = statusMap.get(sensor.code) ?? '正常';
              return (
                <button key={sensor.id} className={selectedId === sensor.id ? 'sensor-card selected' : 'sensor-card'} onClick={() => setSelectedId(sensor.id)}>
                  <div className="sensor-top">
                    <div><span className="sensor-code">{sensor.code}</span><h4>{sensor.name}</h4></div>
                    <span className={`sensor-status ${status !== '正常' ? 'warn' : ''}`}><i />{status}</span>
                  </div>
                  <div className="sensor-reading">
                    <strong>{reading ? reading.value : '—'}</strong>
                    <span>{reading?.unit ?? ''}</span>
                    <em className={sensor.trend.startsWith('↓') ? 'down' : ''}>{sensor.trend}</em>
                  </div>
                  <MiniChart points={sensor.points} color={sensor.color} />
                  <div className="sensor-time">过去 {range} <span>点击查看详情</span></div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-copy">
            <span className="eyebrow">SELECTED SENSOR / {selected.code}</span>
            <h3>{selected.name}历史曲线</h3>
            <p>基于自动校准后的连续观测数据，当前设备状态为 <b>{statusMap.get(selected.code) ?? '正常'}</b>。</p>
            <div className="detail-tags"><span>采样间隔 10 min</span><span>质量评分 98.6</span><span>海拔 4,820 m</span></div>
          </div>
          <div className="big-chart">
            <div className="chart-y"><span>20</span><span>10</span><span>0</span><span>-10</span></div>
            <svg viewBox="0 0 520 150" preserveAspectRatio="none">
              <path d="M0 92 L58 78 L110 83 L168 58 L220 66 L274 44 L330 57 L381 33 L438 45 L520 20" fill="none" stroke={selected.color} strokeWidth="3" />
              <path d="M0 92 L58 78 L110 83 L168 58 L220 66 L274 44 L330 57 L381 33 L438 45 L520 20 L520 150 L0 150 Z" fill={selected.color} opacity=".09" />
            </svg>
            <div className="chart-x"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
          </div>
        </section>

        <section className="rules-section">
          <div className="rules-head">
            <div><span className="eyebrow">ALERT RULES</span><h3>告警规则管理</h3></div>
            <span className="rules-count">启用 {summary.rules.enabled} / {summary.rules.total} · 活动告警 {summary.activeAlerts.length}</span>
          </div>
          <div className="rules-list">
            {rules.map(rule => <RuleRow key={rule.id} rule={rule} onSave={saveRule} onToggle={toggleRule} onRemove={removeRule} />)}
            {rules.length === 0 && <div className="rules-empty">暂无规则，请在下方新增</div>}
          </div>
          <form className="rule-add" onSubmit={handleAddRule}>
            <span className="form-label">新增规则</span>
            <select value={newRule.sensor} onChange={e => pickNewRuleSensor(e.target.value)}>
              {sensorMeta.map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
            </select>
            <input className="grow" placeholder="规则名称，如 风速超过巡检阈值" value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })} />
            <select className="rule-op" value={newRule.comparison} onChange={e => setNewRule({ ...newRule, comparison: e.target.value as Comparison })}>
              {COMPARISONS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input className="rule-threshold" type="number" step="any" value={newRule.threshold} onChange={e => setNewRule({ ...newRule, threshold: Number(e.target.value) })} />
            <input className="rule-unit" placeholder="单位" value={newRule.unit} onChange={e => setNewRule({ ...newRule, unit: e.target.value })} />
            <button type="submit">＋ 添加规则</button>
          </form>
          <form className="reading-sim" onSubmit={handleSimSubmit}>
            <span className="form-label">模拟读数上报</span>
            <select value={simSensor} onChange={e => pickSimSensor(e.target.value)}>
              {sensorMeta.map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
            </select>
            <input className="rule-threshold" type="number" step="any" placeholder="读数" value={simValue} onChange={e => setSimValue(e.target.value)} />
            <span className="sim-unit">{readingMap.get(simSensor)?.unit ?? ''}</span>
            <button type="submit">⇪ 上报读数</button>
            <span className="sim-hint">服务端将按启用规则判断触发 / 恢复</span>
          </form>
        </section>

        {notice && <div className="toast" onClick={() => setNotice('')}>{notice}<span>×</span></div>}
      </main>
    </div>
  );
}
