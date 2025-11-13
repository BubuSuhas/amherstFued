import { Component, DoCheck } from '@angular/core';
import * as XLSX from 'xlsx';
import { GameService } from '../services/game.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss']
})
export class AdminComponent implements DoCheck {
  timerInput: number = 0;
  selectedTeam: string = 'Team A';
  teamNames = ['Team A', 'Team B'];
  selectedParticipant: number = 1;

  // Store rapid fire answers for both participants
  rapidFireInputs: { p1: { answer: string; percentage: number }, p2: { answer: string; percentage: number } }[] = [];

  // Reference answers and percentages for each rapid fire question
  rapidFireRefs: { answers: string[]; percentages: number[] }[] = [];

  constructor(public game: GameService) {
    this.game.setAdminMode(true);
    this.rapidFireInputs = this.game.rapidFireQuestions.map(() => ({
      p1: { answer: '', percentage: 0 },
      p2: { answer: '', percentage: 0 }
    }));
    this.rapidFireRefs = this.game.rapidFireQuestions.map(q => {
      const ref = this.game.questions.find(qn => qn.text === q);
      return {
        answers: ref ? ref.options.slice(0, 5).map(opt => opt.answer) : Array(5).fill(''),
        percentages: ref ? ref.options.slice(0, 5).map(opt => opt.percentage) : Array(5).fill(0)
      };
    });
  }

  ngOnInit(): void {
    // Poll survey state so the status reflects server truth even if a POST fails
    this.loadSurveyState();
    setInterval(() => this.loadSurveyState(), 4000);
  }

  ngDoCheck(): void {
    // Keep local rapid arrays in sync with game.rapidFireQuestions length
    const needLen = this.game.rapidFireQuestions.length;
    if (this.rapidFireInputs.length !== needLen) {
      const next: { p1: { answer: string; percentage: number }, p2: { answer: string; percentage: number } }[] = [];
      for (let i = 0; i < needLen; i++) {
        next[i] = this.rapidFireInputs[i] ?? { p1: { answer: '', percentage: 0 }, p2: { answer: '', percentage: 0 } };
      }
      this.rapidFireInputs = next;
    }
    if (this.rapidFireRefs.length !== needLen) {
      this.rapidFireRefs = this.game.rapidFireQuestions.map(q => {
        const ref = this.game.questions.find(qn => qn.text === q);
        return {
          answers: ref ? ref.options.slice(0, 5).map(opt => opt.answer) : Array(5).fill(''),
          percentages: ref ? ref.options.slice(0, 5).map(opt => opt.percentage) : Array(5).fill(0)
        };
      });
    }
  }

  // Ensure a rapid fire input row exists for index i; returns the row
  ensureRapidRow(i: number) {
    if (!this.rapidFireInputs[i]) {
      this.rapidFireInputs[i] = { p1: { answer: '', percentage: 0 }, p2: { answer: '', percentage: 0 } };
    }
    return this.rapidFireInputs[i];
  }

  // Return indices for pairing reference answers and percentages for row i
  refIndices(i: number): number[] {
    const aLen = this.rapidFireRefs[i]?.answers?.length || 0;
    const pLen = this.rapidFireRefs[i]?.percentages?.length || 0;
    const max = Math.max(aLen, pLen);
    return Array.from({ length: max }, (_, k) => k);
  }

  toggleOption(idx: number) {
    this.game.toggleOption(idx);
  }

  nextQuestion() {
    this.game.nextQuestion();
    // If survey is active, push the new question to survey state immediately
    if (this.surveyActive) {
      this.postSurveyState(true);
    }
    if (this.game.currentQuestion?.round === 'Rapid Fire') {
      this.rapidFireInputs = this.game.rapidFireQuestions.map(() => ({
        p1: { answer: '', percentage: 0 },
        p2: { answer: '', percentage: 0 }
      }));
      this.rapidFireRefs = this.game.rapidFireQuestions.map(q => {
        const ref = this.game.questions.find(qn => qn.text === q);
        return {
          answers: ref ? ref.options.slice(0, 5).map(opt => opt.answer) : Array(5).fill(''),
          percentages: ref ? ref.options.slice(0, 5).map(opt => opt.percentage) : Array(5).fill(0)
        };
      });
    }
  }

  addScore(teamIdx: number, points: number) {
    this.game.addScore(teamIdx, points);
  }

  resetGame() {
    this.game.resetGame();
    // Reset local admin selections and inputs
    this.selectedTeam = 'Team A';
    this.selectedParticipant = 1;
    this.timerInput = 0;
    this.rapidFireInputs = this.game.rapidFireQuestions.map(() => ({
      p1: { answer: '', percentage: 0 },
      p2: { answer: '', percentage: 0 }
    }));
    this.rapidFireRefs = this.game.rapidFireQuestions.map(q => {
      const ref = this.game.questions.find(qn => qn.text === q);
      return {
        answers: ref ? ref.options.slice(0, 5).map(opt => opt.answer) : Array(5).fill(''),
        percentages: ref ? ref.options.slice(0, 5).map(opt => opt.percentage) : Array(5).fill(0)
      };
    });
  }

