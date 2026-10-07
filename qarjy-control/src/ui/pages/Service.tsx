import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Bar, Card, Explain, Kzt, Modal } from '../components/ui';
import { fmtBp } from '../../domain/money';
import { findPeriod } from '../../domain/periods';
import type { TariffCode } from '../../domain/types';

export const TARIFFS: { code: TariffCode; name: string; who: string; includes: string[]; price: string }[] = [
  { code: 'control', name: 'Бақылау', who: 'Клиенттің өз бухгалтерлері бар; біз бақылаймыз және жүйелейміз', includes: ['1С деректерін оқу және тексерулер', 'Мәселелер орталығы', 'Ай жабу чек-листін тексеру', 'Кәсіпкердің басты экраны'], price: 'Жеке есептеледі' },
  { code: 'accounting', name: 'Бухгалтерлік қызмет', who: 'Біздің команда есепті жүргізеді', includes: ['«Бақылау» тарифіндегінің бәрі', 'Бастапқы құжаттарды өңдеу', 'Банк, касса, қойма салыстыру', 'Ай жабу'], price: 'Demo: 380 000 ₸/ай бастап (нарық бағасы емес)' },
  { code: 'partner', name: 'Қаржы серіктесі', who: 'Есеп + басқарушылық талдау', includes: ['«Бухгалтерлік қызмет» тарифіндегінің бәрі', 'Төлем күнтізбесі және болжам', 'Апталық қаржы шолуы', 'Шешім ұсыныстары'], price: 'Demo: 650 000 ₸/ай бастап (нарық бағасы емес)' },
];

export const PRICE_FACTORS = ['Заңды тұлғалар саны', 'Филиалдар', 'Операция көлемі', 'Қызметкерлер саны', 'Қойма есебінің күрделілігі', 'Есептің бастапқы жағдайы', 'Интеграциялар', 'Жауап беру мерзімі (SLA)', 'Басқарушылық есептің көлемі'];

