/**
 * Тексерілетін есептеу қабаты. UI-ға тәуелсіз, таза функциялар.
 * Барлық сомалар — тиын (бүтін сан). Белгісіз дерек null болып қалады, 0-ге айналмайды.
 */
import type { Db, ID, ISODate, Transaction, TxKind, ExpenseCategory, MoneyAccount } from './types';
import { type Money, sum, ratioBp } from './money';
import { addDays, diffDays, monthsBetween, monthStart, monthEnd, hoursBetween, DATA_START } from './periods';

export interface Scope {
  tenantId: ID;
  branchId: ID | null;
  from: ISODate;
  to: ISODate;
}

export type MetricStatus = 'final' | 'preliminary' | 'incomplete' | 'no_data';

export interface MetricInfo {
  value: Money | null;
  status: MetricStatus;
  reasons: string[];
}

// ───────── Негізгі сүзгілер ─────────

export function tenantTx(db: Db, tenantId: ID): Transaction[] {
  return db.transactions.filter((t) => t.tenantId === tenantId);
}

export function scopeTx(db: Db, s: Scope, kinds?: TxKind[]): Transaction[] {
  return db.transactions.filter(
    (t) =>
      t.tenantId === s.tenantId &&
      (s.branchId === null || t.branchId === s.branchId) &&
      t.date >= s.from &&
      t.date <= s.to &&
      (!kinds || kinds.includes(t.kind)),
  );
}

// ───────── Ақша ─────────

const CASH_IN_KINDS: TxKind[] = ['customer_payment', 'other_income', 'owner_contribution'];
const CASH_OUT_KINDS: TxKind[] = [
  'supplier_payment',
  'expense',
  'tax_payment',
  'other_expense',
  'owner_withdrawal',
  'owner_personal_expense',
  'unclassified_payment',
];

/** Транзакцияның берілген шотқа әсері (таңбалы). */
export function cashDelta(t: Transaction, accountId: ID): Money {
  if (t.kind === 'transfer') {
    if (t.accountId === accountId) return -t.amount;
    if (t.toAccountId === accountId) return t.amount;
    return 0;
  }
  if (t.accountId !== accountId) return 0;
  switch (t.kind) {
    case 'sale':
      return t.settlement === 'credit' ? 0 : t.amount;
    case 'sale_return':
      return t.settlement === 'credit' ? 0 : -t.amount;
    case 'purchase':
      return t.settlement === 'credit' ? 0 : -t.amount;
    default:
      if (CASH_IN_KINDS.includes(t.kind)) return t.amount;
      if (CASH_OUT_KINDS.includes(t.kind)) return -t.amount;
      return 0;
  }
}

export function scopeAccounts(db: Db, tenantId: ID, branchId: ID | null): MoneyAccount[] {
  return db.accounts.filter((a) => a.tenantId === tenantId && (branchId === null || a.branchId === branchId));
}

/** Шот қалдығы берілген күннің соңында. date < DATA_START болса — бастапқы қалдық. */
export function balanceAt(db: Db, accountIds: ID[], date: ISODate): Money {
  const ids = new Set(accountIds);
  let bal = sum(db.accounts.filter((a) => ids.has(a.id)).map((a) => a.openingBalance));
  for (const t of db.transactions) {
    if (t.date > date) continue;
    if (!ids.has(t.accountId ?? '') && !ids.has(t.toAccountId ?? '')) continue;
    for (const id of ids) bal += cashDelta(t, id);
  }
  return bal;
}

export interface CashFlowLine {
  kind: TxKind | 'sale_cash' | 'transfer_in' | 'transfer_out';
  amount: Money;
  txIds: ID[];
}

export interface CashFlow {
  accounts: MoneyAccount[];
  opening: Money;
  inflows: CashFlowLine[];
  outflows: CashFlowLine[];
  totalIn: Money;
  totalOut: Money;
  /** Сүзгі ішіндегі шоттар арасындағы аударым — кіріс те, шығыс та емес */
  internalTransfers: Money;
  /** Сүзгіден тыс шотқа/шоттан аударым (мысалы филиал кассасы → компания банкі) */
  transfersOut: Money;
  transfersIn: Money;
  closing: Money;
  /** Тәуелсіз тексеру: opening + in − out + trIn − trOut === balanceAt(to) */
  reconciles: boolean;
  bankOnlyCompanyLevel: boolean;
}

