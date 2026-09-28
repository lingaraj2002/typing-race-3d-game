export async function generateWordSet(
  difficulty = "medium",
  count = 25,
  excludedWords = new Set(),
  wordLength = null,
) {
  const res = await fetch(`/${difficulty}.json`);
  const pool = await res.json();
  const availableWords = [...new Set(pool)].filter(
    (word) =>
      !excludedWords.has(word) &&
      (wordLength === null || word.length === wordLength),
  );

  for (let i = availableWords.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [availableWords[i], availableWords[swapIndex]] = [
      availableWords[swapIndex],
      availableWords[i],
    ];
  }

  return availableWords.slice(0, count);
}
