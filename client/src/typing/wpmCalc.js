export function calculateWPM(correctChars, elapsedMs) {
  const minutes = elapsedMs / 60000;
  const words = correctChars / 5; // standard WPM definition
  return minutes > 0 ? Math.round(words / minutes) : 0;
}
