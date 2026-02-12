import { Component } from '@angular/core';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [SidebarComponent, TopbarComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <div class="shell-main">
        <app-topbar />
        <main class="shell-content">
          <ng-content />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      .shell {
        display: flex;
        min-height: 100vh;
        background: var(--color-bg-primary);
      }

      .shell-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        margin-left: var(--sidebar-width);
        min-width: 0;
      }

      .shell-content {
        flex: 1;
        padding: var(--spacing-lg);
        overflow-y: auto;
        background: var(--gradient-glow), var(--color-bg-primary);
      }
    `,
  ],
})
export class ShellComponent {}


