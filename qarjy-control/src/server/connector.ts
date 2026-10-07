/**
 * 1С интеграция қабаты.
 * Connector интерфейсі әр конфигурацияға жеке адаптер жазуға мүмкіндік береді (OData / HTTP-сервис / файл).
 * MVP-де тек MockConnector жұмыс істейді: нақты 1С-ке қосылмайды, тек оқу режимін симуляциялайды.
 */
import type { Db, Finding, ID, IntegrationConnection, SyncRun, Transaction } from '../domain/types';
import { mulDiv, tenge } from '../domain/money';

export interface PullResult {
  received: number;
  created: number;
  updated: number;
  duplicatesSkipped: number;
}

export interface Connector {
  readonly name: string;
  readonly isMock: boolean;
  testConnection(conn: IntegrationConnection, attempt: number): { ok: boolean; error?: string };
  pullIncremental(db: Db, conn: IntegrationConnection): PullResult;
}

/** Нақты адаптерлер үшін орын (кейінгі кезең). Әдейі іске асырылмаған. */
export class ODataConnectorNotImplemented implements Connector {
  readonly name = 'OData адаптер (кейінгі кезең)';
  readonly isMock = false;
  testConnection(): { ok: boolean; error?: string } {
    return { ok: false, error: 'OData адаптері MVP-де іске асырылмаған' };
  }
  pullIncremental(): PullResult {
    throw new Error('Іске асырылмаған');
  }
}

export class MockConnector implements Connector {
  readonly name = 'MockConnector';
  readonly isMock = true;

  testConnection(conn: IntegrationConnection, attempt: number) {
    // «Кешіккен» қосылым: бірінші әрекет сәтсіз, қайта орындау сәтті (retry логикасын көрсету үшін)
    if (conn.status === 'delayed' && attempt === 1) return { ok: false, error: '1С серверіне қосылу уақыты бітті (timeout 30 с) — Mock' };
    return { ok: true };
  }

  /** Кезектегі 1С деректерін оқу. external_id бойынша идемпотентті. */
  pullIncremental(db: Db, conn: IntegrationConnection): PullResult {
    const res: PullResult = { received: 0, created: 0, updated: 0, duplicatesSkipped: 0 };
    const batches = db.mockSourceQueue.filter((q) => q.tenantId === conn.tenantId);
    const seenTx = new Set(db.transactions.filter((t) => t.tenantId === conn.tenantId).map((t) => t.externalId));
    const seenDoc = new Set(db.documents.filter((d) => d.tenantId === conn.tenantId).map((d) => d.externalId));
    for (const b of batches) {
      for (const d of b.documents) {
        res.received++;
        if (seenDoc.has(d.externalId)) res.duplicatesSkipped++;
        else {
          db.documents.push({ ...d });
          seenDoc.add(d.externalId);
          res.created++;
        }
      }
      for (const t of b.transactions) {
        res.received++;
        if (seenTx.has(t.externalId)) res.duplicatesSkipped++;
        else {
          db.transactions.push({ ...t });
          seenTx.add(t.externalId);
          res.created++;
        }
      }
    }
    // Кезек тазартылмайды: қайта синхрондау дубль жасамайтынын көрсету үшін (duplicatesSkipped өседі)
    return res;
  }
}

export const CONNECTORS: Record<string, Connector> = { mock: new MockConnector(), odata: new ODataConnectorNotImplemented(), http_service: new ODataConnectorNotImplemented() };

/**
 * Mock: бухгалтер 1С-те жасаған түзетуді «қайта оқу» кезінде платформаға түскендей етіп қолдану.
 * Нақты интеграцияда бұл функция болмайды — түзету 1С-тен келесі синхрондауда өздігінен келеді.
 */
