export function calculateProgress(typedCorrectChars, totalChars) {
  return totalChars === 0 ? 0 : typedCorrectChars / totalChars;
}
