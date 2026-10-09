// frontend/src/components/Dashboard.tsx
// Progress Dashboard: sessions, quiz scores, flashcards mastered.

import { useEffect, useState } from 'react';
import { getDashboardStats } from '../db/repositories';
import type { DashboardStats } from '../db/types';
import { formatDate } from './common';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  async function load() {
    setStats(await getDashboardStats());
  }

  useEffect(() => {
    load();
  }, []);

  if (!stats) return <p>Loading…</p>;

  return (
    <section>
      <h2>Progress Dashboard</h2>
      <button onClick={load}>Refresh</button>

      <ul>
        <li>Readings saved: {stats.readingCount}</li>
        <li>Reading sessions (Buddy and Argument Checker): {stats.sessionCount}</li>
        <li>Quizzes taken: {stats.quizAttempts}</li>
        <li>Average quiz score: {stats.averageQuizPercent}%</li>
        <li>Flashcards: {stats.flashcardsTotal} total, {stats.flashcardsMastered} mastered</li>
      </ul>

      <h3>Quiz scores over time</h3>
      {stats.quizScoreHistory.length === 0 ? (
        <p>No quizzes taken yet.</p>
      ) : (
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {stats.quizScoreHistory.map((h) => (
              <tr key={h.date}>
                <td>{formatDate(h.date)}</td>
                <td>{h.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
