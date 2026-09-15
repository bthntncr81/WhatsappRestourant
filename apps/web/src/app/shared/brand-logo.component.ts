import { Component, Input } from '@angular/core';

/**
 * OtOrder AI brand logo.
 *
 * Renders the official OtOrder wordmark image (assets/brand/) with the "AI"
 * suffix badge. Picks the correct asset for the active theme:
 *  - theme="auto"  (default) follows the html[data-theme] attribute
 *  - theme="dark"  always uses the white logo (fixed dark backgrounds)
 *  - theme="light" always uses the colored logo (fixed light backgrounds)
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  template: `
    <span class="brand-logo" [class.fixed-dark]="theme === 'dark'" [class.fixed-light]="theme === 'light'">
      <img
        class="logo-on-dark"
        src="assets/brand/otorder-logo-white.png"
        alt="OtOrder"
        [style.height.px]="height"
      />
      <img
        class="logo-on-light"
        src="assets/brand/otorder-logo.png"
        alt="OtOrder"
        [style.height.px]="height"
      />
      @if (showAi) {
        <span class="ai-badge" [style.height.px]="badgeHeight" [style.font-size.px]="badgeFont">AI</span>
      }
    </span>
  `,
  styles: [
    `
      .brand-logo {
        display: inline-flex;
        align-items: center;
        gap: 9px;
      }

      img {
        display: block;
        width: auto;
      }

      /* Default (dark theme is the app default): white logo */
      .logo-on-light {
        display: none;
      }

      /* Light theme via html[data-theme='light'] */
      :host-context([data-theme='light']) .brand-logo:not(.fixed-dark) .logo-on-dark {
        display: none;
      }
      :host-context([data-theme='light']) .brand-logo:not(.fixed-dark) .logo-on-light {
        display: block;
      }

      /* Forced variants for fixed backgrounds */
      .fixed-dark .logo-on-dark {
        display: block !important;
      }
      .fixed-dark .logo-on-light {
        display: none !important;
      }
      .fixed-light .logo-on-dark {
        display: none;
      }
      .fixed-light .logo-on-light {
        display: block;
      }

      .ai-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 7px;
        border-radius: 6px;
        background: var(--color-accent-primary, #bb1e10);
        color: #ffffff;
        font-family: var(--font-display, 'Sora', sans-serif);
        font-weight: 800;
        letter-spacing: 0.07em;
      }
    `,
  ],
})
export class BrandLogoComponent {
  /** Logo image height in px (aspect ratio 1600x480 — width is auto). */
  @Input() height = 24;
  /** Show the "AI" suffix badge. */
  @Input() showAi = true;
  /** 'auto' follows the theme; 'dark'/'light' force one asset. */
  @Input() theme: 'auto' | 'dark' | 'light' = 'auto';

  get badgeHeight(): number {
    return Math.round(this.height * 0.88);
  }

  get badgeFont(): number {
    return Math.max(10, Math.round(this.height * 0.46));
  }
}