export function cashFlow(db: Db, s: Scope): CashFlow {
  const accounts = scopeAccounts(db, s.tenantId, s.branchId);
  const ids = accounts.map((a) => a.id);
  const idSet = new Set(ids);
  const opening = balanceAt(db, ids, addDays(s.from, -1));
  const inMap = new Map<string, CashFlowLine>();
  const outMap = new Map<string, CashFlowLine>();
  let internal = 0;
  let trIn = 0;
  let trOut = 0;
  const add = (m: Map<string, CashFlowLine>, k: CashFlowLine['kind'], amt: Money, id: ID) => {
    const l = m.get(k) ?? { kind: k, amount: 0, txIds: [] };
    l.amount += amt;
    l.txIds.push(id);
    m.set(k, l);
  };
  for (const t of db.transactions) {
    if (t.tenantId !== s.tenantId || t.date < s.from || t.date > s.to) continue;
    if (t.kind === 'transfer') {
      const fromIn = idSet.has(t.accountId ?? '');
      const toIn = idSet.has(t.toAccountId ?? '');
      if (fromIn && toIn) internal += t.amount;
      else if (fromIn) {
        trOut += t.amount;
        add(outMap, 'transfer_out', t.amount, t.id);
      } else if (toIn) {
        trIn += t.amount;
        add(inMap, 'transfer_in', t.amount, t.id);
      }
      continue;
    }
    if (!idSet.has(t.accountId ?? '')) continue;
    const d = cashDelta(t, t.accountId!);
    if (d > 0) add(inMap, t.kind === 'sale' ? 'sale_cash' : t.kind, d, t.id);
    else if (d < 0) add(outMap, t.kind, -d, t.id);
  }
  const inflows = [...inMap.values()].filter((l) => l.kind !== 'transfer_in');
  const outflows = [...outMap.values()].filter((l) => l.kind !== 'transfer_out');
  const totalIn = sum(inflows.map((l) => l.amount));
  const totalOut = sum(outflows.map((l) => l.amount));
  const closing = balanceAt(db, ids, s.to);
  return {
    accounts,
    opening,
    inflows: inflows.sort((a, b) => b.amount - a.amount),
    outflows: outflows.sort((a, b) => b.amount - a.amount),
    totalIn,
    totalOut,
    internalTransfers: internal,
    transfersIn: trIn,
    transfersOut: trOut,
    closing,
    reconciles: opening + totalIn - totalOut + trIn - trOut === closing,
    bankOnlyCompanyLevel: s.branchId !== null,
  };
}

/** Күн сайынғы ақша қалдығы (график үшін) */
export function dailyCash(db: Db, s: Scope): { date: ISODate; balance: Money; inflow: Money; outflow: Money }[] {
  const ids = scopeAccounts(db, s.tenantId, s.branchId).map((a) => a.id);
  const idSet = new Set(ids);
  let bal = balanceAt(db, ids, addDays(s.from, -1));
  const byDay = new Map<string, { in: Money; out: Money; net: Money }>();
  for (const t of db.transactions) {
    if (t.tenantId !== s.tenantId || t.date < s.from || t.date > s.to) continue;
    let d = 0;
    for (const id of idSet) d += cashDelta(t, id);
    if (d === 0) continue;
    const e = byDay.get(t.date) ?? { in: 0, out: 0, net: 0 };
    e.net += d;
    // ішкі аударым қалдыққа әсер етеді, бірақ түсім/төлем ретінде көрсетілмейді
    if (t.kind !== 'transfer') {
      if (d > 0) e.in += d;
      else e.out += -d;
    }
    byDay.set(t.date, e);
  }
  const out: { date: ISODate; balance: Money; inflow: Money; outflow: Money }[] = [];
  for (let d = s.from; d <= s.to; d = addDays(d, 1)) {
    const e = byDay.get(d) ?? { in: 0, out: 0, net: 0 };
    bal += e.net;
    out.push({ date: d, balance: bal, inflow: e.in, outflow: e.out });
  }
  return out;
}

// ───────── Пайда мен шығын ─────────

export const EXPECTED_MONTHLY: ExpenseCategory[] = ['rent', 'salary'];

