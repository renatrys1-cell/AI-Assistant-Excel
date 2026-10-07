/**
 * DEMO AI көмекші. Нақты LLM қосылмаған.
 * Қаржылық сандарды ТЕК тексерілетін есептеу қабаты (domain/finance) шығарады; бұл модуль оларды түсіндіреді.
 * Сұрақтағы немесе құжаттағы мәтін жүйелік ережелерді өзгерте алмайды.
 * AI: құжат өткізбейді, 1С-ті өзгертпейді, төлем жасамайды, салық есебін жібермейді.
 */
import type { Db, ID, Complexity } from '../domain/types';
import { pnl, debts, cashFlow, profitToCashBridge, dataFreshness, inventoryAt } from '../domain/finance';
import { fmtKzt, fmtBp, sum } from '../domain/money';
import { monthLabel, fmtDateTime, monthEnd, diffDays } from '../domain/periods';
import { OPEN_FINDING_STATUSES } from '../domain/checks';

export interface AiAnswer {
  lang: 'kk' | 'ru';
  intent: string;
  question: string;
  summary: string;
  confirmed: string[];
  hypotheses: string[];
  actions: string[];
  responsible: string;
  due: string;
  sources: string[];
  updatedAt: string;
  dataSent: string[];
  insufficient?: string;
  suggestedTask?: { title: string; description: string; opType: string; complexity: Complexity };
  guardrail?: string;
}

export const SUGGESTED_QUESTIONS = [
  'Осы айда пайда неге азайды?',
  'Қай дүкеннің маржасы төмендеді?',
  'Кассада ақша бар, бірақ пайда аз. Неге?',
  'Қай клиент төлемді кешіктіріп жүр?',
  'Бухгалтерлердің қандай жұмысы кешікті?',
  'Осы аптада қандай шешім қабылдауым керек?',
  'Почему уменьшилась прибыль в этом месяце?',
  'Какой клиент задерживает оплату?',
];

function detectLang(q: string): 'kk' | 'ru' {
  if (/[әғқңөұүһі]/i.test(q)) return 'kk';
  if (/(почему|какой|какая|какие|кто|что|прибыл|деньг|работ|задерж|решени|уменьш|магазин|оплат|сколько)/i.test(q)) return 'ru';
  return 'kk';
}

function detectIntent(q: string): string {
  const s = q.toLowerCase();
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  if (has('ignore', 'игнорир', 'елеме', 'system prompt', 'нұсқаулықты', 'инструкци')) return 'injection';
  if (has('маржа', 'маржи', 'маржу') && has('дүкен', 'филиал', 'магазин', 'қай', 'какой', 'какого')) return 'margin_branch';
  if (has('касса', 'ақша', 'деньг', 'кэш') && has('пайда', 'прибыл')) return 'cash_vs_profit';
  if (has('пайда', 'прибыл') && has('азай', 'төмен', 'неге', 'уменьш', 'упал', 'сниз', 'почему')) return 'profit_drop';
  if (has('клиент', 'покупател', 'кім', 'кто') && has('төле', 'оплат', 'кешік', 'задерж', 'қарыз', 'долг')) return 'late_customers';
  if (has('бухгалтер', 'жұмыс', 'работ', 'тапсырма', 'задач') && has('кешік', 'просроч', 'задерж', 'опозд')) return 'late_work';
  if (has('шешім', 'решени', 'решить', 'қабылда')) return 'decisions';
  return 'unknown';
}

