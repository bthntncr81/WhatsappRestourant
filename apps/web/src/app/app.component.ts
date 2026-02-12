import { Component, inject, signal, effect } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ShellComponent } from './layout/shell/shell.component';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ShellComponent, CommonModule],
  template: `
    @if (authService.isAuthenticated()) {
      @if (isStandalonePage()) {
        <router-outlet />
      } @else {
        <app-shell>
          <router-outlet />
        </app-shell>
      }
    } @else {
      <router-outlet />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }
    `,
  ],
})
export class AppComponent {
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  private router = inject(Router);
  
  isStandalonePage = signal(false);
  
  // Pages that should render without shell (no sidebar/topbar)
  private standaloneRoutes = ['/billing'];
  
  constructor() {
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event) => {
      this.isStandalonePage.set(
        this.standaloneRoutes.some(route => event.urlAfterRedirects.startsWith(route))
      );
    });
    
    // Check initial route
    if (this.standaloneRoutes.some(route => this.router.url.startsWith(route))) {
      this.isStandalonePage.set(true);
    }
  }
}
