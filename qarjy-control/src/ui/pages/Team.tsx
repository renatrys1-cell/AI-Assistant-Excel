import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Bar, Card, Forbidden, Modal } from '../components/ui';
import { KPI_DEFS } from '../../domain/kpi';
import { findPeriod, fmtDate, fmtDateTime } from '../../domain/periods';
import type { Complexity } from '../../domain/types';

export function TeamPage() {
  const { api, session, run, openTask } = useApp();
  const [weights, setWeights] = useState(api.db.settings.complexityWeights);
  const [showDefs, setShowDefs] = useState(false);
  const [assess, setAssess] = useState<{ userId: string; note: string } | null>(null);
  let team: ReturnType<typeof api.team>;
  try {
    team = api.team(session.periodKey);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const per = findPeriod(session.periodKey);
  const canConfig = api.canAnywhere('kpi.config');
  const fmt = (v: number | null, unit: string) => (v === null ? '—' : `${v}${unit === '%' ? '%' : ` ${unit}`}`);
  const dups = api.duplicates();
  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>Команда және KPI</h1>
          <div className="muted small">{per.label} · Кім → қай клиенттер → қандай жұмыстар → мерзімдер → жүктеме → сапа → көмек керек жерлер</div>
        </div>
        <button className="btn" onClick={() => setShowDefs(true)}>KPI формулалары мен дереккөздері</button>
      </div>
      <div className="callout info small">
        Бухгалтер енгізген құжат санымен бағаланбайды. Көлем күрделілік коэффициентімен өлшенеді. KPI жалақыны автоматты түрде өзгертпейді — бұл әділ өлшеу және жетекшінің бағалауына негіз.
      </div>
      {dups.length > 0 && <div className="callout warn">Бір жұмыс бірнеше бухгалтерге түскен: {dups.map((d) => d.tasks.map((t) => `${t.title} (${api.userName(t.assigneeId)})`).join(' / ')).join('; ')}</div>}
      <div className="grid g2">
        {team.map(({ user, kpi }) => {
          const help: string[] = [];
          if ((kpi.loadPct ?? 0) > 100) help.push(`Жүктеме ${kpi.loadPct}% — қайта бөлу керек`);
          if (kpi.overdue.length > 2) help.push(`${kpi.overdue.length} кешіккен жұмыс`);
          if ((kpi.values.rework.value ?? 0) > 20) help.push(`Қайта түзету ${kpi.values.rework.value}% — әдістемелік көмек`);
          if ((kpi.values.clientWait.value ?? 0) > 5) help.push('Клиентті күту ұзақ — клиентпен келісу');
          const notes = (api.db.leadAssessments ?? []).filter((a) => a.userId === user.id);
          return (
            <Card key={user.id} title={user.name} sub={kpi.tenants.map((t) => api.db.tenants.find((x) => x.id === t)?.name.replace(' (demo)', '')).join(', ')} actions={(kpi.loadPct ?? 0) > 100 ? <Badge tone="danger">Жүктеме жоғары</Badge> : <Badge tone="ok">Қалыпты</Badge>}>
              <div className="row between small">
                <span>Ашық жұмыс: <b>{kpi.openTasks.length}</b> · {kpi.openUnits} бірлік / сыйымдылық {kpi.capacity ?? '—'}</span>
                <b>{kpi.loadPct ?? '—'}%</b>
              </div>
              <Bar pct={kpi.loadPct ?? 0} tone={(kpi.loadPct ?? 0) > 100 ? 'over' : (kpi.loadPct ?? 0) > 80 ? 'warn' : undefined} />
              <table className="tbl small mt8">
                <tbody>
                  {KPI_DEFS.map((d) => {
                    const v = kpi.values[d.key];
                    return (
                      <tr key={d.key} title={`${d.formula} · Дереккөз: ${d.source}`}>
                        <td>{d.label}</td>
                        <td className="right num"><b>{fmt(v.value, d.unit)}</b> <span className="muted tiny">n={v.n}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {kpi.overdue.length > 0 && (
                <div className="small mt8">
                  <b>Кешіккен:</b>{' '}
                  {kpi.overdue.map((t) => (
                    <a key={t.id} onClick={() => openTask(t.id)} style={{ marginRight: 8 }}>
                      {t.title} ({fmtDate(t.plannedDue)}){t.status === 'waiting_client' ? ' · клиентті күтуде' : ''}
                    </a>
                  ))}
                </div>
              )}
              {help.length > 0 && <div className="callout warn small mt8"><b>Көмек керек:</b> {help.join('; ')}</div>}
              {notes.map((n) => <div key={n.id} className="callout small mt8"><b>Жетекшінің бағалауы ({n.period}):</b> {n.note} <span className="muted tiny">{fmtDateTime(n.at)}</span></div>)}
              {canConfig && <button className="btn sm mt8" onClick={() => setAssess({ userId: user.id, note: '' })}>Жетекшінің бағалауын жазу</button>}
            </Card>
          );
        })}
      </div>
      {canConfig && (
        <Card title="Күрделілік коэффициенттері" sub="Demo мәндер. Қарапайым операция мен күрделі салыстыру тең саналмайды.">
          <div className="row">
            {(['simple', 'standard', 'complex'] as Complexity[]).map((c) => (
              <label key={c} className="field">
                {c === 'simple' ? 'Қарапайым' : c === 'standard' ? 'Стандарт' : 'Күрделі'}
                <input type="number" min={0.5} step={0.5} style={{ width: 90 }} value={weights[c]} onChange={(e) => setWeights({ ...weights, [c]: parseFloat(e.target.value) })} />
              </label>
            ))}
            <button className="btn primary" onClick={() => run(() => api.setComplexityWeights(weights), 'Коэффициенттер сақталды — KPI қайта есептелді')}>Сақтау</button>
          </div>
        </Card>
      )}
      {showDefs && (
        <Modal title="KPI формулалары" onClose={() => setShowDefs(false)} wide>
          <table className="tbl small">
            <thead><tr><th>Көрсеткіш</th><th>Формула</th><th>Дереккөз</th><th>Жақсы</th></tr></thead>
            <tbody>
              {KPI_DEFS.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.formula}</td><td>{d.source}</td><td>{d.better === 'higher' ? '↑ жоғары' : '↓ төмен'}</td></tr>)}
            </tbody>
          </table>
          <div className="small muted">Есеп кезеңі: жоғарыдағы кезең сүзгісі ({per.label}). n — есептеу базасы (бөлгіш); n аз болса көрсеткіш сенімсіз.</div>
        </Modal>
      )}
      {assess && (
        <Modal title={`Бағалау: ${api.userName(assess.userId)}`} onClose={() => setAssess(null)} footer={<button className="btn primary" onClick={() => run(() => api.addLeadAssessment(assess.userId, per.label, assess.note), 'Сақталды') && setAssess(null)}>Сақтау</button>}>
          <textarea value={assess.note} onChange={(e) => setAssess({ ...assess, note: e.target.value })} placeholder="Сапа, клиентпен жұмыс, дамыту бағыты…" />
        </Modal>
      )}
    </div>
  );
}
