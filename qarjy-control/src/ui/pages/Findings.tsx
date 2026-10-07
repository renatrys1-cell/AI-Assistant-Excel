import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, FindingStatusBadge, KindBadge, Kzt, SeverityBadge, Tabs, Empty, Forbidden } from '../components/ui';
import { OPEN_FINDING_STATUSES, RULES } from '../../domain/checks';
import { fmtDate } from '../../domain/periods';
import type { ID } from '../../domain/types';

export function FindingsPage({ tenantId }: { tenantId: ID | null }) {
  const { api, openFinding, run, session, toast } = useApp();
  const [status, setStatus] = useState<'open' | 'closed' | 'not_an_error' | 'all'>('open');
  const [kind, setKind] = useState<'all' | 'rule' | 'ai'>('all');
  const [q, setQ] = useState('');
  const [rule, setRule] = useState('');
  let list: ReturnType<typeof api.findings>;
  try {
    list = api.findings(tenantId);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const impact = tenantId ? api.impact(tenantId) : null;
  const filtered = list
    .filter((f) => (status === 'all' ? true : status === 'open' ? (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status) : f.status === status))
    .filter((f) => kind === 'all' || f.kind === kind)
    .filter((f) => !rule || f.ruleId === rule)
    .filter((f) => !session.branchId || !f.branchId || f.branchId === session.branchId)
    .filter((f) => !q || `${f.title} ${f.whatHappened}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>Қателер мен тексерулер орталығы</h1>
          <div className="muted small">Нақты ереже арқылы табылған сәйкессіздік пен AI ұсынған күмән бөлек белгіленеді.</div>
        </div>
        {tenantId && api.can('findings.work', tenantId) && (
          <button className="btn" onClick={() => { const r = run(() => api.runChecks(tenantId)); if (Array.isArray(r)) toast(`Тексерулер іске қосылды: жаңа мәселе ${r.length} (бар мәселелер қайталанбайды)`); }}>↻ Тексерулерді қайта іске қосу</button>
        )}
      </div>
      {impact && (
        <div className="grid g4">
          <Card><div className="muted small">Ашық мәселелер</div><h2>{impact.openCount}</h2></Card>
          <Card><div className="muted small">Ықтимал әсер (расталмаған)</div><h2><Kzt v={impact.potential} short /></h2><div className="tiny muted">Бір операция бірнеше тексеруге түссе — бір рет есептелді{impact.overlap ? ` (${impact.overlap} қиылысу)` : ''}. {impact.unquantified} мәселе сомасы бағаланбаған.</div></Card>
          <Card><div className="muted small">Расталған әсер</div><h2><Kzt v={impact.confirmed} short /></h2><div className="tiny muted">Тек тексеруден кейін расталған сома. «Жоғалтқан ақша» деп қосылмайды.</div></Card>
          <Card><div className="muted small">Ережелер</div><h2>{RULES.filter((r) => r.kind === 'rule').length} + {RULES.filter((r) => r.kind === 'ai').length} AI</h2><div className="tiny muted">AI күмәні — тексеруге ұсыныс қана</div></Card>
        </div>
      )}
      <Card>
        <div className="row mb8">
          <Tabs value={status} onChange={setStatus} items={[['open', 'Ашық'], ['closed', 'Жабылған'], ['not_an_error', 'Қате емес'], ['all', 'Барлығы']]} />
          <Tabs value={kind} onChange={setKind} items={[['all', 'Барлық түр'], ['rule', 'Ереже'], ['ai', 'AI күмәні']]} />
          <select value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="">Барлық ереже</option>
            {RULES.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
          </select>
          <input placeholder="Іздеу…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {filtered.length === 0 ? (
          <Empty>Сүзгіге сәйкес мәселе жоқ</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Мәселе</th>
                  {!tenantId && <th>Компания</th>}
                  <th>Түрі</th>
                  <th>Маңыздылық</th>
                  <th className="right">Сома (ықтимал)</th>
                  <th>Анықталды</th>
                  <th>Жауапты</th>
                  <th>Мерзімі</th>
                  <th>Мәртебе</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className="click" onClick={() => openFinding(f.id)}>
                    <td>
                      <b>{f.title}</b>
                      <div className="muted small">{api.db.branches.find((b) => b.id === f.branchId)?.name ?? 'Компания'} · {RULES.find((r) => r.id === f.ruleId)?.code}</div>
                    </td>
                    {!tenantId && <td className="small">{api.db.tenants.find((t) => t.id === f.tenantId)?.name}</td>}
                    <td><KindBadge kind={f.kind} /></td>
                    <td><SeverityBadge s={f.severity} /></td>
                    <td className="right">{f.potentialImpact === null ? <span className="muted small">бағаланбаған</span> : <Kzt v={f.potentialImpact} />}</td>
                    <td className="small num">{fmtDate(f.detectedAt.slice(0, 10))}</td>
                    <td className="small">{api.userName(f.assigneeId)}</td>
                    <td className="small num">{fmtDate(f.dueDate)} {f.dueDate && f.dueDate < api.today() && (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status) && <Badge tone="danger">кешікті</Badge>}</td>
                    <td><FindingStatusBadge s={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
