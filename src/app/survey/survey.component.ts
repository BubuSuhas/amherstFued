import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-survey',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './survey.component.html',
  styleUrls: ['./survey.component.scss']
})
export class SurveyComponent {
  questionText = '';
  active = false;
  currentQuestionIndex = 0;
  private lastSeenIndex = -1;
  totalResponses = 0;
  answer = '';
  submitted = false;
  submitting = false;
  stateRaw: string = '';
  lastUpdated: string = '';

  ngOnInit() {
    this.fetchState();
    // Poll state every 5s for simplicity
    setInterval(() => this.fetchState(), 5000);
  }

  private baseUrls(): string[] {
    const loc = window.location;
    const same = `${loc.origin}`;
    const alt = loc.port === '4200' ? `${loc.protocol}//localhost:3001` : same;
    return Array.from(new Set([same, alt]));
  }

  async fetchState() {
    for (const base of this.baseUrls()) {
      try {
  const r = await fetch(`${base}/api/survey/state`);
        if (!r.ok) continue;
        const s = await r.json();
        this.active = !!s.active;
        const newIndex = s.currentQuestionIndex | 0;
        // Reset submit state when question changes
        if (newIndex !== this.lastSeenIndex) {
          this.submitted = false;
          this.answer = '';
          this.lastSeenIndex = newIndex;
        }
        this.currentQuestionIndex = newIndex;
        this.totalResponses = s.totalResponses | 0;
        const txt = (s.questionText || '').toString().trim();
        this.questionText = this.active ? (txt || `Question #${this.currentQuestionIndex + 1}`) : 'No active survey';
        this.stateRaw = JSON.stringify(s);
        this.lastUpdated = new Date().toLocaleTimeString();
        return;
      } catch {}
    }
  }

  async submit() {
    if (!this.active || !this.answer.trim() || this.submitting || this.submitted) return;
    this.submitting = true;
    const payload = {
      questionIndex: this.currentQuestionIndex,
      raw: this.answer.trim(),
      clientId: this.getClientId()
    };
    for (const base of this.baseUrls()) {
      try {
        const r = await fetch(`${base}/api/survey/response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) continue;
        this.submitted = true;
        this.answer = '';
        this.submitting = false;
        // Refresh state to update counter without manual refresh
        await this.fetchState();
        return;
      } catch {}
    }
    this.submitting = false;
  }

  private getClientId(): string {
    const key = 'ff-client-id';
    let id = localStorage.getItem(key);
    if (!id) { id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; localStorage.setItem(key, id); }
    return id;
  }
}
