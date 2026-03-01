import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MenuService,
  MenuVersionDto,
  MenuItemDto,
  MenuOptionGroupDto,
  MenuOptionDto,
  MenuSynonymDto,
  CanonicalMenuExport,
} from '../../services/menu.service';

type Tab = 'versions' | 'items' | 'options' | 'synonyms';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="menu-page">
      <div class="page-header">
        <div class="header-content">
          <h1 class="page-title">Menu Management</h1>
          <p class="page-subtitle text-secondary">Manage your menu versions, items, and options</p>
        </div>
        <div class="header-actions">
          <button class="btn-secondary" (click)="handleImport()">
            <span>📥</span> Import
          </button>
          @if (selectedVersion()) {
            <button class="btn-secondary" (click)="handleExport()">
              <span>📤</span> Export
            </button>
          }
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        @for (tab of tabs; track tab.id) {
          <button
            class="tab"
            [class.active]="activeTab() === tab.id"
            (click)="activeTab.set(tab.id)"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        }
      </div>

      <!-- Version Selector (when not on versions tab) -->
      @if (activeTab() !== 'versions' && versions().length > 0) {
        <div class="version-selector">
          <label class="selector-label">Working Version:</label>
          <select
            class="selector-select"
            [ngModel]="selectedVersionId()"
            (ngModelChange)="selectVersion($event)"
          >
            @for (v of versions(); track v.id) {
              <option [value]="v.id">
                v{{ v.version }} {{ v.publishedAt ? '(Published)' : '(Draft)' }}
              </option>
            }
          </select>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="loading-state">
          <div class="loader"></div>
          <span class="text-muted">Loading...</span>
        </div>
      }

      <!-- Error -->
      @if (error()) {
        <div class="error-alert">
          <span>⚠</span>
          <span>{{ error() }}</span>
          <button class="btn-sm" (click)="loadData()">Retry</button>
        </div>
      }

      <!-- Content -->
      @if (!loading() && !error()) {
        <!-- Versions Tab -->
        @if (activeTab() === 'versions') {
          <div class="content-card">
            <div class="card-header">
              <h2>Menu Versions</h2>
              <button class="btn-primary" (click)="createVersion()">
                <span>+</span> New Version
              </button>
            </div>
            <div class="card-content">
              @if (versions().length === 0) {
                <div class="empty-state">
                  <span class="empty-icon">📋</span>
                  <p>No versions yet. Create your first menu version to get started.</p>
                </div>
              } @else {
                <div class="versions-list">
                  @for (v of versions(); track v.id) {
                    <div class="version-item" [class.published]="v.publishedAt">
                      <div class="version-info">
                        <span class="version-number">Version {{ v.version }}</span>
                        <span class="version-meta text-muted">
                          {{ v.itemCount || 0 }} items •
                          Created {{ v.createdAt | date: 'short' }}
                        </span>
                      </div>
                      <div class="version-status">
                        @if (v.publishedAt) {
                          <span class="status-badge published">Published</span>
                        } @else {
                          <span class="status-badge draft">Draft</span>
                        }
                      </div>
                      <div class="version-actions">
                        @if (!v.publishedAt) {
                          <button class="btn-sm btn-success" (click)="publishVersion(v)">
                            Publish
                          </button>
                        }
                        <button class="btn-sm" (click)="selectVersionAndSwitch(v)">
                          Edit
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Items Tab -->
        @if (activeTab() === 'items') {
          <div class="content-card">
            <div class="card-header">
              <h2>Menu Items</h2>
              @if (selectedVersion() && !selectedVersion()!.publishedAt) {
                <button class="btn-primary" (click)="showItemForm.set(true)">
                  <span>+</span> Add Item
                </button>
              }
            </div>
            <div class="card-content">
              @if (!selectedVersion()) {
                <div class="empty-state">
                  <p>Select a version to view items.</p>
                </div>
              } @else if (items().length === 0) {
                <div class="empty-state">
                  <span class="empty-icon">🍽️</span>
                  <p>No items in this version yet.</p>
                </div>
              } @else {
                <div class="items-grid">
                  @for (category of itemsByCategory(); track category.name) {
                    <div class="category-section">
                      <h3 class="category-title">{{ category.name }}</h3>
                      <div class="items-list">
                        @for (item of category.items; track item.id) {
                          <div class="item-card" [class.inactive]="!item.isActive">
                            <div class="item-header">
                              <span class="item-name">
                                {{ item.name }}
                                @if (item.isReadyFood) {
                                  <span class="ready-food-badge">Hazır Gıda</span>
                                }
                              </span>
                              <span class="item-price">{{ item.basePrice | currency }}</span>
                            </div>
                            @if (item.description) {
                              <p class="item-description text-muted">{{ item.description }}</p>
                            }
                            @if (!selectedVersion()!.publishedAt) {
                              <div class="item-actions">
                                <button class="btn-icon" (click)="editItem(item)">✏️</button>
                                <button class="btn-icon danger" (click)="deleteItem(item)">🗑️</button>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Item Form Modal -->
          @if (showItemForm()) {
            <div class="modal-overlay" (click)="closeItemForm()">
              <div class="modal" (click)="$event.stopPropagation()">
                <div class="modal-header">
                  <h3>{{ editingItem() ? 'Edit Item' : 'Add Item' }}</h3>
                  <button class="btn-icon" (click)="closeItemForm()">✕</button>
                </div>
                <form class="modal-form" (ngSubmit)="saveItem()">
                  <div class="form-group">
                    <label>Name</label>
                    <input type="text" [(ngModel)]="itemForm.name" name="name" required />
                  </div>
                  <div class="form-group">
                    <label>Description</label>
                    <textarea [(ngModel)]="itemForm.description" name="description"></textarea>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Price</label>
                      <input type="number" [(ngModel)]="itemForm.basePrice" name="basePrice" step="0.01" required />
                    </div>
                    <div class="form-group">
                      <label>Category</label>
                      <input type="text" [(ngModel)]="itemForm.category" name="category" required />
                    </div>
                  </div>
                  <div class="form-group">
                    <label class="checkbox-label">
                      <input type="checkbox" [(ngModel)]="itemForm.isActive" name="isActive" />
                      Active
                    </label>
                  </div>
                  <div class="form-group">
                    <label class="checkbox-label">
                      <input type="checkbox" [(ngModel)]="itemForm.isReadyFood" name="isReadyFood" />
                      Hazır Gıda
                    </label>
                    <span class="hint-text">Sipariş hazır durumundayken ekleme yapılabilecek ürünler</span>
                  </div>
                  <div class="modal-actions">
                    <button type="button" class="btn-secondary" (click)="closeItemForm()">Cancel</button>
                    <button type="submit" class="btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          }
        }

        <!-- Option Groups Tab -->
        @if (activeTab() === 'options') {
          <div class="content-card">
            <div class="card-header">
              <h2>Option Groups</h2>
              @if (selectedVersion() && !selectedVersion()!.publishedAt) {
                <button class="btn-primary" (click)="showOptionGroupForm.set(true)">
                  <span>+</span> Add Group
                </button>
              }
            </div>
            <div class="card-content">
              @if (!selectedVersion()) {
                <div class="empty-state">
                  <p>Select a version to view option groups.</p>
                </div>
              } @else if (optionGroups().length === 0) {
                <div class="empty-state">
                  <span class="empty-icon">⚙️</span>
                  <p>No option groups in this version yet.</p>
                </div>
              } @else {
                <div class="groups-list">
                  @for (group of optionGroups(); track group.id) {
                    <div class="group-card">
                      <div class="group-header">
                        <div class="group-info">
                          <span class="group-name">{{ group.name }}</span>
                          <span class="group-type badge">{{ group.type }}</span>
                          @if (group.required) {
                            <span class="group-type badge required">Required</span>
                          }
                        </div>
                        @if (!selectedVersion()!.publishedAt) {
                          <div class="group-actions">
                            <button class="btn-sm" (click)="addOptionToGroup(group)">+ Option</button>
                            <button class="btn-icon danger" (click)="deleteOptionGroup(group)">🗑️</button>
                          </div>
                        }
                      </div>
                      @if (group.options && group.options.length > 0) {
                        <div class="options-list">
                          @for (option of group.options; track option.id) {
                            <div class="option-item">
                              <span class="option-name">{{ option.name }}</span>
                              @if (option.priceDelta !== 0) {
                                <span class="option-price">
                                  {{ option.priceDelta > 0 ? '+' : '' }}{{ option.priceDelta | currency }}
                                </span>
                              }
                              @if (option.isDefault) {
                                <span class="option-default">Default</span>
                              }
                              @if (!selectedVersion()!.publishedAt) {
                                <button class="btn-icon small danger" (click)="deleteOption(option)">✕</button>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Option Group Form Modal -->
          @if (showOptionGroupForm()) {
            <div class="modal-overlay" (click)="closeOptionGroupForm()">
              <div class="modal" (click)="$event.stopPropagation()">
                <div class="modal-header">
                  <h3>Add Option Group</h3>
                  <button class="btn-icon" (click)="closeOptionGroupForm()">✕</button>
                </div>
                <form class="modal-form" (ngSubmit)="saveOptionGroup()">
                  <div class="form-group">
                    <label>Name</label>
                    <input type="text" [(ngModel)]="optionGroupForm.name" name="name" required />
                  </div>
                  <div class="form-group">
                    <label>Type</label>
                    <select [(ngModel)]="optionGroupForm.type" name="type">
                      <option value="SINGLE">Single Select</option>
                      <option value="MULTI">Multi Select</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="checkbox-label">
                      <input type="checkbox" [(ngModel)]="optionGroupForm.required" name="required" />
                      Required
                    </label>
                  </div>
                  <div class="modal-actions">
                    <button type="button" class="btn-secondary" (click)="closeOptionGroupForm()">Cancel</button>
                    <button type="submit" class="btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          }

          <!-- Option Form Modal -->
          @if (showOptionForm()) {
            <div class="modal-overlay" (click)="closeOptionForm()">
              <div class="modal" (click)="$event.stopPropagation()">
                <div class="modal-header">
                  <h3>Add Option</h3>
                  <button class="btn-icon" (click)="closeOptionForm()">✕</button>
                </div>
                <form class="modal-form" (ngSubmit)="saveOption()">
                  <div class="form-group">
                    <label>Name</label>
                    <input type="text" [(ngModel)]="optionForm.name" name="name" required />
                  </div>
                  <div class="form-group">
                    <label>Price Delta</label>
                    <input type="number" [(ngModel)]="optionForm.priceDelta" name="priceDelta" step="0.01" />
                  </div>
                  <div class="form-group">
                    <label class="checkbox-label">
                      <input type="checkbox" [(ngModel)]="optionForm.isDefault" name="isDefault" />
                      Default
                    </label>
                  </div>
                  <div class="modal-actions">
                    <button type="button" class="btn-secondary" (click)="closeOptionForm()">Cancel</button>
                    <button type="submit" class="btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          }
        }

        <!-- Synonyms Tab -->
        @if (activeTab() === 'synonyms') {
          <div class="content-card">
            <div class="card-header">
              <h2>Synonyms</h2>
              @if (selectedVersion() && !selectedVersion()!.publishedAt) {
                <button class="btn-primary" (click)="showSynonymForm.set(true)">
                  <span>+</span> Add Synonym
                </button>
              }
            </div>
            <div class="card-content">
              @if (!selectedVersion()) {
                <div class="empty-state">
                  <p>Select a version to view synonyms.</p>
                </div>
              } @else if (synonyms().length === 0) {
                <div class="empty-state">
                  <span class="empty-icon">🔤</span>
                  <p>No synonyms in this version yet.</p>
                </div>
              } @else {
                <div class="synonyms-list">
                  @for (syn of synonyms(); track syn.id) {
                    <div class="synonym-item">
                      <span class="synonym-phrase">"{{ syn.phrase }}"</span>
                      <span class="synonym-arrow">→</span>
                      <span class="synonym-target">
                        {{ syn.itemName || syn.optionName || 'Unknown' }}
                      </span>
                      <span class="synonym-weight text-muted">Weight: {{ syn.weight }}</span>
                      @if (!selectedVersion()!.publishedAt) {
                        <button class="btn-icon small danger" (click)="deleteSynonym(syn)">✕</button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Synonym Form Modal -->
          @if (showSynonymForm()) {
            <div class="modal-overlay" (click)="closeSynonymForm()">
              <div class="modal" (click)="$event.stopPropagation()">
                <div class="modal-header">
                  <h3>Add Synonym</h3>
                  <button class="btn-icon" (click)="closeSynonymForm()">✕</button>
                </div>
                <form class="modal-form" (ngSubmit)="saveSynonym()">
                  <div class="form-group">
                    <label>Phrase</label>
                    <input type="text" [(ngModel)]="synonymForm.phrase" name="phrase" required />
                  </div>
                  <div class="form-group">
                    <label>Maps To Item</label>
                    <select [(ngModel)]="synonymForm.mapsToItemId" name="mapsToItemId">
                      <option [ngValue]="undefined">-- Select Item --</option>
                      @for (item of items(); track item.id) {
                        <option [value]="item.id">{{ item.name }}</option>
                      }
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Weight</label>
                    <input type="number" [(ngModel)]="synonymForm.weight" name="weight" min="1" />
                  </div>
                  <div class="modal-actions">
                    <button type="button" class="btn-secondary" (click)="closeSynonymForm()">Cancel</button>
                    <button type="submit" class="btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          }
        }
      }

      <!-- Import Modal -->
      @if (showImportModal()) {
        <div class="modal-overlay" (click)="showImportModal.set(false)">
          <div class="modal large" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Import Menu</h3>
              <button class="btn-icon" (click)="showImportModal.set(false)">✕</button>
            </div>
            <div class="modal-form">
              <div class="form-group">
                <label>Paste JSON or upload file:</label>
                <textarea
                  [(ngModel)]="importJson"
                  rows="15"
                  placeholder="Paste menu JSON here..."
                ></textarea>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn-secondary" (click)="showImportModal.set(false)">Cancel</button>
                <button type="button" class="btn-primary" (click)="doImport()">Import</button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .menu-page {
        max-width: 1200px;
        margin: 0 auto;
      }

      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--spacing-xl);
      }

      .page-title {
        font-size: 2rem;
        font-weight: 700;
        margin-bottom: var(--spacing-xs);
      }

      .header-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .tabs {
        display: flex;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        padding-bottom: var(--spacing-sm);
      }

      .tab {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        background: transparent;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        border-radius: var(--radius-md);
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }

        &.active {
          background: var(--color-bg-elevated);
          color: var(--color-accent-primary);
        }
      }

      .version-selector {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-lg);
        padding: var(--spacing-md);
        background: var(--color-bg-secondary);
        border-radius: var(--radius-md);
      }

      .selector-label {
        font-weight: 500;
      }

      .selector-select {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        min-width: 200px;
      }

      .content-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);

        h2 {
          font-size: 1.125rem;
          font-weight: 600;
        }
      }

      .card-content {
        padding: var(--spacing-lg);
      }

      .loading-state, .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-2xl);
        text-align: center;
        gap: var(--spacing-md);
      }

      .empty-icon {
        font-size: 3rem;
        opacity: 0.5;
      }

      .loader {
        width: 32px;
        height: 32px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error-alert {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: rgba(239, 68, 68, 0.1);
        border-radius: var(--radius-md);
        color: var(--color-accent-danger);
        margin-bottom: var(--spacing-lg);
      }

      /* Versions */
      .versions-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .version-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-lg);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid transparent;

        &.published {
          border-color: var(--color-accent-success);
        }
      }

      .version-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .version-number {
        font-weight: 600;
      }

      .version-meta {
        font-size: 0.75rem;
      }

      .status-badge {
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;

        &.published {
          background: var(--color-accent-success);
          color: white;
        }

        &.draft {
          background: var(--color-bg-elevated);
          color: var(--color-text-secondary);
        }
      }

      .version-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      /* Items */
      .category-section {
        margin-bottom: var(--spacing-xl);
      }

      .category-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .items-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--spacing-md);
      }

      .item-card {
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);

        &.inactive {
          opacity: 0.6;
        }
      }

      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--spacing-xs);
      }

      .item-name {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        flex-wrap: wrap;
      }

      .ready-food-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.625rem;
        font-weight: 600;
        background: #10b981;
        color: white;
        text-transform: uppercase;
      }

      .hint-text {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        margin-top: 2px;
      }

      .item-price {
        font-weight: 600;
        color: var(--color-accent-primary);
      }

      .item-description {
        font-size: 0.875rem;
        margin-bottom: var(--spacing-sm);
      }

      .item-actions {
        display: flex;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-sm);
        padding-top: var(--spacing-sm);
        border-top: 1px solid var(--color-border);
      }

      /* Option Groups */
      .groups-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .group-card {
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        overflow: hidden;
      }

      .group-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md);
        background: var(--color-bg-elevated);
      }

      .group-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .group-name {
        font-weight: 600;
      }

      .badge {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.625rem;
        background: var(--color-bg-secondary);
        text-transform: uppercase;

        &.required {
          background: var(--color-accent-warning);
          color: white;
        }
      }

      .group-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .options-list {
        padding: var(--spacing-md);
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .option-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-secondary);
        border-radius: var(--radius-sm);
        font-size: 0.875rem;
      }

      .option-price {
        color: var(--color-accent-primary);
        font-size: 0.75rem;
      }

      .option-default {
        background: var(--color-accent-primary);
        color: white;
        padding: 1px 4px;
        border-radius: 2px;
        font-size: 0.625rem;
      }

      /* Synonyms */
      .synonyms-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .synonym-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .synonym-phrase {
        font-weight: 500;
        color: var(--color-accent-primary);
      }

      .synonym-arrow {
        color: var(--color-text-muted);
      }

      .synonym-target {
        font-weight: 500;
      }

      .synonym-weight {
        margin-left: auto;
        font-size: 0.75rem;
      }

      /* Buttons */
      .btn-primary, .btn-secondary {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-primary {
        background: var(--color-accent-primary);
        color: white;
        border: none;

        &:hover { opacity: 0.9; }
      }

      .btn-secondary {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);

        &:hover { background: var(--color-bg-elevated); }
      }

      .btn-sm {
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: 0.875rem;
        border-radius: var(--radius-sm);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
        cursor: pointer;

        &:hover { background: var(--color-bg-tertiary); }

        &.btn-success {
          background: var(--color-accent-success);
          color: white;
          border: none;
        }
      }

      .btn-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover { background: var(--color-bg-tertiary); }

        &.danger:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: var(--color-accent-danger);
        }

        &.small {
          width: 24px;
          height: 24px;
          font-size: 0.75rem;
        }
      }

      /* Modal */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: var(--spacing-lg);
      }

      .modal {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 480px;
        max-height: 90vh;
        overflow-y: auto;

        &.large {
          max-width: 640px;
        }
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);

        h3 {
          font-weight: 600;
        }
      }

      .modal-form {
        padding: var(--spacing-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);

        label {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--color-text-secondary);
        }

        input, select, textarea {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text-primary);
          font-size: 0.9375rem;

          &:focus {
            outline: none;
            border-color: var(--color-accent-primary);
          }
        }

        textarea {
          resize: vertical;
          min-height: 100px;
          font-family: var(--font-mono);
          font-size: 0.8125rem;
        }
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-md);
      }

      .checkbox-label {
        flex-direction: row !important;
        align-items: center;
        gap: var(--spacing-sm);
        cursor: pointer;

        input[type="checkbox"] {
          width: 18px;
          height: 18px;
        }
      }

      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
      }
    `,
  ],
})
export class MenuComponent implements OnInit {
  private menuService = inject(MenuService);

  // State
  loading = signal(true);
  error = signal<string | null>(null);
  activeTab = signal<Tab>('versions');

  // Data
  versions = signal<MenuVersionDto[]>([]);
  items = signal<MenuItemDto[]>([]);
  optionGroups = signal<MenuOptionGroupDto[]>([]);
  synonyms = signal<MenuSynonymDto[]>([]);

  selectedVersionId = signal<string | null>(null);
  selectedVersion = computed(() =>
    this.versions().find((v) => v.id === this.selectedVersionId())
  );

  // Computed
  itemsByCategory = computed(() => {
    const map = new Map<string, { name: string; items: MenuItemDto[] }>();
    for (const item of this.items()) {
      if (!map.has(item.category)) {
        map.set(item.category, { name: item.category, items: [] });
      }
      map.get(item.category)!.items.push(item);
    }
    return Array.from(map.values());
  });

  // Forms
  showItemForm = signal(false);
  showOptionGroupForm = signal(false);
  showOptionForm = signal(false);
  showSynonymForm = signal(false);
  showImportModal = signal(false);

  editingItem = signal<MenuItemDto | null>(null);
  editingGroupId = signal<string | null>(null);

  itemForm = { name: '', description: '', basePrice: 0, category: '', isActive: true, isReadyFood: false };
  optionGroupForm = { name: '', type: 'SINGLE' as const, required: false };
  optionForm = { name: '', priceDelta: 0, isDefault: false };
  synonymForm = { phrase: '', mapsToItemId: undefined as string | undefined, weight: 1 };
  importJson = '';

  tabs = [
    { id: 'versions' as Tab, label: 'Versions', icon: '📋' },
    { id: 'items' as Tab, label: 'Items', icon: '🍽️' },
    { id: 'options' as Tab, label: 'Options', icon: '⚙️' },
    { id: 'synonyms' as Tab, label: 'Synonyms', icon: '🔤' },
  ];

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.error.set(null);

    this.menuService.getVersions().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.versions.set(response.data);
          if (response.data.length > 0 && !this.selectedVersionId()) {
            this.selectedVersionId.set(response.data[0].id);
            this.loadVersionData();
          }
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error?.message || 'Failed to load menu data');
        this.loading.set(false);
      },
    });
  }

  loadVersionData(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.getItems(versionId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.items.set(response.data);
        }
      },
    });

    this.menuService.getOptionGroups(versionId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.optionGroups.set(response.data);
        }
      },
    });

    this.menuService.getSynonyms(versionId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.synonyms.set(response.data);
        }
      },
    });
  }

  selectVersion(versionId: string): void {
    this.selectedVersionId.set(versionId);
    this.loadVersionData();
  }

  selectVersionAndSwitch(version: MenuVersionDto): void {
    this.selectedVersionId.set(version.id);
    this.activeTab.set('items');
    this.loadVersionData();
  }

  // Version actions
  createVersion(): void {
    this.menuService.createVersion().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.versions.update((v) => [response.data!, ...v]);
          this.selectedVersionId.set(response.data.id);
          this.loadVersionData();
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to create version');
      },
    });
  }

  publishVersion(version: MenuVersionDto): void {
    if (!confirm(`Publish version ${version.version}?`)) return;

    this.menuService.publishVersion(version.id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.versions.update((versions) =>
            versions.map((v) => (v.id === version.id ? response.data! : v))
          );
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to publish version');
      },
    });
  }

  // Item actions
  editItem(item: MenuItemDto): void {
    this.editingItem.set(item);
    this.itemForm = {
      name: item.name,
      description: item.description || '',
      basePrice: item.basePrice,
      category: item.category,
      isActive: item.isActive,
      isReadyFood: item.isReadyFood,
    };
    this.showItemForm.set(true);
  }

  closeItemForm(): void {
    this.showItemForm.set(false);
    this.editingItem.set(null);
    this.itemForm = { name: '', description: '', basePrice: 0, category: '', isActive: true, isReadyFood: false };
  }

  saveItem(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    const editing = this.editingItem();
    const observable = editing
      ? this.menuService.updateItem(versionId, editing.id, this.itemForm)
      : this.menuService.createItem(versionId, this.itemForm);

    observable.subscribe({
      next: (response) => {
        if (response.success) {
          this.loadVersionData();
          this.closeItemForm();
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to save item');
      },
    });
  }

  deleteItem(item: MenuItemDto): void {
    if (!confirm(`Delete "${item.name}"?`)) return;

    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.deleteItem(versionId, item.id).subscribe({
      next: () => {
        this.items.update((items) => items.filter((i) => i.id !== item.id));
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to delete item');
      },
    });
  }

  // Option Group actions
  closeOptionGroupForm(): void {
    this.showOptionGroupForm.set(false);
    this.optionGroupForm = { name: '', type: 'SINGLE', required: false };
  }

  saveOptionGroup(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.createOptionGroup(versionId, this.optionGroupForm).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.optionGroups.update((groups) => [...groups, response.data!]);
          this.closeOptionGroupForm();
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to save option group');
      },
    });
  }

  deleteOptionGroup(group: MenuOptionGroupDto): void {
    if (!confirm(`Delete group "${group.name}"?`)) return;

    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.deleteOptionGroup(versionId, group.id).subscribe({
      next: () => {
        this.optionGroups.update((groups) => groups.filter((g) => g.id !== group.id));
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to delete option group');
      },
    });
  }

  // Option actions
  addOptionToGroup(group: MenuOptionGroupDto): void {
    this.editingGroupId.set(group.id);
    this.optionForm = { name: '', priceDelta: 0, isDefault: false };
    this.showOptionForm.set(true);
  }

  closeOptionForm(): void {
    this.showOptionForm.set(false);
    this.editingGroupId.set(null);
    this.optionForm = { name: '', priceDelta: 0, isDefault: false };
  }

  saveOption(): void {
    const versionId = this.selectedVersionId();
    const groupId = this.editingGroupId();
    if (!versionId || !groupId) return;

    this.menuService.createOption(versionId, { ...this.optionForm, groupId }).subscribe({
      next: () => {
        this.loadVersionData();
        this.closeOptionForm();
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to save option');
      },
    });
  }

  deleteOption(option: MenuOptionDto): void {
    if (!confirm(`Delete option "${option.name}"?`)) return;

    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.deleteOption(versionId, option.id).subscribe({
      next: () => {
        this.loadVersionData();
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to delete option');
      },
    });
  }

  // Synonym actions
  closeSynonymForm(): void {
    this.showSynonymForm.set(false);
    this.synonymForm = { phrase: '', mapsToItemId: undefined, weight: 1 };
  }

  saveSynonym(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.createSynonym(versionId, this.synonymForm).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.synonyms.update((syns) => [...syns, response.data!]);
          this.closeSynonymForm();
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to save synonym');
      },
    });
  }

  deleteSynonym(synonym: MenuSynonymDto): void {
    if (!confirm(`Delete synonym "${synonym.phrase}"?`)) return;

    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.deleteSynonym(versionId, synonym.id).subscribe({
      next: () => {
        this.synonyms.update((syns) => syns.filter((s) => s.id !== synonym.id));
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to delete synonym');
      },
    });
  }

  // Import/Export
  handleImport(): void {
    this.importJson = '';
    this.showImportModal.set(true);
  }

  doImport(): void {
    try {
      const data = JSON.parse(this.importJson);
      this.menuService.importMenu(data).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            alert(
              `Imported successfully!\nVersion: ${response.data.version}\nItems: ${response.data.itemsCreated}\nOption Groups: ${response.data.optionGroupsCreated}`
            );
            this.showImportModal.set(false);
            this.loadData();
          }
        },
        error: (err) => {
          alert(err.error?.error?.message || 'Failed to import');
        },
      });
    } catch {
      alert('Invalid JSON format');
    }
  }

  handleExport(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.menuService.exportVersion(versionId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const json = JSON.stringify(response.data, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `menu-v${response.data.version}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      },
      error: (err) => {
        alert(err.error?.error?.message || 'Failed to export');
      },
    });
  }
}

