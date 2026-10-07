/**
 * Тексерулер орталығы: ережелер және AI-күмәндар.
 * runChecks идемпотентті: бір мәселе dedupeKey бойынша қайталанып жасалмайды.
 * AI-күмән ешқашан автоматты түрде «дәлелденген қате» болмайды — ол тек тексеруге ұсыныс.
 */
import type { CheckRule, Db, Finding, ID, ISODate, Severity } from './types';
import { sum, fmtKzt, fmtBp, type Money } from './money';
import { balanceAt, debts, pnl, paymentCalendar, isMonthClosed } from './finance';
import { addDays, diffDays, monthEnd, monthsBetween, hoursBetween, monthLabel } from './periods';

export const RULES: CheckRule[] = [
  { id: 'R01', code: 'DUP_DOC', name: 'Қайталануы ықтимал құжат', kind: 'ai', description: 'Бір контрагент, бірдей сома, 3 күн ішіндегі әртүрлі нөмірлі құжаттар. AI ұқсастықты бағалайды — бұл тек күмән.', defaultSeverity: 'medium', blocksPeriodClose: false },
  { id: 'R02', code: 'UNPOSTED', name: 'Өткізілмеген құжат', kind: 'rule', description: '1С-те құжат бар, бірақ өткізілмеген (posted = false). Есепке әсер етпейді.', defaultSeverity: 'medium', blocksPeriodClose: true },
  { id: 'R03', code: 'MISSING_PRIMARY', name: 'Жетіспейтін бастапқы құжат', kind: 'rule', description: 'Шығын немесе сатып алу бастапқы құжатсыз (скан/акт жоқ) немесе тұрақты ай сайынғы шығын (жалдау, жалақы) енгізілмеген.', defaultSeverity: 'high', blocksPeriodClose: true },
  { id: 'R04', code: 'NEG_STOCK', name: 'Теріс қойма қалдығы', kind: 'rule', description: 'Тауар қалдығы 0-ден төмен: сатылым кіріс құжатынан бұрын өткізілген немесе кіріс енгізілмеген.', defaultSeverity: 'high', blocksPeriodClose: true },
  { id: 'R05', code: 'NO_COST', name: 'Сатып алу құны жоқ тауар', kind: 'rule', description: 'Сатылған тауардың өзіндік құны белгісіз. Маржа толық есептелмейді.', defaultSeverity: 'medium', blocksPeriodClose: true },
  { id: 'R06', code: 'CASH_DIFF', name: 'Түсіндірілмеген касса айырмасы', kind: 'rule', description: 'Касса санағы мен есептік қалдық арасындағы айырма.', defaultSeverity: 'medium', blocksPeriodClose: true },
  { id: 'R07', code: 'BANK_MISMATCH', name: 'Банк көшірмесімен сәйкессіздік', kind: 'rule', description: 'Банк көшірмесіндегі соңғы қалдық 1С-тегі қалдықпен сәйкес емес.', defaultSeverity: 'high', blocksPeriodClose: true },
  { id: 'R08', code: 'UNCLASSIFIED', name: 'Жіктелмеген төлем', kind: 'rule', description: 'Төлемнің мақсаты/бабы көрсетілмеген. Пайдаға әсері белгісіз.', defaultSeverity: 'medium', blocksPeriodClose: true },
  { id: 'R09', code: 'AR_OVERDUE', name: 'Мерзімі өткен дебиторлық қарыз', kind: 'rule', description: 'Клиент қарызының мерзімі 30 күннен асқан бөлігі бар.', defaultSeverity: 'high', blocksPeriodClose: false },
  { id: 'R10', code: 'CLOSE_BLOCKER', name: 'Кезең жабылуына кедергі', kind: 'rule', description: 'Ай аяқталғаннан кейін 5 күннен астам уақыт өтті, бірақ кезеңді жабуға кедергі мәселелер бар.', defaultSeverity: 'high', blocksPeriodClose: false },
  { id: 'R11', code: 'STALE_SYNC', name: 'Деректердің кеш жаңаруы', kind: 'rule', description: '1С-тен соңғы сәтті синхрондау баптаудағы шектен (сағат) ескі.', defaultSeverity: 'medium', blocksPeriodClose: false },
  { id: 'R12', code: 'MARGIN_DROP', name: 'Маржаның төмендеуі', kind: 'rule', description: 'Филиалдың жалпы маржасы алдыңғы аймен салыстырғанда 3 п.п.-тен көп төмендеді.', defaultSeverity: 'high', blocksPeriodClose: false },
  { id: 'R13', code: 'CASH_GAP', name: 'Ақша жетіспеуі ықтимал', kind: 'rule', description: 'Төлем күнтізбесінің болжамы бойынша алдағы 30 күнде ақша қалдығы 0-ден төмен түсуі мүмкін.', defaultSeverity: 'high', blocksPeriodClose: false },
  { id: 'R14', code: 'AI_PERSONAL', name: 'Жеке шығын болуы мүмкін (AI)', kind: 'ai', description: 'AI төлем мақсаты мен контрагент бойынша бизнеске қатысы жоқ жеке шығын болуы мүмкін деп белгіледі. Иесінің растауы керек.', defaultSeverity: 'low', blocksPeriodClose: false },
];

