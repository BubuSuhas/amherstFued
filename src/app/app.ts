import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AdminComponent } from './admin/admin.component';
import { PresentationComponent } from './presentation/presentation.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AdminComponent, PresentationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('familyfeud');
}
