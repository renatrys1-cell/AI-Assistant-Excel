/**
 * Ақша сомалары тиынмен (1 ₸ = 100 тиын) бүтін сан ретінде сақталады.
 * Барлық арифметика бүтін сандармен жүреді — floating-point дөңгелектеу қателері болмайды.
 * Number.MAX_SAFE_INTEGER ≈ 9·10^15 тиын ≈ 90 трлн ₸ — MVP үшін жеткілікті.
 */
export type Money = number; // тиын, әрқашан бүтін

export function assertMoney(v: number): Money {
  if (!Number.isSafeInteger(v)) throw new Error(`Money must be a safe integer (tiyn), got ${v}`);
  return v;
}

/** Теңгені тиынға айналдыру (енгізу/импорт кезінде ғана). "1 234,56" сияқты жолдарды да қабылдайды. */
export function tenge(v: number | string): Money {
  if (typeof v === 'string') {
    const clean = v.replace(/\s| /g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new Error(`Сома форматы қате: "${v}"`);
    const neg = clean.startsWith('-');
    const [int, frac = ''] = clean.replace('-', '').split('.');
    const t = Number(int) * 100 + Number((frac + '00').slice(0, 2));
    return assertMoney(neg ? -t : t);
  }
  return assertMoney(Math.round(v * 100));
}

export function sum(values: Money[]): Money {
  let s = 0;
  for (const v of values) s += v;
  return assertMoney(s);
}

/** a * num / den, half-up дөңгелектеу, бүтін нәтиже. */
export function mulDiv(a: Money, num: number, den: number): Money {
  if (den === 0) throw new Error('Division by zero');
  const r = (a * num) / den;
  const rounded = r >= 0 ? Math.floor(r + 0.5) : -Math.floor(-r + 0.5);
  return assertMoney(rounded);
}

/** Үлес базистік пунктпен (1% = 100 bp). Бөлгіш 0 болса — null (белгісіз, 0 емес). */
export function ratioBp(part: Money, whole: Money): number | null {
  if (whole === 0) return null;
  return mulDiv(part, 10000, whole);
}

const fmtInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Толық формат: 12 345 678 ₸ */
export function fmtKzt(v: Money | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v === null || v === undefined) return '—';
  const t = Math.round(v / 100);
  const s = fmtInt.format(Math.abs(t));
  const sign = t < 0 ? '−' : opts.sign && t > 0 ? '+' : '';
  return `${sign}${s} ₸`;
}

/** Қысқа формат: 12,3 млн ₸ */
export function fmtKztShort(v: Money | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const t = v / 100;
  const a = Math.abs(t);
  const sign = t < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2).replace('.', ',')} млрд ₸`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1).replace('.', ',')} млн ₸`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)} мың ₸`;
  return `${sign}${a.toFixed(0)} ₸`;
}

export function fmtBp(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(1).replace('.', ',')}%`;
}