export const OPEN_FINDING_STATUSES = ['new', 'in_review', 'waiting_client', 'fix_proposed', 'approved', 'rechecked'] as const;

export interface Detected {
  ruleId: ID;
  dedupeKey: string;
  tenantId: ID;
  branchId: ID | null;
  title: string;
  whatHappened: string;
  businessImpact: string;
  actionNeeded: string;
  evidence: string;
  txIds: ID[];
  docIds: ID[];
  potentialImpact: Money | null;
  severity: Severity;
  period: string;
  detectedOn: ISODate;
  ownerVisible: boolean;
}

const branchName = (db: Db, id: ID | null) => (id ? db.branches.find((b) => b.id === id)?.name ?? id : 'Компания');

/** Ережелерді іске қосу. asOf — дерек күні, nowIso — қазіргі уақыт. */
export function detect(db: Db, tenantId: ID, asOf: ISODate, nowIso: string): Detected[] {
  const out: Detected[] = [];
  const docs = db.documents.filter((d) => d.tenantId === tenantId);

  // R01 — қайталануы ықтимал құжат (AI-күмән)
  const purch = docs.filter((d) => d.type === 'purchase_invoice' || d.type === 'service_act').sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < purch.length; i++) {
    for (let j = i + 1; j < purch.length; j++) {
      const a = purch[i];
      const b = purch[j];
      if (diffDays(b.date, a.date) > 3) break;
      if (a.counterpartyId && a.counterpartyId === b.counterpartyId && a.amount === b.amount && a.number !== b.number) {
        const cp = db.counterparties.find((c) => c.id === a.counterpartyId)?.name;
        out.push({
          ruleId: 'R01', dedupeKey: `R01:${a.id}:${b.id}`, tenantId, branchId: a.branchId,
          title: `Қайталануы ықтимал сатып алу: ${cp}, ${fmtKzt(a.amount)}`,
          whatHappened: `${cp} бойынша ${a.date} және ${b.date} күндері бірдей сомадағы екі құжат (№${a.number}, №${b.number}).`,
          businessImpact: `Егер қайталанса — өзіндік құн мен жеткізушіге қарыз ${fmtKzt(a.amount)} артық көрсетілуі мүмкін. Бұл расталмаған күмән.`,
          actionNeeded: 'Жүкқұжаттар мен қойма кіріс ордерлерін салыстыру, жеткізушімен растау.',
          evidence: `AI ұқсастық белгілері: контрагент сәйкес, сома сәйкес (${fmtKzt(a.amount)}), күндер айырмасы ${diffDays(b.date, a.date)} күн, нөмірлер әртүрлі. Ұқсастық бағасы: 0,82 (demo).`,
          txIds: db.transactions.filter((t) => t.docId === a.id || t.docId === b.id).map((t) => t.id), docIds: [a.id, b.id],
          potentialImpact: a.amount, severity: 'medium', period: b.date.slice(0, 7), detectedOn: addDays(b.date, 1), ownerVisible: false,
        });
      }
    }
  }

  // R02 — өткізілмеген құжаттар
  for (const d of docs.filter((x) => !x.posted && x.source !== 'upload' && x.date <= asOf)) {
    out.push({
      ruleId: 'R02', dedupeKey: `R02:${d.id}`, tenantId, branchId: d.branchId,
      title: `Өткізілмеген құжат: №${d.number}`,
      whatHappened: `${branchName(db, d.branchId)}: ${d.date} күнгі №${d.number} құжаты (${fmtKzt(d.amount)}) 1С-те бар, бірақ өткізілмеген.`,
      businessImpact: 'Сатылым/қайтарым мен қойма қалдығы толық емес. Ай жабылмайды.',
      actionNeeded: 'Құжатты тексеріп өткізу немесе жою себебін көрсету.',
      evidence: `1С құжат мәртебесі: «Өткізілмеген». Сыртқы ID: ${d.externalId}.`,
      txIds: [], docIds: [d.id], potentialImpact: d.amount, severity: 'medium', period: d.date.slice(0, 7), detectedOn: addDays(d.date, 1), ownerVisible: false,
    });
  }

  // R03 — бастапқы құжатсыз сатып алу / шығын + күтілген ай сайынғы шығын жоқ
  for (const d of docs.filter((x) => (x.type === 'purchase_invoice' || x.type === 'service_act') && !x.hasPrimaryFile && x.posted && x.date <= asOf)) {
    out.push({
      ruleId: 'R03', dedupeKey: `R03:doc:${d.id}`, tenantId, branchId: d.branchId,
      title: `Бастапқы құжаттың көшірмесі жоқ: №${d.number}`,
      whatHappened: `№${d.number} (${fmtKzt(d.amount)}) 1С-те өткізілген, бірақ скан/қол қойылған нұсқа тіркелмеген.`,
      businessImpact: 'Шығынды растау қиын; тексеру кезінде тәуекел.',
      actionNeeded: 'Клиенттен түпнұсқа немесе скан сұрау.',
      evidence: 'Құжатқа файл тіркелмеген (hasPrimaryFile = false).',
      txIds: db.transactions.filter((t) => t.docId === d.id).map((t) => t.id), docIds: [d.id], potentialImpact: null, severity: 'low', period: d.date.slice(0, 7), detectedOn: addDays(d.date, 2), ownerVisible: false,
    });
  }
  const months = monthsBetween('2026-07-01', asOf).filter((m) => monthEnd(m) <= asOf);
  for (const m of months) {
    if (isMonthClosed(db, tenantId, m)) continue;
    const p = pnl(db, { tenantId, branchId: null, from: `${m}-01`, to: monthEnd(m) });
    for (const me of p.missingExpected) {
      out.push({
        ruleId: 'R03', dedupeKey: `R03:exp:${me.branchId}:${m}:${me.category}`, tenantId, branchId: me.branchId,
        title: `${branchName(db, me.branchId)}: ${monthLabel(m)} ${me.category === 'rent' ? 'жалдау' : 'жалақы'} шығыны жоқ`,
        whatHappened: `${monthLabel(m)} айында ${branchName(db, me.branchId)} бойынша ${me.category === 'rent' ? 'жалдау' : 'жалақы'} шығыны 1С-те жоқ. Алдыңғы айларда тұрақты болған.`,
        businessImpact: 'Операциялық пайда шамадан тыс көрсетілуі мүмкін. Ай жабылмайды.',
        actionNeeded: 'Жалға берушіден акт алу және шығынды енгізу.',
        evidence: `Тұрақты шығын тексеруі: шілде–тамызда бар, ${monthLabel(m)} — жоқ.`,
        txIds: [], docIds: [], potentialImpact: null, severity: 'high', period: m, detectedOn: addDays(monthEnd(m), 2), ownerVisible: true,
      });
    }
  }

  // R04 — теріс қойма
  for (const s of db.stock.filter((x) => x.tenantId === tenantId && x.qty < 0)) {
    out.push({
      ruleId: 'R04', dedupeKey: `R04:${s.branchId}:${s.sku}:${s.asOf.slice(0, 7)}`, tenantId, branchId: s.branchId,
      title: `Теріс қалдық: ${s.name} (${s.qty} дана)`,
      whatHappened: `${branchName(db, s.branchId)} қоймасында «${s.name}» қалдығы ${s.qty} дана (${s.asOf}).`,
      businessImpact: 'Өзіндік құн мен маржа бұрмалануы мүмкін; кіріс құжаты енгізілмеген болуы ықтимал.',
      actionNeeded: 'Кіріс құжатын табу/енгізу, құжаттар ретін тексеру.',
      evidence: `Қойма қалдығы есебі: SKU ${s.sku}, қалдық ${s.qty}.`,
      txIds: [], docIds: [], potentialImpact: s.unitCost !== null ? Math.abs(s.qty) * s.unitCost : null, severity: 'high', period: s.asOf.slice(0, 7), detectedOn: addDays(s.asOf, 1), ownerVisible: true,
    });
  }

  // R05 — өзіндік құн жоқ
  const noCost = db.transactions.filter((t) => t.tenantId === tenantId && t.kind === 'sale' && (t.cost === null || t.cost === undefined) && t.date <= asOf);
  const byMonth = new Map<string, typeof noCost>();
  for (const t of noCost) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  for (const [m, list] of byMonth) {
    out.push({
      ruleId: 'R05', dedupeKey: `R05:${m}`, tenantId, branchId: list[0].branchId,
      title: `Өзіндік құны жоқ сатылым: ${list.length} операция`,
      whatHappened: `${monthLabel(m)}: ${list.length} сатылымда тауардың сатып алу құны жоқ (${fmtKzt(sum(list.map((t) => t.amount)))}).`,
      businessImpact: 'Жалпы пайда мен маржа толық емес — бұл сатылымдар есептен тыс қалды.',
      actionNeeded: 'Жаңа SKU үшін кіріс құжатын немесе бағасын енгізу.',
      evidence: list.map((t) => `${t.date} · ${t.description} · ${fmtKzt(t.amount)}`).join('\n'),
      txIds: list.map((t) => t.id), docIds: list.map((t) => t.docId).filter(Boolean) as ID[], potentialImpact: null, severity: 'medium', period: m, detectedOn: addDays(list[list.length - 1].date, 1), ownerVisible: false,
    });
  }

  // R06 — касса айырмасы
  for (const c of db.cashCounts.filter((x) => x.tenantId === tenantId && x.date <= asOf)) {
    const book = balanceAt(db, [c.accountId], c.date);
    const diff = c.counted - book;
    if (diff === 0) continue;
    out.push({
      ruleId: 'R06', dedupeKey: `R06:${c.id}`, tenantId, branchId: c.branchId,
      title: `Касса айырмасы: ${fmtKzt(diff, { sign: true })}`,
      whatHappened: `${c.date} касса санағы ${fmtKzt(c.counted)}, есеп бойынша ${fmtKzt(book)}.`,
      businessImpact: `${fmtKzt(Math.abs(diff))} түсіндірілмеген. Себебі расталмаған — жоғалту деп есептелмейді.`,
      actionNeeded: 'Кассирден түсініктеме, Z-есептер мен инкассацияны салыстыру.',
      evidence: `Санақ актісі: ${c.countedBy}. Есептік қалдық = бастапқы қалдық + түсім − төлем (${c.date}).`,
      txIds: [], docIds: c.docId ? [c.docId] : [], potentialImpact: Math.abs(diff), severity: 'medium', period: c.date.slice(0, 7), detectedOn: addDays(c.date, 1), ownerVisible: true,
    });
  }

  // R07 — банк көшірмесі
  for (const b of db.bankBalances.filter((x) => x.tenantId === tenantId && x.date <= asOf)) {
    const book = balanceAt(db, [b.accountId], b.date);
    const diff = b.closingBalance - book;
    if (diff === 0) continue;
    out.push({
      ruleId: 'R07', dedupeKey: `R07:${b.id}`, tenantId, branchId: null,
      title: `Банк көшірмесі 1С-пен сәйкес емес: ${fmtKzt(diff, { sign: true })}`,
      whatHappened: `${b.date} банк көшірмесінде қалдық ${fmtKzt(b.closingBalance)}, 1С-те ${fmtKzt(book)}.`,
      businessImpact: 'Бір немесе бірнеше банк операциясы 1С-те жоқ. Ақша және шығын көрсеткіштері толық емес. Ай жабылмайды.',
      actionNeeded: 'Банк көшірмесін жол бойынша салыстыру, жетіспейтін операцияны құжатпен енгізу.',
      evidence: `Көшірме қалдығы − 1С қалдығы = ${fmtKzt(diff, { sign: true })}. Көшірме жолдарын 1С операцияларымен салыстыру қажет.`,
      txIds: [], docIds: b.docId ? [b.docId] : [], potentialImpact: Math.abs(diff), severity: 'high', period: b.date.slice(0, 7), detectedOn: addDays(b.date, 2), ownerVisible: true,
    });
  }

  // R08 — жіктелмеген төлем
  for (const t of db.transactions.filter((x) => x.tenantId === tenantId && x.kind === 'unclassified_payment' && x.date <= asOf)) {
    out.push({
      ruleId: 'R08', dedupeKey: `R08:${t.id}`, tenantId, branchId: t.branchId,
      title: `Жіктелмеген төлем: ${fmtKzt(t.amount)}`,
      whatHappened: `${t.date}: ${t.description}.`,
      businessImpact: 'Шығын ба, аванс па, иесінің алымы ма — белгісіз. Операциялық пайда толық емес.',
      actionNeeded: 'Төлем мақсатын кәсіп иесінен растау және бапқа жіктеу.',
      evidence: 'Төлем тапсырмасында тағайындау бабы бос.',
      txIds: [t.id], docIds: t.docId ? [t.docId] : [], potentialImpact: t.amount, severity: 'medium', period: t.date.slice(0, 7), detectedOn: addDays(t.date, 1), ownerVisible: true,
    });
  }

  // R09 — мерзімі өткен дебиторлық
  for (const d of debts(db, tenantId, 'customer', asOf)) {
    if (d.maxDaysOverdue <= 30) continue;
    out.push({
      ruleId: 'R09', dedupeKey: `R09:${d.counterpartyId}:${asOf.slice(0, 7)}`, tenantId, branchId: null,
      title: `${d.name}: мерзімі өткен қарыз ${fmtKzt(d.overdue)}`,
      whatHappened: `${d.name} қарызы ${fmtKzt(d.outstanding)}, оның ${fmtKzt(d.overdue)} мерзімі өткен (ең ұзағы ${d.maxDaysOverdue} күн).`,
      businessImpact: 'Пайда бар, бірақ ақша клиентте тұр. Жеткізушілерге төлем мен жалақыға тәуекел.',
      actionNeeded: 'Салыстыру актісін жасау, төлем кестесін келісу, жаңа жөнелтуді шектеу туралы шешім.',
      evidence: `FIFO бойынша ашық құжаттар: ${d.items.length}. Бөлінісі: 1–30 күн ${fmtKzt(d.buckets.d1_30)}, 31–60 ${fmtKzt(d.buckets.d31_60)}, 60+ ${fmtKzt(d.buckets.d60p)}.`,
      txIds: d.items.filter((i) => i.ref !== 'opening').map((i) => i.ref), docIds: [], potentialImpact: d.overdue, severity: 'high', period: asOf.slice(0, 7), detectedOn: asOf, ownerVisible: true,
    });
  }

  // R11 — кеш синхрондау
  const conn = db.connections.find((c) => c.tenantId === tenantId);
  if (conn?.lastSuccessAt && hoursBetween(conn.lastSuccessAt, nowIso) > db.settings.staleAfterHours) {
    out.push({
      ruleId: 'R11', dedupeKey: `R11:${conn.id}:${conn.lastSuccessAt}`, tenantId, branchId: null,
      title: `Деректер ескі: соңғы синхрондау ${Math.round(hoursBetween(conn.lastSuccessAt, nowIso))} сағат бұрын`,
      whatHappened: `1С-тен соңғы сәтті жаңарту: ${conn.lastSuccessAt.slice(0, 16).replace('T', ' ')}. Кейінгі әрекеттер сәтсіз.`,
      businessImpact: 'Барлық көрсеткіш ескі деректермен көрсетілуде. Соңғы күндердің сатылымы мен төлемдері жоқ.',
      actionNeeded: 'Интегратор қосылымды тексеріп, синхрондауды қайта іске қосады.',
      evidence: `SyncRun журналы: соңғы сәтті — ${conn.lastSuccessAt}; шек — ${db.settings.staleAfterHours} сағат.`,
      txIds: [], docIds: [], potentialImpact: null, severity: 'medium', period: asOf.slice(0, 7), detectedOn: asOf, ownerVisible: true,
    });
  }

  // R12 — маржаның төмендеуі
  const full = months.slice(-2);
  if (full.length === 2) {
    for (const b of db.branches.filter((x) => x.tenantId === tenantId)) {
      const [m0, m1] = full;
      const p0 = pnl(db, { tenantId, branchId: b.id, from: `${m0}-01`, to: monthEnd(m0) });
      const p1 = pnl(db, { tenantId, branchId: b.id, from: `${m1}-01`, to: monthEnd(m1) });
      if (p0.grossMarginBp === null || p1.grossMarginBp === null) continue;
      const drop = p0.grossMarginBp - p1.grossMarginBp;
      if (drop <= 300) continue;
      const lost = Math.round((p1.netSales * drop) / 10000);
      out.push({
        ruleId: 'R12', dedupeKey: `R12:${b.id}:${m1}`, tenantId, branchId: b.id,
        title: `${b.name}: маржа ${fmtBp(p0.grossMarginBp)} → ${fmtBp(p1.grossMarginBp)}`,
        whatHappened: `Сатылым ${fmtKzt(p0.netSales)} → ${fmtKzt(p1.netSales)} (өсті), ал жалпы маржа ${(drop / 100).toFixed(1)} п.п. төмендеді.`,
        businessImpact: `Алдыңғы ай маржасымен салыстырғанда жалпы пайда шамамен ${fmtKzt(lost)} аз (есептеу: сатылым × маржа айырмасы).`,
        actionNeeded: 'Сатып алу бағасының өсуін және бөлшек бағаның жаңартылуын тексеру; негізгі 20 SKU бойынша баға шешімі.',
        evidence: `P&L: ${monthLabel(m0)} маржа ${fmtBp(p0.grossMarginBp)}, ${monthLabel(m1)} ${fmtBp(p1.grossMarginBp)}.`,
        txIds: [], docIds: [], potentialImpact: lost, severity: 'high', period: m1, detectedOn: addDays(monthEnd(m1), 1), ownerVisible: true,
      });
    }
  }

  // R13 — ақша жетіспеуі болжамы
  const cal = paymentCalendar(db, tenantId, asOf, 30);
  if (cal.firstShortage) {
    out.push({
      ruleId: 'R13', dedupeKey: `R13:${asOf.slice(0, 7)}`, tenantId, branchId: null,
      title: `Ақша жетіспеуі ықтимал: ${cal.firstShortage}`,
      whatHappened: `Төлем күнтізбесінің болжамы бойынша ${cal.firstShortage} күні қалдық теріс болуы мүмкін (ең төменгі ${fmtKzt(cal.minBalance)}). Бұл болжам, нақты ақша емес.`,
      businessImpact: 'Жеткізушіге немесе жалақыға төлем кешігуі мүмкін.',
      actionNeeded: 'Мерзімі өткен дебиторлықты жинау, төлемдер ретін келісу.',
      evidence: `Нақты қалдық ${fmtKzt(cal.actualBalance)} (${asOf}); шарттық төлемдер + 28 күн орташа сатылым болжамы.`,
      txIds: [], docIds: [], potentialImpact: Math.abs(cal.minBalance), severity: 'high', period: asOf.slice(0, 7), detectedOn: asOf, ownerVisible: true,
    });
  }

  // R14 — AI: жеке шығын болуы мүмкін
  for (const t of db.transactions.filter((x) => x.tenantId === tenantId && x.kind === 'expense' && x.category === 'other' && /автосервис|көлік|жеке/i.test(x.description) && x.date <= asOf)) {
    out.push({
      ruleId: 'R14', dedupeKey: `R14:${t.id}`, tenantId, branchId: t.branchId,
      title: `Жеке шығын болуы мүмкін: ${fmtKzt(t.amount)}`,
      whatHappened: `${t.date}: «${t.description}» операциялық шығын ретінде жіктелген.`,
      businessImpact: 'Егер жеке шығын болса — операциялық пайда төмен көрсетілген, ал иесінің алымы есепке алынбаған. Расталмаған.',
      actionNeeded: 'Кәсіп иесі растасын: бизнес шығыны ма, жеке шығын ба.',
      evidence: 'AI белгілері: контрагент түрі (автосервис), компанияның балансында көлік жоқ (demo дерек). Ықтималдық бағасы: орташа.',
      txIds: [t.id], docIds: t.docId ? [t.docId] : [], potentialImpact: t.amount, severity: 'low', period: t.date.slice(0, 7), detectedOn: addDays(t.date, 1), ownerVisible: true,
    });
  }

  // R10 — кезең жабылуына кедергі (басқа ережелерден кейін)
  for (const m of months) {
    if (isMonthClosed(db, tenantId, m)) continue;
    if (diffDays(asOf, monthEnd(m)) <= 5) continue;
    const blockers = out.filter((d) => d.period === m && RULES.find((r) => r.id === d.ruleId)?.blocksPeriodClose);
    if (!blockers.length) continue;
    out.push({
      ruleId: 'R10', dedupeKey: `R10:${tenantId}:${m}`, tenantId, branchId: null,
      title: `${monthLabel(m)} жабылмай тұр: ${blockers.length} кедергі`,
      whatHappened: `Ай аяқталғаннан кейін ${diffDays(asOf, monthEnd(m))} күн өтті. Кедергілер: ${blockers.map((b) => b.title).join('; ')}.`,
      businessImpact: 'Осы айдың пайдасы «Алдын ала есеп» болып қалады; таза пайда есептелмейді.',
      actionNeeded: 'Кедергі мәселелерді шешіп, ай жабу чек-листін аяқтау.',
      evidence: `Ай жабу чек-листі және ${blockers.length} бөгеуші тексеру нәтижесі.`,
      txIds: [], docIds: [], potentialImpact: null, severity: 'high', period: m, detectedOn: addDays(monthEnd(m), 6), ownerVisible: false,
    });
  }
  return out;
}

