/**
 * CSV demo-импорт. Идемпотентті: external_id бойынша (tenant ішінде) қайталанған жол дубль жасамайды.
 * Сомалар жолдан тиынға дәл айналдырылады (float қолданылмайды).
 */
import type { Db, ID, Transaction, TxKind, Settlement, ExpenseCategory, SourceDocument } from './types';
import { tenge } from './money';

export const CSV_COLUMNS = ['external_id', 'date', 'branch', 'kind', 'amount', 'cost', 'settlement', 'counterparty', 'category', 'description'] as const;

export const CSV_SAMPLE = `external_id;date;branch;kind;amount;cost;settlement;counterparty;category;description
CSV-0001;2026-10-06;{BRANCH};sale;125000,00;98000,00;cash;;;CSV demo: бөлшек сатылым
CSV-0002;2026-10-06;{BRANCH};expense;45000,00;;bank;;utilities;CSV demo: коммуналдық төлем
CSV-0003;2026-10-06;{BRANCH};sale;87000,50;;bank;;;CSV demo: өзіндік құны жоқ сатылым`;

const KINDS: TxKind[] = ['sale', 'sale_return', 'purchase', 'customer_payment', 'supplier_payment', 'expense', 'tax_payment', 'other_income', 'other_expense', 'owner_contribution', 'owner_withdrawal', 'owner_personal_expense', 'unclassified_payment'];
const CATS: ExpenseCategory[] = ['rent', 'salary', 'utilities', 'marketing', 'logistics', 'bank_fees', 'other'];

export interface ImportResult {
  received: number;
  created: number;
  updated: number;
  duplicatesSkipped: number;
  errors: { line: number; message: string }[];
  createdIds: ID[];
}

export function parseCsv(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length);
  const sep = lines[0]?.includes(';') ? ';' : ',';
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
}

function fingerprint(t: Partial<Transaction>): string {
  return [t.date, t.branchId, t.kind, t.amount, t.cost ?? 'null', t.settlement, t.counterpartyId ?? '', t.category ?? '', t.description].join('|');
}

export function importCsv(db: Db, tenantId: ID, text: string, nextId: () => string): ImportResult {
  const rows = parseCsv(text);
  const res: ImportResult = { received: 0, created: 0, updated: 0, duplicatesSkipped: 0, errors: [], createdIds: [] };
  if (!rows.length) return res;
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  for (const req of ['external_id', 'date', 'branch', 'kind', 'amount']) {
    if (idx(req) < 0) {
      res.errors.push({ line: 1, message: `Міндетті баған жоқ: ${req}` });
      return res;
    }
  }
  const branches = db.branches.filter((b) => b.tenantId === tenantId);
  const accounts = db.accounts.filter((a) => a.tenantId === tenantId);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: string) => (idx(k) >= 0 ? r[idx(k)] ?? '' : '');
    res.received++;
    try {
      const ext = get('external_id');
      if (!ext) throw new Error('external_id бос');
      const date = get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Күн форматы қате: ${date}`);
      const br = branches.find((b) => b.id === get('branch') || b.name === get('branch'));
      if (!br) throw new Error(`Филиал табылмады: ${get('branch')} (тек осы компанияның филиалдары)`);
      const kind = get('kind') as TxKind;
      if (!KINDS.includes(kind)) throw new Error(`Операция түрі белгісіз: ${kind}`);
      const amount = tenge(get('amount'));
      if (amount <= 0) throw new Error('Сома оң болуы керек');
      const costRaw = get('cost');
      const cost = costRaw === '' ? (kind === 'sale' ? null : undefined) : tenge(costRaw);
      const settlement = (get('settlement') || (kind === 'sale' || kind === 'purchase' ? 'cash' : 'bank')) as Settlement;
      const category = (get('category') || undefined) as ExpenseCategory | undefined;
      if (category && !CATS.includes(category)) throw new Error(`Шығын бабы белгісіз: ${category}`);
      const cpName = get('counterparty');
      const cp = cpName ? db.counterparties.find((c) => c.tenantId === tenantId && c.name === cpName) : null;
      if (cpName && !cp) throw new Error(`Контрагент табылмады: ${cpName}`);
      const acc =
        settlement === 'credit'
          ? null
          : settlement === 'cash'
            ? accounts.find((a) => a.kind === 'cash' && a.branchId === br.id) ?? accounts.find((a) => a.kind === 'cash')
            : accounts.find((a) => a.kind === 'bank');
      const tx: Transaction = {
        id: '',
        tenantId,
        branchId: br.id,
        date,
        kind,
        amount,
        ...(cost !== undefined ? { cost } : {}),
        settlement: kind === 'sale' || kind === 'purchase' || kind === 'sale_return' ? settlement : undefined,
        accountId: acc?.id ?? null,
        counterpartyId: cp?.id ?? null,
        category,
        docId: null,
        externalId: `csv:${ext}`,
        description: get('description') || `CSV импорт ${ext}`,
      };
      const existing = db.transactions.find((t) => t.tenantId === tenantId && t.externalId === tx.externalId);
      if (existing) {
        if (fingerprint(existing) === fingerprint(tx)) res.duplicatesSkipped++;
        else {
          Object.assign(existing, { ...tx, id: existing.id, docId: existing.docId });
          res.updated++;
        }
        continue;
      }
      tx.id = nextId();
      const doc: SourceDocument = {
        id: nextId(), tenantId, branchId: br.id, externalId: tx.externalId, type: kind === 'sale' ? 'retail_receipt_z' : kind === 'expense' ? 'service_act' : 'other',
        number: ext, date, counterpartyId: cp?.id ?? null, amount, posted: true, hasPrimaryFile: false, sourceAuthor: null, source: 'csv', note: 'CSV demo-импорт',
      };
      tx.docId = doc.id;
      db.documents.push(doc);
      db.transactions.push(tx);
      res.created++;
      res.createdIds.push(tx.id);
    } catch (e) {
      res.errors.push({ line: i + 1, message: (e as Error).message });
    }
  }
  return res;
}
