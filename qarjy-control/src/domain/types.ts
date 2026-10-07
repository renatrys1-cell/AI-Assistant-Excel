import type { Money } from './money';

export type ID = string;
export type ISODate = string; // YYYY-MM-DD (Asia/Almaty күні)
export type ISODateTime = string; // ISO 8601

// ───────── Ұйымдар мен пайдаланушылар ─────────

export type Industry = 'retail' | 'wholesale';
export type ServiceMode = 'control' | 'outsourcing';

export interface Tenant {
  id: ID;
  name: string;
  industry: Industry;
  serviceMode: ServiceMode;
  isDemo: boolean;
  status: 'active' | 'onboarding';
  createdAt: ISODateTime;
  contactPerson: string;
  contactPhone: string;
  description: string;
}

export interface LegalEntity {
  id: ID;
  tenantId: ID;
  name: string;
  bin: string; // demo
  taxRegimeNote: string; // жергілікті маман растауы керек
}

export interface Branch {
  id: ID;
  tenantId: ID;
  name: string;
  kind: 'store' | 'warehouse';
  city: string;
  /** 2026-07-01 басындағы тауар қалдығы (өзіндік құн бойынша) */
  openingInventory: Money;
}

export interface User {
  id: ID;
  name: string;
  title: string;
  email: string;
  mfaEnabled: boolean;
  active: boolean;
  capacityUnitsPerMonth?: number; // бухгалтер жүктемесі үшін (күрделілік бірлігі)
}

export type Role =
  | 'owner'
  | 'client_manager'
  | 'accountant'
  | 'chief_accountant'
  | 'service_lead'
  | 'integrator'
  | 'platform_admin';

export interface Membership {
  id: ID;
  userId: ID;
  /** null — платформа деңгейіндегі рөл (тек platform_admin) */
  tenantId: ID | null;
  role: Role;
  /** Интегратор / менеджер үшін қаржылық ақпаратқа бөлек рұқсат */
  financeAccess?: boolean;
  /** Уақытша рұқсат (әкімшіге) — мерзімі */
  expiresAt?: ISODateTime;
  revokedAt?: ISODateTime;
}

// ───────── Интеграция ─────────

export type ConnectionMethod = 'odata' | 'http_service' | 'csv' | 'mock';

export interface IntegrationConnection {
  id: ID;
  tenantId: ID;
  configuration: string; // мысалы "1С:Бухгалтерия для Казахстана 3.0" (demo)
  version: string;
  hosting: 'on_premise' | 'cloud_vps' | 'saas_1c' | 'unknown';
  method: ConnectionMethod;
  mode: 'read_only';
  adapter: string; // адаптер атауы
  isMock: boolean;
  status: 'ok' | 'delayed' | 'error' | 'not_connected';
  lastSuccessAt: ISODateTime | null;
  lastAttemptAt: ISODateTime | null;
  /** 1С өрісі → платформа өрісі */
  fieldMapping: Record<string, string>;
  hasSourceAuditInfo: boolean; // 1С-те өзгеріс авторы туралы аудит дерегі бар ма
  licenseNote: string; // 1С лицензиясы клиенттікі
}

export interface SyncRun {
  id: ID;
  tenantId: ID;
  connectionId: ID;
  kind: 'initial' | 'incremental' | 'csv_import' | 'recheck';
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  status: 'success' | 'failed' | 'partial' | 'retrying';
  attempt: number;
  received: number;
  created: number;
  updated: number;
  duplicatesSkipped: number;
  error?: string;
  note?: string;
}

// ───────── Бастапқы деректер ─────────

export type DocType =
  | 'retail_receipt_z' // Z-есеп / бөлшек сатылым
  | 'sales_invoice' // жүкқұжат (көтерме сатылым)
  | 'sales_return'
  | 'purchase_invoice'
  | 'bank_statement_line'
  | 'cash_order'
  | 'payroll'
  | 'service_act'
  | 'inventory_count'
  | 'transfer_order'
  | 'other';

