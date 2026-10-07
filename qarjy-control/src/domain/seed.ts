/**
 * DEMO деректер. Барлық компания, адам және сан — ойдан құрастырылған.
 * Нақты компанияның (оның ішінде ALTOR) есебі ЕМЕС.
 * Детерминирленген генератор: әр жүктеуде бірдей нәтиже.
 */
import type {
  Db, Transaction, SourceDocument, Task, Complexity, TaskStatus, ID, ISODate, Finding, ChecklistItem, MonthPlan, TxKind, ExpenseCategory, Settlement,
} from './types';
import { tenge, mulDiv, type Money } from './money';
import { addDays, eachDay, weekday, monthEnd, monthsBetween, DEMO_NOW, DEMO_TODAY, DATA_START } from './periods';
import { RULES, runChecks } from './checks';
import { pnl } from './finance';
import { transitionFinding } from './workflow';

export const DB_VERSION = 3;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'done' | 'by' | 'at' | 'note'>[] = [
  { id: 'bank', label: 'Банк салыстырылды ма?', required: true },
  { id: 'cash', label: 'Касса тексерілді ме?', required: true },
  { id: 'sales', label: 'Сатылым мен қайтарымдар толық па?', required: true },
  { id: 'stock', label: 'Тауар қозғалысы тексерілді ме?', required: true },
  { id: 'expenses', label: 'Шығындар енгізілді ме?', required: true },
  { id: 'debts', label: 'Қарыздар салыстырылды ма?', required: true },
  { id: 'accruals', label: 'Қажетті есептеулер жүргізілді ме?', required: true },
  { id: 'diffs', label: 'Шешілмеген айырмалар жоқ па?', required: true },
];

export function emptyDb(): Db {
  return {
    version: DB_VERSION,
    settings: { platformName: 'Qarjy Control', lang: 'kk', complexityWeights: { simple: 1, standard: 2, complex: 4 }, staleAfterHours: 24, density: 'comfortable' },
    tenants: [], legalEntities: [], branches: [], users: [], memberships: [], connections: [], syncRuns: [], documents: [], accounts: [], counterparties: [],
    transactions: [], stock: [], cashCounts: [], bankBalances: [], plans: [], rules: RULES, findings: [], tasks: [], taskEvents: [], reviews: [], workLogs: [],
    periodCloses: [], agreements: [], subscriptions: [], audit: [], mockSourceQueue: [], seq: 1, clockBaseMs: Date.now(),
  };
}

