import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, Explain, Kzt, MetricStatusBadge, Tabs, Forbidden, Empty } from '../components/ui';
import { CashChart } from '../components/charts';
import { fmtBp, fmtKzt, sum, type Money } from '../../domain/money';
import { fmtDate, fmtDateTime, monthLabel, addDays } from '../../domain/periods';
import { TX_KIND_LABEL } from '../components/detail';
import { CAT } from './OwnerHome';
import type { ID } from '../../domain/types';
import { balanceAt, type MetricInfo } from '../../domain/finance';

type Tab = 'pnl' | 'cash' | 'debts' | 'calendar' | 'branches' | 'owner';

export function FinancePage({ tenantId }: { tenantId: ID }) {
  const { api, session, route, go, openDrill } = useApp();
  const [tab, setTabState] = useState<Tab>((route.query.get('tab') as Tab) || 'pnl');
  const setTab = (t: Tab) => {
    setTabState(t);
    go(`/finance?tab=${t}`);
  };
  let F: ReturnType<typeof api.finance>;
  try {
    F = api.finance(tenantId, session.branchId, session.periodKey);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const per = session.lang === 'ru' ? F.period.labelRu : F.period.label;
  const upd = F.freshness.lastSuccessAt ? fmtDateTime(F.freshness.lastSuccessAt) : '—';
  const P = F.pnl;
  const branchName = api.db.branches.find((b) => b.id === session.branchId)?.name;
  const metaLine = (
    <div className="small muted">
      Кезең: {per} · Филиал: {branchName ?? 'барлығы'} · Дереккөз: 1С (MockConnector) · Жаңартылды: {upd} · <Badge tone={F.reportStatus === 'final' ? 'ok' : 'info'}>{F.reportStatus === 'final' ? 'Ай жабылған' : 'Алдын ала есеп'}</Badge>
    </div>
  );
  const MV = ({ m }: { m: MetricInfo }) => (m.value === null ? <Badge tone="warn">{m.status === 'no_data' ? 'Дерек жоқ' : 'Есеп толық емес'}</Badge> : <Kzt v={m.value} />);
  const row = (label: string, v: Money | null | MetricInfo, opts: { strong?: boolean; indent?: boolean; txIds?: ID[]; explain?: string; sign?: number } = {}) => {
    const isM = v !== null && typeof v === 'object';
    return (
      <tr className={`${opts.strong ? 'total' : ''} ${opts.txIds?.length ? 'click' : ''}`} onClick={() => opts.txIds?.length && openDrill({ title: label, tenantId, txIds: opts.txIds, meta: { period: per, source: '1С (MockConnector)', updated: upd } })}>
        <td className={opts.indent ? 'indent' : ''}>
          {label} {opts.explain && <Explain k={opts.explain} />}
        </td>
        <td className="right">{isM ? <MV m={v as MetricInfo} /> : v === null ? <Badge tone="warn">белгісіз</Badge> : <Kzt v={(v as Money) * (opts.sign ?? 1)} />}</td>
        <td className="right">{isM && <MetricStatusBadge status={(v as MetricInfo).status} />}{opts.txIds?.length ? <span className="muted tiny"> {opts.txIds.length} оп. →</span> : null}</td>
      </tr>
    );
  };

  return (
    <div className="col gap16">
      <div className="row between">
        <h1>Қаржы</h1>
        <Tabs<Tab> value={tab} onChange={setTab} items={[['pnl', 'A. Пайда мен шығын'], ['cash', 'B. Ақша қозғалысы'], ['debts', 'C. Қарыздар'], ['calendar', 'D. Төлем күнтізбесі'], ['branches', 'E. Филиалдар мен қойма'], ['owner', 'F. Иесінің операциялары']]} />
      </div>
      {metaLine}

      {tab === 'pnl' && (
        <div className="grid g3">
          <Card title="Пайда мен шығын" className="span2" sub="Жолды басып бастапқы операцияларды ашыңыз">
            <table className="tbl">
              <tbody>
                {row('Сатылым', P.grossSales, { txIds: P.txIds.sales, explain: 'sales' })}
                {row('− Қайтарымдар', P.returns, { indent: true, sign: -1, txIds: P.txIds.returns })}
                {row('Таза сатылым', P.netSales, { strong: true })}
                {P.missingCost.count > 0 && row(`Өзіндік құны белгісіз сатылым (${P.missingCost.count} оп., есептен тыс)`, P.missingCost.salesAmount, { indent: true, txIds: P.missingCost.txIds })}
                {row('− Өзіндік құн', P.cogs, { indent: true, sign: -1 })}
                {row(`Жалпы пайда · маржа ${fmtBp(P.grossMarginBp)}`, P.grossProfit, { strong: true, explain: 'grossProfit' })}
                {P.opexByCategory.map((c) => row(`− ${CAT[c.category]}`, c.amount, { indent: true, sign: -1, txIds: c.txIds }))}
                {P.unclassified.amount > 0 && row('? Жіктелмеген төлемдер (пайдаға әсері белгісіз)', P.unclassified.amount, { indent: true, txIds: P.unclassified.txIds })}
                {row('Операциялық пайда', P.operatingProfit, { strong: true, explain: 'opProfit' })}
                {row('+ Басқа кірістер', P.otherIncome, { indent: true })}
                {row('− Басқа шығыстар (банк комиссиясы т.б.)', P.otherExpense, { indent: true, sign: -1, txIds: P.txIds.other })}
                {row('− Табыс салығы (ай жабылғанда)', P.incomeTax, { indent: true })}
                {row('Есептелген таза пайда', P.netProfit, { strong: true, explain: 'netProfit' })}
              </tbody>
            </table>
            {[...new Set([...P.operatingProfit.reasons, ...P.netProfit.reasons])].map((r) => <div key={r} className="callout warn small mt8">{r}</div>)}
          </Card>
          <Card title="Алдыңғы кезеңмен салыстыру" sub={F.prevPeriod.label}>
            <table className="tbl small">
              <thead><tr><th></th><th className="right">Алдыңғы</th><th className="right">Ағымдағы</th></tr></thead>
              <tbody>
                <tr><td>Таза сатылым</td><td className="right"><Kzt v={F.prevPnl.netSales} short /></td><td className="right"><Kzt v={P.netSales} short /></td></tr>
                <tr><td>Маржа</td><td className="right num">{fmtBp(F.prevPnl.grossMarginBp)}</td><td className="right num">{fmtBp(P.grossMarginBp)}</td></tr>
                <tr><td>Операциялық шығын</td><td className="right"><Kzt v={F.prevPnl.opex} short /></td><td className="right"><Kzt v={P.opex} short /></td></tr>
                <tr><td>Операциялық пайда</td><td className="right"><Kzt v={F.prevPnl.operatingProfit.value} short /></td><td className="right"><Kzt v={P.operatingProfit.value} short /></td></tr>
              </tbody>
            </table>
            <div className="callout small mt8">Иесінің салымы мен алымы, ішкі аударымдар, салық төлемдері пайдаға кірмейді (F бөлімін қараңыз).</div>
          </Card>
        </div>
      )}

      {tab === 'cash' && (
        <div className="grid g3">
          <Card title="Ақша қозғалысы" className="span2" sub={F.cash.bankOnlyCompanyLevel ? 'Филиал сүзгісі: тек филиал кассасы. Банк шоты компания деңгейінде.' : 'Барлық банк шоттары мен кассалар'} actions={<Explain k="cash" />}>
            <table className="tbl">
              <tbody>
                {row('Кезең басындағы ақша', F.cash.opening, { strong: true })}
                {F.cash.inflows.map((l) => row(`+ ${TX_KIND_LABEL[l.kind]}`, l.amount, { indent: true, txIds: l.txIds }))}
                {row('Түсімдер барлығы', F.cash.totalIn, {})}
                {F.cash.outflows.map((l) => row(`− ${TX_KIND_LABEL[l.kind]}`, l.amount, { indent: true, sign: -1, txIds: l.txIds }))}
                {row('Төлемдер барлығы', F.cash.totalOut, { sign: -1 })}
                {F.cash.transfersOut > 0 && row('− Ішкі аударым: компания банк шотына (кіріс/шығыс емес)', F.cash.transfersOut, { indent: true, sign: -1 })}
                {F.cash.transfersIn > 0 && row('+ Ішкі аударым: басқа шоттан', F.cash.transfersIn, { indent: true })}
                {row('Кезең соңындағы ақша', F.cash.closing, { strong: true })}
              </tbody>
            </table>
            <div className={`callout mt8 small ${F.cash.reconciles ? 'info' : 'danger'}`}>
              {F.cash.reconciles ? '✓' : '✗'} Тексеру: {fmtKzt(F.cash.opening)} + {fmtKzt(F.cash.totalIn)} − {fmtKzt(F.cash.totalOut)}{F.cash.transfersIn || F.cash.transfersOut ? ` ± ${fmtKzt(F.cash.transfersIn - F.cash.transfersOut)}` : ''} = {fmtKzt(F.cash.closing)}. Шоттар арасындағы ішкі аударым ({fmtKzt(F.cash.internalTransfers)}) жаңа кіріс ретінде есептелмеді.
            </div>
          </Card>
          <Card title="Шоттар бойынша">
            <table className="tbl small">
              <tbody>
                <tr><th>Шот</th><th className="right">Басы</th><th className="right">Соңы</th></tr>
                {F.cash.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}<div className="muted tiny">{a.kind === 'bank' ? 'Банк' : 'Касса'}</div></td>
                    <td className="right"><Kzt v={balanceAt(api.db, [a.id], addDays(F.period.from, -1))} short /></td>
                    <td className="right"><Kzt v={balanceAt(api.db, [a.id], F.period.to)} short /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="callout small mt8">Пайда мен ақша әртүрлі: пайда бар болса да, ақша клиент қарызында немесе тауарда тұруы мүмкін. <a onClick={() => setTab('branches')}>Пайда → ақша көпірі</a></div>
          </Card>
          <Card title="Күн сайынғы қалдық" className="span2"><CashChart data={F.daily} height={220} /></Card>
        </div>
      )}

      {tab === 'debts' && (
        <div className="grid g2">
          {(['ar', 'ap'] as const).map((k) => {
            const list = k === 'ar' ? F.ar : F.ap;
            return (
              <Card key={k} title={k === 'ar' ? 'Клиенттердің қарызы' : 'Жеткізушілерге қарыз'} sub={`${fmtDate(F.effectiveTo)} жағдайы · төлемдер FIFO бойынша бөлінді`} actions={<Explain k={k} />}>
                {list.length === 0 ? (
                  <Empty>{k === 'ar' ? 'Клиент қарызы жоқ (бөлшек сауда — қолданылмайды)' : 'Қарыз жоқ'}</Empty>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl small">
                      <thead><tr><th>Контрагент</th><th className="right">Қалдық</th><th className="right">Мерзімі өткен</th><th>1–30 / 31–60 / 60+</th><th>Жауапты · келесі әрекет</th></tr></thead>
                      <tbody>
                        {list.map((d) => (
                          <tr key={d.counterpartyId} className="click" onClick={() => openDrill({ title: `${d.name}: ашық құжаттар`, tenantId, txIds: d.items.filter((i) => i.ref !== 'opening').map((i) => i.ref), lines: d.items.map((i) => ({ label: `${i.ref === 'opening' ? 'Бастапқы қалдық' : 'Құжат'} ${fmtDate(i.date)}, мерзімі ${fmtDate(i.dueDate)}`, value: i.outstanding })), formula: 'Қалдық = Құжат сомасы − FIFO бойынша бөлінген төлемдер' })}>
                            <td>{d.name}</td>
                            <td className="right"><Kzt v={d.outstanding} /></td>
                            <td className="right">{d.overdue > 0 ? <b style={{ color: d.maxDaysOverdue > 30 ? 'var(--danger)' : 'var(--warn)' }}><Kzt v={d.overdue} /> <span className="tiny">({d.maxDaysOverdue} к.)</span></b> : '—'}</td>
                            <td className="num tiny">{fmtKzt(d.buckets.d1_30)} / {fmtKzt(d.buckets.d31_60)} / {fmtKzt(d.buckets.d60p)}</td>
                            <td className="small">{api.userName(d.responsibleUserId)}<div className="muted">{d.nextAction || '—'}</div></td>
                          </tr>
                        ))}
                        <tr className="total"><td>Барлығы</td><td className="right"><Kzt v={sum(list.map((d) => d.outstanding))} /></td><td className="right"><Kzt v={sum(list.map((d) => d.overdue))} /></td><td></td><td></td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'calendar' && (
        <Card title="Төлем күнтізбесі · алдағы 30 күн" sub={`Нақты қалдық ${fmtDate(F.calendar.asOf)}: ${fmtKzt(F.calendar.actualBalance)} (нақты ақша). Қалғаны — болжам.`}>
          <div className="row small mb8">
            <Badge tone="info">Шарт</Badge> шарт мерзімі бойынша
            <Badge tone="outline">Болжам</Badge> өткен ай/28 күн негізінде
            <Badge tone="warn">Мерзімі өткен</Badge> бірінші күнге қойылды
            <span className="muted">· Мерзімі өткен клиент қарызы болжамға кірмейді (түсу күні белгісіз)</span>
          </div>
          {F.calendar.firstShortage ? <div className="callout danger mb8">Ақша жетіспеуі ықтимал: {fmtDate(F.calendar.firstShortage)} (болжам). Ең төменгі қалдық {fmtKzt(F.calendar.minBalance)}.</div> : <div className="callout info mb8">Болжам бойынша 30 күнде қалдық 0-ден төмен түспейді. Ең төменгі: {fmtKzt(F.calendar.minBalance)}.</div>}
          <div className="tbl-wrap" style={{ maxHeight: 560 }}>
            <table className="tbl small">
              <thead><tr><th>Күні</th><th>Операциялар</th><th className="right">Түсім</th><th className="right">Төлем</th><th className="right">Болжамды қалдық</th></tr></thead>
              <tbody>
                {F.calendar.days.map((d) => (
                  <tr key={d.date} style={d.shortage ? { background: 'var(--danger-soft)' } : undefined}>
                    <td className="num">{fmtDate(d.date)}</td>
                    <td>
                      {d.entries.filter((e) => e.basis !== 'forecast' || e.amount > 0).map((e, i) => (
                        <div key={i}>
                          <Badge tone={e.basis === 'contract' ? 'info' : e.basis === 'overdue' ? 'warn' : 'outline'}>{e.basis === 'contract' ? 'Шарт' : e.basis === 'overdue' ? 'Мерзімі өткен' : 'Болжам'}</Badge> {e.direction === 'in' ? '+' : '−'} {e.label} · <Kzt v={e.amount} />
                        </div>
                      ))}
                    </td>
                    <td className="right"><Kzt v={d.inflow} /></td>
                    <td className="right"><Kzt v={d.outflow} /></td>
                    <td className="right"><b><Kzt v={d.projectedBalance} /></b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'branches' && (
        <div className="grid g2">
          <Card title="Филиалдар" sub={per}>
            <table className="tbl small">
              <thead><tr><th>Филиал</th><th className="right">Сатылым</th><th className="right">Маржа</th><th className="right">Шығын</th><th className="right">Тауар</th></tr></thead>
              <tbody>
                {F.branches.map((b) => (
                  <tr key={b.branch.id}><td>{b.branch.name}</td><td className="right"><Kzt v={b.netSales} short /></td><td className="right num">{fmtBp(b.marginBp)}</td><td className="right"><Kzt v={b.opex} short /></td><td className="right"><Kzt v={b.inventory} short /></td></tr>
                ))}
              </tbody>
            </table>
            <div className="callout small mt8">Қоймадағы тауар — ақша емес. Ол «Банк пен кассадағы ақша» көрсеткішіне қосылмайды.</div>
            {F.stockLines.length > 0 && (
              <>
                <h4 className="mt16 mb8">Қойма қалдығы (тексерілген SKU)</h4>
                <table className="tbl small">
                  <tbody>
                    {F.stockLines.map((s) => (
                      <tr key={s.id}><td>{s.name}<div className="muted tiny">{api.db.branches.find((b) => b.id === s.branchId)?.name} · {fmtDate(s.asOf)}</div></td><td className="right num">{s.qty < 0 ? <Badge tone="danger">{s.qty} дана</Badge> : `${s.qty} дана`}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
          <Card title="Пайда → ақша көпірі" sub={`${per} · компания деңгейі`}>
            <table className="tbl">
              <tbody>
                <tr><td>Операциялық пайда</td><td className="right"><Kzt v={F.bridge.operatingProfit.value} /></td></tr>
                <tr><td className="indent">− Клиент қарызының өсуі</td><td className="right"><Kzt v={-F.bridge.arDelta} /></td></tr>
                <tr><td className="indent">− Тауар қалдығының өсуі</td><td className="right"><Kzt v={-F.bridge.invDelta} /></td></tr>
                <tr><td className="indent">+ Жеткізушіге қарыздың өсуі</td><td className="right"><Kzt v={F.bridge.apDelta} /></td></tr>
                <tr><td className="indent">± Иесінің операциялары</td><td className="right"><Kzt v={F.bridge.ownerNet} /></td></tr>
                <tr><td className="indent">− Салық төлемдері</td><td className="right"><Kzt v={-F.bridge.taxPaid} /></td></tr>
                <tr className="total"><td>Ақшаның нақты өзгерісі</td><td className="right"><Kzt v={F.bridge.cashDelta} /></td></tr>
              </tbody>
            </table>
            {F.bridge.operatingProfit.value !== null && (
              <div className="callout small mt8">
                Түсіндірілмеген айырма: {fmtKzt(F.bridge.cashDelta - ((F.bridge.operatingProfit.value ?? 0) - F.bridge.arDelta - F.bridge.invDelta + F.bridge.apDelta + F.bridge.ownerNet - F.bridge.taxPaid))} — басқа кірістер/шығыстар, қайтарымдар, жіктелмеген төлемдер.
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'owner' && (
        <Card title="Иесінің операциялары" sub={`${per} · пайдаға кірмейді`} actions={<Explain k="ownerOps" />}>
          <div className="grid g3">
            <div><div className="muted small">Иесінің салымы</div><h2><Kzt v={F.owner.contributions} /></h2></div>
            <div><div className="muted small">Бизнестен алған ақшасы</div><h2><Kzt v={F.owner.withdrawals} /></h2></div>
            <div><div className="muted small">Бизнес шотынан жеке шығындар</div><h2><Kzt v={F.owner.personal} /></h2></div>
          </div>
          <div className="mt16">
            {F.owner.txs.length ? (
              <table className="tbl small">
                <thead><tr><th>Күні</th><th>Түрі</th><th>Сипаттама</th><th className="right">Сома</th></tr></thead>
                <tbody>
                  {F.owner.txs.map((t) => <tr key={t.id}><td>{fmtDate(t.date)}</td><td>{TX_KIND_LABEL[t.kind]}</td><td>{t.description}</td><td className="right"><Kzt v={t.amount} /></td></tr>)}
                </tbody>
              </table>
            ) : (
              <Empty>Бұл кезеңде иесінің операциясы жоқ</Empty>
            )}
          </div>
          <div className="callout small mt8">AI жеке шығын болуы мүмкін деп белгілеген операциялар «Мәселелер» бөлімінде — олар сіз растағанға дейін бизнес шығыны болып қалады.</div>
        </Card>
      )}
      <div className="small muted">Кезеңдер: {P.openMonths.length ? `жабылмаған — ${P.openMonths.map((m) => monthLabel(m)).join(', ')}` : 'барлығы жабылған'}.</div>
    </div>
  );
}
