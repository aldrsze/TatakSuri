import * as repo from './repositories';

export async function runDbSmokeTest() {
  const reading = await repo.addReading({
    title: 'Smoke test',
    text: 'Hello world',
    sourceType: 'paste',
  });
  console.assert((await repo.getReading(reading.id))?.title === 'Smoke test', 'reading not saved');

  const quiz = await repo.saveQuiz(reading.id, 'easy', [
    { type: 'true-false', question: 'The sky is blue.', correctAnswer: 'True', explanation: 'Test' },
  ]);
  await repo.saveQuizResult(quiz, 1, 1);
  await repo.saveReviewer(reading.id, 'short', '# Reviewer');
  await repo.logSession(reading.id, 'buddy');

  const cards = await repo.saveFlashcards(reading.id, [
    { front: 'A', back: 'B' },
    { front: 'C', back: 'D' },
  ]);
  await repo.reviewFlashcard(cards[0].id, true);  // moves to box 2
  await repo.reviewFlashcard(cards[1].id, false); // stays in box 1

  const queue = await repo.getStudyQueue(reading.id);
  console.assert(queue[0].id === cards[1].id, 'missed card should come first');

  const stats = await repo.getDashboardStats();
  console.table(stats);

  // Comment this out if you want to inspect the data in DevTools afterwards
  await repo.deleteReading(reading.id);
  console.assert((await repo.listFlashcardsByReading(reading.id)).length === 0, 'cascade delete failed');

  console.log('DB smoke test finished. Any failed assertions are listed above.');
}