export interface Pnl {
  grossSales: Money;
  returns: Money;
  netSales: Money;
  cogs: Money; // белгілі өзіндік құн бойынша
  missingCost: { count: number; salesAmount: Money; txIds: ID[] };
  grossProfit: MetricInfo;
  grossMarginBp: number | null;
  opexByCategory: { category: ExpenseCategory; amount: Money; txIds: ID[] }[];
  opex: Money;
  missingExpected: { branchId: ID; month: string; category: ExpenseCategory }[];
  unclassified: { amount: Money; txIds: ID[] };
  operatingProfit: MetricInfo;
  otherIncome: Money;
  otherExpense: Money;
  incomeTax: MetricInfo;
  netProfit: MetricInfo;
  /** Кезеңдегі барлық ай жабылған ба */
  allMonthsClosed: boolean;
  openMonths: string[];
  partialPeriod: boolean;
  txIds: { sales: ID[]; returns: ID[]; opex: ID[]; other: ID[] };
}

export function isMonthClosed(db: Db, tenantId: ID, month: string): boolean {
  return db.periodCloses.some((p) => p.tenantId === tenantId && p.period === month && p.status === 'closed');
}

/** Кезең толық айлардан тұра ма */
export function fullMonths(from: ISODate, to: ISODate): string[] | null {
  const ms = monthsBetween(from, to);
  if (from !== monthStart(ms[0]) || to !== monthEnd(ms[ms.length - 1])) return null;
  return ms;
}