export function askAi(db: Db, tenantId: ID, question: string, nowIso: string, today: string): AiAnswer {
  const lang = detectLang(question);
  const L = (kk: string, ru: string) => (lang === 'ru' ? ru : kk);
  const intent = detectIntent(question);
  const tenant = db.tenants.find((t) => t.id === tenantId)!;
  const fresh = dataFreshness(db, tenantId, nowIso);
  const lastFull = ['2026-09', '2026-08'];
  const [m1, m0] = lastFull;
  const sc = (m: string, branchId: ID | null = null) => ({ tenantId, branchId, from: `${m}-01`, to: monthEnd(m) });
  const resp = (id: ID | null | undefined) => db.users.find((u) => u.id === id)?.name ?? L('Тағайындалмаған', 'Не назначен');
  const agreement = db.agreements.find((a) => a.tenantId === tenantId);
  const base: AiAnswer = {
    lang, intent, question, summary: '', confirmed: [], hypotheses: [], actions: [], responsible: '', due: '',
    sources: [], updatedAt: fresh.lastSuccessAt ? fmtDateTime(fresh.lastSuccessAt) : '—', dataSent: [],
  };
  const staleNote = fresh.status === 'stale' ? L(`Ескерту: деректер ескі (соңғы синхрондау ${fresh.hours} сағат бұрын). Соңғы күндер есепке кірмеген.`, `Внимание: данные устарели (последняя синхронизация ${fresh.hours} ч назад).`) : null;
  const curMonthNote = L(`Қазан әлі аяқталмаған, сондықтан толық айларды салыстырамын: ${monthLabel(m0)} → ${monthLabel(m1)}.`, `Октябрь ещё не закончился, поэтому сравниваю полные месяцы: ${monthLabel(m0, 'ru')} → ${monthLabel(m1, 'ru')}.`);

  switch (intent) {
    case 'injection':
      return {
        ...base,
        summary: L('Сұрақтағы нұсқаулар жүйелік ережелерді өзгерте алмайды. Мен тек деректерді түсіндіремін.', 'Инструкции в вопросе не могут изменить системные правила. Я только объясняю данные.'),
        guardrail: L('AI құжат өткізбейді, 1С-ті өзгертпейді, төлем жасамайды және салық есебін жібермейді.', 'AI не проводит документы, не меняет 1С, не делает платежи и не отправляет налоговую отчётность.'),
        dataSent: [L('Ешқандай қаржылық дерек жіберілмеді', 'Финансовые данные не отправлялись')],
        sources: [], responsible: '—', due: '—',
      };
    case 'profit_drop':
    case 'margin_branch': {
      const p0 = pnl(db, sc(m0));
      const p1 = pnl(db, sc(m1));
      const br = db.branches.filter((b) => b.tenantId === tenantId).map((b) => ({ b, a: pnl(db, sc(m0, b.id)), c: pnl(db, sc(m1, b.id)) }));
      const worst = [...br].sort((x, y) => ((y.a.grossMarginBp ?? 0) - (y.c.grossMarginBp ?? 0)) - ((x.a.grossMarginBp ?? 0) - (x.c.grossMarginBp ?? 0)))[0];
      const op0 = p0.operatingProfit.value;
      const op1 = p1.operatingProfit.value;
      const marginEffect = p0.grossMarginBp !== null && p1.grossMarginBp !== null ? Math.round((p1.netSales * (p0.grossMarginBp - p1.grossMarginBp)) / 10000) : null;
      const confirmed: string[] = [
        L(`Сатылым ${fmtKzt(p0.netSales)} → ${fmtKzt(p1.netSales)} (${p1.netSales >= p0.netSales ? 'өсті' : 'төмендеді'}).`, `Продажи ${fmtKzt(p0.netSales)} → ${fmtKzt(p1.netSales)}.`),
        L(`Жалпы маржа ${fmtBp(p0.grossMarginBp)} → ${fmtBp(p1.grossMarginBp)}. Маржа өзгерісінің әсері ≈ ${fmtKzt(marginEffect)} (сатылым × маржа айырмасы).`, `Валовая маржа ${fmtBp(p0.grossMarginBp)} → ${fmtBp(p1.grossMarginBp)}. Эффект ≈ ${fmtKzt(marginEffect)}.`),
        L(`Операциялық шығындар ${fmtKzt(p0.opex)} → ${fmtKzt(p1.opex)}.`, `Операционные расходы ${fmtKzt(p0.opex)} → ${fmtKzt(p1.opex)}.`),
      ];
      if (br.length > 1)
        confirmed.push(
          L(
            `Филиалдар бойынша маржа: ${br.map((x) => `${x.b.name} ${fmtBp(x.a.grossMarginBp)} → ${fmtBp(x.c.grossMarginBp)}`).join('; ')}. Ең көп төмендеген — ${worst.b.name}.`,
            `Маржа по филиалам: ${br.map((x) => `${x.b.name} ${fmtBp(x.a.grossMarginBp)} → ${fmtBp(x.c.grossMarginBp)}`).join('; ')}. Сильнее всего снизилась — ${worst.b.name}.`,
          ),
        );
      const hypotheses = [
        L('Ықтимал себеп: жеткізушілердің сатып алу бағасы өсті, ал бөлшек баға жаңартылмады. Расталмаған — SKU деңгейінде баға тарихын салыстыру керек.', 'Вероятная причина: выросли закупочные цены, а розничные не обновлены. Не подтверждено — нужно сравнить историю цен по SKU.'),
        L('Ықтимал себеп: жеңілдіктер немесе ассортимент құрылымының өзгеруі. Демо деректе SKU бойынша сатылым жоқ — тексеру мүмкін емес.', 'Вероятная причина: скидки или изменение структуры ассортимента. В демо-данных нет продаж по SKU — проверить нельзя.'),
      ];
      if (p1.operatingProfit.status === 'incomplete')
        hypotheses.push(L(`${monthLabel(m1)} есебі толық емес: ${p1.operatingProfit.reasons.join('; ')}. Сондықтан операциялық пайда (${fmtKzt(op1)}) өзгеруі мүмкін.`, `Отчёт за ${monthLabel(m1, 'ru')} неполный: ${p1.operatingProfit.reasons.join('; ')}.`));
      return {
        ...base,
        summary:
          intent === 'margin_branch' && br.length > 1
            ? L(`${worst.b.name} маржасы ең көп төмендеді: ${fmtBp(worst.a.grossMarginBp)} → ${fmtBp(worst.c.grossMarginBp)}.`, `Сильнее всего снизилась маржа в «${worst.b.name}»: ${fmtBp(worst.a.grossMarginBp)} → ${fmtBp(worst.c.grossMarginBp)}.`)
            : L(`${curMonthNote} Операциялық пайда ${fmtKzt(op0)} → ${fmtKzt(op1)}. Негізгі себеп — маржаның төмендеуі, сатылым өссе де.`, `${curMonthNote} Операционная прибыль ${fmtKzt(op0)} → ${fmtKzt(op1)}. Основная причина — снижение маржи при росте продаж.`) + (staleNote ? ' ' + staleNote : ''),
        confirmed,
        hypotheses,
        actions: [
          L('Сатып алу бағасы ең көп өскен 20 SKU тізімін дайындау және бөлшек бағаны қайта қарау.', 'Подготовить список 20 SKU с наибольшим ростом закупочной цены и пересмотреть розничные цены.'),
          L('Қыркүйек айын жабу (кедергілерді шешу), содан кейін таза пайданы қайта бағалау.', 'Закрыть сентябрь (устранить блокеры), затем переоценить чистую прибыль.'),
        ],
        responsible: L(`Орындаушы: ${resp(agreement?.responsibleAccountantId)}; баға шешімі — кәсіп иесі`, `Исполнитель: ${resp(agreement?.responsibleAccountantId)}; решение по ценам — собственник`),
        due: L('Ұсыныс: 3 жұмыс күні (пайдаланушы бекітеді)', 'Предложение: 3 рабочих дня (утверждает пользователь)'),
        sources: [`P&L ${monthLabel(m0)}, ${monthLabel(m1)} (domain/finance.pnl)`, L('Ереже R12 «Маржаның төмендеуі»', 'Правило R12 «Снижение маржи»'), `1С → MockConnector, ${tenant.name}`],
        dataSent: [L('Айлық агрегаттар: сатылым, өзіндік құн, маржа, шығын (филиал бойынша)', 'Месячные агрегаты: продажи, себестоимость, маржа, расходы (по филиалам)'), L('Жеке тұлғалар мен құжат мәтіндері жіберілмейді', 'Персональные данные и тексты документов не отправляются')],
        suggestedTask: { title: L(`Маржа талдауы: ${br.length > 1 ? worst.b.name : tenant.name} — SKU бойынша сатып алу/сату бағасы`, `Анализ маржи: ${br.length > 1 ? worst.b.name : tenant.name}`), description: L('AI ұсынысы: маржа төмендеуінің себебін SKU деңгейінде растау және баға ұсынысын дайындау.', 'Предложение AI: подтвердить причину снижения маржи на уровне SKU.'), opType: 'Тауар қозғалысын тексеру', complexity: 'complex' },
      };
    }
    case 'cash_vs_profit': {
      const s = { tenantId, branchId: null, from: '2026-07-01', to: '2026-09-30' };
      const b = profitToCashBridge(db, s);
      const cf = cashFlow(db, s);
      const inv = inventoryAt(db, tenantId, null, '2026-09-30');
      return {
        ...base,
        summary: L(
          `III тоқсанда операциялық пайда ${fmtKzt(b.operatingProfit.value)}, ал ақша ${fmtKzt(b.cashDelta, { sign: true })} өзгерді. Пайда мен ақша — әртүрлі көрсеткіш: айырма қарыздарға, тауарға және иесінің алымына кетті.`,
          `В III квартале операционная прибыль ${fmtKzt(b.operatingProfit.value)}, а деньги изменились на ${fmtKzt(b.cashDelta, { sign: true })}. Разница ушла в долги, товар и изъятия собственника.`,
        ) + (staleNote ? ' ' + staleNote : ''),
        confirmed: [
          L(`Клиенттердің қарызы ${fmtKzt(b.arDelta, { sign: true })} өзгерді (өсім — ақша клиентте тұр).`, `Дебиторка изменилась на ${fmtKzt(b.arDelta, { sign: true })}.`),
          L(`Тауар қалдығы ${fmtKzt(b.invDelta, { sign: true })} өзгерді; қазір ${fmtKzt(inv.value)}. Тауар — ақша емес.`, `Товарный запас изменился на ${fmtKzt(b.invDelta, { sign: true })}; сейчас ${fmtKzt(inv.value)}.`),
          L(`Жеткізушілерге қарыз ${fmtKzt(b.apDelta, { sign: true })} өзгерді.`, `Кредиторка изменилась на ${fmtKzt(b.apDelta, { sign: true })}.`),
          L(`Иесінің операциялары (салым − алым − жеке шығын): ${fmtKzt(b.ownerNet, { sign: true })}. Салық төлемдері: ${fmtKzt(b.taxPaid)}.`, `Операции собственника: ${fmtKzt(b.ownerNet, { sign: true })}. Налоги уплачено: ${fmtKzt(b.taxPaid)}.`),
          L(`Ақша: ${fmtKzt(cf.opening)} → ${fmtKzt(cf.closing)}. Ішкі аударымдар (${fmtKzt(cf.internalTransfers)}) кіріс ретінде есептелмеді.`, `Деньги: ${fmtKzt(cf.opening)} → ${fmtKzt(cf.closing)}. Внутренние переводы (${fmtKzt(cf.internalTransfers)}) не считаются доходом.`),
        ],
        hypotheses: [L('Көпір толық жабылмауы мүмкін: шоттар бойынша дерек толық болса да, табыс салығы мен есептелген міндеттемелер ай жабылғанда ғана нақтыланады.', 'Мост может не сходиться полностью: налог и начисления уточняются при закрытии месяца.')],
        actions: [
          L('Мерзімі өткен дебиторлық бойынша төлем кестесін келісу.', 'Согласовать график погашения просроченной дебиторки.'),
          L('Баяу айналатын тауарға сатып алуды шектеу туралы шешім.', 'Решение об ограничении закупок медленно оборачиваемого товара.'),
        ],
        responsible: L(`${resp(agreement?.responsibleAccountantId)} — талдау; кәсіп иесі — шешім`, `${resp(agreement?.responsibleAccountantId)} — анализ; собственник — решение`),
        due: L('Ұсыныс: осы апта', 'Предложение: эта неделя'),
        sources: [L('Пайда→ақша көпірі (domain/finance.profitToCashBridge)', 'Мост прибыль→деньги'), L('Ақша қозғалысы, қарыздар (FIFO), қойма', 'ДДС, долги (FIFO), склад')],
        dataSent: [L('Тоқсандық агрегаттар: пайда, қарыз өзгерісі, қойма өзгерісі', 'Квартальные агрегаты')],
        suggestedTask: { title: L('Пайда мен ақша айырмасын түсіндіретін басқарушылық есеп', 'Управленческий отчёт: прибыль vs деньги'), description: L('AI ұсынысы: көпірді кәсіп иесімен талқылау, дебиторлық пен қойма бойынша шешімдер.', 'Предложение AI.'), opType: 'Қарыздарды салыстыру', complexity: 'standard' },
      };
    }
    case 'late_customers': {
      const ar = debts(db, tenantId, 'customer', today).filter((d) => d.overdue > 0);
      if (!ar.length)
        return {
          ...base,
          summary: L('Мерзімі өткен клиент қарызы табылмады.', 'Просроченной дебиторской задолженности не найдено.'),
          insufficient: tenant.industry === 'retail' ? L('Бөлшек саудада клиент қарызы әдетте жоқ — бұл нөл емес, дерек «қолданылмайды».', 'В рознице дебиторки обычно нет.') : undefined,
          sources: [L('Қарыздар (FIFO)', 'Долги (FIFO)')], responsible: '—', due: '—', dataSent: [L('Клиенттер бойынша қарыз агрегаты', 'Агрегат долгов')],
        };
      const top = ar[0];
      return {
        ...base,
        summary: L(`Ең үлкен мерзімі өткен қарыз — ${top.name}: ${fmtKzt(top.overdue)} (${top.maxDaysOverdue} күнге дейін).`, `Крупнейшая просрочка — ${top.name}: ${fmtKzt(top.overdue)} (до ${top.maxDaysOverdue} дней).`) + (staleNote ? ' ' + staleNote : ''),
        confirmed: ar.map((d) => L(`${d.name}: барлығы ${fmtKzt(d.outstanding)}, мерзімі өткен ${fmtKzt(d.overdue)}, ең ұзағы ${d.maxDaysOverdue} күн. Жауапты: ${resp(d.responsibleUserId)}. Келесі әрекет: ${d.nextAction || '—'}`, `${d.name}: всего ${fmtKzt(d.outstanding)}, просрочено ${fmtKzt(d.overdue)}, макс. ${d.maxDaysOverdue} дн.`)),
        hypotheses: [L('Төлемдер FIFO бойынша ең ескі құжатқа бөлінді. Клиенттің өз есебінде басқаша бөлінуі мүмкін — салыстыру актісі керек.', 'Оплаты распределены по FIFO. У клиента может быть иначе — нужен акт сверки.')],
        actions: [L(`${top.name}: салыстыру актісі, төлем кестесі, жаңа жөнелтуге шектеу туралы шешім.`, `${top.name}: акт сверки, график оплат, решение об ограничении отгрузок.`)],
        responsible: resp(top.responsibleUserId),
        due: L('Ұсыныс: 2 жұмыс күні', 'Предложение: 2 рабочих дня'),
        sources: [L('Қарыздар модулі (domain/finance.debts, FIFO)', 'Модуль долгов (FIFO)')],
        dataSent: [L('Контрагент атауы, қарыз сомасы, мерзімі', 'Название контрагента, сумма, срок')],
        suggestedTask: { title: L(`${top.name}: мерзімі өткен қарызды жинау жоспары`, `${top.name}: план взыскания просрочки`), description: L('AI ұсынысы: салыстыру актісі және төлем кестесі.', 'Предложение AI: акт сверки и график.'), opType: 'Қарыздарды салыстыру', complexity: 'standard' },
      };
    }
    case 'late_work': {
      const late = db.tasks.filter((t) => t.tenantId === tenantId && !['done', 'cancelled'].includes(t.status) && t.plannedDue < today);
      return {
        ...base,
        summary: late.length ? L(`${late.length} тапсырма мерзімінен кешікті.`, `Просрочено задач: ${late.length}.`) : L('Кешіккен тапсырма жоқ.', 'Просроченных задач нет.'),
        confirmed: late.map((t) => L(`«${t.title}» — ${resp(t.assigneeId)}, мерзімі ${t.plannedDue} (${diffDays(today, t.plannedDue)} күн кешікті)${t.status === 'waiting_client' ? `; себебі: клиент жауабын күтуде — ${t.waitReason}` : ''}`, `«${t.title}» — ${resp(t.assigneeId)}, срок ${t.plannedDue}${t.status === 'waiting_client' ? `; ждём клиента: ${t.waitReason}` : ''}`)),
        hypotheses: late.some((t) => t.status === 'waiting_client') ? [L('Кешігудің бір бөлігі клиент жағында. KPI-да бұл «клиентті күтуден кешігу» ретінде бөлек есептеледі.', 'Часть задержек на стороне клиента — в KPI учитывается отдельно.')] : [],
        actions: late.length ? [L('Клиент жағындағы құжаттарды бүгін беру; бас бухгалтерге мерзімді қайта бекіту.', 'Предоставить документы со стороны клиента; пересогласовать сроки.')] : [],
        responsible: L(`Бас бухгалтер: ${resp(agreement?.reviewerId)}`, `Главный бухгалтер: ${resp(agreement?.reviewerId)}`),
        due: L('Бүгін', 'Сегодня'),
        sources: [L('Тапсырмалар (Task, TaskEvent)', 'Задачи (Task, TaskEvent)')],
        dataSent: [L('Тапсырма атауы, мерзімі, мәртебесі', 'Название, срок, статус задач')],
      };
    }
    case 'decisions': {
      const dec = db.tasks.filter((t) => t.tenantId === tenantId && t.needsOwnerDecision && !t.ownerDecision);
      const top = db.findings.filter((f) => f.tenantId === tenantId && f.ownerVisible && (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status)).slice(0, 3);
      return {
        ...base,
        summary: L(`Сіздің шешіміңізді ${dec.length} мәселе күтіп тұр.`, `Вашего решения ждут ${dec.length} вопроса(ов).`),
        confirmed: [...dec.map((t) => L(`Шешім: ${t.title} (мерзімі ${t.plannedDue})`, `Решение: ${t.title} (срок ${t.plannedDue})`)), ...top.map((f) => L(`Назар: ${f.title} → ${f.actionNeeded}`, `Внимание: ${f.title}`))],
        hypotheses: [],
        actions: [L('«Шешімдер» блогында әр сұраққа жауап беріңіз — бухгалтер сол бойынша 1С-те жіктейді.', 'Ответьте в блоке «Решения» — бухгалтер классифицирует в 1С.')],
        responsible: L('Кәсіп иесі', 'Собственник'),
        due: L('Осы апта', 'Эта неделя'),
        sources: [L('Тапсырмалар, тексерулер орталығы', 'Задачи, центр проверок')],
        dataSent: [L('Тапсырма атаулары мен мерзімдері', 'Названия и сроки задач')],
      };
    }
    default:
      return {
        ...base,
        summary: L('Бұл сұраққа demo AI-да дайын жауап жоқ.', 'На этот вопрос в демо-AI нет готового ответа.'),
        insufficient: L('Дерек немесе сценарий жеткіліксіз. Төмендегі ұсынылған сұрақтардың бірін таңдаңыз. Нақты AI кейінгі кезеңде қосылады.', 'Недостаточно данных или сценария. Выберите один из предложенных вопросов. Реальный AI — следующий этап.'),
        responsible: '—', due: '—', sources: [], dataSent: [L('Ештеңе жіберілмеді', 'Ничего не отправлено')],
      };
  }
}

export function totalOverdue(db: Db, tenantId: ID, today: string) {
  return sum(debts(db, tenantId, 'customer', today).map((d) => d.overdue));
}
