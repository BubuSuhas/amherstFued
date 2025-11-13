# Sounds

Place your audio files in this folder to use authentic show SFX.

Expected filenames (you can change them in `presentation.component.ts` if needed):

- feud-board-load.mp3  — plays when a new question/board is shown
- feud-reveal.mp3      — plays when an answer is revealed or a rapid % > 0 is loaded
- feud-rapid-load.mp3  — plays when loading an answer during Rapid Fire (optional; falls back to reveal)
- feud-wrong.mp3       — plays for wrong answers and when a rapid % is 0
- feud-tick.mp3        — looping clock tick while the timer is running

Notes:
- These files are not included due to copyright. Provide your own licensed or recorded sounds.
- MP3 or WAV should work. Keep files short and small for low latency.
- Volume can be adjusted in code (tick default is 0.5).
- If a file is missing, the app will fall back to synthesized tones.
