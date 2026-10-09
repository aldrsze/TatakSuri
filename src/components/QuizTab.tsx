// frontend/src/components/QuizTab.tsx
// Quiz Maker: generate, take one question at a time, check answers, save the score.

import { useEffect, useRef, useState } from 'react';
import { ALL_QUESTION_TYPES, generateQuiz, gradeExplanation } from '../ai/generators';
import { normalizeKey } from '../ai/chunks';
import { listQuizzesByReading, saveQuiz, saveQuizResult } from '../db/repositories';
import type { Difficulty, QuestionType, Quiz, Reading } from '../db/types';
import { NeedsModel, errorMessage, formatDate, isAbort } from './common';

interface Feedback {
  points: number;
  note: string;
}

export default function QuizTab({ reading }: { reading: Reading }) {
  // setup
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [types, setTypes] = useState<QuestionType[]>(ALL_QUESTION_TYPES);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<Quiz[]>([]);
  const abort = useRef<AbortController | null>(null);

  // taking a quiz
  const [phase, setPhase] = useState<'setup' | 'taking' | 'done'>('setup');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [grading, setGrading] = useState(false);
  const [score, setScore] = useState(0);

  async function refreshSaved() {
    setSaved((await listQuizzesByReading(reading.id)).reverse());
  }

  useEffect(() => {
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleType(t: QuestionType) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  function startQuiz(q: Quiz) {
    setQuiz(q);
    setIndex(0);
    setAnswer('');
    setFeedback(null);
    setScore(0);
    setPhase('taking');
  }

  async function generate() {
    setError('');
    setNotice('');
    setGenerating(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const questions = await generateQuiz({
        text: reading.text,
        count,
        difficulty,
        types,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(`Step ${done} of ${total} done`),
      });
      const savedQuiz = await saveQuiz(reading.id, difficulty, questions);
      if (questions.length < count) {
        setNotice(`Only ${questions.length} usable questions were generated (you asked for ${count}).`);
      }
      await refreshSaved();
      startQuiz(savedQuiz);
    } catch (e) {
      if (!isAbort(e)) setError(errorMessage(e));
    } finally {
      setGenerating(false);
      setProgress('');
    }
  }

  async function check() {
    if (!quiz) return;
    const q = quiz.questions[index];
    let points = 0;
    let note = '';

    if (q.type === 'multiple-choice' || q.type === 'true-false') {
      points = answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase() ? 1 : 0;
    } else if (q.type === 'identification') {
      const a = normalizeKey(answer);
      const c = normalizeKey(q.correctAnswer);
      const match = a !== '' && (a === c || (a.length >= 3 && (c.includes(a) || a.includes(c))));
      points = match ? 1 : 0;
    } else {
      setGrading(true);
      try {
        const g = await gradeExplanation({
          question: q.question,
          modelAnswer: q.correctAnswer,
          studentAnswer: answer,
        });
        points = g.points;
        note = g.feedback;
      } catch {
        note = 'Could not grade this automatically. Compare your answer with the model answer.';
      } finally {
        setGrading(false);
      }
    }

    setScore((s) => s + points);
    setFeedback({ points, note });
  }

  async function next() {
    if (!quiz) return;
    if (index + 1 < quiz.questions.length) {
      setIndex(index + 1);
      setAnswer('');
      setFeedback(null);
    } else {
      await saveQuizResult(quiz, score, quiz.questions.length);
      setPhase('done');
    }
  }

  /* ------------------------------ views ------------------------------ */

  if (phase === 'taking' && quiz) {
    const q = quiz.questions[index];
    const last = index + 1 === quiz.questions.length;
    return (
      <section>
        <h2>Quiz</h2>
        {notice && <p>{notice}</p>}
        <p>
          <b>
            Question {index + 1} of {quiz.questions.length}
          </b>{' '}
          ({q.type})
        </p>
        <p>{q.question}</p>

        {q.type === 'multiple-choice' &&
          q.choices?.map((c) => (
            <div key={c}>
              <label>
                <input type="radio" name="answer" checked={answer === c} disabled={!!feedback} onChange={() => setAnswer(c)} /> {c}
              </label>
            </div>
          ))}

        {q.type === 'true-false' &&
          ['True', 'False'].map((c) => (
            <div key={c}>
              <label>
                <input type="radio" name="answer" checked={answer === c} disabled={!!feedback} onChange={() => setAnswer(c)} /> {c}
              </label>
            </div>
          ))}

        {q.type === 'identification' && (
          <input value={answer} disabled={!!feedback} onChange={(e) => setAnswer(e.target.value)} />
        )}

        {q.type === 'explain-why' && (
          <textarea rows={4} cols={60} value={answer} disabled={!!feedback} onChange={(e) => setAnswer(e.target.value)} />
        )}

        {!feedback && (
          <p>
            <button onClick={check} disabled={grading || (q.type !== 'explain-why' && !answer.trim())}>
              {grading ? 'Grading…' : 'Check answer'}
            </button>
          </p>
        )}

        {feedback && (
          <div>
            <p>
              <b>{feedback.points === 1 ? 'Correct!' : feedback.points > 0 ? 'Partly correct.' : 'Not quite.'}</b>
            </p>
            <p>Answer: {q.correctAnswer}</p>
            {feedback.note && <p>Feedback: {feedback.note}</p>}
            {q.explanation && <p>Why: {q.explanation}</p>}
            <button onClick={next}>{last ? 'Finish' : 'Next question'}</button>
          </div>
        )}
        <p>Score so far: {score}</p>
      </section>
    );
  }

  if (phase === 'done' && quiz) {
    return (
      <section>
        <h2>Quiz finished</h2>
        <p>
          Score: <b>{score}</b> / {quiz.questions.length} (saved)
        </p>
        <button onClick={() => startQuiz(quiz)}>Retake this quiz</button>{' '}
        <button
          onClick={() => {
            setPhase('setup');
            refreshSaved();
          }}
        >
          Back to quiz setup
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Quiz Maker</h2>

      <NeedsModel>
        <p>
          Number of questions:{' '}
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </p>
        <p>
          Difficulty:{' '}
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
        </p>
        <p>
          Question types:{' '}
          {ALL_QUESTION_TYPES.map((t) => (
            <label key={t} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} /> {t}
            </label>
          ))}
        </p>

        <button onClick={generate} disabled={generating}>
          Generate quiz
        </button>{' '}
        {generating && <button onClick={() => abort.current?.abort()}>Stop</button>}
        {generating && <p>Generating… {progress}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <p>
          <i>Small local models can make mistakes. Check questions against the reading.</i>
        </p>
      </NeedsModel>

      <h3>Saved quizzes for this reading</h3>
      {saved.length === 0 && <p>None yet.</p>}
      <ul>
        {saved.map((q) => (
          <li key={q.id}>
            {formatDate(q.createdAt)}: {q.questions.length} questions, {q.difficulty}{' '}
            <button onClick={() => startQuiz(q)}>Take</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