export interface SourceDocument {
  id: ID;
  tenantId: ID;
  branchId: ID | null;
  externalId: string; // 1С сілтемесі / импорт кілті
  type: DocType;
  number: string;
  date: ISODate;
  counterpartyId: ID | null;
  amount: Money;
  posted: boolean;
  /** Бастапқы құжаттың файлы (скан/ЭСФ) бар ма */
  hasPrimaryFile: boolean;
  /** 1С аудит дерегі болса ғана толтырылады. Платформа тапсырма орындаушысы ЕМЕС. */
  sourceAuthor: string | null;
  source: 'mock_1c' | 'csv' | 'upload';
  note?: string;
  uploadedBy?: ID;
}

export type MoneyAccountKind = 'bank' | 'cash';

export interface MoneyAccount {
  id: ID;
  tenantId: ID;
  branchId: ID | null;
  kind: MoneyAccountKind;
  name: string;
  /** 2026-07-01 басындағы қалдық */
  openingBalance: Money;
}

export interface Counterparty {
  id: ID;
  tenantId: ID;
  name: string;
  kind: 'customer' | 'supplier';
  paymentTermsDays: number;
  /** 2026-07-01 басындағы қарыз қалдығы (клиент бізге / біз жеткізушіге) */
  openingBalance: Money;
  openingDueDate: ISODate;
  responsibleUserId: ID | null;
  nextAction: string;
}

export type TxKind =
  | 'sale' // сатылым (табыс), cost — өзіндік құн
  | 'sale_return'
  | 'purchase' // тауар сатып алу (қойма ↑)
  | 'customer_payment' // клиенттен түсім (дебиторлық ↓)
  | 'supplier_payment' // жеткізушіге төлем (кредиторлық ↓)
  | 'expense' // операциялық шығын
  | 'tax_payment' // салық төлемі (ақша қозғалысы)
  | 'other_income'
  | 'other_expense'
  | 'transfer' // ішкі аударым — кіріс емес
  | 'owner_contribution'
  | 'owner_withdrawal'
  | 'owner_personal_expense'
  | 'unclassified_payment';

export type Settlement = 'cash' | 'bank' | 'credit';

export interface Transaction {
  id: ID;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  kind: TxKind;
  amount: Money; // әрқашан оң
  /** Сатылым үшін өзіндік құн. null — өзіндік құн белгісіз (0 емес!) */
  cost?: Money | null;
  settlement?: Settlement; // sale / purchase
  accountId?: ID | null; // ақша шоты (bank/cash), credit болса null
  toAccountId?: ID | null; // transfer үшін
  counterpartyId?: ID | null;
  dueDate?: ISODate; // credit сатылым/сатып алу үшін
  category?: ExpenseCategory;
  docId: ID | null;
  externalId: string;
  description: string;
}

export type ExpenseCategory = 'rent' | 'salary' | 'utilities' | 'marketing' | 'logistics' | 'bank_fees' | 'other';

export interface StockLine {
  id: ID;
  tenantId: ID;
  branchId: ID;
  sku: string;
  name: string;
  qty: number;
  unitCost: Money | null;
  asOf: ISODate;
}

export interface CashCount {
  id: ID;
  tenantId: ID;
  branchId: ID;
  accountId: ID;
  date: ISODate;
  counted: Money;
  countedBy: string;
  docId: ID | null;
}

export interface BankStatementBalance {
  id: ID;
  tenantId: ID;
  accountId: ID;
  date: ISODate;
  closingBalance: Money;
  docId: ID | null;
}

export interface MonthPlan {
  tenantId: ID;
  branchId: ID;
  month: string; // YYYY-MM
  sales: Money;
  grossProfit: Money;
  opex: Money;
}

// ───────── Тексерулер мен мәселелер ─────────

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface CheckRule {
  id: ID;
  code: string;
  name: string;
  kind: 'rule' | 'ai';
  description: string;
  defaultSeverity: Severity;
  blocksPeriodClose: boolean;
}

export type FindingStatus =
  | 'new'
  | 'in_review'
  | 'waiting_client'
  | 'fix_proposed'
  | 'approved'
  | 'rechecked'
  | 'closed'
  | 'not_an_error';

