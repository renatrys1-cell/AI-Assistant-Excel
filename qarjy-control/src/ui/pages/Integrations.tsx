import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, DemoBadge, Empty, NotImplemented } from '../components/ui';
import { fmtDateTime } from '../../domain/periods';
import { CSV_SAMPLE } from '../../domain/csv';
import type { ConnectionMethod } from '../../domain/types';

export function IntegrationsPage() {
  const { api, run, session, setSession, toast } = useApp();
  const list = api.connections();
  const [sel, setSel] = useState(session.tenantId && list.some((c) => c.tenant.id === session.tenantId) ? session.tenantId : list[0]?.tenant.id ?? '');
  const cur = list.find((c) => c.tenant.id === sel);
  const firstBranch = api.db.branches.find((b) => b.tenantId === sel)?.id ?? '';
  const [csv, setCsv] = useState(CSV_SAMPLE.replace(/\{BRANCH\}/g, firstBranch));
  if (!list.length) return <Empty>Интеграцияларға рұқсат жоқ</Empty>;
  const canManage = cur ? api.can('integration.manage', cur.tenant.id) || api.can('close.manage', cur.tenant.id) || api.can('findings.work', cur.tenant.id) : false;
  return (
    <div className="col gap16">
      <div className="row between">
        <h1>1С интеграциялары</h1>
        <Badge tone="outline">Оқу режимі · MockConnector</Badge>
      </div>
      <div className="grid g3">
        {list.map((c) => (
          <div key={c.tenant.id} className="card metric" onClick={() => { setSel(c.tenant.id); setSession({ tenantId: c.tenant.id }); setCsv(CSV_SAMPLE.replace(/\{BRANCH\}/g, api.db.branches.find((b) => b.tenantId === c.tenant.id)?.id ?? '')); }} style={sel === c.tenant.id ? { borderColor: 'var(--brand)' } : undefined}>
            <div className="label"><b>{c.tenant.name}</b>{c.freshness.status === 'stale' ? <Badge tone="warn">Кешікті · {c.freshness.hours} сағ</Badge> : c.conn?.status === 'not_connected' ? <Badge>Қосылмаған</Badge> : <Badge tone="ok">ОК</Badge>}</div>
            <div className="small">{c.conn?.configuration} · {c.conn?.version}</div>
            <div className="small muted">Соңғы сәтті: {fmtDateTime(c.conn?.lastSuccessAt)} · әрекет: {fmtDateTime(c.conn?.lastAttemptAt)}</div>
          </div>
        ))}
      </div>
      {cur?.conn && (
        <div className="grid g2">
          <Card title="Қосылым" actions={cur.conn.isMock ? <DemoBadge label="MockConnector" /> : null}>
            <table className="tbl small">
              <tbody>
                <tr><td className="muted">Адаптер</td><td>{cur.conn.adapter}</td></tr>
                <tr><td className="muted">Тәсіл</td><td>
                  {api.can('integration.manage', cur.tenant.id) ? (
                    <select value={cur.conn.method} onChange={(e) => run(() => api.updateConnection(cur.tenant.id, { method: e.target.value as ConnectionMethod, configuration: cur.conn!.configuration, version: cur.conn!.version, hosting: cur.conn!.hosting }), 'Сақталды')}>
                      <option value="mock">MockConnector</option><option value="csv">CSV</option><option value="odata">OData</option><option value="http_service">HTTP-сервис</option>
                    </select>
                  ) : cur.conn.method}
                  {(cur.conn.method === 'odata' || cur.conn.method === 'http_service') && <div className="mt8"><NotImplemented>нақты адаптер — кейінгі кезең</NotImplemented></div>}
                </td></tr>
                <tr><td className="muted">Режим</td><td>Тек оқу (read-only)</td></tr>
                <tr><td className="muted">Орналастыру</td><td>{cur.conn.hosting}</td></tr>
                <tr><td className="muted">1С аудит дерегі</td><td>{cur.conn.hasSourceAuditInfo ? 'Бар — құжат авторы көрсетіледі' : 'Жоқ — автор белгісіз деп көрсетіледі'}</td></tr>
                <tr><td className="muted">Лицензия</td><td>{cur.conn.licenseNote}</td></tr>
                <tr><td className="muted">Кезекте (1С-те бар, әлі оқылмаған)</td><td>{cur.queued} операция <DemoBadge /></td></tr>
              </tbody>
            </table>
            {canManage && (
              <button className="btn primary mt8" onClick={() => { const r = run(() => api.runSync(cur.tenant.id)); if (Array.isArray(r)) { const last = r[r.length - 1]; toast(last.status === 'success' ? `Синхрондау сәтті (әрекет ${last.attempt}): жаңа ${last.created}, дубль өткізілді ${last.duplicatesSkipped}` : 'Синхрондау сәтсіз', last.status !== 'success'); } }}>
                ↻ Синхрондауды іске қосу
              </button>
            )}
            <h4 className="mt16 mb8">Өрістерді сәйкестендіру</h4>
            <table className="tbl small">
              <tbody>{Object.entries(cur.conn.fieldMapping).map(([k, v]) => <tr key={k}><td className="num">{k}</td><td>→ {v}</td></tr>)}</tbody>
            </table>
            {!Object.keys(cur.conn.fieldMapping).length && <div className="muted small">Әлі бапталмаған</div>}
          </Card>
          <Card title="Синхрондау журналы" sub="Қате кезінде қайта орындау (3 әрекетке дейін)">
            <div className="tbl-wrap" style={{ maxHeight: 420 }}>
              <table className="tbl small">
                <thead><tr><th>Уақыты</th><th>Түрі</th><th>Мәртебе</th><th>Алынды / жаңа / дубль</th><th>Қате / ескертпе</th></tr></thead>
                <tbody>
                  {cur.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{fmtDateTime(r.startedAt)}</td>
                      <td>{r.kind}{r.attempt > 1 ? ` · әрекет ${r.attempt}` : ''}</td>
                      <td><Badge tone={r.status === 'success' ? 'ok' : r.status === 'failed' ? 'danger' : 'warn'}>{r.status}</Badge></td>
                      <td className="num">{r.received} / {r.created} / {r.duplicatesSkipped}{r.updated ? ` · жаңартылды ${r.updated}` : ''}</td>
                      <td className="small">{r.error ?? r.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {canManage && (
            <Card title="CSV demo-импорт" className="span2" sub="external_id бойынша идемпотентті: қайта импорт дубль жасамайды">
              <textarea style={{ minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} />
              <div className="row mt8">
                <button className="btn primary" onClick={() => { const r = run(() => api.importCsv(cur.tenant.id, csv)); if (r && r !== true) toast(`Импорт: жаңа ${r.created}, жаңартылды ${r.updated}, дубль ${r.duplicatesSkipped}, қате ${r.errors.length}${r.errors.length ? ` (${r.errors[0].message})` : ''}`, r.errors.length > 0 && r.created === 0); }}>Импорттау</button>
                <span className="small muted">Бағандар: external_id; date; branch; kind; amount; cost; settlement; counterparty; category; description. Бос cost → өзіндік құн белгісіз (0 емес).</span>
              </div>
            </Card>
          )}
        </div>
      )}
      <Card title="Интеграция архитектурасы">
        <div className="grid g2 small">
          <div>
            <b>MVP (іске асырылған):</b>
            <ul>
              <li>Connector интерфейсі: әр конфигурацияға жеке адаптер</li>
              <li>MockConnector: бастапқы жүктеу, кейінгі өзгерістер, retry, журнал</li>
              <li>external_id бойынша дубльді анықтау; CSV импорт</li>
              <li>Синхрондаудан кейін тексерулер автоматты қайта іске қосылады</li>
              <li>Соңғы сәтті жаңару және ескі дерек белгісі (баптау: {api.db.settings.staleAfterHours} сағ)</li>
            </ul>
          </div>
          <div>
            <b>Кейінгі кезең:</b> <NotImplemented />
            <ul>
              <li>Бір нақты 1С конфигурациясына production адаптер (OData / HTTP-сервис)</li>
              <li>1С-ке жазу: ұсыныс → тексеру → рұқсаты бар адамның бекітуі → орындау → нәтижені қайта оқу</li>
              <li>Бастапқы нұсқа сақтау, өзгеріс тарихы, idempotency key, қалпына келтіру тәртібі</li>
              <li>Банк және құжат интеграциялары, OCR</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
