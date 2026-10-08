/**
 * A short sound for a celebration, made in the browser — no file to load. The
 * browser lets a page play sound only after someone has clicked on it, so the
 * first celebration of a session may be silent; that is the browser's rule.
 */
let context: AudioContext | null = null;

const NOTES: Record<'win' | 'big' | 'soft', number[]> = {
  soft: [660, 880],
  win: [523, 659, 784, 1047],
  big: [523, 659, 784, 1047, 784, 1047, 1319],
};

export function playChime(kind: keyof typeof NOTES = 'win') {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context = context || new Ctor();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + 0.02;
    NOTES[kind].forEach((frequency, index) => {
      const at = start + index * 0.11;
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.3);
    });
  } catch {
    // No sound is never an error worth showing.
  }
}