export interface StatusChange {
  at: ISODateTime;
  by: ID;
  from: FindingStatus | null;
  to: FindingStatus;
  note?: string;
}

export interface Finding {
  id: ID;
  tenantId: ID;
  branchId: ID | null;
  ruleId: ID;
  kind: 'rule' | 'ai';
  dedupeKey: string;
  title: string;
  whatHappened: string;
  businessImpact: string;
  actionNeeded: string;
  evidence: string;
  txIds: ID[];
  docIds: ID[];
  /** Ықтимал әсер — расталмаған. Бірнеше тексеруге түскен операция қайталап қосылмайды. */
  potentialImpact: Money | null;
  /** Тексеруден кейін расталған әсер. Расталмаса null. */
  confirmedImpact: Money | null;
  detectedAt: ISODateTime;
  severity: Severity;
  assigneeId: ID | null;
  dueDate: ISODate | null;
  status: FindingStatus;
  history: StatusChange[];
  notAnErrorReason?: string;
  fixEvidence?: string;
  /** Түзету 1С-те жасалды деп белгіленді (Mock: келесі қайта оқуда қолданылады) */
  sourceFixPending?: boolean;
  recheck?: { at: ISODateTime; passed: boolean; detail: string; syncRunId: ID | null };
  taskId: ID | null;
  period: string; // YYYY-MM
  ownerVisible: boolean; // кәсіпкерге көрсетілетін бизнес-мәселе ме
}

// ───────── Тапсырмалар ─────────

export type TaskStatus = 'todo' | 'in_progress' | 'waiting_client' | 'in_review' | 'returned' | 'done' | 'cancelled';
export type Complexity = 'simple' | 'standard' | 'complex';

export interface TaskComment {
  id: ID;
  at: ISODateTime;
  by: ID;
  text: string;
}

export interface TaskEvidence {
  id: ID;
  at: ISODateTime;
  by: ID;
  kind: 'source_fix' | 'document' | 'explanation' | 'reconciliation';
  text: string;
  docId?: ID | null;
}

export interface Task {
  id: ID;
  tenantId: ID;
  title: string;
  opType: string;
  description: string;
  findingId: ID | null;
  docIds: ID[];
  assigneeId: ID | null;
  reviewerId: ID | null;
  /** Клиент тарапынан орындаушы (менеджер/иесі), егер тапсырма клиентке берілсе */
  clientAssigneeId?: ID | null;
  complexity: Complexity;
  plannedDue: ISODate;
  status: TaskStatus;
  createdAt: ISODateTime;
  createdBy: ID;
  source: 'finding' | 'ai' | 'manual' | 'checklist' | 'decision';
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  waitReason: string | null;
  comments: TaskComment[];
  evidence: TaskEvidence[];
  reviewResult: { decision: 'accepted' | 'returned'; by: ID; at: ISODateTime; note: string } | null;
  returnCount: number;
  /** Кәсіпкердің шешімін күтетін тапсырма */
  needsOwnerDecision?: boolean;
  ownerDecision?: { decision: 'approved' | 'rejected'; by: ID; at: ISODateTime; note: string } | null;
  period: string;
}

export interface TaskEvent {
  id: ID;
  tenantId: ID;
  taskId: ID;
  at: ISODateTime;
  by: ID;
  type: 'created' | 'status' | 'assigned' | 'comment' | 'evidence' | 'review' | 'decision';
  from?: string | null;
  to?: string | null;
  note?: string;
}

export interface Review {
  id: ID;
  tenantId: ID;
  taskId: ID;
  reviewerId: ID;
  decision: 'accepted' | 'returned';
  note: string;
  at: ISODateTime;
  attempt: number;
}

export interface WorkLog {
  id: ID;
  tenantId: ID;
  taskId: ID;
  userId: ID;
  date: ISODate;
  minutes: number;
}

// ───────── Кезең жабу ─────────

export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
  by: ID | null;
  at: ISODateTime | null;
  note: string;
}