export function makeFinding(id: ID, d: Detected): Finding {
  const rule = RULES.find((r) => r.id === d.ruleId)!;
  const at = `${d.detectedOn}T07:00:00+05:00`;
  return {
    id,
    tenantId: d.tenantId,
    branchId: d.branchId,
    ruleId: d.ruleId,
    kind: rule.kind,
    dedupeKey: d.dedupeKey,
    title: d.title,
    whatHappened: d.whatHappened,
    businessImpact: d.businessImpact,
    actionNeeded: d.actionNeeded,
    evidence: d.evidence,
    txIds: d.txIds,
    docIds: d.docIds,
    potentialImpact: d.potentialImpact,
    confirmedImpact: null,
    detectedAt: at,
    severity: d.severity,
    assigneeId: null,
    dueDate: null,
    status: 'new',
    history: [{ at, by: 'system', from: null, to: 'new', note: rule.kind === 'ai' ? 'AI күмәні — тексеру керек' : `Ереже ${rule.code}` }],
    taskId: null,
    period: d.period,
    ownerVisible: d.ownerVisible,
  };
}

/** Жаңа мәселелерді қосады; бар dedupeKey қайталанбайды. Қосылғандар санын қайтарады. */
export function runChecks(db: Db, tenantId: ID, asOf: ISODate, nowIso: string, nextId: () => string): Finding[] {
  const existing = new Set(db.findings.filter((f) => f.tenantId === tenantId).map((f) => f.dedupeKey));
  const created: Finding[] = [];
  for (const d of detect(db, tenantId, asOf, nowIso)) {
    if (existing.has(d.dedupeKey)) continue;
    const f = makeFinding(nextId(), d);
    db.findings.push(f);
    existing.add(d.dedupeKey);
    created.push(f);
  }
  return created;
}

