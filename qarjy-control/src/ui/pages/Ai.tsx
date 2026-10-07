import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, Forbidden } from '../components/ui';
import { AssignForm } from '../components/detail';
import { SUGGESTED_QUESTIONS, type AiAnswer } from '../../server/ai';
import type { ID } from '../../domain/types';

export function AiPage({ tenantId }: { tenantId: ID }) {
  const { api, run, openTask } = useApp();
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<AiAnswer[]>([]);
  const [taskFor, setTaskFor] = useState<number | null>(null);
  if (!api.can('ai.ask', tenantId)) return <Forbidden message="AI көмекшіге рұқсат жоқ" />;
  const ask = (question: string) => {
    const a = run(() => api.ask(tenantId, question));
    if (a && a !== true) {
      setHistory((h) => [a, ...h]);
      setQ('');
    }
  };
  const L = (a: AiAnswer, kk: string, ru: string) => (a.lang === 'ru' ? ru : kk);
  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>AI көмекші</h1>
          <div className="muted small">Қазақша немесе орысша сұраңыз. Сандарды тексерілетін есептеу қабаты шығарады; AI оларды түсіндіреді.</div>
        </div>
        <Badge tone="ai">DEMO AI · ережеге негізделген, нақты LLM қосылмаған</Badge>
      </div>
      <div className="callout ai small">
        AI құжаттарды өздігінен өткізбейді, 1С-тегі бастапқы есепті өзгертпейді, банк төлемін жасамайды, салық есебін жібермейді. Сұраққа қажетті ең аз агрегат қана қолданылады. Құжат мәтіні жүйелік ережелерді өзгерте алмайды.
      </div>
      <Card>
        <div className="row">
          <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && ask(q)} placeholder="Мысалы: Осы айда пайда неге азайды?" />
          <button className="btn primary" disabled={!q.trim()} onClick={() => ask(q)}>Сұрау</button>
        </div>
        <div className="row mt8">
          {SUGGESTED_QUESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => ask(s)}>{s}</button>)}
        </div>
      </Card>
      {history.map((a, i) => (
        <Card key={i} title={<span>«{a.question}»</span>} actions={<Badge tone="outline">{a.lang === 'ru' ? 'RU' : 'ҚАЗ'} · {a.intent}</Badge>}>
          <div className="col">
            <div><b>1. {L(a, 'Қысқа қорытынды', 'Краткий вывод')}:</b> {a.summary}</div>
            {a.insufficient && <div className="callout warn">{a.insufficient}</div>}
            {a.guardrail && <div className="callout ai">{a.guardrail}</div>}
            {a.confirmed.length > 0 && (
              <div>
                <b>2. {L(a, 'Деректермен расталған себептер', 'Причины, подтверждённые данными')}:</b>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{a.confirmed.map((c, j) => <li key={j}>{c}</li>)}</ul>
              </div>
            )}
            {a.hypotheses.length > 0 && (
              <div>
                <b>3. {L(a, 'Тексеруді қажет ететін болжамдар', 'Гипотезы, требующие проверки')}:</b> <Badge tone="warn">{L(a, 'ықтимал себеп', 'вероятная причина')}</Badge>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{a.hypotheses.map((c, j) => <li key={j}>{c}</li>)}</ul>
              </div>
            )}
            {a.actions.length > 0 && (
              <div>
                <b>4. {L(a, 'Ұсынылған әрекет', 'Рекомендуемое действие')}:</b>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{a.actions.map((c, j) => <li key={j}>{c}</li>)}</ul>
              </div>
            )}
            <div><b>5. {L(a, 'Жауапты және мерзім', 'Ответственный и срок')}:</b> {a.responsible} · {a.due}</div>
            <div className="small muted"><b>6. {L(a, 'Дереккөз және жаңарту уақыты', 'Источник и время обновления')}:</b> {a.sources.join('; ') || '—'} · {a.updatedAt}</div>
            <details className="small">
              <summary>AI-ға жіберілген дерек (минимизация)</summary>
              <ul>{a.dataSent.map((d, j) => <li key={j}>{d}</li>)}</ul>
            </details>
            {a.suggestedTask && api.can('tasks.create_from_issue', tenantId) && taskFor !== i && (
              <div><button className="btn" onClick={() => setTaskFor(i)}>+ {L(a, 'Осы жауаптан тапсырма жасау', 'Создать задачу из ответа')}</button> <span className="small muted">{L(a, 'Жауапты мен мерзімді сіз бекітесіз', 'Ответственного и срок утверждаете вы')}</span></div>
            )}
            {taskFor === i && a.suggestedTask && (
              <AssignForm
                tenantId={tenantId}
                defaultTitle={a.suggestedTask.title}
                onCancel={() => setTaskFor(null)}
                onSubmit={(p) => {
                  const t = run(() => api.createTask(tenantId, { title: a.suggestedTask!.title, description: `${a.suggestedTask!.description}\n\nAI жауабы: ${a.summary}\n${p.note}`, opType: a.suggestedTask!.opType, assigneeId: p.assigneeId, reviewerId: p.reviewerId, plannedDue: p.plannedDue, complexity: p.complexity, source: 'ai' }), 'Тапсырма жасалды');
                  if (t && t !== true) {
                    setTaskFor(null);
                    openTask(t.id);
                  }
                }}
              />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