export interface PeriodClose {
  id: ID;
  tenantId: ID;
  period: string; // YYYY-MM
  status: 'open' | 'in_progress' | 'closed';
  checklist: ChecklistItem[];
  /** Ай жабылғанда есептелген корпоративтік табыс салығы (demo мән, нақты есептеуді бухгалтер жүргізеді) */
  incomeTaxAccrual: Money | null;
  closedBy: ID | null;
  closedAt: ISODateTime | null;
  approvedBy: ID | null;
}

// ───────── Қызмет және төлем ─────────

export type TariffCode = 'control' | 'accounting' | 'partner';

export interface ServiceAgreement {
  id: ID;
  tenantId: ID;
  tariff: TariffCode;
  mode: ServiceMode;
  /** Demo мән. Нарық бағасы емес. null — жеке есептеледі */
  monthlyFee: Money | null;
  includedUnitsPerMonth: number; // күрделілік бірлігімен лимит
  includedWorks: string[];
  excludedWorks: string[];
  clientDocuments: { name: string; deadline: string }[];
  clientDuties: string[];
  ourDuties: string[];
  responsibleAccountantId: ID | null;
  reviewerId: ID | null;
  serviceLeadId: ID | null;
  slaResponseHours: number;
  startDate: ISODate;
  restoration: { needed: boolean; estimateHours: number | null; fee: Money | null; status: 'not_needed' | 'estimate' | 'agreed' | 'in_progress' | 'done' } | null;
  /** Demo: тікелей шығын болжамы (қызмет экономикасы үшін) */
  directCosts: { hourlyLaborCost: Money; integrationAndAi: Money; other: Money };
  extraWorkProposals: { id: ID; period: string; units: number; amount: Money | null; status: 'draft' | 'sent' | 'accepted' | 'declined'; note: string }[];
}

export interface Subscription {
  id: ID;
  tenantId: ID;
  tariff: TariffCode;
  status: 'active' | 'trial' | 'paused';
  since: ISODate;
  /** 1С лицензиясы — бөлек, клиенттікі. Біздің жазылымға кірмейді. */
  oneCLicense: string;
}

// ───────── Аудит ─────────

export interface AuditEvent {
  id: ID;
  at: ISODateTime;
  userId: ID;
  role: Role | null;
  tenantId: ID | null;
  action: string;
  entity: string;
  entityId: ID | null;
  result: 'ok' | 'denied' | 'error';
  details: string;
}

// ───────── Баптаулар ─────────

export interface Settings {
  platformName: string;
  lang: 'kk' | 'ru';
  /** Күрделілік коэффициенттері (demo) — қызмет жетекшісі баптайды */
  complexityWeights: Record<Complexity, number>;
  staleAfterHours: number;
  density: 'comfortable' | 'compact';
}

export interface Db {
  version: number;
  settings: Settings;
  tenants: Tenant[];
  legalEntities: LegalEntity[];
  branches: Branch[];
  users: User[];
  memberships: Membership[];
  connections: IntegrationConnection[];
  syncRuns: SyncRun[];
  documents: SourceDocument[];
  accounts: MoneyAccount[];
  counterparties: Counterparty[];
  transactions: Transaction[];
  stock: StockLine[];
  cashCounts: CashCount[];
  bankBalances: BankStatementBalance[];
  plans: MonthPlan[];
  rules: CheckRule[];
  findings: Finding[];
  tasks: Task[];
  taskEvents: TaskEvent[];
  reviews: Review[];
  workLogs: WorkLog[];
  periodCloses: PeriodClose[];
  agreements: ServiceAgreement[];
  subscriptions: Subscription[];
  audit: AuditEvent[];
  /** MockConnector: 1С-те бар, бірақ платформаға әлі оқылмаған деректер (кешіккен синхрондауды көрсету үшін) */
  mockSourceQueue: { tenantId: ID; transactions: Transaction[]; documents: SourceDocument[] }[];
  seq: number;
  /** Қызмет жетекшісінің сапалық бағалауы (KPI-ді толықтырады, жалақыға автоматты әсер етпейді) */
  leadAssessments?: { id: ID; userId: ID; period: string; note: string; by: ID; at: ISODateTime }[];
  /** Demo сағатының базасы: DEMO_NOW + (Date.now() − clockBaseMs) */
  clockBaseMs: number;
}