export function pnl(db: Db, s: Scope): Pnl {
  const txs = scopeTx(db, s);
  const sales = txs.filter((t) => t.kind === 'sale');
  const rets = txs.filter((t) => t.kind === 'sale_return');
  const grossSales = sum(sales.map((t) => t.amount));
  const returns = sum(rets.map((t) => t.amount));
  const netSales = grossSales - returns;
  const missing = sales.filter((t) => t.cost === null || t.cost === undefined);
  const known = sales.filter((t) => t.cost !== null && t.cost !== undefined);
  const cogs = sum(known.map((t) => t.cost as Money)) - sum(rets.map((t) => t.cost ?? 0));
  const knownNet = sum(known.map((t) => t.amount)) - returns;
  const gpValue = knownNet - cogs;

  const months = monthsBetween(s.from, s.to);
  const openMonths = months.filter((m) => !isMonthClosed(db, s.tenantId, m));
  const allClosed = openMonths.length === 0;
  const full = fullMonths(s.from, s.to);
  const baseStatus: MetricStatus = allClosed && full ? 'final' : 'preliminary';

  const gpReasons: string[] = [];
  let gpStatus: MetricStatus = baseStatus;
  if (sales.length === 0) gpStatus = 'no_data';
  if (missing.length > 0) {
    gpStatus = 'incomplete';
    gpReasons.push(`${missing.length} сатылымның өзіндік құны белгісіз — есептен тыс қалды (${(sum(missing.map((t) => t.amount)) / 100).toLocaleString('ru-RU')} ₸ сатылым)`);
  }

  // Операциялық шығындар
  const exp = txs.filter((t) => t.kind === 'expense');
  const cats = new Map<ExpenseCategory, { amount: Money; txIds: ID[] }>();
  for (const t of exp) {
    const c = t.category ?? 'other';
    const e = cats.get(c) ?? { amount: 0, txIds: [] };
    e.amount += t.amount;
    e.txIds.push(t.id);
    cats.set(c, e);
  }
  const opex = sum(exp.map((t) => t.amount));
  const branches = db.branches.filter((b) => b.tenantId === s.tenantId && (s.branchId === null || b.id === s.branchId));
  const missingExpected: Pnl['missingExpected'] = [];
  if (full) {
    for (const m of full) {
      for (const b of branches) {
        for (const c of EXPECTED_MONTHLY) {
          const has = db.transactions.some(
            (t) => t.tenantId === s.tenantId && t.branchId === b.id && t.kind === 'expense' && t.category === c && t.date.startsWith(m),
          );
          if (!has) missingExpected.push({ branchId: b.id, month: m, category: c });
        }
      }
    }
  }
  const uncl = txs.filter((t) => t.kind === 'unclassified_payment');
  const unclassified = { amount: sum(uncl.map((t) => t.amount)), txIds: uncl.map((t) => t.id) };

  const opReasons = [...gpReasons];
  let opStatus: MetricStatus = gpStatus === 'no_data' ? 'no_data' : gpStatus;
  if (missingExpected.length) {
    opStatus = 'incomplete';
    for (const m of missingExpected) {
      const bn = db.branches.find((b) => b.id === m.branchId)?.name ?? m.branchId;
      opReasons.push(`${bn}: ${m.month} ${m.category === 'rent' ? 'жалдау' : 'жалақы'} шығыны енгізілмеген`);
    }
  }
  if (unclassified.amount > 0) {
    opStatus = 'incomplete';
    opReasons.push(`${uncl.length} жіктелмеген төлем (${(unclassified.amount / 100).toLocaleString('ru-RU')} ₸) — шығын ба, жоқ па, белгісіз`);
  }
  if (!full && opStatus !== 'incomplete' && opStatus !== 'no_data') {
    opReasons.push('Кезең толық ай емес: ай сайынғы шығындар (жалдау, жалақы) күнге бөлінбеген — бағдар ғана');
    opStatus = 'preliminary';
  }

  const otherIncome = sum(txs.filter((t) => t.kind === 'other_income').map((t) => t.amount));
  const otherExpense = sum(txs.filter((t) => t.kind === 'other_expense').map((t) => t.amount));

  // Табыс салығы тек жабылған толық айлар үшін (бухгалтер есептеген, demo мән)
  let tax: MetricInfo;
  if (s.branchId !== null) {
    tax = { value: null, status: 'incomplete', reasons: ['Табыс салығы компания деңгейінде есептеледі, филиалға бөлінбейді'] };
  } else if (!full) {
    tax = { value: null, status: 'incomplete', reasons: ['Салық тек толық ай жабылғанда есептеледі'] };
  } else if (!allClosed) {
    tax = { value: null, status: 'incomplete', reasons: [`Ай жабылмаған (${openMonths.join(', ')}) — табыс салығы әлі есептелмеген`] };
  } else {
    const vals = full.map((m) => db.periodCloses.find((p) => p.tenantId === s.tenantId && p.period === m)?.incomeTaxAccrual ?? null);
    if (vals.some((v) => v === null)) tax = { value: null, status: 'incomplete', reasons: ['Жабылған айда салық сомасы енгізілмеген'] };
    else tax = { value: sum(vals as Money[]), status: 'final', reasons: [] };
  }

  const op: MetricInfo = { value: sales.length === 0 ? null : gpValue - opex, status: sales.length === 0 ? 'no_data' : opStatus, reasons: sales.length === 0 ? ['Сатылым дерегі жоқ'] : opReasons };
  let net: MetricInfo;
  if (op.status === 'incomplete' || op.status === 'no_data' || tax.value === null) {
    net = {
      value: null,
      status: 'incomplete',
      reasons: [...(op.status === 'incomplete' ? opReasons : []), ...tax.reasons],
    };
  } else {
    net = { value: (op.value as Money) + otherIncome - otherExpense - tax.value, status: 'final', reasons: [] };
  }

  return {
    grossSales,
    returns,
    netSales,
    cogs,
    missingCost: { count: missing.length, salesAmount: sum(missing.map((t) => t.amount)), txIds: missing.map((t) => t.id) },
    grossProfit: { value: sales.length ? gpValue : null, status: gpStatus, reasons: gpReasons },
    grossMarginBp: sales.length ? ratioBp(gpValue, knownNet) : null,
    opexByCategory: [...cats.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount),
    opex,
    missingExpected,
    unclassified,
    operatingProfit: op,
    otherIncome,
    otherExpense,
    incomeTax: tax,
    netProfit: net,
    allMonthsClosed: allClosed,
    openMonths,
    partialPeriod: !full,
    txIds: {
      sales: sales.map((t) => t.id),
      returns: rets.map((t) => t.id),
      opex: exp.map((t) => t.id),
      other: txs.filter((t) => t.kind === 'other_income' || t.kind === 'other_expense').map((t) => t.id),
    },
  };
}

// ───────── Қарыздар (FIFO) ─────────

export interface DebtItem {
  counterpartyId: ID;
  ref: string; // tx id немесе 'opening'
  date: ISODate;
  dueDate: ISODate;
  original: Money;
  outstanding: Money;
}

