import { useApp } from '../ctx';
import { Badge, Card, Forbidden, Kzt } from '../components/ui';
import { TARIFFS } from './Service';
import { fmtDate, fmtDateTime, monthLabel } from '../../domain/periods';

export function ClientCardPage({ tenantId }: { tenantId: string }) {
  const { api } = useApp();
  let a: ReturnType<typeof api.agreement>;
  try {
    a = api.agreement(tenantId);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const t = api.db.tenants.find((x) => x.id === tenantId)!;
  const le = api.db.legalEntities.filter((x) => x.tenantId === tenantId);
  const br = api.db.branches.filter((x) => x.tenantId === tenantId);
  const conn = api.db.connections.find((c) => c.tenantId === tenantId);
  const closes = api.db.periodCloses.filter((p) => p.tenantId === tenantId).sort((x, y) => y.period.localeCompare(x.period));
  const List = ({ items }: { items: string[] }) => <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>{t.name}</h1>
          <div className="muted small">{t.description} · байланыс: {t.contactPerson}, {t.contactPhone}</div>
        </div>
        <div className="row">
          {t.isDemo && <Badge tone="outline">DEMO</Badge>}
          <Badge tone={t.status === 'active' ? 'ok' : 'info'}>{t.status === 'active' ? 'Белсенді' : 'Қосылу кезеңі'}</Badge>
        </div>
      </div>
      <div className="grid g3">
        <Card title="Қызмет">
          <table className="tbl small">
            <tbody>
              <tr><td className="muted">Тариф</td><td>{TARIFFS.find((x) => x.code === a.tariff)?.name}</td></tr>
              <tr><td className="muted">Режим</td><td>{a.mode === 'outsourcing' ? 'Біздің команда орындайтын аутсорсинг' : 'Клиент бухгалтерлерімен бірге бақылау'}</td></tr>
              <tr><td className="muted">Айлық төлем</td><td>{a.monthlyFee === null ? 'Жеке есептеледі' : <><Kzt v={a.monthlyFee} /> <Badge tone="outline">demo</Badge></>}</td></tr>
              <tr><td className="muted">Келісілген көлем</td><td>{a.includedUnitsPerMonth} бірлік/ай</td></tr>
              <tr><td className="muted">Қызмет деңгейі</td><td>Жауап: {a.slaResponseHours} сағ ішінде (demo SLA)</td></tr>
              <tr><td className="muted">Басталды</td><td>{fmtDate(a.startDate)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="Жауаптылар">
          <table className="tbl small">
            <tbody>
              <tr><td className="muted">Жауапты бухгалтер</td><td>{api.userName(a.responsibleAccountantId)}</td></tr>
              <tr><td className="muted">Тексеруші</td><td>{api.userName(a.reviewerId)}</td></tr>
              <tr><td className="muted">Қызмет жетекшісі</td><td>{api.userName(a.serviceLeadId)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="Құрылым және 1С">
          <div className="small">Заңды тұлға: {le.map((x) => `${x.name} (БСН ${x.bin})`).join(', ')}</div>
          <div className="small muted">{le[0]?.taxRegimeNote}</div>
          <div className="small mt8">Филиалдар: {br.map((b) => b.name).join(', ') || '—'}</div>
          <div className="small mt8">1С: {conn?.configuration} {conn?.version} · {conn?.method}{conn?.isMock && <> <Badge tone="outline">Mock</Badge></>}</div>
          <div className="small muted">{conn?.licenseNote}</div>
        </Card>
      </div>
      <div className="grid g3">
        <Card title="Қызметке кіретін жұмыстар"><List items={a.includedWorks} /></Card>
        <Card title="Кірмейтін жұмыстар"><List items={a.excludedWorks} /></Card>
        <Card title="Клиент тапсыратын құжаттар және мерзімдер">
          <table className="tbl small"><tbody>{a.clientDocuments.map((d) => <tr key={d.name}><td>{d.name}</td><td className="muted">{d.deadline}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Клиенттің міндеттері"><List items={a.clientDuties} /></Card>
        <Card title="Біздің команданың міндеттері"><List items={a.ourDuties} /></Card>
        <Card title="Бастапқы есепті қалпына келтіру" sub="Тұрақты айлық қызметтен бөлек бағаланады">
          {a.restoration?.needed ? (
            <div className="small">Бағалау: {a.restoration.estimateHours ?? '—'} сағ · {a.restoration.fee === null ? 'сомасы жеке есептеледі' : <Kzt v={a.restoration.fee} />} · <Badge tone="info">{a.restoration.status}</Badge></div>
          ) : <div className="small muted">Қажет емес</div>}
        </Card>
      </div>
      <Card title="Есептер тарихы">
        <table className="tbl small">
          <thead><tr><th>Кезең</th><th>Мәртебе</th><th>Жапқан</th></tr></thead>
          <tbody>{closes.map((p) => <tr key={p.id}><td>{monthLabel(p.period)}</td><td>{p.status === 'closed' ? <Badge tone="ok">Жабылды</Badge> : <Badge tone="info">{p.status === 'open' ? 'Ашық' : 'Жабылуда'}</Badge>}</td><td>{api.userName(p.closedBy)} {fmtDateTime(p.closedAt)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
