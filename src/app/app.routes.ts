import { Routes } from '@angular/router';
import { AdminComponent } from './admin/admin.component';
import { PresentationComponent } from './presentation/presentation.component';
import { SurveyComponent } from './survey/survey.component';

export const routes: Routes = [
  { path: 'admin', component: AdminComponent },
  { path: 'presentation', component: PresentationComponent },
  { path: 'survey', component: SurveyComponent },
  { path: '', redirectTo: 'presentation', pathMatch: 'full' }
];
