import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, Kzt, Forbidden } from '../components/ui';
import { monthsBetween, monthLabel, monthEnd, fmtDateTime, DATA_START } from '../../domain/periods';
import { pnl } from '../../domain/finance';
import { fmtBp, tenge } from '../../domain/money';
import type { ID } from '../../domain/types';

function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage({ tenantId }: { tenantId: ID }) {
  const { api, run, openFinding } = useApp();
  const months = monthsBetween(DATA_START, api.today()).reverse();
  const [month, setMonth] = useState(months.find((m) => api.db.periodCloses.some((p) => p.tenantId === tenantId && p.period === m && p.status !== 'closed' && monthEnd(m) < api.today())) ?? months[1] ?? months[0]);
  const [newItem, setNewItem] = useState('');
  const [tax, setTax] = useState('');
  let pc: ReturnType<typeof api.periodClose>;
  try {
    api.tenant(tenantId);
    pc = api.periodClose(tenantId, month);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const canWork = api.can('findings.work', tenantId);
  const canClose = api.can('close.manage', tenantId);
  const canFinance = api.can('finance.read', tenantId);
  const roles = api.roles(tenantId);
  const p = canFinance ? pnl(api.db, { tenantId, branchId: null, from: `${month}-01`, to: monthEnd(month) }) : null;

  return (
    <div className="col gap16">
      <div className="row between">
        <h1>Есептер және ай жабу</h1>
        <div className="row">
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {(roles.includes('owner') || roles.includes('service_lead')) && (
            <button className="btn" onClick={() => { const s = run(() => api.exportTenant(tenantId), 'Экспорт дайын'); if (typeof s === 'string') download(`qarjy-export-${tenantId}.json`, s); }}>⤓ Деректерді экспорттау (JSON)</button>
          )}
        </div>
      </div>
      <div className="grid g3">
        <Card title={`Ай жабу чек-листі · ${monthLabel(month)}`} className="span2" actions={pc.pc.status === 'closed' ? <Badge tone="ok">Жабылды</Badge> : <Badge tone="info">{pc.readyPct}% дайын</Badge>}>
          <div className="small muted mb8">Чек-лист клиенттің есеп саясаты мен қызмет көлеміне қарай бапталады (міндетті / қосымша пункттер).</div>
          <table className="tbl">
            <tbody>
              {pc.pc.checklist.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" checked={c.done} disabled={!canWork || pc.pc.status === 'closed'} onChange={() => run(() => api.toggleChecklist(tenantId, month, c.id))} aria-label={c.label} />
                  </td>
                  <td>
                    {c.label} {!c.required && <Badge tone="outline">қосымша</Badge>}
                    {c.done && <div className="muted tiny">Кім тексерді: {api.userName(c.by)} · {fmtDateTime(c.at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canClose && pc.pc.status !== 'closed' && (
            <div className="row mt8">
              <input className="grow" placeholder="Жаңа пункт (мысалы: Маркетплейс есептері салыстырылды ма?)" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
              <button className="btn" onClick={() => run(() => api.addChecklistItem(tenantId, month, newItem, false), 'Пункт қосылды') && setNewItem('')}>+ Қосымша пункт</button>
            </div>
          )}
          {pc.blockers.length > 0 && (
            <div className="callout warn mt8">
              <b>Кезеңді жабуға кедергі мәселелер:</b>
              {pc.blockers.map((b) => <div key={b.id}><a onClick={() => openFinding(b.id)}>{b.title}</a> — {api.userName(b.assigneeId)}</div>)}
            </div>
          )}
          {pc.pc.status === 'closed' ? (
            <div className="callout info mt8">Жапқан және бекіткен: {api.userName(pc.pc.closedBy)} · {fmtDateTime(pc.pc.closedAt)} · Есептелген табыс салығы: <Kzt v={pc.pc.incomeTaxAccrual} /> (бухгалтер енгізген, demo)</div>
          ) : canClose ? (
            <div className="row mt8">
              <label className="field">Есептелген табыс салығы, ₸ (бухгалтер есептейді)<input value={tax} onChange={(e) => setTax(e.target.value)} placeholder="мысалы 1 250 000" /></label>
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => run(() => api.closePeriod(tenantId, month, tenge(tax || '0')), 'Кезең жабылды')}>Кезеңді жабу және бекіту</button>
            </div>
          ) : (
            <div className="small muted mt8">Кезеңді бас бухгалтер жабады.</div>
          )}
          <div className="small muted mt8">Салық ставкалары мен мерзімдерін платформа ойдан шығармайды — сомасын жауапты бухгалтер енгізеді.</div>
        </Card>
        <Card title="Ай қорытындысы" sub={pc.pc.status === 'closed' ? 'Ай жабылған' : 'Алдын ала есеп'}>
          {p ? (
            <table className="tbl small">
              <tbody>
                <tr><td>Таза сатылым</td><td className="right"><Kzt v={p.netSales} /></td></tr>
                <tr><td>Маржа</td><td className="right num">{fmtBp(p.grossMarginBp)}</td></tr>
                <tr><td>Операциялық пайда</td><td className="right">{p.operatingProfit.status === 'incomplete' ? <Badge tone="warn">толық емес</Badge> : <Kzt v={p.operatingProfit.value} />}</td></tr>
                <tr><td>Таза пайда</td><td className="right">{p.netProfit.value === null ? <Badge tone="warn">Есеп толық емес</Badge> : <Kzt v={p.netProfit.value} />}</td></tr>
              </tbody>
            </table>
          ) : <div className="muted small">Қаржылық ақпаратқа рұқсат жоқ</div>}
          {p && (
            <button className="btn sm mt8" onClick={() => download(`pnl-${tenantId}-${month}.csv`, `Көрсеткіш;Сома (тиын)\nТаза сатылым;${p.netSales}\nӨзіндік құн;${p.cogs}\nЖалпы пайда;${p.grossProfit.value ?? 'белгісіз'}\nОперациялық шығын;${p.opex}\nОперациялық пайда;${p.operatingProfit.value ?? 'белгісіз'}\nТаза пайда;${p.netProfit.value ?? 'белгісіз'}\nМәртебе;${p.allMonthsClosed ? 'ай жабылған' : 'алдын ала'}\n`, 'text/csv')}>⤓ CSV</button>
          )}
        </Card>
      </div>
      <Card title="Есептер тарихы">
        <table className="tbl small">
          <thead><tr><th>Кезең</th><th>Мәртебе</th><th>Чек-лист</th><th>Жапқан</th><th className="right">Есептелген табыс салығы</th></tr></thead>
          <tbody>
            {api.db.periodCloses.filter((x) => x.tenantId === tenantId).sort((a, b) => b.period.localeCompare(a.period)).map((x) => (
              <tr key={x.id} className="click" onClick={() => setMonth(x.period)}>
                <td>{monthLabel(x.period)}</td>
                <td>{x.status === 'closed' ? <Badge tone="ok">Жабылды</Badge> : x.status === 'in_progress' ? <Badge tone="info">Жабылуда</Badge> : <Badge>Ашық</Badge>}</td>
                <td>{x.checklist.filter((c) => c.done).length}/{x.checklist.length}</td>
                <td>{api.userName(x.closedBy)} {x.closedAt && <span className="muted">{fmtDateTime(x.closedAt)}</span>}</td>
                <td className="right">{x.incomeTaxAccrual === null ? '—' : <Kzt v={x.incomeTaxAccrual} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