export interface DebtSummary {
  counterpartyId: ID;
  name: string;
  outstanding: Money;
  overdue: Money;
  maxDaysOverdue: number;
  items: DebtItem[];
  buckets: { current: Money; d1_30: Money; d31_60: Money; d60p: Money };
  responsibleUserId: ID | null;
  nextAction: string;
}

function allocateFifo(items: DebtItem[], payments: Money): void {
  let rest = payments;
  for (const it of items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))) {
    if (rest <= 0) break;
    const p = Math.min(rest, it.outstanding);
    it.outstanding -= p;
    rest -= p;
  }
}

export function debts(db: Db, tenantId: ID, kind: 'customer' | 'supplier', asOf: ISODate, branchId: ID | null = null): DebtSummary[] {
  const cps = db.counterparties.filter((c) => c.tenantId === tenantId && c.kind === kind);
  const out: DebtSummary[] = [];
  for (const c of cps) {
    const items: DebtItem[] = [];
    if (c.openingBalance > 0 && branchId === null)
      items.push({ counterpartyId: c.id, ref: 'opening', date: DATA_START, dueDate: c.openingDueDate, original: c.openingBalance, outstanding: c.openingBalance });
    let paid = 0;
    for (const t of db.transactions) {
      if (t.tenantId !== tenantId || t.counterpartyId !== c.id || t.date > asOf) continue;
      if (branchId !== null && t.branchId !== branchId) continue;
      const isDoc = kind === 'customer' ? t.kind === 'sale' : t.kind === 'purchase';
      const isPay = kind === 'customer' ? t.kind === 'customer_payment' : t.kind === 'supplier_payment';
      if (isDoc && t.settlement === 'credit')
        items.push({ counterpartyId: c.id, ref: t.id, date: t.date, dueDate: t.dueDate ?? t.date, original: t.amount, outstanding: t.amount });
      else if (isPay) paid += t.amount;
      else if (kind === 'customer' && t.kind === 'sale_return' && t.settlement === 'credit') paid += t.amount;
    }
    allocateFifo(items, paid);
    const open = items.filter((i) => i.outstanding > 0);
    const b = { current: 0, d1_30: 0, d31_60: 0, d60p: 0 };
    let overdue = 0;
    let maxDays = 0;
    for (const i of open) {
      const d = diffDays(asOf, i.dueDate);
      if (d <= 0) b.current += i.outstanding;
      else {
        overdue += i.outstanding;
        maxDays = Math.max(maxDays, d);
        if (d <= 30) b.d1_30 += i.outstanding;
        else if (d <= 60) b.d31_60 += i.outstanding;
        else b.d60p += i.outstanding;
      }
    }
    const outstanding = sum(open.map((i) => i.outstanding));
    if (outstanding === 0 && kind === 'supplier' && items.length === 0) continue;
    out.push({
      counterpartyId: c.id,
      name: c.name,
      outstanding,
      overdue,
      maxDaysOverdue: maxDays,
      items: open,
      buckets: b,
      responsibleUserId: c.responsibleUserId,
      nextAction: c.nextAction,
    });
  }
  return out.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
}

// ───────── Қойма ─────────

export function inventoryAt(db: Db, tenantId: ID, branchId: ID | null, asOf: ISODate): { value: Money; missingCostSales: number } {
  const brs = db.branches.filter((b) => b.tenantId === tenantId && (branchId === null || b.id === branchId));
  let v = sum(brs.map((b) => b.openingInventory));
  let missing = 0;
  const ids = new Set(brs.map((b) => b.id));
  for (const t of db.transactions) {
    if (t.tenantId !== tenantId || !ids.has(t.branchId) || t.date > asOf) continue;
    if (t.kind === 'purchase') v += t.amount;
    else if (t.kind === 'sale') {
      if (t.cost === null || t.cost === undefined) missing++;
      else v -= t.cost;
    } else if (t.kind === 'sale_return') v += t.cost ?? 0;
  }
  return { value: v, missingCostSales: missing };
}

// ───────── Төлем күнтізбесі ─────────

export interface CalendarEntry {
  date: ISODate;
  direction: 'in' | 'out';
  amount: Money;
  label: string;
  basis: 'contract' | 'forecast' | 'overdue';
  counterpartyId?: ID | null;
}

export interface CalendarDay {
  date: ISODate;
  inflow: Money;
  outflow: Money;
  projectedBalance: Money;
  entries: CalendarEntry[];
  shortage: boolean;
}