export function buildSeed(): Db {
  const db = emptyDb();
  const id = (p: string) => `${p}_${(db.seq++).toString(36)}`;
  const T = (d: ISODate, hh = '09:00') => `${d}T${hh}:00+05:00`;

  // ───── Пайдаланушылар ─────
  db.users.push(
    { id: 'u_owner1', name: 'Ерлан Сапаров', title: 'Кәсіп иесі · Құрылыс Әлемі', email: 'owner1@demo.kz', mfaEnabled: true, active: true },
    { id: 'u_mgr1', name: 'Динара Қасымова', title: 'Клиент менеджері · Құрылыс Әлемі', email: 'manager1@demo.kz', mfaEnabled: false, active: true },
    { id: 'u_owner2', name: 'Асқар Төлеуов', title: 'Кәсіп иесі · Кеңсе Плюс', email: 'owner2@demo.kz', mfaEnabled: false, active: true },
    { id: 'u_owner3', name: 'Жанар Бекова', title: 'Кәсіп иесі · Береке дүкені', email: 'owner3@demo.kz', mfaEnabled: false, active: true },
    { id: 'u_acc1', name: 'Айгерім Нұрланова', title: 'Бухгалтер', email: 'acc1@service.demo', mfaEnabled: true, active: true, capacityUnitsPerMonth: 24 },
    { id: 'u_acc2', name: 'Дәурен Мұратов', title: 'Бухгалтер', email: 'acc2@service.demo', mfaEnabled: true, active: true, capacityUnitsPerMonth: 24 },
    { id: 'u_acc3', name: 'Мадина Жұмабаева', title: 'Бухгалтер', email: 'acc3@service.demo', mfaEnabled: true, active: true, capacityUnitsPerMonth: 24 },
    { id: 'u_acc4', name: 'Нұрлан Ермеков', title: 'Бухгалтер', email: 'acc4@service.demo', mfaEnabled: false, active: true, capacityUnitsPerMonth: 24 },
    { id: 'u_chief', name: 'Гүлнар Әбенова', title: 'Бас бухгалтер / сапа бақылаушы', email: 'chief@service.demo', mfaEnabled: true, active: true },
    { id: 'u_lead', name: 'Бауыржан Кенжебаев', title: 'Қызмет жетекшісі', email: 'lead@service.demo', mfaEnabled: true, active: true },
    { id: 'u_int', name: 'Тимур Омаров', title: 'Интегратор', email: 'integrator@service.demo', mfaEnabled: true, active: true },
    { id: 'u_admin', name: 'Платформа әкімшісі', title: 'Платформа әкімшісі', email: 'admin@service.demo', mfaEnabled: true, active: true },
  );

  // ───── Компаниялар ─────
  db.tenants.push(
    { id: 't1', name: 'Құрылыс Әлемі ЖШС (demo)', industry: 'retail', serviceMode: 'outsourcing', isDemo: true, status: 'active', createdAt: T('2026-06-15'), contactPerson: 'Ерлан Сапаров', contactPhone: '+7 700 000 00 01 (demo)', description: 'Құрылыс тауарлары, 3 дүкен' },
    { id: 't2', name: 'Кеңсе Плюс ЖШС (demo)', industry: 'wholesale', serviceMode: 'outsourcing', isDemo: true, status: 'active', createdAt: T('2026-06-20'), contactPerson: 'Асқар Төлеуов', contactPhone: '+7 700 000 00 02 (demo)', description: 'Кеңсе тауарларының көтерме саудасы' },
    { id: 't3', name: 'Береке дүкені ЖК (demo)', industry: 'retail', serviceMode: 'control', isDemo: true, status: 'active', createdAt: T('2026-06-25'), contactPerson: 'Жанар Бекова', contactPhone: '+7 700 000 00 03 (demo)', description: 'Азық-түлік, 1 сауда нүктесі' },
  );
  db.legalEntities.push(
    { id: 'le1', tenantId: 't1', name: 'Құрылыс Әлемі ЖШС', bin: '000000000001 (demo)', taxRegimeNote: 'Жалпы режим (demo, жергілікті маман растайды)' },
    { id: 'le2', tenantId: 't2', name: 'Кеңсе Плюс ЖШС', bin: '000000000002 (demo)', taxRegimeNote: 'Жалпы режим (demo, жергілікті маман растайды)' },
    { id: 'le3', tenantId: 't3', name: 'ЖК Бекова Ж.', bin: '000000000003 (demo)', taxRegimeNote: 'Арнаулы режим болуы мүмкін (demo, жергілікті маман растайды)' },
  );
  db.branches.push(
    { id: 'b11', tenantId: 't1', name: 'Сайран дүкені', kind: 'store', city: 'Алматы', openingInventory: tenge(45_000_000) },
    { id: 'b12', tenantId: 't1', name: 'Рысқұлов дүкені', kind: 'store', city: 'Алматы', openingInventory: tenge(35_000_000) },
    { id: 'b13', tenantId: 't1', name: 'Қонаев дүкені', kind: 'store', city: 'Қонаев', openingInventory: tenge(22_000_000) },
    { id: 'b21', tenantId: 't2', name: 'Орталық қойма', kind: 'warehouse', city: 'Алматы', openingInventory: tenge(25_000_000) },
    { id: 'b31', tenantId: 't3', name: 'Береке дүкені', kind: 'store', city: 'Шымкент', openingInventory: tenge(6_500_000) },
  );

  const m = (userId: ID, tenantId: ID | null, role: import('./types').Role, extra: Partial<import('./types').Membership> = {}) =>
    db.memberships.push({ id: id('m'), userId, tenantId, role, ...extra });
  m('u_owner1', 't1', 'owner');
  m('u_mgr1', 't1', 'client_manager', { financeAccess: false });
  m('u_owner2', 't2', 'owner');
  m('u_owner3', 't3', 'owner');
  m('u_acc1', 't1', 'accountant');
  m('u_acc1', 't2', 'accountant');
  m('u_acc2', 't1', 'accountant');
  m('u_acc3', 't2', 'accountant');
  m('u_acc4', 't3', 'accountant');
  for (const t of ['t1', 't2', 't3']) {
    m('u_chief', t, 'chief_accountant');
    m('u_lead', t, 'service_lead');
    m('u_int', t, 'integrator', { financeAccess: false });
  }
  m('u_admin', null, 'platform_admin');

  // ───── Шоттар ─────
  db.accounts.push(
    { id: 'a1_bank', tenantId: 't1', branchId: null, kind: 'bank', name: 'Негізгі банк шоты (demo)', openingBalance: tenge(18_000_000) },
    { id: 'a1_c1', tenantId: 't1', branchId: 'b11', kind: 'cash', name: 'Касса · Сайран', openingBalance: tenge(400_000) },
    { id: 'a1_c2', tenantId: 't1', branchId: 'b12', kind: 'cash', name: 'Касса · Рысқұлов', openingBalance: tenge(350_000) },
    { id: 'a1_c3', tenantId: 't1', branchId: 'b13', kind: 'cash', name: 'Касса · Қонаев', openingBalance: tenge(250_000) },
    { id: 'a2_bank', tenantId: 't2', branchId: null, kind: 'bank', name: 'Негізгі банк шоты (demo)', openingBalance: tenge(46_500_000) },
    { id: 'a2_c', tenantId: 't2', branchId: 'b21', kind: 'cash', name: 'Касса · Қойма', openingBalance: tenge(200_000) },
    { id: 'a3_bank', tenantId: 't3', branchId: null, kind: 'bank', name: 'Банк шоты (demo)', openingBalance: tenge(2_500_000) },
    { id: 'a3_c', tenantId: 't3', branchId: 'b31', kind: 'cash', name: 'Касса · Дүкен', openingBalance: tenge(150_000) },
  );

  // ───── Контрагенттер ─────
  const cp = (tenantId: ID, name: string, kind: 'customer' | 'supplier', terms: number, opening = 0, openingDue = '2026-07-10', resp: ID | null = null, next = '') => {
    const c = { id: id('cp'), tenantId, name, kind, paymentTermsDays: terms, openingBalance: tenge(opening), openingDueDate: openingDue, responsibleUserId: resp, nextAction: next };
    db.counterparties.push(c);
    return c.id;
  };
  const s11 = cp('t1', 'Цемент-Снаб ЖШС (demo)', 'supplier', 14, 6_000_000, '2026-07-08', 'u_acc1', 'Мерзімінде төлеу');
  const s12 = cp('t1', 'Гипс Импорт ЖШС (demo)', 'supplier', 14, 4_000_000, '2026-07-10', 'u_acc1', 'Мерзімінде төлеу');
  const s13 = cp('t1', 'Металл Профиль ЖШС (demo)', 'supplier', 14, 3_500_000, '2026-07-12', 'u_acc2', 'Мерзімінде төлеу');
  const landlord13 = cp('t1', 'Қонаев Сауда Орталығы ЖШС (demo)', 'supplier', 0, 0, '2026-07-01', 'u_acc2', 'Қыркүйек актісін алу');
  const ahmetov = cp('t1', 'ЖК Ахметов (demo)', 'supplier', 0, 0, '2026-07-01', 'u_acc1', 'Төлем мақсатын растау');
  const autoservice = cp('t1', 'Автосервис ЖШС (demo)', 'supplier', 0, 0, '2026-07-01', null, '');
  const c21 = cp('t2', 'Алатау Офис ЖШС (demo)', 'customer', 30, 6_000_000, '2026-07-15', 'u_acc3', 'Салыстыру актісі, төлем кестесі');
  const c22 = cp('t2', 'Дала Білім ЖШС (demo)', 'customer', 30, 2_000_000, '2026-07-20', 'u_acc3', 'Тұрақты бақылау');
  const c23 = cp('t2', 'Нұр Сервис ЖШС (demo)', 'customer', 30, 0, '2026-07-01', 'u_acc3', 'Тұрақты бақылау');
  const c24 = cp('t2', 'Сапа Логистик ЖШС (demo)', 'customer', 21, 0, '2026-07-01', 'u_acc1', 'Еске салу хаты');
  const c25 = cp('t2', 'Бөлшек сатып алушылар', 'customer', 0, 0, '2026-07-01', null, '');
  const s21 = cp('t2', 'Қағаз Трейд ЖШС (demo)', 'supplier', 10, 3_000_000, '2026-07-05', 'u_acc3', 'Мерзімінде төлеу');
  const s22 = cp('t2', 'Офис Импорт ЖШС (demo)', 'supplier', 30, 0, '2026-07-01', 'u_acc3', 'Мерзімінде төлеу');
  const s31 = cp('t3', 'Азық Дистрибуция ЖШС (demo)', 'supplier', 7, 900_000, '2026-07-05', 'u_acc4', 'Мерзімінде төлеу');

  // ───── Генерация көмекшілері ─────
  const docAuthors = ['Айгерім Н. (1С аудит)', 'Дәурен М. (1С аудит)'];
  const addDoc = (d: Omit<SourceDocument, 'id' | 'externalId' | 'source' | 'sourceAuthor'> & { sourceAuthor?: string | null; externalId?: string }): SourceDocument => {
    const doc: SourceDocument = { id: id('doc'), externalId: d.externalId ?? `1c:${d.tenantId}:${d.type}:${d.number}`, source: 'mock_1c', sourceAuthor: d.sourceAuthor ?? null, ...d };
    db.documents.push(doc);
    return doc;
  };
  let docNo = 1000;
  const addTx = (t: Omit<Transaction, 'id' | 'externalId'> & { externalId?: string }, target: Transaction[] = db.transactions): Transaction => {
    const tx: Transaction = { id: id('tx'), externalId: t.externalId ?? `1c:${t.tenantId}:${db.seq}`, ...t };
    target.push(tx);
    return tx;
  };

  // ───────────────── T1: Құрылыс Әлемі (3 дүкен) ─────────────────
  {
    const r = rng(11);
    const tid = 't1';
    const stores = [
      { b: 'b11', cash: 'a1_c1', base: 950_000, rent: 1_800_000, salary: 2_600_000, util: 180_000 },
      { b: 'b12', cash: 'a1_c2', base: 720_000, rent: 1_400_000, salary: 2_100_000, util: 150_000 },
      { b: 'b13', cash: 'a1_c3', base: 450_000, rent: 700_000, salary: 1_300_000, util: 90_000 },
    ];
    const growth: Record<string, number> = { '2026-07': 1.0, '2026-08': 1.07, '2026-09': 1.16, '2026-10': 1.18 };
    const costRatio = (b: string, mo: string) => (({ '2026-07': 0.71, '2026-08': 0.735, '2026-09': b === 'b13' ? 0.805 : 0.775, '2026-10': 0.77 }) as Record<string, number>)[mo];
    const suppliers = [s11, s12, s13];
    const cashBal: Record<string, number> = { a1_c1: tenge(400_000), a1_c2: tenge(350_000), a1_c3: tenge(250_000) };
    const lastDay = '2026-10-06';
    const purchases: Transaction[] = [];
    const weekCost: Record<string, number> = { b11: 0, b12: 0, b13: 0 };
    for (const d of eachDay(DATA_START, lastDay)) {
      const mo = d.slice(0, 7);
      const wd = weekday(d);
      for (const s of stores) {
        const f = (wd === 0 ? 0.7 : wd === 6 ? 1.2 : 1) * growth[mo] * (0.9 + r() * 0.2);
        const total = tenge(Math.round(s.base * f));
        const card = mulDiv(total, 62, 100);
        const cash = total - card;
        const doc = addDoc({ tenantId: tid, branchId: s.b, type: 'retail_receipt_z', number: `Z-${s.b}-${d.replace(/-/g, '')}`, date: d, counterpartyId: null, amount: total, posted: true, hasPrimaryFile: true, sourceAuthor: null });
        const cr = costRatio(s.b, mo);
        const cCard = tenge(Math.round((card / 100) * cr));
        const cCash = tenge(Math.round((cash / 100) * cr));
        addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'sale', amount: card, cost: cCard, settlement: 'bank', accountId: 'a1_bank', docId: doc.id, description: 'Бөлшек сатылым (карта)' });
        addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'sale', amount: cash, cost: cCash, settlement: 'cash', accountId: s.cash, docId: doc.id, description: 'Бөлшек сатылым (қолма-қол)' });
        cashBal[s.cash] += cash;
        weekCost[s.b] += cCard + cCash;
        // инкассация әр 3 күн сайын: кассада 300 000 ₸ қалады
        if (diffIndex(d) % 3 === 0 && cashBal[s.cash] > tenge(300_000)) {
          const amt = cashBal[s.cash] - tenge(300_000);
          const dd = addDoc({ tenantId: tid, branchId: s.b, type: 'transfer_order', number: `ИНК-${++docNo}`, date: d, counterpartyId: null, amount: amt, posted: true, hasPrimaryFile: true });
          addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'transfer', amount: amt, accountId: s.cash, toAccountId: 'a1_bank', docId: dd.id, description: 'Инкассация: касса → банк (ішкі аударым)' });
          cashBal[s.cash] -= amt;
        }
        // дүйсенбі — сатып алу (несиеге, 14 күн)
        if (wd === 1) {
          const amt = mulDiv(weekCost[s.b], 102, 100);
          if (amt > 0) {
            const sup = suppliers[Math.floor(r() * 3)];
            const dn = `ПН-${++docNo}`;
            const dd = addDoc({ tenantId: tid, branchId: s.b, type: 'purchase_invoice', number: dn, date: d, counterpartyId: sup, amount: amt, posted: true, hasPrimaryFile: !(d === '2026-09-14' && s.b === 'b13'), sourceAuthor: docAuthors[Math.floor(r() * 2)] });
            purchases.push(addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'purchase', amount: amt, settlement: 'credit', accountId: null, counterpartyId: sup, dueDate: addDays(d, 14), docId: dd.id, description: `Тауар сатып алу ${dn}` }));
          }
          weekCost[s.b] = 0;
        }
      }
      // ай сайынғы шығындар (банктен)
      const day = d.slice(8);
      for (const s of stores) {
        if (day === '05' && !(mo === '2026-09' && s.b === 'b13')) {
          const dd = addDoc({ tenantId: tid, branchId: s.b, type: 'service_act', number: `АКТ-ЖАЛ-${s.b}-${mo}`, date: d, counterpartyId: s.b === 'b13' ? landlord13 : null, amount: tenge(s.rent), posted: true, hasPrimaryFile: true });
          addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'expense', category: 'rent', amount: tenge(s.rent), accountId: 'a1_bank', counterpartyId: s.b === 'b13' ? landlord13 : null, docId: dd.id, description: `Жалдау · ${db.branches.find((b) => b.id === s.b)!.name}` });
        }
        if (day === '15') {
          const dd = addDoc({ tenantId: tid, branchId: s.b, type: 'service_act', number: `КОМ-${s.b}-${mo}`, date: d, counterpartyId: null, amount: tenge(s.util), posted: true, hasPrimaryFile: true });
          addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'expense', category: 'utilities', amount: tenge(s.util), accountId: 'a1_bank', docId: dd.id, description: 'Коммуналдық қызметтер' });
        }
        if (day === '28') {
          const dd = addDoc({ tenantId: tid, branchId: s.b, type: 'payroll', number: `ЖАЛ-${s.b}-${mo}`, date: d, counterpartyId: null, amount: tenge(s.salary), posted: true, hasPrimaryFile: true });
          addTx({ tenantId: tid, branchId: s.b, date: d, kind: 'expense', category: 'salary', amount: tenge(s.salary), accountId: 'a1_bank', docId: dd.id, description: 'Жалақы және онымен байланысты төлемдер' });
        }
      }
      if (day === '10') {
        const dd = addDoc({ tenantId: tid, branchId: 'b11', type: 'service_act', number: `МАРК-${mo}`, date: d, counterpartyId: null, amount: tenge(400_000), posted: true, hasPrimaryFile: true });
        addTx({ tenantId: tid, branchId: 'b11', date: d, kind: 'expense', category: 'marketing', amount: tenge(400_000), accountId: 'a1_bank', docId: dd.id, description: 'Маркетинг (барлық дүкен)' });
      }
      if (day === '25') {
        addTx({ tenantId: tid, branchId: 'b11', date: d, kind: 'tax_payment', amount: tenge(1_150_000), accountId: 'a1_bank', docId: null, description: 'Салық және міндетті төлемдер (demo сома)' });
      }
      if (day === '20') {
        addTx({ tenantId: tid, branchId: 'b11', date: d, kind: 'owner_withdrawal', amount: tenge(3_000_000), accountId: 'a1_bank', docId: null, description: 'Иесінің алымы (дивиденд аванс, demo)' });
      }
      if (day === '30' || (mo === '2026-09' && day === '30')) {
        addTx({ tenantId: tid, branchId: 'b11', date: d, kind: 'other_expense', amount: tenge(35_000), accountId: 'a1_bank', docId: null, description: 'Банк комиссиясы' });
      }
    }
    // жеткізушілерге төлем — мерзімінде
    for (const p of purchases) {
      if (p.dueDate! <= lastDay) addTx({ tenantId: tid, branchId: p.branchId, date: p.dueDate!, kind: 'supplier_payment', amount: p.amount, accountId: 'a1_bank', counterpartyId: p.counterpartyId, docId: null, description: `Жеткізушіге төлем (${p.description})` });
    }
    // бастапқы кредиторлық қарызды өтеу
    for (const sid of [s11, s12, s13]) {
      const c = db.counterparties.find((x) => x.id === sid)!;
      addTx({ tenantId: tid, branchId: 'b11', date: c.openingDueDate, kind: 'supplier_payment', amount: c.openingBalance, accountId: 'a1_bank', counterpartyId: sid, docId: null, description: 'Бастапқы қарызды өтеу' });
    }
    addTx({ tenantId: tid, branchId: 'b11', date: '2026-07-15', kind: 'owner_contribution', amount: tenge(5_000_000), accountId: 'a1_bank', docId: null, description: 'Иесінің айналым қаражатына салымы' });
    addTx({ tenantId: tid, branchId: 'b11', date: '2026-08-12', kind: 'owner_personal_expense', amount: tenge(240_000), accountId: 'a1_bank', docId: null, description: 'Иесінің жеке шығыны (бизнес картасынан, жіктелген)' });
    const dAhm = addDoc({ tenantId: tid, branchId: 'b12', type: 'bank_statement_line', number: 'ПП-4471', date: '2026-09-18', counterpartyId: ahmetov, amount: tenge(450_000), posted: true, hasPrimaryFile: false });
    addTx({ tenantId: tid, branchId: 'b12', date: '2026-09-18', kind: 'unclassified_payment', amount: tenge(450_000), accountId: 'a1_bank', counterpartyId: ahmetov, docId: dAhm.id, description: 'ЖК Ахметовке төлем — мақсаты көрсетілмеген' });
    const dAuto = addDoc({ tenantId: tid, branchId: 'b11', type: 'service_act', number: 'АКТ-7781', date: '2026-09-12', counterpartyId: autoservice, amount: tenge(380_000), posted: true, hasPrimaryFile: true });
    addTx({ tenantId: tid, branchId: 'b11', date: '2026-09-12', kind: 'expense', category: 'other', amount: tenge(380_000), accountId: 'a1_bank', counterpartyId: autoservice, docId: dAuto.id, description: 'Автосервис ЖШС — көлік жөндеу' });
    // өткізілмеген қайтарым құжаттары
    addDoc({ tenantId: tid, branchId: 'b12', type: 'sales_return', number: 'ВЗ-0927-1', date: '2026-09-27', counterpartyId: null, amount: tenge(85_000), posted: false, hasPrimaryFile: true, sourceAuthor: 'Дәурен М. (1С аудит)' });
    addDoc({ tenantId: tid, branchId: 'b12', type: 'sales_return', number: 'ВЗ-0927-2', date: '2026-09-27', counterpartyId: null, amount: tenge(42_000), posted: false, hasPrimaryFile: true, sourceAuthor: 'Дәурен М. (1С аудит)' });
    // теріс қалдық
    db.stock.push(
      { id: id('st'), tenantId: tid, branchId: 'b12', sku: 'CEM-M400-50', name: 'Цемент М400, 50 кг', qty: -35, unitCost: tenge(2_850), asOf: '2026-09-28' },
      { id: id('st'), tenantId: tid, branchId: 'b11', sku: 'GKL-12.5', name: 'Гипсокартон 12,5 мм', qty: 140, unitCost: tenge(2_400), asOf: '2026-09-30' },
    );
    // банк көшірмесі: 30.09 қалдығы — 1С-те жоқ жалдау төлемі (05.09, 700 000 ₸)
    const stDoc = addDoc({ tenantId: tid, branchId: null, type: 'bank_statement_line', number: 'ВЫП-2026-09', date: '2026-09-30', counterpartyId: null, amount: 0, posted: true, hasPrimaryFile: true, note: 'Банк көшірмесі, қыркүйек (demo)' });
    db.bankBalances.push({ id: 'bb1', tenantId: tid, accountId: 'a1_bank', date: '2026-09-30', closingBalance: 0, docId: stDoc.id });
    db.bankBalances.push({ id: 'bb1a', tenantId: tid, accountId: 'a1_bank', date: '2026-08-31', closingBalance: 0, docId: null });
  }

  // ───────────────── T2: Кеңсе Плюс (көтерме) ─────────────────
  {
    const r = rng(22);
    const tid = 't2';
    const lastDay = '2026-10-06';
    const growth: Record<string, number> = { '2026-07': 0.95, '2026-08': 1.55, '2026-09': 1.2, '2026-10': 1.0 };
    const customers = [
      { id: c21, w: 0.35, delay: 42 },
      { id: c22, w: 0.25, delay: 6 },
      { id: c23, w: 0.2, delay: 0 },
      { id: c24, w: 0.15, delay: 18 },
    ];
    const sales: { tx: Transaction; delay: number }[] = [];
    let n = 0;
    for (const d of eachDay(DATA_START, lastDay)) {
      const wd = weekday(d);
      if (wd === 0 || wd === 6) continue;
      const mo = d.slice(0, 7);
      const cnt = 1 + Math.floor(r() * 3);
      for (let i = 0; i < cnt; i++) {
        const x = r();
        let acc = 0;
        const c = customers.find((cc) => (acc += cc.w) >= x) ?? customers[3];
        const amt = tenge(Math.round((1_150_000 + r() * 900_000) * growth[mo] / 2.8));
        const num = `РН-${++n + 5000}`;
        const noCost = (d === '2026-10-02' && i === 0) || (d === '2026-10-05' && i === 0);
        const doc = addDoc({ tenantId: tid, branchId: 'b21', type: 'sales_invoice', number: num, date: d, counterpartyId: c.id, amount: amt, posted: true, hasPrimaryFile: true, sourceAuthor: 'Мадина Ж. (1С аудит)' });
        const tx = addTx({ tenantId: tid, branchId: 'b21', date: d, kind: 'sale', amount: amt, cost: noCost ? null : mulDiv(amt, 74, 100), settlement: 'credit', accountId: null, counterpartyId: c.id, dueDate: addDays(d, c.id === c24 ? 21 : 30), docId: doc.id, description: noCost ? `Жүкқұжат ${num} (жаңа SKU: А3 қағаз, өзіндік құны жоқ)` : `Жүкқұжат ${num}` });
        sales.push({ tx, delay: c.delay });
      }
      // бөлшек ақшалай сатылым
      const ra = tenge(Math.round(90_000 + r() * 60_000));
      const rd = addDoc({ tenantId: tid, branchId: 'b21', type: 'retail_receipt_z', number: `Z-${d.replace(/-/g, '')}`, date: d, counterpartyId: c25, amount: ra, posted: true, hasPrimaryFile: true });
      addTx({ tenantId: tid, branchId: 'b21', date: d, kind: 'sale', amount: ra, cost: mulDiv(ra, 70, 100), settlement: 'cash', accountId: 'a2_c', counterpartyId: c25, docId: rd.id, description: 'Бөлшек сатылым (шоурум)' });
      if (wd === 5) {
        // жұма — кассадан банкке
        addTx({ tenantId: tid, branchId: 'b21', date: d, kind: 'transfer', amount: tenge(400_000), accountId: 'a2_c', toAccountId: 'a2_bank', docId: null, description: 'Инкассация: касса → банк (ішкі аударым)' });
      }
    }
    // клиенттердің төлемдері: мерзім + кешігу
    for (const { tx, delay } of sales) {
      const pd = addDays(tx.dueDate!, delay + Math.floor(r() * 4));
      if (pd <= lastDay) addTx({ tenantId: tid, branchId: 'b21', date: pd, kind: 'customer_payment', amount: tx.amount, accountId: 'a2_bank', counterpartyId: tx.counterpartyId, docId: null, description: `Клиенттен түсім (${tx.description})` });
    }
    addTx({ tenantId: tid, branchId: 'b21', date: '2026-07-16', kind: 'customer_payment', amount: tenge(6_000_000), accountId: 'a2_bank', counterpartyId: c21, docId: null, description: 'Бастапқы қарыз бойынша түсім' });
    addTx({ tenantId: tid, branchId: 'b21', date: '2026-07-22', kind: 'customer_payment', amount: tenge(2_000_000), accountId: 'a2_bank', counterpartyId: c22, docId: null, description: 'Бастапқы қарыз бойынша түсім' });
    // сатып алу: маусым алдында қор жинау
    const purchasePlan: [ISODate, ID, number][] = [
      ['2026-07-06', s21, 7_800_000], ['2026-07-13', s22, 8_600_000], ['2026-07-20', s21, 7_400_000], ['2026-07-27', s22, 7_200_000],
      ['2026-08-03', s21, 8_500_000], ['2026-08-10', s22, 8_200_000], ['2026-08-17', s21, 6_300_000], ['2026-08-24', s22, 5_200_000],
      ['2026-09-08', s22, 1_845_000], ['2026-09-10', s22, 1_845_000], ['2026-09-14', s21, 5_400_000], ['2026-09-21', s22, 6_600_000], ['2026-09-28', s21, 4_300_000],
      ['2026-10-05', s21, 4_500_000],
    ];
    for (const [d, sup, a] of purchasePlan) {
      const num = d === '2026-09-08' ? 'ПН-0912' : d === '2026-09-10' ? 'ПН-0927' : `ПН-${++docNo}`;
      const doc = addDoc({ tenantId: tid, branchId: 'b21', type: 'purchase_invoice', number: num, date: d, counterpartyId: sup, amount: tenge(a), posted: true, hasPrimaryFile: true, sourceAuthor: 'Мадина Ж. (1С аудит)' });
      const p = addTx({ tenantId: tid, branchId: 'b21', date: d, kind: 'purchase', amount: tenge(a), settlement: 'credit', accountId: null, counterpartyId: sup, dueDate: addDays(d, sup === s22 ? 30 : 10), docId: doc.id, description: `Тауар сатып алу ${num}` });
      if (p.dueDate! <= lastDay) addTx({ tenantId: tid, branchId: 'b21', date: p.dueDate!, kind: 'supplier_payment', amount: p.amount, accountId: 'a2_bank', counterpartyId: sup, docId: null, description: `Жеткізушіге төлем (${num})` });
    }
    addTx({ tenantId: tid, branchId: 'b21', date: '2026-07-05', kind: 'supplier_payment', amount: tenge(3_000_000), accountId: 'a2_bank', counterpartyId: s21, docId: null, description: 'Бастапқы қарызды өтеу' });
    for (const mo of monthsBetween(DATA_START, lastDay)) {
      const ex: [string, ExpenseCategory, number, string][] = [
        ['05', 'rent', 1_200_000, 'Қойма жалдау'],
        ['15', 'logistics', 450_000, 'Жеткізу / логистика'],
        ['15', 'utilities', 120_000, 'Коммуналдық'],
        ['28', 'salary', 3_400_000, 'Жалақы және онымен байланысты төлемдер'],
      ];
      for (const [day, cat, a, label] of ex) {
        const d = `${mo}-${day}`;
        if (d > lastDay) continue;
        const doc = addDoc({ tenantId: tid, branchId: 'b21', type: cat === 'salary' ? 'payroll' : 'service_act', number: `${cat.toUpperCase()}-${mo}`, date: d, counterpartyId: null, amount: tenge(a), posted: true, hasPrimaryFile: true });
        addTx({ tenantId: tid, branchId: 'b21', date: d, kind: 'expense', category: cat, amount: tenge(a), accountId: 'a2_bank', docId: doc.id, description: label });
      }
      if (`${mo}-25` <= lastDay) addTx({ tenantId: tid, branchId: 'b21', date: `${mo}-25`, kind: 'tax_payment', amount: tenge(950_000), accountId: 'a2_bank', docId: null, description: 'Салық және міндетті төлемдер (demo сома)' });
      if (`${mo}-30` <= lastDay) addTx({ tenantId: tid, branchId: 'b21', date: `${mo}-30`, kind: 'other_expense', amount: tenge(28_000), accountId: 'a2_bank', docId: null, description: 'Банк комиссиясы' });
      if (`${mo}-18` <= lastDay) addTx({ tenantId: tid, branchId: 'b21', date: `${mo}-18`, kind: 'owner_withdrawal', amount: tenge(1_000_000), accountId: 'a2_bank', docId: null, description: 'Иесінің алымы (demo)' });
    }
  }

  // ───────────────── T3: Береке дүкені (1 нүкте, синхрондау кешіккен) ─────────────────
  {
    const r = rng(33);
    const tid = 't3';
    const synced = '2026-10-03';
    const lastReal = '2026-10-06';
    let cash = tenge(150_000);
    const purch: Transaction[] = [];
    let weekCost = 0;
    for (const d of eachDay(DATA_START, lastReal)) {
      const queue = d > synced;
      const target: Transaction[] = queue ? [] : db.transactions;
      const wd = weekday(d);
      const total = tenge(Math.round(420_000 * (wd === 0 || wd === 6 ? 1.25 : 1) * (0.88 + r() * 0.24)));
      const cashPart = mulDiv(total, 55, 100);
      const card = total - cashPart;
      const doc: SourceDocument = { id: id('doc'), tenantId: tid, branchId: 'b31', externalId: `1c:t3:z:${d}`, type: 'retail_receipt_z', number: `Z-${d.replace(/-/g, '')}`, date: d, counterpartyId: null, amount: total, posted: true, hasPrimaryFile: true, sourceAuthor: null, source: 'mock_1c' };
      const txs: Transaction[] = [];
      const dayDocs: SourceDocument[] = [doc];
      txs.push(addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'sale', amount: card, cost: mulDiv(card, 76, 100), settlement: 'bank', accountId: 'a3_bank', docId: doc.id, description: 'Бөлшек сатылым (карта)', externalId: `1c:t3:sale-card:${d}` }, target));
      txs.push(addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'sale', amount: cashPart, cost: mulDiv(cashPart, 76, 100), settlement: 'cash', accountId: 'a3_c', docId: doc.id, description: 'Бөлшек сатылым (қолма-қол)', externalId: `1c:t3:sale-cash:${d}` }, target));
      cash += cashPart;
      weekCost += mulDiv(total, 76, 100);
      if (wd === 2 || wd === 5) {
        const amt = mulDiv(weekCost, 101, 100);
        weekCost = 0;
        const num = `ПН-${++docNo}`;
        const pdoc: SourceDocument = { id: id('doc'), tenantId: tid, branchId: 'b31', externalId: `1c:t3:pn:${num}`, type: 'purchase_invoice', number: num, date: d, counterpartyId: s31, amount: amt, posted: true, hasPrimaryFile: true, sourceAuthor: null, source: 'mock_1c' };
        const p = addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'purchase', amount: amt, settlement: 'credit', accountId: null, counterpartyId: s31, dueDate: addDays(d, 7), docId: pdoc.id, description: `Тауар сатып алу ${num}`, externalId: `1c:t3:purchase:${num}` }, target);
        if (queue) db.mockSourceQueue.push({ tenantId: tid, transactions: [p], documents: [pdoc] });
        else {
          db.documents.push(pdoc);
          purch.push(p);
        }
      }
      if (wd === 1 && cash > tenge(250_000)) {
        const amt = cash - tenge(200_000);
        txs.push(addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'transfer', amount: amt, accountId: 'a3_c', toAccountId: 'a3_bank', docId: null, description: 'Касса → банк (ішкі аударым)', externalId: `1c:t3:tr:${d}` }, target));
        cash -= amt;
      }
      if (d.slice(8) === '14' || d.slice(8) === '29') {
        txs.push(addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'owner_withdrawal', amount: tenge(400_000), accountId: 'a3_bank', docId: null, description: 'Иесінің алымы', externalId: `1c:t3:ow:${d}` }, target));
      }
      const day = d.slice(8);
      const mo = d.slice(0, 7);
      const ex: [string, ExpenseCategory, number, string][] = [['05', 'rent', 450_000, 'Дүкен жалдау'], ['28', 'salary', 1_100_000, 'Жалақы'], ['15', 'utilities', 60_000, 'Коммуналдық']];
      for (const [dd, cat, a, label] of ex) {
        if (day !== dd) continue;
        const edoc: SourceDocument = { id: id('doc'), tenantId: tid, branchId: 'b31', externalId: `1c:t3:${cat}:${mo}`, type: cat === 'salary' ? 'payroll' : 'service_act', number: `${cat.toUpperCase()}-${mo}`, date: d, counterpartyId: null, amount: tenge(a), posted: true, hasPrimaryFile: true, sourceAuthor: null, source: 'mock_1c' };
        dayDocs.push(edoc);
        txs.push(addTx({ tenantId: tid, branchId: 'b31', date: d, kind: 'expense', category: cat, amount: tenge(a), accountId: 'a3_bank', docId: edoc.id, description: label, externalId: `1c:t3:exp:${cat}:${mo}` }, target));
      }
      if (queue) db.mockSourceQueue.push({ tenantId: tid, transactions: txs, documents: dayDocs });
      else db.documents.push(...dayDocs);
    }
    for (const p of purch) {
      if (p.dueDate! <= synced) addTx({ tenantId: tid, branchId: 'b31', date: p.dueDate!, kind: 'supplier_payment', amount: p.amount, accountId: 'a3_bank', counterpartyId: s31, docId: null, description: `Жеткізушіге төлем (${p.description})`, externalId: `1c:t3:sp:${p.id}` });
    }
    addTx({ tenantId: tid, branchId: 'b31', date: '2026-07-05', kind: 'supplier_payment', amount: tenge(900_000), accountId: 'a3_bank', counterpartyId: s31, docId: null, description: 'Бастапқы қарызды өтеу' });
    addTx({ tenantId: tid, branchId: 'b31', date: '2026-07-02', kind: 'owner_contribution', amount: tenge(1_000_000), accountId: 'a3_bank', docId: null, description: 'Иесінің салымы (айналым қаражаты)' });
    const ccDoc = addDoc({ tenantId: tid, branchId: 'b31', type: 'inventory_count', number: 'ИНВ-КАССА-0930', date: '2026-09-30', counterpartyId: null, amount: 0, posted: true, hasPrimaryFile: true, note: 'Касса санағы актісі' });
    db.cashCounts.push({ id: 'cc1', tenantId: tid, branchId: 'b31', accountId: 'a3_c', date: '2026-09-30', counted: 0, countedBy: 'Кассир (demo)', docId: ccDoc.id });
  }

  // Банк көшірмесі мен касса санағы мәндерін есептік қалдыққа байланыстыру (сценарий бойынша айырма)
  const bal = (acc: ID, d: ISODate) => {
    let b = db.accounts.find((a) => a.id === acc)!.openingBalance;
    for (const t of db.transactions) {
      if (t.date > d) continue;
      if (t.kind === 'transfer') {
        if (t.accountId === acc) b -= t.amount;
        if (t.toAccountId === acc) b += t.amount;
        continue;
      }
      if (t.accountId !== acc) continue;
      const inK: TxKind[] = ['customer_payment', 'other_income', 'owner_contribution'];
      if (t.kind === 'sale') b += t.settlement === 'credit' ? 0 : t.amount;
      else if (t.kind === 'sale_return' || t.kind === 'purchase') b -= t.settlement === 'credit' ? 0 : t.amount;
      else if (inK.includes(t.kind)) b += t.amount;
      else b -= t.amount;
    }
    return b;
  };
  db.bankBalances.find((b) => b.id === 'bb1')!.closingBalance = bal('a1_bank', '2026-09-30') - tenge(700_000);
  db.bankBalances.find((b) => b.id === 'bb1a')!.closingBalance = bal('a1_bank', '2026-08-31');
  db.cashCounts.find((c) => c.id === 'cc1')!.counted = bal('a3_c', '2026-09-30') - tenge(85_000);

  // ───── Жоспарлар ─────
  const planFor = (tenantId: ID, branchId: ID, sales: number, marginPct: number, opex: number) => {
    for (const mo of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      const k = mo === '2026-07' ? 1 : mo === '2026-08' ? 1.05 : mo === '2026-09' ? 1.1 : 1.12;
      const p: MonthPlan = { tenantId, branchId, month: mo, sales: tenge(Math.round(sales * k)), grossProfit: tenge(Math.round(sales * k * marginPct)), opex: tenge(opex) };
      db.plans.push(p);
    }
  };
  planFor('t1', 'b11', 27_500_000, 0.28, 5_000_000);
  planFor('t1', 'b12', 20_500_000, 0.28, 3_650_000);
  planFor('t1', 'b13', 13_000_000, 0.27, 2_090_000);
  planFor('t2', 'b21', 30_000_000, 0.26, 5_170_000);
  planFor('t3', 'b31', 13_000_000, 0.24, 1_610_000);

  // ───── Интеграциялар ─────
  const mapping = { 'Документ.РеализацияТоваровУслуг': 'Transaction(sale)', 'Документ.ПоступлениеТоваровУслуг': 'Transaction(purchase)', 'Документ.ПлатежноеПоручениеИсходящее': 'Transaction(payment_out)', 'Справочник.Контрагенты': 'Counterparty', 'Справочник.Склады': 'Branch' };
  db.connections.push(
    { id: 'ic1', tenantId: 't1', configuration: '1С:Управление торговлей для Казахстана (demo)', version: '3.x (demo)', hosting: 'on_premise', method: 'mock', mode: 'read_only', adapter: 'MockConnector · UT-KZ адаптер үлгісі', isMock: true, status: 'ok', lastSuccessAt: '2026-10-07T08:55:00+05:00', lastAttemptAt: '2026-10-07T08:55:00+05:00', fieldMapping: mapping, hasSourceAuditInfo: true, licenseNote: '1С лицензиясы клиенттікі (жеке шарт)' },
    { id: 'ic2', tenantId: 't2', configuration: '1С:Бухгалтерия для Казахстана (demo)', version: '3.0 (demo)', hosting: 'cloud_vps', method: 'mock', mode: 'read_only', adapter: 'MockConnector · BP-KZ адаптер үлгісі', isMock: true, status: 'ok', lastSuccessAt: '2026-10-07T09:10:00+05:00', lastAttemptAt: '2026-10-07T09:10:00+05:00', fieldMapping: mapping, hasSourceAuditInfo: true, licenseNote: '1С лицензиясы клиенттікі (жеке шарт)' },
    { id: 'ic3', tenantId: 't3', configuration: '1С:Розница (demo)', version: '2.x (demo)', hosting: 'on_premise', method: 'mock', mode: 'read_only', adapter: 'MockConnector · Розница адаптер үлгісі', isMock: true, status: 'delayed', lastSuccessAt: '2026-10-03T18:40:00+05:00', lastAttemptAt: '2026-10-07T09:00:00+05:00', fieldMapping: mapping, hasSourceAuditInfo: false, licenseNote: '1С лицензиясы клиенттікі (жеке шарт)' },
  );
  const sr = (tenantId: ID, connectionId: ID, kind: import('./types').SyncRun['kind'], at: string, status: import('./types').SyncRun['status'], received: number, created: number, dup: number, error?: string, attempt = 1) =>
    db.syncRuns.push({ id: id('sync'), tenantId, connectionId, kind, startedAt: at, finishedAt: at, status, attempt, received, created, updated: 0, duplicatesSkipped: dup, error });
  sr('t1', 'ic1', 'initial', '2026-06-28T10:00:00+05:00', 'success', 1820, 1820, 0);
  sr('t1', 'ic1', 'incremental', '2026-10-06T08:50:00+05:00', 'success', 24, 22, 2);
  sr('t1', 'ic1', 'incremental', '2026-10-07T08:55:00+05:00', 'success', 21, 21, 0);
  sr('t2', 'ic2', 'initial', '2026-06-30T11:00:00+05:00', 'success', 640, 640, 0);
  sr('t2', 'ic2', 'incremental', '2026-10-07T09:10:00+05:00', 'success', 9, 9, 0);
  sr('t3', 'ic3', 'initial', '2026-07-01T12:00:00+05:00', 'success', 410, 410, 0);
  sr('t3', 'ic3', 'incremental', '2026-10-03T18:40:00+05:00', 'success', 6, 6, 0);
  sr('t3', 'ic3', 'incremental', '2026-10-04T09:00:00+05:00', 'failed', 0, 0, 0, '1С серверіне қосылу уақыты бітті (timeout 30 с) — Mock', 1);
  sr('t3', 'ic3', 'incremental', '2026-10-04T09:05:00+05:00', 'failed', 0, 0, 0, '1С серверіне қосылу уақыты бітті (timeout 30 с) — Mock', 2);
  sr('t3', 'ic3', 'incremental', '2026-10-07T09:00:00+05:00', 'failed', 0, 0, 0, 'HTTP-сервис жауап бермеді: клиент серверi өшірулі болуы мүмкін — Mock', 1);

  // ───── Кезең жабу ─────
  const close = (tenantId: ID, period: string, status: 'open' | 'in_progress' | 'closed', closedAt: string | null, doneIds: string[]) => {
    const p = pnl(db, { tenantId, branchId: null, from: `${period}-01`, to: monthEnd(period) });
    const op = p.operatingProfit.value ?? 0;
    db.periodCloses.push({
      id: id('pc'), tenantId, period, status,
      checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c, done: status === 'closed' || doneIds.includes(c.id), by: status === 'closed' || doneIds.includes(c.id) ? 'u_chief' : null, at: status === 'closed' || doneIds.includes(c.id) ? closedAt ?? T('2026-10-03') : null, note: '' })),
      incomeTaxAccrual: status === 'closed' ? Math.max(0, mulDiv(op + p.otherIncome - p.otherExpense, 20, 100)) : null,
      closedBy: status === 'closed' ? 'u_chief' : null, closedAt, approvedBy: status === 'closed' ? 'u_chief' : null,
    });
  };
  close('t1', '2026-07', 'closed', T('2026-08-07', '17:00'), []);
  close('t1', '2026-08', 'closed', T('2026-09-08', '16:30'), []);
  close('t1', '2026-09', 'in_progress', null, ['cash', 'sales', 'debts']);
  close('t1', '2026-10', 'open', null, []);
  close('t2', '2026-07', 'closed', T('2026-08-05', '15:00'), []);
  close('t2', '2026-08', 'closed', T('2026-09-05', '18:00'), []);
  close('t2', '2026-09', 'closed', T('2026-10-06', '17:20'), []);
  close('t2', '2026-10', 'open', null, []);
  close('t3', '2026-07', 'closed', T('2026-08-06', '12:00'), []);
  close('t3', '2026-08', 'closed', T('2026-09-06', '12:00'), []);
  close('t3', '2026-09', 'in_progress', null, ['bank', 'sales', 'expenses', 'debts']);
  close('t3', '2026-10', 'open', null, []);

  // ───── Қызмет келісімдері ─────
  const baseIncluded = ['Бастапқы құжаттарды 1С-те өңдеу', 'Банк пен кассаны салыстыру', 'Сатылым мен тауар қозғалысын тексеру', 'Ай жабу', 'Басқарушылық есеп (айлық)'];
  db.agreements.push(
    { id: 'sa1', tenantId: 't1', tariff: 'partner', mode: 'outsourcing', monthlyFee: tenge(650_000), includedUnitsPerMonth: 60, includedWorks: [...baseIncluded, 'Апталық қаржы шолуы', 'Төлем күнтізбесін жүргізу'], excludedWorks: ['Өткен кезеңдерді қалпына келтіру', 'Салық тексеруін сүйемелдеу', 'Кадрлық іс жүргізу'], clientDocuments: [{ name: 'Жалдау және қызмет актілері', deadline: 'Келесі айдың 3-күніне дейін' }, { name: 'Банк көшірмесі (егер интеграция болмаса)', deadline: 'Апта сайын, дүйсенбі' }, { name: 'Инвентаризация актілері', deadline: 'Ай соңы' }], clientDuties: ['Бастапқы құжаттарды уақтылы беру', 'Сұрақтарға 2 жұмыс күні ішінде жауап беру'], ourDuties: ['Ай жабу — келесі айдың 7-күніне дейін (demo SLA)', 'Мәселелерді жауаптысымен және мерзімімен көрсету'], responsibleAccountantId: 'u_acc1', reviewerId: 'u_chief', serviceLeadId: 'u_lead', slaResponseHours: 8, startDate: '2026-07-01', restoration: { needed: true, estimateHours: 40, fee: tenge(400_000), status: 'done' }, directCosts: { hourlyLaborCost: tenge(4_500), integrationAndAi: tenge(35_000), other: tenge(15_000) }, extraWorkProposals: [] },
    { id: 'sa2', tenantId: 't2', tariff: 'accounting', mode: 'outsourcing', monthlyFee: tenge(380_000), includedUnitsPerMonth: 40, includedWorks: baseIncluded, excludedWorks: ['Өткен кезеңдерді қалпына келтіру', 'Дебиторлық қарызды өндіру (заңгерлік)', 'Кадрлық іс жүргізу'], clientDocuments: [{ name: 'Клиенттермен салыстыру актілері', deadline: 'Тоқсан сайын' }, { name: 'Жеткізушілердің жүкқұжаттары', deadline: 'Келесі айдың 3-күніне дейін' }], clientDuties: ['Құжаттарды уақтылы беру'], ourDuties: ['Ай жабу — келесі айдың 7-күніне дейін (demo SLA)'], responsibleAccountantId: 'u_acc3', reviewerId: 'u_chief', serviceLeadId: 'u_lead', slaResponseHours: 12, startDate: '2026-07-01', restoration: { needed: false, estimateHours: null, fee: null, status: 'not_needed' }, directCosts: { hourlyLaborCost: tenge(4_500), integrationAndAi: tenge(25_000), other: tenge(10_000) }, extraWorkProposals: [{ id: 'xp1', period: '2026-09', units: 9, amount: null, status: 'draft', note: 'Қыркүйекте лимиттен тыс: 4 салыстыру актісі, қайталанған құжатты тергеу. Сома — жеке есептеледі.' }] },
    { id: 'sa3', tenantId: 't3', tariff: 'control', mode: 'control', monthlyFee: null, includedUnitsPerMonth: 15, includedWorks: ['Клиент бухгалтерінің жұмысын бақылау', 'Тексерулер орталығы', 'Ай жабу чек-листін тексеру'], excludedWorks: ['Бастапқы құжаттарды өңдеу', 'Жалақы есептеу'], clientDocuments: [{ name: 'Касса санағы актісі', deadline: 'Ай соңы' }], clientDuties: ['1С-тегі бастапқы есепті клиенттің өз бухгалтері жүргізеді', '1С серверінің қолжетімділігі'], ourDuties: ['Апта сайын тексеру нәтижесін беру'], responsibleAccountantId: 'u_acc4', reviewerId: 'u_chief', serviceLeadId: 'u_lead', slaResponseHours: 24, startDate: '2026-07-01', restoration: null, directCosts: { hourlyLaborCost: tenge(4_500), integrationAndAi: tenge(20_000), other: tenge(5_000) }, extraWorkProposals: [] },
  );
  db.subscriptions.push(
    { id: 'sub1', tenantId: 't1', tariff: 'partner', status: 'active', since: '2026-07-01', oneCLicense: 'Клиенттің өз лицензиясы — біздің жазылымға кірмейді' },
    { id: 'sub2', tenantId: 't2', tariff: 'accounting', status: 'active', since: '2026-07-01', oneCLicense: 'Клиенттің өз лицензиясы — біздің жазылымға кірмейді' },
    { id: 'sub3', tenantId: 't3', tariff: 'control', status: 'trial', since: '2026-07-01', oneCLicense: 'Клиенттің өз лицензиясы — біздің жазылымға кірмейді' },
  );

  // ───── Тапсырмалар тарихы (KPI үшін) ─────
  const profiles: Record<ID, { onTime: number; firstPass: number; tenants: ID[]; perMonth: number }> = {
    u_acc1: { onTime: 0.8, firstPass: 0.86, tenants: ['t1', 't2'], perMonth: 13 },
    u_acc2: { onTime: 0.93, firstPass: 0.68, tenants: ['t1'], perMonth: 9 },
    u_acc3: { onTime: 0.9, firstPass: 0.94, tenants: ['t2'], perMonth: 9 },
    u_acc4: { onTime: 0.96, firstPass: 0.9, tenants: ['t3'], perMonth: 6 },
  };
  const opTypes: [string, Complexity][] = [
    ['Банк көшірмесін өңдеу', 'standard'], ['Кассаны тексеру', 'simple'], ['Сатылымды салыстыру', 'standard'], ['Тауар қозғалысын тексеру', 'complex'],
    ['Жалақы есептеу', 'standard'], ['Шығындарды енгізу', 'simple'], ['Қарыздарды салыстыру', 'complex'], ['Ай жабу есептеулері', 'complex'], ['Жеткізуші құжаттарын енгізу', 'simple'],
  ];
  const hr = rng(44);
  const ev = (task: Task, at: string, by: ID, type: import('./types').TaskEvent['type'], from: string | null, to: string | null, note?: string) =>
    db.taskEvents.push({ id: id('te'), tenantId: task.tenantId, taskId: task.id, at, by, type, from, to, note });
  for (const [uid, pr] of Object.entries(profiles)) {
    for (const mo of ['2026-07', '2026-08', '2026-09']) {
      for (let i = 0; i < pr.perMonth; i++) {
        const [op, cx] = opTypes[Math.floor(hr() * opTypes.length)];
        const tenantId = pr.tenants[Math.floor(hr() * pr.tenants.length)];
        const due = `${mo}-${String(3 + Math.floor(hr() * 25)).padStart(2, '0')}`;
        const late = hr() > pr.onTime;
        const returned = hr() > pr.firstPass;
        const created = addDays(due, -5);
        const fin = addDays(due, late ? 1 + Math.floor(hr() * 4) : -Math.floor(hr() * 2));
        const t: Task = {
          id: id('task'), tenantId, title: `${op} · ${mo}`, opType: op, description: 'Тұрақты айлық жұмыс (demo тарих)', findingId: null, docIds: [], assigneeId: uid, reviewerId: 'u_chief',
          complexity: cx, plannedDue: due, status: 'done', createdAt: T(created), createdBy: 'u_chief', source: 'checklist', startedAt: T(addDays(created, 1)), finishedAt: T(fin, '17:00'),
          waitReason: null, comments: [], evidence: [{ id: id('ev'), at: T(fin, '12:00'), by: uid, kind: 'reconciliation', text: 'Салыстыру тізімдемесі тіркелді (demo)' }],
          reviewResult: { decision: 'accepted', by: 'u_chief', at: T(fin, '17:00'), note: '' }, returnCount: returned ? 1 : 0, period: mo,
        };
        db.tasks.push(t);
        ev(t, t.createdAt, 'u_chief', 'created', null, 'todo');
        if (returned) {
          db.reviews.push({ id: id('rv'), tenantId, taskId: t.id, reviewerId: 'u_chief', decision: 'returned', note: 'Салыстыру толық емес (demo)', at: T(addDays(fin, -1), '15:00'), attempt: 1 });
        }
        db.reviews.push({ id: id('rv'), tenantId, taskId: t.id, reviewerId: 'u_chief', decision: 'accepted', note: '', at: T(fin, '17:00'), attempt: returned ? 2 : 1 });
        const w = db.settings.complexityWeights[cx];
        db.workLogs.push({ id: id('wl'), tenantId, taskId: t.id, userId: uid, date: fin, minutes: Math.round(w * (50 + hr() * 40) * (returned ? 1.4 : 1)) });
      }
    }
  }

  // ───── Тексерулерді іске қосу → мәселелер ─────
  for (const t of ['t1', 't2', 't3']) runChecks(db, t, t === 't3' ? '2026-10-03' : '2026-10-06', DEMO_NOW, () => id('f'));
  const F = (key: string) => db.findings.find((f) => f.dedupeKey.startsWith(key));
  const move = (f: Finding | undefined, steps: { to: import('./types').FindingStatus; by: ID; at: string; reason?: string; fixEvidence?: string; note?: string }[]) => {
    if (!f) return;
    let cur = f;
    for (const s of steps) {
      const roles: import('./types').Role[] = s.by === 'u_chief' ? ['chief_accountant'] : ['accountant'];
      cur = transitionFinding(cur, { ...s, roles });
    }
    Object.assign(f, cur);
  };

  // Ағымдағы ашық тапсырмалар
  const mkTask = (p: Partial<Task> & Pick<Task, 'tenantId' | 'title' | 'opType' | 'assigneeId' | 'plannedDue' | 'status' | 'complexity'>, events: [string, ID, string | null, string, string?][] = []) => {
    const t: Task = {
      id: id('task'), description: '', findingId: null, docIds: [], reviewerId: 'u_chief', createdAt: T('2026-10-01'), createdBy: 'u_chief', source: 'manual', startedAt: null, finishedAt: null,
      waitReason: null, comments: [], evidence: [], reviewResult: null, returnCount: 0, period: '2026-10', ...p,
    };
    db.tasks.push(t);
    ev(t, t.createdAt, t.createdBy, 'created', null, 'todo');
    for (const [at, by, from, to, note] of events) ev(t, at, by, 'status', from, to, note);
    return t;
  };

  // 1) Банк сәйкессіздігі / Қонаев жалдау — клиенттен акт күтілуде (кешіккен)
  const fBank = F('R07:bb1');
  const fRent = F('R03:exp:b13:2026-09:rent');
  const tRent = mkTask(
    { tenantId: 't1', title: 'Қонаев: қыркүйек жалдау актісін алу және шығынды енгізу', opType: 'Шығындарды енгізу', description: 'Банк көшірмесінде 05.09 жалға берушіге 700 000 ₸ төлем бар, 1С-те жоқ. Акт клиенттен күтілуде.', findingId: fRent?.id ?? null, docIds: [], assigneeId: 'u_acc2', clientAssigneeId: 'u_mgr1', plannedDue: '2026-10-03', status: 'waiting_client', complexity: 'standard', createdAt: T('2026-10-01', '09:30'), source: 'finding', startedAt: T('2026-10-01', '10:00'), waitReason: 'Жалға берушінің қыркүйек актісі клиенттен күтілуде (менеджерге 01.10 сұрау жіберілді)', comments: [], period: '2026-09' },
    [[T('2026-10-01', '10:00'), 'u_acc2', 'todo', 'in_progress'], [T('2026-10-01', '11:00'), 'u_acc2', 'in_progress', 'waiting_client', 'Акт клиенттен сұралды']],
  );
  tRent.comments.push(
    { id: id('c'), at: T('2026-10-01', '11:00'), by: 'u_acc2', text: 'Динара, Қонаев СО-дан қыркүйек айының жалдау актісін жіберіңізші. Банкте төлем бар, 1С-те құжат жоқ.' },
    { id: id('c'), at: T('2026-10-04', '16:20'), by: 'u_mgr1', text: 'Жалға берушіге хабарластым, акт дүйсенбіде болады деді.' },
    { id: id('c'), at: T('2026-10-05', '09:40'), by: 'u_acc2', text: 'Рақмет! Акт келген соң бірден енгізіп, банкті салыстырамын.' },
  );
  if (fRent) {
    fRent.taskId = tRent.id;
    fRent.assigneeId = 'u_acc2';
    fRent.dueDate = '2026-10-03';
    move(fRent, [{ to: 'in_review', by: 'u_acc2', at: T('2026-10-01', '10:00') }, { to: 'waiting_client', by: 'u_acc2', at: T('2026-10-01', '11:00'), note: 'Акт клиенттен күтілуде' }]);
  }
  if (fBank) {
    fBank.assigneeId = 'u_acc2';
    fBank.dueDate = '2026-10-03';
    fBank.taskId = tRent.id;
    move(fBank, [{ to: 'in_review', by: 'u_acc2', at: T('2026-10-01', '10:00'), note: 'Себебі: 05.09 жалдау төлемі 1С-те жоқ — R03 мәселесімен байланысты' }, { to: 'waiting_client', by: 'u_acc2', at: T('2026-10-01', '11:00') }]);
  }
  // 2) Өткізілмеген қайтарымдар — бухгалтер түзетіп, тексеруге жіберді (бас бухгалтер шешімін күтеді)
  const unposted = db.findings.filter((f) => f.ruleId === 'R02' && f.tenantId === 't1');
  const tRet = mkTask(
    { tenantId: 't1', title: 'Рысқұлов: өткізілмеген 2 қайтарым құжатын өңдеу', opType: 'Сатылымды салыстыру', description: 'ВЗ-0927-1 және ВЗ-0927-2 құжаттарын тексеріп өткізу.', findingId: unposted[0]?.id ?? null, docIds: unposted.flatMap((f) => f.docIds), assigneeId: 'u_acc2', plannedDue: '2026-10-08', status: 'in_review', complexity: 'simple', createdAt: T('2026-10-02', '09:00'), source: 'finding', startedAt: T('2026-10-02', '10:00'), period: '2026-09' },
    [[T('2026-10-02', '10:00'), 'u_acc2', 'todo', 'in_progress'], [T('2026-10-06', '15:30'), 'u_acc2', 'in_progress', 'in_review']],
  );
  tRet.evidence.push({ id: id('ev'), at: T('2026-10-06', '15:20'), by: 'u_acc2', kind: 'source_fix', text: '1С-те екі қайтарым құжаты кассир түсініктемесімен тексерілді, өткізілді. Кассалық чектер тіркелді.', docId: unposted[0]?.docIds[0] ?? null });
  db.workLogs.push({ id: id('wl'), tenantId: 't1', taskId: tRet.id, userId: 'u_acc2', date: '2026-10-06', minutes: 55 });
  for (const f of unposted) {
    f.taskId = tRet.id;
    f.assigneeId = 'u_acc2';
    f.dueDate = '2026-10-08';
    move(f, [{ to: 'in_review', by: 'u_acc2', at: T('2026-10-02', '10:00') }, { to: 'fix_proposed', by: 'u_acc2', at: T('2026-10-06', '15:30'), fixEvidence: tRet.evidence[0].text }]);
    f.sourceFixPending = true;
  }
  // 3) Т2: қайталанған құжат туралы AI күмәні — расталмаған («Қате емес»)
  const fDup = db.findings.find((f) => f.ruleId === 'R01' && f.tenantId === 't2');
  if (fDup) {
    fDup.assigneeId = 'u_acc3';
    const tDup = mkTask(
      { tenantId: 't2', title: 'AI күмәні: ПН-0912 / ПН-0927 қайталану ма?', opType: 'Жеткізуші құжаттарын енгізу', description: 'Жүкқұжаттар мен қойма кіріс ордерлерін салыстыру.', findingId: fDup.id, docIds: fDup.docIds, assigneeId: 'u_acc3', plannedDue: '2026-09-16', status: 'done', complexity: 'standard', createdAt: T('2026-09-11', '09:00'), source: 'finding', startedAt: T('2026-09-11', '10:00'), finishedAt: T('2026-09-15', '16:00'), period: '2026-09', reviewResult: { decision: 'accepted', by: 'u_chief', at: T('2026-09-15', '16:00'), note: 'Екі бөлек жеткізу расталды' } },
      [[T('2026-09-11', '10:00'), 'u_acc3', 'todo', 'in_progress'], [T('2026-09-14', '12:00'), 'u_acc3', 'in_progress', 'in_review'], [T('2026-09-15', '16:00'), 'u_chief', 'in_review', 'done']],
    );
    tDup.evidence.push({ id: id('ev'), at: T('2026-09-14', '11:50'), by: 'u_acc3', kind: 'document', text: 'Екі бөлек жүкқұжат (ТТН №4411, №4438) және екі қойма кіріс ордері бар; жеткізуші хатпен растады.' });
    db.reviews.push({ id: id('rv'), tenantId: 't2', taskId: tDup.id, reviewerId: 'u_chief', decision: 'accepted', note: 'Екі бөлек жеткізу расталды', at: T('2026-09-15', '16:00'), attempt: 1 });
    db.workLogs.push({ id: id('wl'), tenantId: 't2', taskId: tDup.id, userId: 'u_acc3', date: '2026-09-14', minutes: 95 });
    fDup.taskId = tDup.id;
    move(fDup, [{ to: 'in_review', by: 'u_acc3', at: T('2026-09-11', '10:00') }, { to: 'not_an_error', by: 'u_acc3', at: T('2026-09-15', '16:10'), reason: 'Екі бөлек жеткізу: ТТН №4411 және №4438, қойма кіріс ордерлері бар, жеткізуші растады. Қайталану жоқ.' }]);
  }
  // 4) Т2: салыстыру актісі — клиент жауабын күтуден кешіккен
  const fAr = db.findings.find((f) => f.ruleId === 'R09' && f.tenantId === 't2' && f.title.startsWith('Алатау'));
  const tAct = mkTask(
    { tenantId: 't2', title: 'Алатау Офис: өзара есеп айырысуды салыстыру актісі', opType: 'Қарыздарды салыстыру', description: 'Мерзімі өткен қарызды растау және төлем кестесін келісу үшін акт.', findingId: fAr?.id ?? null, assigneeId: 'u_acc3', plannedDue: '2026-09-30', status: 'waiting_client', complexity: 'complex', createdAt: T('2026-09-18', '10:00'), source: 'finding', startedAt: T('2026-09-18', '11:00'), waitReason: 'Алатау Офис бухгалтериясы актіге қол қоймады (22.09 жіберілді, 2 рет еске салынды)', period: '2026-09' },
    [[T('2026-09-18', '11:00'), 'u_acc3', 'todo', 'in_progress'], [T('2026-09-22', '12:00'), 'u_acc3', 'in_progress', 'waiting_client', 'Акт клиентке жіберілді']],
  );
  tAct.comments.push({ id: id('c'), at: T('2026-09-29', '10:00'), by: 'u_owner2', text: 'Алатау-мен өзім сөйлесемін. Акт керек.' }, { id: id('c'), at: T('2026-09-29', '13:30'), by: 'u_acc3', text: 'Жақсы, актінің PDF нұсқасын поштаңызға жібердім.' });
  db.workLogs.push({ id: id('wl'), tenantId: 't2', taskId: tAct.id, userId: 'u_acc3', date: '2026-09-22', minutes: 120 });
  if (fAr) {
    fAr.taskId = tAct.id;
    fAr.assigneeId = 'u_acc3';
    fAr.dueDate = '2026-09-30';
    move(fAr, [{ to: 'in_review', by: 'u_acc3', at: T('2026-09-18', '11:00') }, { to: 'waiting_client', by: 'u_acc3', at: T('2026-09-22', '12:00') }]);
  }
  // 5) Тарихи: тамыздағы теріс қалдық — түзетілді, қайта тексерілді, жабылды
  {
    const tid = 't1';
    const fClosed: Finding = {
      id: id('f'), tenantId: tid, branchId: 'b11', ruleId: 'R04', kind: 'rule', dedupeKey: 'R04:b11:GKL-12.5:2026-08', title: 'Теріс қалдық: Гипсокартон 12,5 мм (−60 дана)',
      whatHappened: 'Сайран қоймасында 21.08 «Гипсокартон 12,5 мм» қалдығы −60 дана.', businessImpact: 'Өзіндік құн төмен көрсетілген болуы мүмкін.', actionNeeded: 'Кіріс құжатын табу/енгізу.',
      evidence: 'Қойма қалдығы есебі: SKU GKL-12.5, қалдық −60 (21.08).', txIds: [], docIds: [], potentialImpact: tenge(144_000), confirmedImpact: 0, detectedAt: T('2026-08-22', '07:00'), severity: 'high',
      assigneeId: 'u_acc1', dueDate: '2026-08-26', status: 'new', history: [{ at: T('2026-08-22', '07:00'), by: 'system', from: null, to: 'new', note: 'Ереже NEG_STOCK' }], taskId: null, period: '2026-08', ownerVisible: true,
    };
    const tc = mkTask(
      { tenantId: tid, title: 'Сайран: гипсокартон теріс қалдығын түзету', opType: 'Тауар қозғалысын тексеру', description: 'Кіріс құжаты кейін енгізілген болуы мүмкін.', findingId: fClosed.id, assigneeId: 'u_acc1', plannedDue: '2026-08-26', status: 'done', complexity: 'standard', createdAt: T('2026-08-22', '09:00'), source: 'finding', startedAt: T('2026-08-22', '10:00'), finishedAt: T('2026-08-25', '15:00'), period: '2026-08', reviewResult: { decision: 'accepted', by: 'u_chief', at: T('2026-08-25', '15:00'), note: 'Кіріс құжаты дұрыс күнмен өткізілді' } },
      [[T('2026-08-22', '10:00'), 'u_acc1', 'todo', 'in_progress'], [T('2026-08-24', '17:00'), 'u_acc1', 'in_progress', 'in_review'], [T('2026-08-25', '15:00'), 'u_chief', 'in_review', 'done']],
    );
    tc.evidence.push({ id: id('ev'), at: T('2026-08-24', '16:50'), by: 'u_acc1', kind: 'source_fix', text: 'ПН-1187 кіріс құжаты 19.08 күнімен өткізілді (бұрын 23.08 қате күнмен енгізілген). Қойма қалдығы қайта есептелді.' });
    db.reviews.push({ id: id('rv'), tenantId: tid, taskId: tc.id, reviewerId: 'u_chief', decision: 'accepted', note: 'Кіріс құжаты дұрыс күнмен өткізілді', at: T('2026-08-25', '15:00'), attempt: 1 });
    db.workLogs.push({ id: id('wl'), tenantId: tid, taskId: tc.id, userId: 'u_acc1', date: '2026-08-24', minutes: 80 });
    fClosed.taskId = tc.id;
    let cur = fClosed;
    cur = transitionFinding(cur, { to: 'in_review', by: 'u_acc1', roles: ['accountant'], at: T('2026-08-22', '10:00') });
    cur = transitionFinding(cur, { to: 'fix_proposed', by: 'u_acc1', roles: ['accountant'], at: T('2026-08-24', '17:00'), fixEvidence: tc.evidence[0].text });
    cur = transitionFinding(cur, { to: 'approved', by: 'u_chief', roles: ['chief_accountant'], at: T('2026-08-25', '15:00') });
    cur.recheck = { at: T('2026-08-26', '08:00'), passed: true, detail: 'Синхрондаудан кейін ереже R04 қайта іске қосылды: GKL-12.5 қалдығы +140, сәйкессіздік жоқ.', syncRunId: null };
    cur = transitionFinding(cur, { to: 'rechecked', by: 'u_acc1', roles: ['accountant'], at: T('2026-08-26', '08:05') });
    cur = transitionFinding(cur, { to: 'closed', by: 'u_chief', roles: ['chief_accountant'], at: T('2026-08-26', '09:00'), note: 'Расталған әсер: 0 ₸ (күн қатесі)' });
    db.findings.push(cur);
  }
  // 6) Айгерімнің жоғары жүктемесі: көп ашық тапсырма
  const loadTasks: [ID, string, Complexity, ISODate, TaskStatus][] = [
    ['t1', 'Қыркүйек: тауар қозғалысын тексеру (3 дүкен)', 'complex', '2026-10-06', 'in_progress'],
    ['t1', 'Қыркүйек: жеткізушілермен салыстыру', 'complex', '2026-10-08', 'todo'],
    ['t1', 'Қазан: банк көшірмесін өңдеу (1-апта)', 'standard', '2026-10-07', 'in_progress'],
    ['t1', 'Қыркүйек: ай жабу есептеулері', 'complex', '2026-10-09', 'todo'],
    ['t2', 'Қазан: Сапа Логистик-ке еске салу хаты', 'simple', '2026-10-08', 'todo'],
    ['t2', 'Жаңа SKU (А3 қағаз) кіріс бағасын енгізу', 'standard', '2026-10-09', 'todo'],
    ['t2', 'Қазан: жалақы алдын ала есебі', 'standard', '2026-10-10', 'todo'],
    ['t1', 'Қазан: кассаларды тексеру (3 дүкен)', 'standard', '2026-10-10', 'todo'],
    ['t1', 'Маркетинг шығындарын филиалдарға бөлу ұсынысы', 'standard', '2026-10-14', 'todo'],
    ['t2', 'Қазан: жеткізуші құжаттарын енгізу', 'simple', '2026-10-12', 'todo'],
  ];
  for (const [tid, title, cx, due, st] of loadTasks) {
    const t = mkTask({ tenantId: tid, title, opType: title.split(':')[1]?.trim().split(' (')[0] ?? title, assigneeId: 'u_acc1', plannedDue: due, status: st, complexity: cx, startedAt: st === 'in_progress' ? T('2026-10-02') : null }, st === 'in_progress' ? [[T('2026-10-02'), 'u_acc1', 'todo', 'in_progress']] : []);
    if (st === 'in_progress') db.workLogs.push({ id: id('wl'), tenantId: tid, taskId: t.id, userId: 'u_acc1', date: '2026-10-05', minutes: 140 });
  }
  // өзіндік құны жоқ сатылым → тапсырмаға байланыстыру
  const fNoCost = db.findings.find((f) => f.ruleId === 'R05' && f.tenantId === 't2');
  const tSku = db.tasks.find((t) => t.title.startsWith('Жаңа SKU'));
  if (fNoCost && tSku) {
    fNoCost.taskId = tSku.id;
    fNoCost.assigneeId = 'u_acc1';
    fNoCost.dueDate = tSku.plannedDue;
    tSku.findingId = fNoCost.id;
  }
  // Басқа бухгалтерлердің ағымдағы жұмысы
  mkTask({ tenantId: 't2', title: 'Қазан: банк көшірмесін өңдеу', opType: 'Банк көшірмесін өңдеу', assigneeId: 'u_acc3', plannedDue: '2026-10-08', status: 'in_progress', complexity: 'standard', startedAt: T('2026-10-05') }, [[T('2026-10-05'), 'u_acc3', 'todo', 'in_progress']]);
  mkTask({ tenantId: 't3', title: 'Қыркүйек: касса айырмасын түсіндіру', opType: 'Кассаны тексеру', assigneeId: 'u_acc4', plannedDue: '2026-10-09', status: 'todo', complexity: 'simple', findingId: db.findings.find((f) => f.ruleId === 'R06')?.id ?? null, source: 'finding' });
  const fCash = db.findings.find((f) => f.ruleId === 'R06');
  if (fCash) {
    fCash.taskId = db.tasks[db.tasks.length - 1].id;
    fCash.assigneeId = 'u_acc4';
    fCash.dueDate = '2026-10-09';
  }
  const tRetBack = mkTask(
    { tenantId: 't1', title: 'Қыркүйек: инкассацияны банкпен салыстыру', opType: 'Банк көшірмесін өңдеу', assigneeId: 'u_acc2', plannedDue: '2026-10-07', status: 'returned', complexity: 'standard', startedAt: T('2026-10-03'), returnCount: 1, period: '2026-09', reviewResult: { decision: 'returned', by: 'u_chief', at: T('2026-10-06', '11:00'), note: 'Қонаев дүкенінің 3 инкассациясы тізімде жоқ — толықтырыңыз.' } },
    [[T('2026-10-03'), 'u_acc2', 'todo', 'in_progress'], [T('2026-10-05', '18:00'), 'u_acc2', 'in_progress', 'in_review'], [T('2026-10-06', '11:00'), 'u_chief', 'in_review', 'returned']],
  );
  tRetBack.evidence.push({ id: id('ev'), at: T('2026-10-05', '17:50'), by: 'u_acc2', kind: 'reconciliation', text: 'Сайран мен Рысқұлов инкассациялары салыстырылды.' });
  db.reviews.push({ id: id('rv'), tenantId: 't1', taskId: tRetBack.id, reviewerId: 'u_chief', decision: 'returned', note: 'Қонаев дүкенінің 3 инкассациясы тізімде жоқ — толықтырыңыз.', at: T('2026-10-06', '11:00'), attempt: 1 });

  // 7) Кәсіпкердің шешімін күтетін тапсырмалар
  const fUncl = db.findings.find((f) => f.ruleId === 'R08' && f.tenantId === 't1');
  const tDec1 = mkTask({ tenantId: 't1', title: 'ЖК Ахметовке 450 000 ₸ төлемнің мақсатын растаңыз', opType: 'Шешім', description: 'Бухгалтер төлемді жіктей алмайды. Нұсқалар: тауар жеткізу авансы / қызмет / иесінің алымы.', findingId: fUncl?.id ?? null, assigneeId: 'u_acc1', plannedDue: '2026-10-08', status: 'waiting_client', complexity: 'simple', needsOwnerDecision: true, ownerDecision: null, clientAssigneeId: 'u_owner1', source: 'decision', startedAt: T('2026-10-02'), waitReason: 'Кәсіп иесінің шешімі күтілуде', period: '2026-09' }, [[T('2026-10-02'), 'u_acc1', 'todo', 'in_progress'], [T('2026-10-02', '12:00'), 'u_acc1', 'in_progress', 'waiting_client']]);
  if (fUncl) {
    fUncl.taskId = tDec1.id;
    fUncl.assigneeId = 'u_acc1';
    fUncl.dueDate = '2026-10-08';
    move(fUncl, [{ to: 'in_review', by: 'u_acc1', at: T('2026-10-02') }, { to: 'waiting_client', by: 'u_acc1', at: T('2026-10-02', '12:00') }]);
  }
  const fPers = db.findings.find((f) => f.ruleId === 'R14');
  const tDec2 = mkTask({ tenantId: 't1', title: 'Автосервис 380 000 ₸: бизнес шығыны ма, жеке шығын ба?', opType: 'Шешім', description: 'AI күмәні — расталмаған. Сіздің жауабыңыз бойынша бухгалтер жіктейді.', findingId: fPers?.id ?? null, assigneeId: 'u_acc1', plannedDue: '2026-10-10', status: 'waiting_client', complexity: 'simple', needsOwnerDecision: true, ownerDecision: null, clientAssigneeId: 'u_owner1', source: 'decision', startedAt: T('2026-10-03'), waitReason: 'Кәсіп иесінің шешімі күтілуде', period: '2026-09' }, [[T('2026-10-03'), 'u_acc1', 'todo', 'in_progress'], [T('2026-10-03', '12:00'), 'u_acc1', 'in_progress', 'waiting_client']]);
  if (fPers) {
    fPers.taskId = tDec2.id;
    fPers.assigneeId = 'u_acc1';
    fPers.dueDate = '2026-10-10';
    move(fPers, [{ to: 'in_review', by: 'u_acc1', at: T('2026-10-03') }, { to: 'waiting_client', by: 'u_acc1', at: T('2026-10-03', '12:00') }]);
  }
  mkTask({ tenantId: 't2', title: 'Қыркүйектегі лимиттен тыс жұмыс ұсынысын қарау (9 бірлік)', opType: 'Шешім', description: 'Келісілген көлемнен тыс жұмыс. Қосымша төлем тек сіз бекіткен соң есептеледі.', assigneeId: 'u_lead', reviewerId: 'u_lead', plannedDue: '2026-10-12', status: 'waiting_client', complexity: 'simple', needsOwnerDecision: true, ownerDecision: null, clientAssigneeId: 'u_owner2', source: 'decision', waitReason: 'Кәсіп иесінің шешімі күтілуде', period: '2026-09' });

  // Бастапқы мәселелердің жауаптыларын толтыру
  const defaultResp: Record<ID, ID> = { t1: 'u_acc1', t2: 'u_acc3', t3: 'u_acc4' };
  for (const f of db.findings) {
    if (!f.assigneeId && f.status !== 'closed') {
      f.assigneeId = f.ruleId === 'R11' ? 'u_int' : defaultResp[f.tenantId];
      f.dueDate = f.dueDate ?? addDays(DEMO_TODAY, f.severity === 'high' ? 2 : 5);
    }
  }

  db.audit.push({ id: id('au'), at: DEMO_NOW, userId: 'system', role: null, tenantId: null, action: 'seed', entity: 'Db', entityId: null, result: 'ok', details: 'Demo деректер жасалды' });
  return db;
}

const BASE = Date.UTC(2026, 6, 1);
function diffIndex(d: ISODate): number {
  return Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - BASE) / 86400000);
}

export type { Settlement, Money };