  resetCurrentQuestion() {
    this.game.resetCurrentQuestion();
  }

  onFileChange(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      this.game.loadQuestionsFromSheet(json as any[][]);
      this.rapidFireInputs = this.game.rapidFireQuestions.map(() => ({
        p1: { answer: '', percentage: 0 },
        p2: { answer: '', percentage: 0 }
      }));
      this.rapidFireRefs = this.game.rapidFireQuestions.map(q => {
        const ref = this.game.questions.find(qn => qn.text === q);
        return {
          answers: ref ? ref.options.slice(0, 5).map(opt => opt.answer) : Array(5).fill(''),
          percentages: ref ? ref.options.slice(0, 5).map(opt => opt.percentage) : Array(5).fill(0)
        };
      });
    };
    reader.readAsArrayBuffer(file);
  }

  setTimerValue(val: number) {
    this.timerInput = val;
    this.game.setTimerValue(this.timerInput);
  }

  startTimer() {
    (window as any).adminTimerInput = this.timerInput;
    this.game.startTimer();
  }

  stopTimer() {
    this.game.stopTimer();
  }

  clearTimer() {
    this.game.clearTimer();
  }

  incrementWrong() {
    this.game.incrementWrong();
  }

  resetWrong() {
    this.game.resetWrong();
  }

  get wrongCount() {
    return this.game.wrongCount || 0;
  }

  updateScore() {
    if (this.game.currentQuestion?.round === 'Rapid Fire') {
      const allP1Populated = this.game.rapidAnswers.participant1.every(a => a.answer !== '');
      const allP2Populated = this.game.rapidAnswers.participant2.every(a => a.answer !== '');
      if (allP1Populated && allP2Populated) {
        this.game.addScoreByName(this.selectedTeam, this.game.totalRapidScore);
      }
    } else {
      const totalScore = this.game.currentQuestion.options
        .filter(opt => opt.revealed)
        .reduce((sum, opt) => sum + (opt.percentage || 0), 0);
      this.game.addScoreByName(this.selectedTeam, totalScore);
    }
  }

  onTeamChange(team: string) {
    this.selectedTeam = team;
    this.game.selectedTeam = team;
    this.game.syncState();
  }

  toggleQuestionVisibility() {
    this.game.setQuestionVisible(!this.game.questionVisible);
  }

  onLoadP1Answer(i: number) {
    if (this.rapidFireInputs[i] && this.rapidFireInputs[i].p1.answer !== undefined) {
      this.game.rapidAnswers.participant1[i].answer = this.rapidFireInputs[i].p1.answer;
      this.game.syncState();
    }
  }
  onLoadP1Percentage(i: number) {
    if (this.rapidFireInputs[i] && this.rapidFireInputs[i].p1.percentage !== undefined) {
      this.game.rapidAnswers.participant1[i].percentage = this.rapidFireInputs[i].p1.percentage;
      // Mark as explicitly loaded so 0 can be displayed/sounded
      if (!this.game.rapidPercentageLoaded) {
        this.game.rapidPercentageLoaded = { participant1: Array(10).fill(false), participant2: Array(10).fill(false) } as any;
      }
      this.game.rapidPercentageLoaded.participant1[i] = true;
      this.game.syncState();
    }
  }
  onLoadP2Answer(i: number) {
    if (this.rapidFireInputs[i] && this.rapidFireInputs[i].p2.answer !== undefined) {
      this.game.rapidAnswers.participant2[i].answer = this.rapidFireInputs[i].p2.answer;
      this.game.syncState();
    }
  }
  onLoadP2Percentage(i: number) {
    if (this.rapidFireInputs[i] && this.rapidFireInputs[i].p2.percentage !== undefined) {
      this.game.rapidAnswers.participant2[i].percentage = this.rapidFireInputs[i].p2.percentage;
      if (!this.game.rapidPercentageLoaded) {
        this.game.rapidPercentageLoaded = { participant1: Array(10).fill(false), participant2: Array(10).fill(false) } as any;
      }
      this.game.rapidPercentageLoaded.participant2[i] = true;
      this.game.syncState();
    }
  }

  onParticipantChange(participant: number) {
    this.selectedParticipant = participant;
    this.game.selectedParticipant = participant;
    this.game.syncState();
  }

  // Play the Fast Money sound on demand (available across admin)
  playFastMoney() {
    try {
      // Play locally for preview
      const a = new Audio('/sounds/family-feud-fast-money.mp3');
      a.play().catch(() => {});
      // Also broadcast to presentation via WebSocket
      this.game.playFastMoneyCue?.();
    } catch {}
  }

  // Show numbers on the presentation board
  showNumbers() {
    this.game.setShowNumbers(true);
  }

  // Hide numbers on the presentation board
  hideNumbers() {
    this.game.setShowNumbers(false);
  }

  // --- Survey controls ---
  surveyActive: boolean = false;
  private surveyBaseUrls(): string[] {
    const loc = window.location as any;
    const same = loc.origin as string;
    const alt = (loc.port === '4200') ? `${loc.protocol}//localhost:3001` : same;
    return Array.from(new Set([same, alt]));
  }
  private async loadSurveyState() {
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/state`);
        if (!r.ok) continue;
        const s = await r.json();
        this.surveyActive = !!s.active;
        return;
      } catch {}
    }
  }
  private async postSurveyState(active: boolean) {
    const body = { active, currentQuestionIndex: this.game.currentQuestionIndex, questionText: this.game.currentQuestion?.text || '' };
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) { this.surveyActive = active; return; }
      } catch {}
    }
  }
  async startSurveyForCurrent() { await this.postSurveyState(true); }
  async stopSurvey() { await this.postSurveyState(false); }

  // --- Survey Review ---
  reviewQIndex: number = 0;
  rawResponses: Array<{ id: string; ts: number; questionIndex: number; questionText: string; raw: string; }> = [] as any;
  clusters: Array<{ label: string; count: number; percentage: number; examples: string[]; members: string[]; }> = [];
  synonymsText: string = '';
  private synonymsMap: Record<string, string> = {};
  // AI status
  aiAvailable: boolean = false;
  aiProvider: string | null = null;
  aiLastError: string | null = null;

  async loadResponsesForReview() {
    // Default to current question index
    if (this.reviewQIndex == null) this.reviewQIndex = this.game.currentQuestionIndex | 0;
    const bases = this.surveyBaseUrls();
    // refresh AI config in parallel (best effort)
    this.loadAiConfig();
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/api/survey/responses`);
        if (!r.ok) continue;
        const data = await r.json();
        const all = (data.responses || []) as any[];
        this.rawResponses = all.filter(r => (r.questionIndex|0) === (this.reviewQIndex|0));
        await this.loadSynonyms();
        this.recluster();
        return;
      } catch {}
    }
  }

  private async loadAiConfig() {
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/ai-config`);
        if (!r.ok) continue;
        const data = await r.json();
        this.aiAvailable = !!data.available;
        this.aiProvider = data.provider || null;
        return;
      } catch {}
    }
  }

  private async loadSynonyms() {
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/synonyms`);
        if (!r.ok) continue;
        const data = await r.json();
        this.synonymsMap = data.synonyms || {};
        this.synonymsText = Object.entries(this.synonymsMap).map(([k,v]) => `${k} => ${v}`).join('\n');
        return;
      } catch {}
    }
  }

  onSynonymsChangeLocal() {
    const map: Record<string, string> = {};
    (this.synonymsText || '').split(/\r?\n/).forEach(line => {
      const m = line.split('=>');
      if (m.length >= 2) {
        const from = m[0].trim();
        const to = m.slice(1).join('=>').trim();
        if (from) map[from] = to;
      }
    });
    this.synonymsMap = map;
  }

  async saveSynonyms() {
    this.onSynonymsChangeLocal();
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/synonyms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ synonyms: this.synonymsMap }) });
        if (r.ok) { break; }
      } catch {}
    }
    this.recluster();
  }

  async aiCluster() {
    // Ensure we have responses
    if (!this.rawResponses.length) {
      await this.loadResponsesForReview();
      if (!this.rawResponses.length) return;
    }
    await this.loadAiConfig();
    const body = { questionIndex: this.reviewQIndex };
    let result: any = null;
    let lastErr: any = null;
    for (const base of this.surveyBaseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/ai-cluster`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) {
          try { const err = await r.json(); console.warn('AI cluster error', err); lastErr = err; } catch (e) { lastErr = { error: 'http_error', status: r.status }; }
          continue;
        }
        result = await r.json();
        break;
      } catch (e) {}
    }
    if (!result || !Array.isArray(result.clusters)) {
      const details = lastErr?.error ? `\n(${lastErr.error}${lastErr.message ? ': ' + lastErr.message : ''})` : '';
      this.aiLastError = (lastErr?.error || 'unavailable') + (lastErr?.message ? `: ${lastErr.message}` : '');
      alert('AI clustering unavailable or returned no result. Falling back to local clustering.' + details);
      this.recluster();
      return;
    }
    this.aiLastError = null;
    const total = Math.max(1, this.rawResponses.length);
    // Map AI result to local cluster structure using our responses for examples where needed
    const byId: Record<string, any> = {};
    for (const r of this.rawResponses) byId[r.id] = r;
    this.clusters = result.clusters.map((c: any) => {
      const members: string[] = (c.members || c.memberIds || []).filter((id: string) => !!byId[id]);
      const examples: string[] = (c.examples && c.examples.length) ? c.examples.slice(0,4) : members.slice(0,4).map(id => byId[id]?.raw).filter(Boolean);
      const count = members.length;
      return { label: c.label || '', members, examples, count, percentage: Math.round((count*100)/total) };
    }).sort((a: any,b: any) => b.count - a.count);
  }

  private normalize(s: string): string {
    let x = (s || '').toLowerCase();
    x = x.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ');
    x = x.replace(/\s+/g, ' ').trim();
    // apply synonyms (simple whole-word replace)
    for (const [from, to] of Object.entries(this.synonymsMap || {})) {
      const re = new RegExp(`(^|\\b)${from.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(\\b|$)`, 'gi');
      x = x.replace(re, `$1${to}$2`);
    }
    return x;
  }

  private bigrams(s: string): string[] {
    const q = ` ${s} `;
    const arr: string[] = [];
    for (let i = 0; i < q.length - 1; i++) arr.push(q.slice(i, i+2));
    return arr;
  }
  private dice(a: string, b: string): number {
    if (a === b) return 1;
    const A = this.bigrams(a); const B = this.bigrams(b);
    if (!A.length || !B.length) return 0;
    let inter = 0;
    const setB = new Map<string, number>();
    for (const bi of B) setB.set(bi, (setB.get(bi)||0)+1);
    for (const ai of A) {
      const cnt = setB.get(ai) || 0; if (cnt>0) { inter++; setB.set(ai, cnt-1); }
    }
    return (2*inter) / (A.length + B.length);
  }

  recluster() {
    const items = this.rawResponses.map(r => ({ id: r.id, raw: r.raw, norm: this.normalize(r.raw) }));
    const clusters: Array<{ label: string; members: string[]; examples: string[] }>=[];
    const THRESH = 0.82;
    for (const it of items) {
      let best = -1, bestScore = 0;
      for (let i=0;i<clusters.length;i++){
        const sc = this.dice(it.norm, clusters[i].label);
        if (sc>bestScore){ bestScore = sc; best = i; }
      }
      if (best>=0 && bestScore>=THRESH) {
        clusters[best].members.push(it.id);
        if (clusters[best].examples.length < 4) clusters[best].examples.push(it.raw);
      } else {
        clusters.push({ label: it.norm || it.raw, members: [it.id], examples: [it.raw] });
      }
    }
    const total = Math.max(1, items.length);
    this.clusters = clusters
      .map(c => ({ label: c.label, members: c.members, examples: c.examples, count: c.members.length, percentage: Math.round((c.members.length*100)/total) }))
      .sort((a,b)=> b.count - a.count);
  }

  onLabelChange(c: any) {
    // no-op for now; label used in export; we can later persist curated labels
    this.recluster();
  }

  private mergeTarget: any = null;
  mergeInto(c: any) {
    if (!this.mergeTarget) { this.mergeTarget = c; return; }
    if (this.mergeTarget === c) { this.mergeTarget = null; return; }
    // merge c into target
    this.mergeTarget.members = this.mergeTarget.members.concat(c.members);
    this.mergeTarget.examples = (this.mergeTarget.examples || []).concat(c.examples || []).slice(0,4);
    this.clusters = this.clusters.filter(x => x !== c);
    // recompute counts/percentages
    const total = Math.max(1, this.rawResponses.length);
    for (const cl of this.clusters) {
      cl.count = cl.members.length;
      cl.percentage = Math.round((cl.count*100)/total);
    }
  }

  exportReviewSheet() {
    const total = Math.max(1, this.rawResponses.length);
    const top = this.clusters.slice(0, 8);
    // build a row similar to the import format: [Question, Round, A1, %1, A2, %2, ...]
    const qText = (this.game.questions?.[this.reviewQIndex]?.text) || (this.rawResponses[0]?.questionText) || '';
    const round = (this.game.questions?.[this.reviewQIndex]?.round) || '';
    const row: any[] = [qText, round];
    for (let i=0;i<8;i++){
      const c = top[i];
      if (c) { row.push(c.label); row.push(c.percentage); }
      else { row.push(''); row.push(0); }
    }
    const aoa = [[ 'Question', 'Round', 'A1','%1','A2','%2','A3','%3','A4','%4','A5','%5','A6','%6','A7','%7','A8','%8' ], row];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Survey Consolidated');
    XLSX.writeFile(wb, 'survey-consolidated.xlsx');
  }
}
