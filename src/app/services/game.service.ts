import { Injectable, NgZone } from '@angular/core';

export interface Team {
  name: string;
  score: number;
}

export interface QuestionOption {
  answer: string;
  percentage: number;
  revealed: boolean;
  justRevealed?: boolean;
}

export interface Question {
  text: string;
  options: QuestionOption[];
  round?: string;
}

export interface RapidAnswer {
  answer: string;
  percentage: number;
}

@Injectable({ providedIn: 'root' })
export class GameService {
  // Auto team selection toggling per normal-round group
  private autoNextTeamIndexNormal8: number = 0; // starts with Team A
  private autoNextTeamIndexNormal5: number = 0; // starts with Team A
  private lastAutoGroupKey: string = '';
  // Presentation: show unrevealed slot numbers on demand
  public showNumbers: boolean = false;
  previousQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
      const currentRound = this.questions[this.currentQuestionIndex]?.round?.toLowerCase();
      this.isRapidRound = currentRound === 'rapid fire';
      this.syncState();
    }
  }
  get totalRapidScore(): number {
    const sum1 = (this.rapidAnswers?.participant1 ?? []).reduce((acc: number, a: RapidAnswer) => acc + (a.percentage || 0), 0);
    const sum2 = (this.rapidAnswers?.participant2 ?? []).reduce((acc: number, a: RapidAnswer) => acc + (a.percentage || 0), 0);
    return sum1 + sum2;
  }
  teams: Team[] = [
    { name: 'Team A', score: 0 },
    { name: 'Team B', score: 0 }
  ];
  questions: Question[] = [
    {
      text: 'Name a common Indian superstition.',
      options: [
        { answer: 'Black cat crossing the road', percentage: 28, revealed: false },
        { answer: 'Don’t cut nails at night', percentage: 17, revealed: false },
        { answer: 'Nazar / Evil eye protection with lemon & chillies', percentage: 15, revealed: false },
        { answer: 'Don’t sweep the floor after sunset', percentage: 11, revealed: false },
        { answer: 'Twitching eye means something will happen', percentage: 9, revealed: false },
        { answer: 'Avoid leaving home when someone sneezes', percentage: 8, revealed: false },
        { answer: 'Broken mirror brings bad luck', percentage: 7, revealed: false },
        { answer: 'Itchy palms = money.', percentage: 5, revealed: false }
      ]
    },
    {
      text: 'Name something Indian moms do when guests are coming.',
      options: [
        { answer: 'Clean the entire house top to bottom', percentage: 34, revealed: false },
        { answer: 'Make tea and snacks', percentage: 21, revealed: false },
        { answer: 'Yell at kids to clean their rooms', percentage: 14, revealed: false },
        { answer: 'Bring out fancy plates and glasses', percentage: 10, revealed: false },
        { answer: 'Change sofa covers or bedsheets', percentage: 7, revealed: false },
        { answer: 'Spray room freshener / light agarbatti', percentage: 6, revealed: false },
        { answer: 'warn everyone to behave', percentage: 5, revealed: false },
        { answer: 'Dress neatly and comb hair before opening door', percentage: 3, revealed: false }
      ]
    },
    {
      text: 'Name something you hear at Indian weddings/gatherings',
      options: [
        { answer: 'When are you getting married?', percentage: 28, revealed: false },
        { answer: '“Have you eaten?”', percentage: 24, revealed: false },
        { answer: '“You’ve gained/ lost weight!”', percentage: 18, revealed: false },
        { answer: 'when are you going to have kids', percentage: 18, revealed: false },
        { answer: '“Beta, do you remember me?”', percentage: 14, revealed: false },
        { answer: '', percentage: 0, revealed: false },
        { answer: '', percentage: 0, revealed: false },
        { answer: '', percentage: 0, revealed: false }
      ]
    },
    {
      text: 'Name something Indian dads always forget to do.',
      options: [
        { answer: 'Take medicine', percentage: 26, revealed: false },
        { answer: 'Turn off lights/fan', percentage: 22, revealed: false },
        { answer: 'Buy what mom asked for', percentage: 20, revealed: false },
        { answer: 'Charge their phone', percentage: 18, revealed: false },
        { answer: 'Water the plants', percentage: 14, revealed: false },
        { answer: '', percentage: 0, revealed: false },
        { answer: '', percentage: 0, revealed: false },
        { answer: '', percentage: 0, revealed: false }
      ]
    }
    // ...add more questions as needed from spreadsheet...
  ];
  currentQuestionIndex = 0;

  timerValue: number = 0;
  timerRunning: boolean = false;
  timerInterval: any = null;

  wrongCount: number = 0;
  wrongTimeout: any = null;
  showWrong: boolean = false;

  private ws: WebSocket | null = null;
  private isAdmin = false;

  questionVisible: boolean = false;

  rapidAnswers: { participant1: RapidAnswer[]; participant2: RapidAnswer[] } = {
    participant1: Array(10).fill(0).map(() => ({ answer: '', percentage: 0 })),
    participant2: Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }))
  };
  rapidActualAnswers: RapidAnswer[] = Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }));
  // Track if a rapid percentage was explicitly loaded (so 0 can be shown and sounds can play even if value didn't change)
  rapidPercentageLoaded: { participant1: boolean[]; participant2: boolean[] } = {
    participant1: Array(10).fill(false),
    participant2: Array(10).fill(false)
  };
  rapidLoaded: boolean = false;
  isRapidRound: boolean = false;
  rapidFireQuestions: string[] = [];

  selectedParticipant: number = 1;
  selectedTeam: string = 'Team A'; // Add selectedTeam property to GameService

  constructor(private ngZone: NgZone) {
    this.connectWebSocket();
  }

  connectWebSocket() {
    const makeUrls = (): string[] => {
      try {
        const loc = (typeof window !== 'undefined') ? window.location : { protocol: 'http:', host: 'localhost:3001' } as any;
        const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
        const sameOrigin = `${proto}://${loc.host}`;
        const local3001 = `${proto}://localhost:3001`;
        const localLoop = `${proto}://127.0.0.1:3001`;
        return Array.from(new Set([sameOrigin, local3001, localLoop]));
      } catch {
        return ['ws://localhost:3001'];
      }
    };

    const urls = makeUrls();
    const attempt = (i: number) => {
      if (i >= urls.length) {
        console.error('WebSocket: all endpoints failed, retrying in 2s');
        setTimeout(() => this.connectWebSocket(), 2000);
        return;
      }
      const url = urls[i];
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        let opened = false;
        const connectTimeout = setTimeout(() => {
          if (!opened) {
            try { ws.close(); } catch {}
          }
        }, 1500);

        ws.onopen = () => {
          opened = true;
          clearTimeout(connectTimeout);
          console.log('WebSocket connected', url);
        };
        ws.onerror = (err) => {
          console.warn('WebSocket error', err);
        };
        ws.onclose = () => {
          clearTimeout(connectTimeout);
          if (!opened) {
            // Try next endpoint if this one never opened
            attempt(i + 1);
          } else {
            console.warn('WebSocket closed, reconnecting in 2s...');
            setTimeout(() => this.connectWebSocket(), 2000);
          }
        };
        ws.onmessage = (event) => this.handleWebSocketMessage(event as any);
      } catch (e) {
        console.warn('WebSocket connect failed, trying next', e);
        attempt(i + 1);
      }
    };

    attempt(0);
  }

  setAdminMode(isAdmin: boolean) {
    this.isAdmin = isAdmin;
  }

  syncState() {
    if (this.isAdmin && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'update', data: this.getState() }));
    }
  }

  getState() {
    return {
      teams: this.teams,
      questions: this.questions,
      currentQuestionIndex: this.currentQuestionIndex,
      isRapidRound: this.isRapidRound,
      timerValue: this.timerValue,
      timerRunning: this.timerRunning,
      wrongCount: this.wrongCount,
      showWrong: this.showWrong,
      questionVisible: this.questionVisible,
      showNumbers: this.showNumbers,
      rapidAnswers: this.rapidAnswers,
  rapidPercentageLoaded: this.rapidPercentageLoaded,
      rapidActualAnswers: this.rapidActualAnswers,
      rapidLoaded: this.rapidLoaded,
      rapidFireQuestions: this.rapidFireQuestions, // <-- Added
      selectedParticipant: this.selectedParticipant,
      selectedTeam: this.selectedTeam,
    };
  }

  applyState(state: any) {
    this.ngZone.run(() => {
      const prevShowWrong = this.showWrong;
      const prevShowNumbers = this.showNumbers;
      const prevQuestionIndex = this.currentQuestionIndex;
      const prevTimerRunning = this.timerRunning;
      const prevQuestionVisible = this.questionVisible;
      const prevOptionsRevealed = (this.questions?.[prevQuestionIndex]?.options || []).map(o => !!o.revealed);
      const prevRapid = {
        participant1: (this.rapidAnswers?.participant1 ?? []).map((a: any) => ({ ...a })),
        participant2: (this.rapidAnswers?.participant2 ?? []).map((a: any) => ({ ...a })),
      };
      const prevLoaded = {
        participant1: (this.rapidPercentageLoaded?.participant1 ?? []).slice(),
        participant2: (this.rapidPercentageLoaded?.participant2 ?? []).slice(),
      };
      this.teams = state.teams;
      this.questions = state.questions;
      this.currentQuestionIndex = state.currentQuestionIndex;
      // Ensure rapid round flag is in sync or computed from question metadata
      const roundStr = this.questions?.[this.currentQuestionIndex]?.round?.toLowerCase?.() || '';
      this.isRapidRound = (typeof state.isRapidRound === 'boolean') ? state.isRapidRound : (roundStr === 'rapid fire');
      this.timerValue = state.timerValue;
  this.timerRunning = state.timerRunning;
      this.wrongCount = state.wrongCount;
      this.showWrong = state.showWrong;
  this.questionVisible = state.questionVisible ?? false;
    this.showNumbers = !!state.showNumbers;
      this.rapidAnswers = {
  participant1: state.rapidAnswers?.participant1?.map((a: RapidAnswer) => ({ ...a })) ?? Array(10).fill(0).map(() => ({ answer: '', percentage: 0 })),
  participant2: state.rapidAnswers?.participant2?.map((a: RapidAnswer) => ({ ...a })) ?? Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }))
      };
      this.rapidActualAnswers = state.rapidActualAnswers;
      this.rapidPercentageLoaded = {
        participant1: state.rapidPercentageLoaded?.participant1?.slice?.() ?? Array(10).fill(false),
        participant2: state.rapidPercentageLoaded?.participant2?.slice?.() ?? Array(10).fill(false),
      };
      this.rapidLoaded = state.rapidLoaded;
      this.rapidFireQuestions = state.rapidFireQuestions || [];
      this.selectedParticipant = state.selectedParticipant ?? 1;
      if (typeof state.selectedTeam === 'string') {
        this.selectedTeam = state.selectedTeam;
      }
      // Force change detection in presentation
      if ((this as any)._presentationCdr) {
        (this as any)._presentationCdr.detectChanges();
      }
      // If showWrong just turned on, notify presentation to play buzzer immediately
      if (!prevShowWrong && this.showWrong && (this as any)._onShowWrong) {
        try { (this as any)._onShowWrong(); } catch {}
      }
      // If question index changed or visibility turned on, play board load cue
      if (((prevQuestionIndex !== this.currentQuestionIndex) || (!prevQuestionVisible && this.questionVisible)) && (this as any)._onBoardLoad) {
        try { (this as any)._onBoardLoad(); } catch {}
      }
      // Numbers toggled on -> allow presentation to animate
      if (!prevShowNumbers && this.showNumbers && (this as any)._onShowNumbers) {
        try { (this as any)._onShowNumbers(); } catch {}
      }
      // Detect newly revealed options for current question (admin clicked show)
      if (this.currentQuestionIndex === prevQuestionIndex && Array.isArray(prevOptionsRevealed)) {
        const currOptions = (this.questions?.[this.currentQuestionIndex]?.options || []);
        const newly: number[] = [];
        for (let i = 0; i < currOptions.length; i++) {
          const was = !!prevOptionsRevealed[i];
          const now = !!currOptions[i]?.revealed;
          if (!was && now) newly.push(i);
        }
        if (newly.length && (this as any)._onReveal) {
          try { (this as any)._onReveal(newly); } catch {}
        }
      }
      // Rapid round: detect newly loaded answers/percentages and notify presentation
      try {
        const currRapid = this.rapidAnswers || { participant1: [], participant2: [] };
        const maxLen = Math.max(prevRapid.participant1.length, prevRapid.participant2.length, currRapid.participant1.length, currRapid.participant2.length, 10);
        for (let i = 0; i < maxLen; i++) {
          const p1prev = prevRapid.participant1[i] || { answer: '', percentage: 0 };
          const p1curr = currRapid.participant1[i] || { answer: '', percentage: 0 };
          if (p1prev.answer !== p1curr.answer && p1curr.answer && p1curr.answer.trim().length > 0 && (this as any)._onRapidLoad) {
            try { (this as any)._onRapidLoad('p1', i, 'answer', p1curr.answer); } catch {}
          }
          if (p1prev.percentage !== p1curr.percentage && typeof p1curr.percentage === 'number' && (this as any)._onRapidLoad) {
            try { (this as any)._onRapidLoad('p1', i, 'percentage', p1curr.percentage); } catch {}
          }
          const p2prev = prevRapid.participant2[i] || { answer: '', percentage: 0 };
          const p2curr = currRapid.participant2[i] || { answer: '', percentage: 0 };
          if (p2prev.answer !== p2curr.answer && p2curr.answer && p2curr.answer.trim().length > 0 && (this as any)._onRapidLoad) {
            try { (this as any)._onRapidLoad('p2', i, 'answer', p2curr.answer); } catch {}
          }
          if (p2prev.percentage !== p2curr.percentage && typeof p2curr.percentage === 'number' && (this as any)._onRapidLoad) {
            try { (this as any)._onRapidLoad('p2', i, 'percentage', p2curr.percentage); } catch {}
          }
        }
        // Additionally, detect when the admin explicitly pressed Load Percentage (loaded flag toggles to true)
        const currLoaded = this.rapidPercentageLoaded || { participant1: [], participant2: [] };
        const maxLoaded = Math.max(prevLoaded.participant1.length, prevLoaded.participant2.length, currLoaded.participant1.length, currLoaded.participant2.length, 10);
        for (let i = 0; i < maxLoaded; i++) {
          const p1was = !!prevLoaded.participant1[i];
          const p1now = !!currLoaded.participant1[i];
          if (!p1was && p1now && (this as any)._onRapidLoad) {
            const val = currRapid.participant1[i]?.percentage ?? 0;
            try { (this as any)._onRapidLoad('p1', i, 'percentage', val); } catch {}
          }
          const p2was = !!prevLoaded.participant2[i];
          const p2now = !!currLoaded.participant2[i];
          if (!p2was && p2now && (this as any)._onRapidLoad) {
            const val = currRapid.participant2[i]?.percentage ?? 0;
            try { (this as any)._onRapidLoad('p2', i, 'percentage', val); } catch {}
          }
        }
      } catch {}

      // Notify timer running change for tick sound
      try {
        if (prevTimerRunning !== this.timerRunning && (this as any)._onTimerRunningChange) {
          (this as any)._onTimerRunningChange(!!this.timerRunning);
        }
      } catch {}
    });
  }

  get currentQuestion(): Question {
    return this.questions[this.currentQuestionIndex];
  }

  get totalRevealedPercentage(): number {
    if (!this.currentQuestion || !this.currentQuestion.options) return 0;
    return this.currentQuestion.options
      .filter(opt => opt.revealed)
      .reduce((sum, opt) => sum + (opt.percentage || 0), 0);
  }

  revealOption(optionIdx: number) {
    this.currentQuestion.options[optionIdx].revealed = true;
    this.currentQuestion.options[optionIdx].justRevealed = true;
    this.stopTimer();
    this.syncState();
  }

  toggleOption(optionIdx: number) {
    this.currentQuestion.options[optionIdx].revealed = !this.currentQuestion.options[optionIdx].revealed;
    if (this.currentQuestion.options[optionIdx].revealed) {
      this.currentQuestion.options[optionIdx].justRevealed = true;
      this.stopTimer();
    }
    this.syncState();
  }

  nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
      // Always check the round property of the current question
      const currentRound = this.questions[this.currentQuestionIndex]?.round?.toLowerCase();
      this.isRapidRound = currentRound === 'rapid fire';
      // Reset wrong hits on next question
      this.wrongCount = 0;
      this.showWrong = false;
      // Hide numbers on next question
      this.showNumbers = false;
      if (this.wrongTimeout) { clearTimeout(this.wrongTimeout); this.wrongTimeout = null; }
      // Auto team alternation for normal rounds
      this.applyAutoTeamSelectionForCurrentQuestion();
      this.syncState();
    } else {
      // If at the end, check if last question is rapid fire
      const currentRound = this.questions[this.currentQuestionIndex]?.round?.toLowerCase();
      this.isRapidRound = currentRound === 'rapid fire';
      // Also reset wrong hits when attempting to go beyond
      this.wrongCount = 0;
      this.showWrong = false;
      this.showNumbers = false;
      if (this.wrongTimeout) { clearTimeout(this.wrongTimeout); this.wrongTimeout = null; }
      this.syncState();
    }
  }

  addScore(teamIdx: number, points: number) {
    this.teams[teamIdx].score += points;
    this.syncState();
  }

  addScoreByName(teamName: string, score: number) {
    const teamIdx = this.teams.findIndex(t => t.name === teamName);
    if (teamIdx !== -1) {
      this.teams[teamIdx].score += score;
      this.syncState();
    }
  }

  resetGame() {
    // Reset team scores
    this.teams.forEach(t => t.score = 0);
    // Reset questions
    this.questions.forEach(q => q.options.forEach(o => { o.revealed = false; o.justRevealed = false; }));
    // Go to first question
    this.currentQuestionIndex = 0;
    // Reset wrong counts/overlay
    this.wrongCount = 0;
    this.showWrong = false;
    if (this.wrongTimeout) { clearTimeout(this.wrongTimeout); this.wrongTimeout = null; }
    // Reset timer
    this.timerRunning = false;
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    this.timerValue = 0;
    // Hide question text
    this.questionVisible = false;
  // Hide numbers
  this.showNumbers = false;
    // Reset selection
    this.selectedTeam = 'Team A';
    this.selectedParticipant = 1;
  // Reset auto team alternation trackers
  this.autoNextTeamIndexNormal8 = 0;
  this.autoNextTeamIndexNormal5 = 0;
  this.lastAutoGroupKey = '';
    // Reset rapid answers
    this.rapidAnswers = {
      participant1: Array(10).fill(0).map(() => ({ answer: '', percentage: 0 })),
      participant2: Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }))
    };
    this.rapidActualAnswers = Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }));
    this.rapidPercentageLoaded = { participant1: Array(10).fill(false), participant2: Array(10).fill(false) };
    this.rapidLoaded = false;
    // Reset rapid flag based on first question
    const firstRound = this.questions?.[0]?.round?.toLowerCase?.();
    this.isRapidRound = firstRound === 'rapid fire';
    this.syncState();
  }

  resetCurrentQuestion() {
    if (this.currentQuestion.round === 'Rapid Fire') {
  this.rapidAnswers.participant1 = Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }));
  this.rapidAnswers.participant2 = Array(10).fill(0).map(() => ({ answer: '', percentage: 0 }));
  this.rapidPercentageLoaded = { participant1: Array(10).fill(false), participant2: Array(10).fill(false) };
    } else {
      this.currentQuestion.options.forEach(o => { o.revealed = false; o.justRevealed = false; });
    }
    this.showNumbers = false;
    this.syncState();
  }

  loadQuestionsFromSheet(sheet: any[][]) {
    // Find header row
    const header = sheet[0];
    const questions: Question[] = [];
    const roundIdx = header.findIndex(h => h.toLowerCase().includes('round'));
    this.rapidFireQuestions = [];
    for (let i = 1; i < sheet.length; i++) {
      const row = sheet[i];
      if (!row[1]) continue; // skip if no question
      const roundType = row[roundIdx]?.toLowerCase();
      if (roundType === 'rapid fire') {
        this.rapidFireQuestions.push(row[1]);
        // Parse up to 5 rapid fire answers for this question
        const options = [];
        for (let j = 2; j < 2 + 5 * 2; j += 2) {
          const answer = row[j] || '';
          const percentage = Number(row[j + 1]) || 0;
          options.push({ answer, percentage, revealed: false });
        }
        while (options.length < 5) options.push({ answer: '', percentage: 0, revealed: false });
        questions.push({ text: row[1], options, round: 'Rapid Fire' });
        continue;
      }
      // Normal round processing
      let numAnswers = 8;
      if (roundIdx !== -1 && row[roundIdx] == 2) numAnswers = 5;
      const options = [];
      for (let j = 2; j < 2 + numAnswers * 2; j += 2) {
        const answer = row[j] || '';
        const percentage = Number(row[j + 1]) || 0;
        options.push({ answer, percentage, revealed: false });
      }
      while (options.length < 8) options.push({ answer: '', percentage: 0, revealed: false });
      questions.push({ text: row[1], options, round: roundType });
    }
    this.questions = questions;
    this.currentQuestionIndex = 0;
    // Reset auto team alternation trackers when loading new sheet
    this.autoNextTeamIndexNormal8 = 0;
    this.autoNextTeamIndexNormal5 = 0;
    this.lastAutoGroupKey = '';
    this.showNumbers = false;
    this.syncState();
  }

  setTimerValue(val: number) {
    this.timerValue = val;
    this.syncState();
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerRunning = true;
    // Always reset timerValue to timerInput when starting
    if (typeof (window as any).adminTimerInput === 'number') {
      this.timerValue = (window as any).adminTimerInput;
    }
    // Reset justRevealed flags at the start of each timer
    this.currentQuestion.options.forEach(o => o.justRevealed = false);
    this.syncState();
    this.timerInterval = setInterval(() => {
      if (this.timerValue > 0) {
        this.timerValue--;
        this.syncState();
      } else {
        this.timerRunning = false;
        clearInterval(this.timerInterval);
        // Only increment wrong if no answer was revealed during this timer and NOT rapid fire round
        if (!this.isRapidRound && !this.currentQuestion.options.some(o => o.justRevealed)) {
          this.incrementWrong();
        }
        // Reset justRevealed flags for next timer
        this.currentQuestion.options.forEach(o => o.justRevealed = false);
        this.syncState();
      }
    }, 1000);
  }

  stopTimer() {
    this.timerRunning = false;
    clearInterval(this.timerInterval);
    this.syncState();
  }

  clearTimer() {
    this.timerRunning = false;
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    this.timerValue = 0;
    this.syncState();
  }

  incrementWrong() {
    if (this.wrongCount < 3) {
      this.wrongCount++;
      this.showWrong = true;
      this.syncState();
      if (this.wrongTimeout) clearTimeout(this.wrongTimeout);
      this.wrongTimeout = setTimeout(() => {
        this.showWrong = false;
        this.syncState();
      }, 1400);
    }
  }

  setQuestionVisible(visible: boolean) {
    this.questionVisible = visible;
    this.syncState();
  }

  // Toggle showing numbers on board
  setShowNumbers(val: boolean) {
    this.showNumbers = !!val;
    this.syncState();
  }

  resetWrong() {
    this.wrongCount = 0;
    this.showWrong = false;
    this.syncState();
  }

  private handleWebSocketMessage(event: MessageEvent) {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'sync':
        this.applyState(msg.data);
        break;
      // handle other message types if needed
    }
  }

  // Determine normal round group key based on how many answers are intended (8 vs 5)
  private getRoundGroupKey(index: number): string {
    const q = this.questions?.[index];
    if (!q) return '';
    const roundStr = q.round?.toLowerCase?.() || '';
    if (roundStr === 'rapid fire') return 'rapid';
    // Heuristic: if >= 3 empty answers, treat as 5-answer (round 2 style)
    const emptyCount = (q.options || []).filter(o => !o.answer).length;
    return emptyCount >= 3 ? 'normal-5' : 'normal-8';
  }

  // Apply alternating team auto-selection for the current non-rapid question
  private applyAutoTeamSelectionForCurrentQuestion() {
    const key = this.getRoundGroupKey(this.currentQuestionIndex);
    if (!key || key === 'rapid') return; // don't auto-switch during rapid fire
    // If group changed, reset to Team A (index 0)
    if (key !== this.lastAutoGroupKey) {
      if (key === 'normal-5') this.autoNextTeamIndexNormal5 = 0; else this.autoNextTeamIndexNormal8 = 0;
    }
    const idxRef = key === 'normal-5' ? 'autoNextTeamIndexNormal5' : 'autoNextTeamIndexNormal8';
    const nextIdx = (this as any)[idxRef] ?? 0;
    const teamName = this.teams?.[nextIdx]?.name ?? this.teams?.[0]?.name ?? 'Team A';
    this.selectedTeam = teamName;
    // Toggle for next question (always alternate 0 <-> 1)
    (this as any)[idxRef] = nextIdx === 0 ? 1 : 0;
    this.lastAutoGroupKey = key;
  }
}