/** Ықтимал және расталған әсер — операциялар бірнеше тексеруге түссе де бір рет есептеледі. */
export function impactSummary(findings: Finding[], db: Db) {
  const open = findings.filter((f) => f.status !== 'not_an_error' && f.status !== 'closed');
  const seenTx = new Set<ID>();
  let potential = 0;
  let unquantified = 0;
  let overlap = 0;
  for (const f of open) {
    if (f.potentialImpact === null) {
      unquantified++;
      continue;
    }
    if (f.txIds.length) {
      const fresh = f.txIds.filter((id) => !seenTx.has(id));
      if (fresh.length < f.txIds.length) overlap++;
      const freshAmt = sum(fresh.map((id) => db.transactions.find((t) => t.id === id)?.amount ?? 0));
      potential += Math.min(f.potentialImpact, freshAmt || (fresh.length ? f.potentialImpact : 0));
      fresh.forEach((id) => seenTx.add(id));
    } else potential += f.potentialImpact;
  }
  const confirmed = sum(findings.filter((f) => f.confirmedImpact !== null).map((f) => f.confirmedImpact as Money));
  return { potential, confirmed, unquantified, overlap, openCount: open.length };
}

/** Қайта тексеру: ереже қазіргі деректе әлі де орындала ма */
export function recheckFinding(db: Db, f: Finding, asOf: ISODate, nowIso: string): { passed: boolean; detail: string } {
  const still = detect(db, f.tenantId, asOf, nowIso).some((d) => d.dedupeKey === f.dedupeKey);
  return still
    ? { passed: false, detail: `Ереже ${f.ruleId} әлі де сәйкессіздік көрсетеді. Түзету 1С-те көрінбейді.` }
    : { passed: true, detail: `Ереже ${f.ruleId} қайта іске қосылды: сәйкессіздік табылмады.` };
}