export function applySimulatedSourceFix(db: Db, f: Finding, nextId: () => string, ownerDecisionNote?: string): string {
  const tx = (id: ID) => db.transactions.find((t) => t.id === id);
  switch (f.ruleId) {
    case 'R02': {
      for (const docId of f.docIds) {
        const d = db.documents.find((x) => x.id === docId);
        if (!d || d.posted) continue;
        d.posted = true;
        const cash = db.accounts.find((a) => a.tenantId === d.tenantId && a.branchId === d.branchId && a.kind === 'cash');
        db.transactions.push({ id: nextId(), tenantId: d.tenantId, branchId: d.branchId!, date: d.date, kind: 'sale_return', amount: d.amount, cost: mulDiv(d.amount, 775, 1000), settlement: 'cash', accountId: cash?.id ?? null, docId: d.id, externalId: `${d.externalId}:posted`, description: `Тауар қайтарымы №${d.number}` });
      }
      return 'Құжат(тар) 1С-те өткізілді; қайтарым операциясы оқылды.';
    }
    case 'R03':
    case 'R07': {
      if (f.dedupeKey.startsWith('R03:doc:')) {
        for (const id of f.docIds) {
          const d = db.documents.find((x) => x.id === id);
          if (d) d.hasPrimaryFile = true;
        }
        return 'Бастапқы құжаттың скан нұсқасы тіркелді.';
      }
      // Қонаев жалдау шығыны — банк көшірмесіндегі 05.09 төлем
      const exists = db.transactions.some((t) => t.tenantId === f.tenantId && t.externalId === 'fix:rent:b13:2026-09');
      if (!exists && f.tenantId === 't1') {
        const docId = nextId();
        db.documents.push({ id: docId, tenantId: 't1', branchId: 'b13', externalId: '1c:t1:act:rent-b13-2026-09', type: 'service_act', number: 'АКТ-ЖАЛ-b13-2026-09', date: '2026-09-05', counterpartyId: db.counterparties.find((c) => c.name.startsWith('Қонаев Сауда'))?.id ?? null, amount: tenge(700_000), posted: true, hasPrimaryFile: true, sourceAuthor: 'Дәурен М. (1С аудит)', source: 'mock_1c' });
        db.transactions.push({ id: nextId(), tenantId: 't1', branchId: 'b13', date: '2026-09-05', kind: 'expense', category: 'rent', amount: tenge(700_000), accountId: 'a1_bank', docId, externalId: 'fix:rent:b13:2026-09', description: 'Жалдау · Қонаев дүкені (акт кейін енгізілді)' });
        return 'Қыркүйек жалдау актісі мен банк төлемі 1С-те енгізілді.';
      }
      return 'Түзету бұрын қолданылған.';
    }
    case 'R04': {
      const [, branchId, sku] = f.dedupeKey.split(':');
      const s = db.stock.find((x) => x.tenantId === f.tenantId && x.branchId === branchId && x.sku === sku);
      if (s && s.qty < 0) s.qty = 25;
      return 'Кіріс құжаты дұрыс күнмен өткізілді; қалдық қайта есептелді.';
    }
    case 'R05': {
      for (const id of f.txIds) {
        const t = tx(id);
        if (t && (t.cost === null || t.cost === undefined)) t.cost = mulDiv(t.amount, 74, 100);
      }
      return 'Жаңа SKU кіріс бағасы енгізілді; өзіндік құн есептелді.';
    }
    case 'R06': {
      const c = db.cashCounts.find((x) => f.dedupeKey === `R06:${x.id}`);
      if (c && !db.transactions.some((t) => t.externalId === `fix:cash:${c.id}`)) {
        // Demo: айырма сомасы кассир түсініктемесімен шаруашылық шығын ретінде расталды
        const t: Transaction = { id: nextId(), tenantId: c.tenantId, branchId: c.branchId, date: c.date, kind: 'expense', category: 'other', amount: tenge(85_000), accountId: c.accountId, docId: null, externalId: `fix:cash:${c.id}`, description: 'Кассадан шаруашылық шығын (кассир түсініктемесімен енгізілді)' };
        db.transactions.push(t);
      }
      return 'Кассалық шығын құжаты енгізілді (кассир түсініктемесі).';
    }
    case 'R08':
    case 'R14': {
      for (const id of f.txIds) {
        const t = tx(id);
        if (!t) continue;
        const personal = /жеке|алым|личн/i.test(ownerDecisionNote ?? '');
        if (personal) {
          t.kind = 'owner_personal_expense';
          t.category = undefined;
        } else {
          t.kind = 'expense';
          t.category = t.category ?? 'other';
        }
        t.description += ` (жіктелді: ${personal ? 'иесінің жеке шығыны' : 'бизнес шығыны'})`;
      }
      return 'Төлем 1С-те кәсіп иесінің шешімі бойынша жіктелді.';
    }
    default:
      return 'Бұл ереже үшін дерек түзетуі қолданылмайды.';
  }
}

export function newSyncRun(p: Omit<SyncRun, 'id'>, id: ID): SyncRun {
  return { id, ...p };
}
