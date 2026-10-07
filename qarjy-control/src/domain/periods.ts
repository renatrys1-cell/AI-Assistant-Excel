import type { ISODate } from './types';

/**
 * Demo сағаты. Демонстрациялық деректер осы күнге дейін үйлестірілген.
 * Уақыт белдеуі: Asia/Almaty (UTC+5).
 */
export const DEMO_NOW = '2026-10-07T10:00:00+05:00';
export const DEMO_TODAY: ISODate = '2026-10-07';
export const DATA_START: ISODate = '2026-07-01';
export const TZ = 'Asia/Almaty';

export function addDays(d: ISODate, n: number): ISODate {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((ta - tb) / 86400000);
}

export function monthOf(d: ISODate): string {
  return d.slice(0, 7);
}

export function monthStart(m: string): ISODate {
  return `${m}-01`;
}

export function monthEnd(m: string): ISODate {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(last).padStart(2, '0')}`;
}

export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let m = monthOf(from);
  while (m <= monthOf(to)) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return out;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(d: ISODate): number {
  return new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = жексенбі
}

export type PeriodKind = 'day' | 'week' | 'month' | 'quarter';

export interface Period {
  key: string;
  kind: PeriodKind;
  from: ISODate;
  to: ISODate;
  label: string;
  labelRu: string;
}

const MONTH_KK = ['Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым', 'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'];
const MONTH_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function monthLabel(m: string, lang: 'kk' | 'ru' = 'kk'): string {
  const [y, mo] = m.split('-').map(Number);
  return `${(lang === 'ru' ? MONTH_RU : MONTH_KK)[mo - 1]} ${y}`;
}

export function fmtDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  const p = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(dt);
  return p.replace(',', '');
}

/** Берілген ISO уақыттың Asia/Almaty бойынша күні */
export function almatyDate(iso: string): ISODate {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p;
}

export function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 3600000;
}

/** Деректер соңғы толық күні — 06.10.2026 (demo). */
export const LAST_DATA_DAY: ISODate = addDays(DEMO_TODAY, -1);

export function availablePeriods(lastDay: ISODate = LAST_DATA_DAY): Period[] {
  const weekFrom = addDays(lastDay, -6);
  const list: Period[] = [
    { key: `day:${lastDay}`, kind: 'day', from: lastDay, to: lastDay, label: `Күн · ${fmtDate(lastDay)}`, labelRu: `День · ${fmtDate(lastDay)}` },
    { key: `week:${weekFrom}`, kind: 'week', from: weekFrom, to: lastDay, label: `Апта · ${fmtDate(weekFrom).slice(0, 5)}–${fmtDate(lastDay).slice(0, 5)}`, labelRu: `Неделя · ${fmtDate(weekFrom).slice(0, 5)}–${fmtDate(lastDay).slice(0, 5)}` },
  ];
  for (const m of monthsBetween(DATA_START, lastDay).reverse()) {
    const to = monthEnd(m) < lastDay ? monthEnd(m) : lastDay;
    const partial = to !== monthEnd(m);
    list.push({
      key: `month:${m}`,
      kind: 'month',
      from: monthStart(m),
      to,
      label: `Ай · ${monthLabel(m)}${partial ? ' (ағымдағы)' : ''}`,
      labelRu: `Месяц · ${monthLabel(m, 'ru')}${partial ? ' (текущий)' : ''}`,
    });
  }
  list.push({ key: 'quarter:2026-Q3', kind: 'quarter', from: '2026-07-01', to: '2026-09-30', label: 'Тоқсан · III тоқсан 2026', labelRu: 'Квартал · III кв. 2026' });
  return list;
}

export function findPeriod(key: string): Period {
  const p = availablePeriods().find((x) => x.key === key);
  if (!p) throw new Error(`Unknown period ${key}`);
  return p;
}

export const DEFAULT_PERIOD_KEY = 'month:2026-09';

/** Салыстыру үшін алдыңғы кезең (сол ұзындықтағы) */
export function previousPeriod(p: Period): Period {
  if (p.kind === 'month') {
    const m = monthsBetween(addDays(p.from, -1), addDays(p.from, -1))[0];
    const len = diffDays(p.to, p.from);
    const from = monthStart(m);
    const to = addDays(from, len) > monthEnd(m) ? monthEnd(m) : addDays(from, len);
    return { key: `month:${m}`, kind: 'month', from, to, label: monthLabel(m), labelRu: monthLabel(m, 'ru') };
  }
  const len = diffDays(p.to, p.from) + 1;
  const to = addDays(p.from, -1);
  const from = addDays(to, -(len - 1));
  return { key: `${p.kind}:${from}`, kind: p.kind, from, to, label: `${fmtDate(from)}–${fmtDate(to)}`, labelRu: `${fmtDate(from)}–${fmtDate(to)}` };
}
