import { Component, ChangeDetectorRef, ViewEncapsulation, DoCheck, AfterViewInit } from '@angular/core';
import { GameService } from '../services/game.service';
import { CommonModule } from '@angular/common';
import { AutoFitTextDirective } from './auto-fit-text.directive';

@Component({
  selector: 'app-presentation',
  standalone: true,
  imports: [CommonModule, AutoFitTextDirective],
  templateUrl: './presentation.component.html',
  styleUrls: ['./presentation.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PresentationComponent implements DoCheck, AfterViewInit {
  private audioCtx?: AudioContext;
  private lastShowWrong = false;
  private removeInteractionListeners?: () => void;
  public audioReady = false;
  public audioUnlockedOnce = false; // persisted across reloads
  public showAudioNudge = false; // small button hint after first unlock
  private sfxPrimed = false; // ensure HTMLAudioElements are primed post-unlock
  private lastBuzzerAt = 0;
  private seenJustRevealed = new Set<number>();
  private lastQuestionIndex = -1;
  // Optional external SFX loaded from /sounds (public folder)
  private sfx: {
    reveal?: HTMLAudioElement;
    wrong?: HTMLAudioElement;
    tick?: HTMLAudioElement;
    board?: HTMLAudioElement;
    rapid?: HTMLAudioElement;
    fast?: HTMLAudioElement;
  } = {};
  private sfxReady: { [k: string]: boolean } = { reveal: false, wrong: false, tick: false, board: false, rapid: false, fast: false };
  private tickInterval: any = null;
  constructor(public game: GameService, private cdr: ChangeDetectorRef) {
    // Listen for state changes and trigger change detection
    (game as any)._presentationCdr = cdr;
    // Allow GameService to notify us immediately on showWrong transitions
    (game as any)._onShowWrong = () => this.playWrongSound(false);
    // Notify immediately when admin reveals an answer
    (game as any)._onReveal = (indices: number[]) => {
      try {
        this.playRevealSound();
        indices?.forEach(i => this.seenJustRevealed.add(i));
      } catch {}
    };
    // Board load cue (when question becomes visible or index changes)
    (game as any)._onBoardLoad = () => {
      try { this.playBoardLoadSound(); } catch {}
    };
    // Numbers shown cue (optional: reuse board load sound)
    (game as any)._onShowNumbers = () => {
      try { this.playBoardLoadSound(); } catch {}
    };
    // Timer running changed -> start/stop tick
    (game as any)._onTimerRunningChange = (running: boolean) => {
      try {
        if (running) this.startTick(); else this.stopTick();
      } catch {}
    };
    // Rapid round: play sounds on load
    (game as any)._onRapidLoad = (who: 'p1'|'p2', index: number, kind: 'answer'|'percentage', value: any) => {
      try {
        if (kind === 'answer' && typeof value === 'string' && value.trim().length > 0) {
          this.playRapidLoadSound();
        } else if (kind === 'percentage' && typeof value === 'number') {
          if (value > 0) {
            this.playRevealSound();
          } else if (value === 0) {
            this.playWrongSound(true);
          }
        }
      } catch {}
    };
    // Fast Money cue from admin broadcast
    (game as any)._onFastMoney = () => {
      try { this.playFastMoneyTheme(); } catch {}
    };
  }

  // Used to trigger slot animation when just revealed
  isJustRevealed(idx: number): boolean {
    return !!this.game.currentQuestion.options[idx]?.justRevealed;
  }

  // After animation, reset justRevealed
  onSlotAnimationEnd(idx: number) {
    if (this.game.currentQuestion.options[idx]) {
      this.game.currentQuestion.options[idx].justRevealed = false;
    }
  }

  getTotalScore(): number {
    return this.game.currentQuestion.options
      .filter(o => o.revealed)
      .reduce((sum, o) => sum + o.percentage, 0);
  }

  get numAnswersToShow(): number {
    // Round 2 has 5 answers, round 1 has 8
    const q = this.game.currentQuestion;
    if (!q) return 8;
    // If last 3 answers are empty, it's round 2
    const emptyCount = q.options.filter(opt => !opt.answer).length;
    return emptyCount >= 3 ? 5 : 8;
  }

  // Add this method to PresentationComponent
  get selectedTeamScore(): number {
    const team = this.game.teams.find(t => t.name === this.game.selectedTeam);
    return team ? team.score : 0;
  }

  // Display repeated Xs instead of numeric count
  get wrongXs(): string {
    const count = Math.max(0, Math.min(3, this.game.wrongCount || 0));
    return 'X'.repeat(count || 1); // show at least one X when overlay is visible
  }

  ngDoCheck(): void {
    // Detect rising edge of showWrong to play buzzer
    if (this.game.showWrong && !this.lastShowWrong) {
      this.playWrongSound(false);
    }
    this.lastShowWrong = this.game.showWrong;

    // Reset reveal tracking on question change
    if (this.game.currentQuestionIndex !== this.lastQuestionIndex) {
      this.seenJustRevealed.clear();
      this.lastQuestionIndex = this.game.currentQuestionIndex;
    }

    // Play a chime when an answer is revealed (admin clicks show)
    const opts = this.game.currentQuestion?.options || [];
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      if (o && o.justRevealed && !this.seenJustRevealed.has(i)) {
        this.playRevealSound();
        this.seenJustRevealed.add(i);
      }
    }
  }

  ngAfterViewInit(): void {
    // Try to initialize audio immediately (no manual enable button)
    this.initAudio();
    // Add multiple passive listeners to resume audio context if the browser requires a gesture
    const tryInit = () => this.initAudio();
    const listeners: Array<[string, any, any?]> = [
      ['click', tryInit, { once: true }],
      ['keydown', tryInit, { once: true }],
      ['touchstart', tryInit, { once: true }],
      ['pointerdown', tryInit, { once: true }],
      ['pointerup', tryInit, { once: true }],
      ['mousedown', tryInit, { once: true }],
      ['mousemove', tryInit, { once: true }],
      ['pointermove', tryInit, { once: true }],
      // Non-gesture events (may not unlock, but harmless retries)
      ['visibilitychange', tryInit, undefined],
      ['focus', tryInit, undefined],
    ];
    listeners.forEach(([evt, fn, opts]) => window.addEventListener(evt as any, fn, (opts || {}) as any));
    this.removeInteractionListeners = () => {
      listeners.forEach(([evt, fn]) => window.removeEventListener(evt as any, fn as any));
    };

    // If audio was unlocked before, aggressively auto-resume on visibility/focus
    try {
      this.audioUnlockedOnce = !!window.localStorage.getItem('feud.audioUnlockedOnce');
    } catch {}
    if (this.audioUnlockedOnce) {
      this.installAutoResume();
    }
  }

  private async initAudio() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (!ctx) return;
      const wasRunning = (ctx.state === 'running');
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }
      // Track state changes to auto-resume and update UI
      try {
        ctx.onstatechange = () => {
          const running = (ctx.state === 'running');
          this.audioReady = running;
          if (!running) {
            // After first unlock, show a small nudge instead of fullscreen overlay
            this.showAudioNudge = this.audioUnlockedOnce;
            // Attempt auto-resume if page is visible
            if (document.visibilityState === 'visible') this.tryResumeSoon();
          } else {
            this.showAudioNudge = false;
          }
          this.cdr.markForCheck();
        };
      } catch {}
      // Try to load external SFX once audio is permitted
      this.loadSfx();
      // Clean up interaction listeners after success
      this.removeInteractionListeners?.();
      this.removeInteractionListeners = undefined;
      this.audioReady = (ctx.state === 'running');
      // If we transitioned into running, play a short confirmation beep
      if (this.audioReady && !wasRunning) {
        this.playTestBeep();
        // Persist the one-time unlock for this browser
        try {
          window.localStorage.setItem('feud.audioUnlockedOnce', '1');
          this.audioUnlockedOnce = true;
        } catch {}
  this.installAutoResume();
  // Prime SFX elements for better reliability across browsers
  this.primeSfx();
      }
      this.cdr.markForCheck();
    } catch {}
  }

  public async enableAudio() {
    await this.initAudio();
    // Optional: leave as no-op now that audio is auto-enabled
  }

  private installAutoResume() {
    // Keep trying to resume when visible without requiring overlay clicks
    const tryResume = () => this.tryResumeSoon();
    window.addEventListener('visibilitychange', tryResume);
    window.addEventListener('focus', tryResume);
    window.addEventListener('pageshow', tryResume);
    // Light keep-alive: periodically nudge resume while visible
    setInterval(() => {
      if (document.visibilityState === 'visible') this.tryResumeSoon();
    }, 20000);
  }

  private async tryResumeSoon() {
    try {
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state !== 'running') {
        await ctx.resume();
        const st: any = (ctx as any).state;
        if (st === 'running') {
          this.audioReady = true;
          this.showAudioNudge = false;
          this.cdr.markForCheck();
        }
      }
    } catch {}
  }

  private async primeSfx() {
    if (this.sfxPrimed) return;
    try {
      const keys = Object.keys(this.sfx) as Array<keyof typeof this.sfx>;
      for (const k of keys) {
        const el = this.sfx[k];
        if (!el) continue;
        const prevMuted = el.muted;
        const prevVol = el.volume;
        try {
          el.muted = true;
          el.volume = 0;
          el.currentTime = 0;
          await el.play().catch(() => {});
          el.pause();
        } catch {}
        try { el.muted = prevMuted; el.volume = prevVol; } catch {}
      }
      this.sfxPrimed = true;
    } catch {}
  }

  private async playBuzzer() {
    try {
      const nowTs = Date.now();
      if (nowTs - this.lastBuzzerAt < 250) return; // cooldown to avoid duplicates
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();

      // Longer, more vibrant buzzer: detuned squares + tremolo + subtle distortion + filtered noise
      const duration = 1.6;
      const now = ctx.currentTime;

      // Main oscillators (slightly detuned)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'square';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(200, now);
      osc2.frequency.setValueAtTime(200 * 1.02, now);
      // Gentle downward sweep for character
      osc1.frequency.exponentialRampToValueAtTime(140, now + duration * 0.7);
      osc2.frequency.exponentialRampToValueAtTime(140 * 1.02, now + duration * 0.7);

      // Gain envelope
      const toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.linearRampToValueAtTime(0.85, now + 0.05);
      toneGain.gain.setValueAtTime(0.85, now + duration * 0.6);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      // Tremolo for vibrancy
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(7, now); // 7 Hz tremolo
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.35, now); // depth
      lfo.connect(lfoGain);
      lfoGain.connect(toneGain.gain);

      // Filter to tame highs
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1300, now);

      // Subtle distortion for body
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.makeDistortionCurve(30);
      shaper.oversample = '4x' as any;

      // A touch of filtered noise for texture
      const noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1000, now);
      noiseFilter.Q.setValueAtTime(1.0, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.06, now); // low level

      // Routing
      const master = ctx.createGain();
      master.gain.setValueAtTime(1.0, now);

      osc1.connect(toneGain);
      osc2.connect(toneGain);
      toneGain.connect(filter);
      filter.connect(shaper);
      shaper.connect(master);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);

      master.connect(ctx.destination);

      // Start/stop
      lfo.start(now);
      osc1.start(now);
      osc2.start(now);
      noise.start(now);
      osc1.stop(now + duration);
      osc2.stop(now + duration);
      lfo.stop(now + duration);
      noise.stop(now + duration);

      this.lastBuzzerAt = nowTs;
    } catch {}
  }

  // Shorter "wrong" sound for rapid 0% loads
  private async playShortBuzzer() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();

      const duration = 0.35;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + duration * 0.7);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, now);
      filter.Q.setValueAtTime(1.2, now);

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  // Prefer external SFX for reveal; fallback to synth chime
  private playRevealSound() {
    if (this.sfx['reveal'] && this.sfxReady['reveal']) {
      this.playOneShot(this.sfx['reveal']);
    } else {
      this.playRevealChime();
    }
  }

  // Prefer external SFX for wrong; fallback to long/short buzzer
  private playWrongSound(preferShort: boolean) {
    if (this.sfx['wrong'] && this.sfxReady['wrong']) {
      try {
        // Try playing the preloaded element; on failure, fall back to buzzer
        this.sfx['wrong'].pause();
        try { this.sfx['wrong'].currentTime = 0; } catch {}
        this.sfx['wrong'].play().catch(() => {
          if (preferShort) this.playShortBuzzer(); else this.playBuzzer();
        });
      } catch {
        if (preferShort) this.playShortBuzzer(); else this.playBuzzer();
      }
    } else {
      if (preferShort) this.playShortBuzzer(); else this.playBuzzer();
    }
  }

  private playBoardLoadSound() {
    if (this.sfx['board'] && this.sfxReady['board']) {
      try {
        this.sfx['board'].pause();
        try { this.sfx['board'].currentTime = 0; } catch {}
        this.sfx['board'].play().catch(() => this.playRevealChime());
      } catch { this.playRevealChime(); }
    } else {
      // Fallback to a pleasant reveal chime
      this.playRevealChime();
    }
  }

  private playRapidLoadSound() {
    if (this.sfx['rapid'] && this.sfxReady['rapid']) {
      this.playOneShot(this.sfx['rapid']);
    } else {
      // Fallback to reveal chime if a dedicated rapid sound isn't provided
      this.playRevealChime();
    }
  }

  private startTick() {
  // Nudge resume when timer starts
  this.tryResumeSoon();
  if (this.sfx['tick'] && this.sfxReady['tick']) {
      try {
  this.sfx['tick'].loop = true;
  this.sfx['tick'].currentTime = 0;
  this.sfx['tick'].play().catch(() => {});
      } catch {}
    } else {
      if (this.tickInterval) clearInterval(this.tickInterval);
      this.tickInterval = setInterval(() => this.playTickClick(), 1000);
    }
  }

  private stopTick() {
    if (this.sfx['tick'] && this.sfxReady['tick']) {
      try { this.sfx['tick'].pause(); } catch {}
    }
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  private loadSfx() {
    try {
      const base = '/sounds/'; // served from public/sounds
      const make = (key: 'reveal'|'wrong'|'board'|'tick'|'rapid'|'fast', file: string) => {
        const a = new Audio(base + file);
        a.preload = 'auto';
        a.addEventListener('canplaythrough', () => { this.sfxReady[key] = true; }, { once: true });
        a.addEventListener('loadeddata', () => { this.sfxReady[key] = true; }, { once: true });
        a.addEventListener('error', () => { this.sfxReady[key] = false; });
        return a;
      };
      this.sfx.reveal = make('reveal', 'feud-reveal.mp3');
      this.sfx.wrong  = make('wrong',  'feud-wrong.mp3');
  // Play this when moving to the next question
  this.sfx.board  = make('board',  'family-feud-next-question.mp3');
      this.sfx.tick   = make('tick',   'feud-tick.mp3');
      this.sfx.rapid  = make('rapid',  'feud-rapid-load.mp3');
      this.sfx.fast   = make('fast',   'family-feud-fast-money.mp3');
      this.sfx['tick'].loop = true;
      this.sfx['tick'].volume = 0.5;
    } catch {}
  }

  private playOneShot(sample: HTMLAudioElement) {
    try {
      // Ensure context is running if possible
      this.tryResumeSoon();
      // Prefer playing the preloaded element directly; fallback to clone if blocked
      try {
        sample.pause();
        try { sample.currentTime = 0; } catch {}
        sample.play().catch(() => {
          const a = new Audio(sample.src);
          a.play().catch(() => {});
        });
      } catch {
        const a = new Audio(sample.src);
        a.play().catch(() => {});
      }
    } catch {}
  }

  // Minimal click as a fallback for ticking
  private async playTickClick() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  // Helper: show rapid % if >0 OR if admin explicitly loaded percentage (so 0 displays)
  public showRapidPercentage(who: 'p1'|'p2', index: number): boolean {
    const pct = who === 'p1' ? (this.game.rapidAnswers.participant1[index]?.percentage ?? 0)
                              : (this.game.rapidAnswers.participant2[index]?.percentage ?? 0);
    if (pct > 0) return true;
    const loaded = who === 'p1'
      ? !!this.game.rapidPercentageLoaded?.participant1?.[index]
      : !!this.game.rapidPercentageLoaded?.participant2?.[index];
    return loaded;
  }

  private makeDistortionCurve(amount: number) {
    const k = typeof amount === 'number' ? amount : 50;
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private async playRevealChime() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();

      const now = ctx.currentTime;
      const duration = 0.7;

      // Bright chime: sine + overtone, gentle HP filter, percussive envelope
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      oscA.type = 'sine';
      oscB.type = 'sine';
      oscA.frequency.setValueAtTime(880, now); // A5
      oscB.frequency.setValueAtTime(1320, now); // harmonic

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(300, now);

      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(hp);
      hp.connect(ctx.destination);

      // slight pitch up blip for sparkle
      oscA.frequency.exponentialRampToValueAtTime(932, now + 0.06);
      oscB.frequency.exponentialRampToValueAtTime(1398, now + 0.06);

      oscA.start(now);
      oscB.start(now);
      oscA.stop(now + duration);
      oscB.stop(now + duration);
    } catch {}
  }

  private playTestBeep() {
    try {
      const ctx = this.audioCtx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  private playFastMoneyTheme() {
    try {
      this.tryResumeSoon();
      if (this.sfx['fast'] && this.sfxReady['fast']) {
        // Use the preloaded element to improve reliability post-unlock
        const el = this.sfx['fast'];
        try { el.pause(); } catch {}
        try { el.currentTime = 0; } catch {}
        el.play().catch(() => {
          // Fallback: if theme fails, at least play the board load cue
          this.playBoardLoadSound();
        });
      } else {
        // Fallback: play the board load sound if theme not ready
        this.playBoardLoadSound();
      }
    } catch {}
  }
}
