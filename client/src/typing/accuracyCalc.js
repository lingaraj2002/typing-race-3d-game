export function calculateAccuracy(correctChars, totalTyped) {
  return totalTyped === 0 ? 100 : Math.round((correctChars / totalTyped) * 100);
}
