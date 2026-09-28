function sendProgressUpdate(room, typingState) {
  room.send("typingProgress", {
    typedCharacters: typingState.correctChars,
    totalCharacters: typingState.totalChars,
    wpm: typingState.wpm,
    accuracy: typingState.accuracy,
  });
}
