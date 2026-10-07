import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, DemoBadge, Forbidden, Kzt, Empty } from '../components/ui';
import { DOC_TYPE_LABEL } from '../components/detail';
import { fmtDate } from '../../domain/periods';
import { tenge } from '../../domain/money';
import type { DocType, ID } from '../../domain/types';

export function DocumentsPage({ tenantId }: { tenantId: ID }) {
  const { api, openDoc, run, session } = useApp();
  const [type, setType] = useState<'' | DocType>('');
  const [flag, setFlag] = useState<'' | 'unposted' | 'nofile' | 'upload'>('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [up, setUp] = useState({ type: 'service_act' as DocType, number: '', date: api.today(), amount: '', fileName: '', note: '' });
  let docs: ReturnType<typeof api.documents>;
  try {
    docs = api.documents(tenantId);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const showAmounts = api.can('finance.read', tenantId);
  const list = docs
    .filter((d) => !type || d.type === type)
    .filter((d) => !session.branchId || d.branchId === session.branchId || d.branchId === null)
    .filter((d) => (flag === 'unposted' ? !d.posted && d.source !== 'upload' : flag === 'nofile' ? !d.hasPrimaryFile : flag === 'upload' ? d.source === 'upload' : true))
    .filter((d) => !q || `${d.number} ${d.note ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="col gap16">
      <h1>Құжаттар</h1>
      <div className="callout small">1С — бастапқы есептің негізгі жүйесі. Платформа құжаттарды оқиды және тексереді; жүктелген файлдар 1С-ке автоматты түрде өткізілмейді.</div>
      {api.can('docs.upload', tenantId) && (
        <Card title="Құжат жүктеу" actions={<DemoBadge label="файлдың өзі сақталмайды" />}>
          <div className="row">
            <select value={up.type} onChange={(e) => setUp({ ...up, type: e.target.value as DocType })}>
              {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input placeholder="№" style={{ width: 100 }} value={up.number} onChange={(e) => setUp({ ...up, number: e.target.value })} />
            <input type="date" value={up.date} onChange={(e) => setUp({ ...up, date: e.target.value })} />
            <input placeholder="Сома, ₸" style={{ width: 120 }} value={up.amount} onChange={(e) => setUp({ ...up, amount: e.target.value })} />
            <input placeholder="Файл атауы (akt.pdf)" value={up.fileName} onChange={(e) => setUp({ ...up, fileName: e.target.value })} />
            <input placeholder="Түсініктеме" className="grow" value={up.note} onChange={(e) => setUp({ ...up, note: e.target.value })} />
            <button className="btn primary" disabled={!up.number || !up.fileName} onClick={() => run(() => api.uploadDocument(tenantId, { type: up.type, number: up.number, date: up.date, amount: up.amount ? tenge(up.amount) : 0, note: up.note, fileName: up.fileName, branchId: session.branchId }), 'Құжат жүктелді') && setUp({ ...up, number: '', amount: '', fileName: '', note: '' })}>Жүктеу</button>
          </div>
        </Card>
      )}
      <Card>
        <div className="row mb8">
          <select value={type} onChange={(e) => setType(e.target.value as DocType)}>
            <option value="">Барлық түр</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)}>
            <option value="">Барлығы</option>
            <option value="unposted">Өткізілмеген (1С)</option>
            <option value="nofile">Файлы жоқ</option>
            <option value="upload">Платформаға жүктелген</option>
          </select>
          <input placeholder="№ іздеу…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{list.length} құжат</span>
        </div>
        {list.length === 0 ? <Empty>Құжат жоқ</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Күні</th><th>Түрі</th><th>№</th><th>Филиал</th>{showAmounts && <th className="right">Сома</th>}<th>Күйі</th><th>Дереккөз</th></tr></thead>
              <tbody>
                {list.slice(0, limit).map((d) => (
                  <tr key={d.id} className="click" onClick={() => openDoc(tenantId, d.id)}>
                    <td className="num">{fmtDate(d.date)}</td>
                    <td className="small">{DOC_TYPE_LABEL[d.type]}</td>
                    <td>{d.number}</td>
                    <td className="small">{api.db.branches.find((b) => b.id === d.branchId)?.name ?? 'Компания'}</td>
                    {showAmounts && <td className="right"><Kzt v={d.amount} /></td>}
                    <td>
                      {d.source !== 'upload' && !d.posted && <Badge tone="warn">өткізілмеген</Badge>}
                      {!d.hasPrimaryFile && <Badge tone="warn">файл жоқ</Badge>}
                      {d.source !== 'upload' && d.posted && d.hasPrimaryFile && <Badge tone="ok">ок</Badge>}
                    </td>
                    <td className="small">{d.source === 'mock_1c' ? '1С (Mock)' : d.source === 'csv' ? 'CSV' : `Жүктелді: ${api.userName(d.uploadedBy)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > limit && <button className="btn mt8" onClick={() => setLimit(limit + 200)}>Тағы көрсету ({list.length - limit})</button>}
          </div>
        )}
      </Card>
    </div>
  );
}