export function paymentCalendar(db: Db, tenantId: ID, asOf: ISODate, days = 30) {
  const ids = scopeAccounts(db, tenantId, null).map((a) => a.id);
  const actual = balanceAt(db, ids, asOf);
  const start = addDays(asOf, 1);
  const end = addDays(asOf, days);
  const entries: CalendarEntry[] = [];

  for (const d of debts(db, tenantId, 'supplier', asOf)) {
    for (const i of d.items) {
      const overdue = i.dueDate <= asOf;
      entries.push({ date: overdue ? start : i.dueDate, direction: 'out', amount: i.outstanding, label: `${d.name}: жеткізушіге төлем`, basis: overdue ? 'overdue' : 'contract', counterpartyId: d.counterpartyId });
    }
  }
  for (const d of debts(db, tenantId, 'customer', asOf)) {
    for (const i of d.items) {
      if (i.dueDate <= asOf) continue; // мерзімі өткен түсім болжамға кірмейді — уақыты белгісіз
      entries.push({ date: i.dueDate, direction: 'in', amount: i.outstanding, label: `${d.name}: күтілетін түсім (шарт мерзімі)`, basis: 'contract', counterpartyId: d.counterpartyId });
    }
  }
  // Тұрақты шығындар болжамы — соңғы толық айдағы күн мен сома бойынша
  const lastMonthStart = monthStart(addDays(monthStart(asOf.slice(0, 7)), -1).slice(0, 7));
  const lastMonthEnd = monthEnd(lastMonthStart.slice(0, 7));
  const recurring = db.transactions.filter(
    (t) => t.tenantId === tenantId && t.date >= lastMonthStart && t.date <= lastMonthEnd && (t.kind === 'expense' || t.kind === 'tax_payment' || t.kind === 'owner_withdrawal'),
  );
  for (const t of recurring) {
    const day = t.date.slice(8, 10);
    for (const m of monthsBetween(start, end)) {
      const dt = `${m}-${day}` <= monthEnd(m) ? `${m}-${day}` : monthEnd(m);
      if (dt < start || dt > end) continue;
      const already = db.transactions.some((x) => x.tenantId === tenantId && x.kind === t.kind && x.category === t.category && x.branchId === t.branchId && x.date.startsWith(m) && x.date <= asOf);
      if (already) continue;
      entries.push({ date: dt, direction: 'out', amount: t.amount, label: `${t.description} (өткен ай негізінде)`, basis: 'forecast' });
    }
  }
  // Күнделікті ақшалай сатылым болжамы: соңғы 28 күннің орташасы
  const from28 = addDays(asOf, -27);
  const cashSales = db.transactions.filter((t) => t.tenantId === tenantId && t.kind === 'sale' && t.settlement !== 'credit' && t.date >= from28 && t.date <= asOf);
  const avgDaily = Math.floor(sum(cashSales.map((t) => t.amount)) / 28);
  // Ақшалай сатып алу (тауарды толықтыру) болжамы
  const cashPurch = db.transactions.filter((t) => t.tenantId === tenantId && t.kind === 'purchase' && t.settlement !== 'credit' && t.date >= from28 && t.date <= asOf);
  const avgPurch = Math.floor(sum(cashPurch.map((t) => t.amount)) / 28);

  const daysOut: CalendarDay[] = [];
  let bal = actual;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const es = entries.filter((e) => e.date === d);
    if (avgDaily > 0) es.push({ date: d, direction: 'in', amount: avgDaily, label: 'Ақшалай/картамен сатылым (28 күн орташасы)', basis: 'forecast' });
    if (avgPurch > 0) es.push({ date: d, direction: 'out', amount: avgPurch, label: 'Тауарды ақшалай толықтыру (28 күн орташасы)', basis: 'forecast' });
    const inflow = sum(es.filter((e) => e.direction === 'in').map((e) => e.amount));
    const outflow = sum(es.filter((e) => e.direction === 'out').map((e) => e.amount));
    bal = bal + inflow - outflow;
    daysOut.push({ date: d, inflow, outflow, projectedBalance: bal, entries: es, shortage: bal < 0 });
  }
  return { asOf, actualBalance: actual, days: daysOut, firstShortage: daysOut.find((d) => d.shortage)?.date ?? null, minBalance: Math.min(...daysOut.map((d) => d.projectedBalance)) };
}