export function ServicePage() {
  const { api, session, run, go, setSession } = useApp();
  const [xp, setXp] = useState<{ tenantId: string; units: string; note: string } | null>(null);
  const isLead = api.canAnywhere('service.economics');
  const per = findPeriod(session.periodKey);
  const econ = isLead ? api.economics(session.periodKey) : [];
  const own = api.tenants().filter((t) => api.can('service.view', t.id) && !isLead);
  return (
    <div className="col gap16">
      <div className="row between">
        <h1>Қызмет және төлем</h1>
        {api.canAnywhere('onboarding') && <button className="btn primary" onClick={() => go('/onboarding')}>+ Жаңа клиентті қосу</button>}
      </div>
      <div className="grid g3">
        {TARIFFS.map((t) => (
          <Card key={t.code} title={t.name} sub={t.who} actions={<Badge tone="outline">шартты атау</Badge>}>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{t.includes.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="mt8"><b>{t.price}</b></div>
          </Card>
        ))}
      </div>
      <div className="callout small">Бағалау факторлары: {PRICE_FACTORS.join(' · ')}. Бағалар расталған нарық бағасы емес. 1С лицензиясы — клиенттің жеке шарты, біздің жазылымға кірмейді.</div>

      {own.map((t) => {
        const a = api.agreement(t.id);
        const u = api.usage(t.id, api.today().slice(0, 7));
        const sub = api.subscription(t.id);
        return (
          <Card key={t.id} title={`${t.name}: сіздің қызметіңіз`} actions={<a href={`#/client/${t.id}`}>Клиент карточкасы →</a>}>
            <div className="grid g3">
              <div><div className="muted small">Тариф</div><b>{TARIFFS.find((x) => x.code === a.tariff)?.name}</b> · {a.mode === 'outsourcing' ? 'аутсорсинг' : 'бақылау'}</div>
              <div><div className="muted small">Айлық төлем</div><b>{a.monthlyFee === null ? 'Жеке есептеледі' : <Kzt v={a.monthlyFee} />}</b> <Badge tone="outline">demo</Badge></div>
              <div><div className="muted small">Жазылым / 1С лицензиясы</div>{sub?.status} · <span className="small">{sub?.oneCLicense}</span></div>
            </div>
            <div className="mt8 small">Осы айдағы көлем: {u.units} / {u.limit} бірлік</div>
            <Bar pct={u.limit ? (u.units / u.limit) * 100 : 0} tone={u.over ? 'over' : undefined} />
            {u.over > 0 && <div className="small muted mt8">Лимиттен тыс {u.over} бірлік. Қосымша төлем үнсіз есептелмейді — ұсыныс сізге шешім ретінде келеді.</div>}
          </Card>
        );
      })}

      {isLead && (
        <Card title="Қызмет экономикасы (клиент бойынша)" sub={`${per.label} · тек қызмет жетекшісіне`} actions={<Explain k="contribution" />}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Клиент</th><th>Тариф</th><th className="right">Айлық түсім</th><th className="right">Тікелей еңбек</th><th className="right">Интеграция және AI</th><th className="right">Басқа тікелей</th><th className="right">Үлестік маржа</th><th>Көлем / лимит</th><th></th>
                </tr>
              </thead>
              <tbody>
                {econ.map((e) => (
                  <tr key={e.tenant.id}>
                    <td><a onClick={() => { setSession({ tenantId: e.tenant.id }); go(`/client/${e.tenant.id}`); }}>{e.tenant.name}</a><div className="muted tiny">{e.hours} сағ еңбек</div></td>
                    <td className="small">{TARIFFS.find((x) => x.code === e.agreement.tariff)?.name}</td>
                    <td className="right">{e.revenue === null ? <Badge>жеке есептеледі</Badge> : <Kzt v={e.revenue} />}</td>
                    <td className="right"><Kzt v={-e.labor} /></td>
                    <td className="right"><Kzt v={-e.integ} /></td>
                    <td className="right"><Kzt v={-e.other} /></td>
                    <td className="right">{e.margin === null ? <Badge tone="warn">түсім белгісіз</Badge> : <b><Kzt v={e.margin} /> <span className="tiny muted">{fmtBp(e.marginBp)}</span></b>}</td>
                    <td style={{ minWidth: 140 }}>
                      <div className="small num">{e.usage.units} / {e.usage.limit}</div>
                      <Bar pct={e.usage.limit ? (e.usage.units / e.usage.limit) * 100 : 0} tone={e.usage.over ? 'over' : undefined} />
                    </td>
                    <td>{e.usage.over > 0 && <button className="btn sm" onClick={() => setXp({ tenantId: e.tenant.id, units: String(e.usage.over), note: `Лимиттен тыс ${e.usage.over} бірлік жұмыс` })}>Қосымша жұмыс ұсынысы</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout small mt8">Үлестік маржа = Айлық түсім − Тікелей еңбек (WorkLog сағаты × demo ставка) − Интеграция және AI − Басқа тікелей шығын. Бұл компанияның таза пайдасы ЕМЕС. Барлық ставкалар — demo.</div>
          {econ.flatMap((e) => e.agreement.extraWorkProposals.map((p) => ({ e, p }))).length > 0 && (
            <div className="mt8">
              <h4 className="mb8">Қосымша жұмыс ұсыныстары</h4>
              {econ.flatMap((e) => e.agreement.extraWorkProposals.map((p) => (
                <div key={p.id} className="small">{e.tenant.name}: {p.units} бірлік · {p.note} · <Badge tone={p.status === 'accepted' ? 'ok' : p.status === 'declined' ? 'danger' : 'info'}>{p.status === 'draft' ? 'жоба' : p.status === 'sent' ? 'клиентке жіберілді' : p.status === 'accepted' ? 'бекітілді' : 'бас тартылды'}</Badge></div>
              )))}
            </div>
          )}
        </Card>
      )}
      {xp && (
        <Modal title="Қосымша жұмыс ұсынысы" onClose={() => setXp(null)} footer={<button className="btn primary" onClick={() => run(() => api.proposeExtraWork(xp.tenantId, parseInt(xp.units, 10), xp.note), 'Ұсыныс кәсіп иесіне шешім ретінде жіберілді') && setXp(null)}>Клиентке жіберу</button>}>
          <div className="callout small">Сома «жеке есептеледі». Клиент бекітпейінше ештеңе есептелмейді.</div>
          <label className="field">Бірлік<input value={xp.units} onChange={(e) => setXp({ ...xp, units: e.target.value })} /></label>
          <label className="field">Сипаттама<textarea value={xp.note} onChange={(e) => setXp({ ...xp, note: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  );
}