// ───────── Филиалдар ─────────

export function branchComparison(db: Db, tenantId: ID, from: ISODate, to: ISODate) {
  return db.branches
    .filter((b) => b.tenantId === tenantId)
    .map((b) => {
      const p = pnl(db, { tenantId, branchId: b.id, from, to });
      const inv = inventoryAt(db, tenantId, b.id, to);
      return { branch: b, netSales: p.netSales, grossProfit: p.grossProfit, marginBp: p.grossMarginBp, opex: p.opex, operatingProfit: p.operatingProfit, inventory: inv.value };
    });
}

// ───────── Иесінің операциялары ─────────

export function ownerOps(db: Db, s: Scope) {
  const txs = scopeTx(db, s, ['owner_contribution', 'owner_withdrawal', 'owner_personal_expense']);
  return {
    contributions: sum(txs.filter((t) => t.kind === 'owner_contribution').map((t) => t.amount)),
    withdrawals: sum(txs.filter((t) => t.kind === 'owner_withdrawal').map((t) => t.amount)),
    personal: sum(txs.filter((t) => t.kind === 'owner_personal_expense').map((t) => t.amount)),
    txs,
  };
}

// ───────── Жоспар / нақты ─────────

export function planVsFact(db: Db, s: Scope) {
  const full = fullMonths(monthStart(s.from.slice(0, 7)), monthEnd(s.to.slice(0, 7))) ?? [];
  const plans = db.plans.filter((p) => p.tenantId === s.tenantId && (s.branchId === null || p.branchId === s.branchId) && full.includes(p.month));
  if (!plans.length) return null;
  // Кезең толық ай болмаса жоспар күнге пропорционал бөлінеді
  const totalDays = diffDays(monthEnd(s.to.slice(0, 7)), monthStart(s.from.slice(0, 7))) + 1;
  const days = diffDays(s.to, s.from) + 1;
  const k = (v: Money) => Math.round((v * days) / totalDays);
  const p = pnl(db, s);
  return {
    prorated: days !== totalDays,
    sales: { plan: k(sum(plans.map((x) => x.sales))), fact: p.netSales },
    grossProfit: { plan: k(sum(plans.map((x) => x.grossProfit))), fact: p.grossProfit.value },
    opex: { plan: k(sum(plans.map((x) => x.opex))), fact: p.opex },
  };
}

// ───────── Пайда мен ақша көпірі ─────────

export function profitToCashBridge(db: Db, s: Scope) {
  const p = pnl(db, s);
  const prev = addDays(s.from, -1);
  const arDelta = sum(debts(db, s.tenantId, 'customer', s.to).map((d) => d.outstanding)) - sum(debts(db, s.tenantId, 'customer', prev).map((d) => d.outstanding));
  const apDelta = sum(debts(db, s.tenantId, 'supplier', s.to).map((d) => d.outstanding)) - sum(debts(db, s.tenantId, 'supplier', prev).map((d) => d.outstanding));
  const invDelta = inventoryAt(db, s.tenantId, null, s.to).value - inventoryAt(db, s.tenantId, null, prev).value;
  const cf = cashFlow(db, { ...s, branchId: null });
  const own = ownerOps(db, { ...s, branchId: null });
  const taxPaid = sum(scopeTx(db, { ...s, branchId: null }, ['tax_payment']).map((t) => t.amount));
  return {
    operatingProfit: p.operatingProfit,
    arDelta,
    apDelta,
    invDelta,
    ownerNet: own.contributions - own.withdrawals - own.personal,
    taxPaid,
    cashDelta: cf.closing - cf.opening,
  };
}

// ───────── Деректің жаңалығы ─────────

export function dataFreshness(db: Db, tenantId: ID, nowIso: string) {
  const c = db.connections.find((x) => x.tenantId === tenantId);
  if (!c || !c.lastSuccessAt) return { status: 'none' as const, lastSuccessAt: null, hours: null, connection: c ?? null };
  const h = hoursBetween(c.lastSuccessAt, nowIso);
  return { status: h > db.settings.staleAfterHours ? ('stale' as const) : ('fresh' as const), lastSuccessAt: c.lastSuccessAt, hours: Math.round(h), connection: c };
}
