import { Component, OnInit, OnDestroy, inject, signal, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  StoreService,
  StoreDto,
  DeliveryRuleDto,
  CreateStoreDto,
  CreateDeliveryRuleDto,
} from '../../services/store.service';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="stores-page">
      <header class="page-header">
        <h1><app-icon name="store" [size]="24"/> Şube Yönetimi</h1>
        <button class="add-btn" (click)="openAddStoreModal()">+ Yeni Şube</button>
      </header>

      <!-- Stores List -->
      <div class="stores-grid">
        @for (store of stores(); track store.id) {
          <div class="store-card" [class.inactive]="!store.isActive">
            <div class="store-header">
              <h3>{{ store.name }}</h3>
              <div class="badges">
                <span class="status-badge" [class.active]="store.isActive">
                  {{ store.isActive ? 'Aktif' : 'Pasif' }}
                </span>
                <span class="open-badge" [class.open]="store.isOpen" [class.closed]="!store.isOpen">
                  {{ store.isOpen ? 'Açık' : 'Kapalı' }}
                </span>
              </div>
            </div>

            <div class="store-info">
              @if (store.address) {
                <p class="address"><app-icon name="map-pin" [size]="14"/> {{ store.address }}</p>
              }
              @if (store.phone) {
                <p class="phone"><app-icon name="phone" [size]="14"/> {{ store.phone }}</p>
              }
              <p class="coords">
                <app-icon name="globe" [size]="14"/> {{ store.lat.toFixed(6) }}, {{ store.lng.toFixed(6) }}
              </p>
            </div>

            <!-- Delivery Rules -->
            <div class="delivery-rules">
              <h4>
                Teslimat Kuralları
                <button class="add-rule-btn" (click)="openAddRule(store)">+</button>
              </h4>
              @if (store.deliveryRules && store.deliveryRules.length > 0) {
                @for (rule of store.deliveryRules; track rule.id) {
                  <div class="rule-item" [class.inactive]="!rule.isActive">
                    <div class="rule-info">
                      <span class="radius"><app-icon name="ruler" [size]="14"/> {{ rule.radiusKm }} km</span>
                      <span class="fee"><app-icon name="car" [size]="14"/> {{ rule.deliveryFee }} TL</span>
                      <span class="min-basket"><app-icon name="shopping-cart" [size]="14"/> Min: {{ rule.minBasket }} TL</span>
                    </div>
                    <div class="rule-actions">
                      <button class="edit-btn" (click)="editRule(rule)"><app-icon name="edit" [size]="14"/></button>
                      <button class="delete-btn" (click)="deleteRule(rule)"><app-icon name="trash" [size]="14"/></button>
                    </div>
                  </div>
                }
              } @else {
                <p class="no-rules">Teslimat kuralı yok</p>
              }
            </div>

            <div class="store-actions">
              <button class="edit-btn" (click)="editStore(store)">Düzenle</button>
              <button class="open-toggle-btn" [class.is-open]="store.isOpen" (click)="toggleStoreOpen(store)">
                {{ store.isOpen ? 'Kapat' : 'Aç' }}
              </button>
              <button class="toggle-btn" (click)="toggleStore(store)">
                {{ store.isActive ? 'Devre Dışı' : 'Aktifleştir' }}
              </button>
              <button class="delete-btn" (click)="deleteStore(store)">Sil</button>
            </div>
          </div>
        }

        @if (stores().length === 0 && !loading()) {
          <div class="empty-state">
            <app-icon name="store" [size]="48" class="empty-icon"/>
            <p>Henüz şube eklenmemiş</p>
            <button class="add-btn" (click)="openAddStoreModal()">İlk Şubeyi Ekle</button>
          </div>
        }
      </div>

      <!-- Add/Edit Store Modal -->
      @if (showAddStore || editingStore()) {
        <div class="modal-overlay" (click)="closeStoreModal()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>{{ editingStore() ? 'Şube Düzenle' : 'Yeni Şube' }}</h2>
            <form (ngSubmit)="saveStore()">
              <div class="form-group">
                <label>Şube Adı *</label>
                <input type="text" [(ngModel)]="storeForm.name" name="name" required />
              </div>
              <div class="form-group">
                <label>Adres</label>
                <textarea [(ngModel)]="storeForm.address" name="address" rows="2"></textarea>
              </div>
              <div class="form-group">
                <label>Konum * <small style="color: var(--color-text-secondary); font-weight: 400;">(Haritaya tıklayarak seçin)</small></label>
                <div id="storeMap" class="store-map"></div>
                @if (storeForm.lat !== 0 || storeForm.lng !== 0) {
                  <p class="coords-display"><app-icon name="map-pin" [size]="14"/> {{ storeForm.lat.toFixed(6) }}, {{ storeForm.lng.toFixed(6) }}</p>
                }
              </div>
              <div class="form-group">
                <label>Telefon</label>
                <input type="tel" [(ngModel)]="storeForm.phone" name="phone" />
              </div>
              <div class="form-group checkbox">
                <label>
                  <input type="checkbox" [(ngModel)]="storeForm.isActive" name="isActive" />
                  Aktif
                </label>
              </div>
              <div class="modal-actions">
                <button type="button" class="cancel-btn" (click)="closeStoreModal()">İptal</button>
                <button type="submit" class="save-btn">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Add/Edit Delivery Rule Modal -->
      @if (showAddRule || editingRule()) {
        <div class="modal-overlay" (click)="closeRuleModal()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>{{ editingRule() ? 'Kural Düzenle' : 'Yeni Teslimat Kuralı' }}</h2>
            <p class="modal-subtitle" *ngIf="selectedStoreForRule()">
              {{ selectedStoreForRule()?.name }}
            </p>
            <form (ngSubmit)="saveRule()">
              <div class="form-group">
                <label>Teslimat Yarıçapı (km) *</label>
                <input type="number" step="0.1" min="0.1" [(ngModel)]="ruleForm.radiusKm" name="radiusKm" required />
              </div>
              <div class="form-group">
                <label>Minimum Sepet (TL) *</label>
                <input type="number" step="0.01" min="0" [(ngModel)]="ruleForm.minBasket" name="minBasket" required />
              </div>
              <div class="form-group">
                <label>Teslimat Ücreti (TL) *</label>
                <input type="number" step="0.01" min="0" [(ngModel)]="ruleForm.deliveryFee" name="deliveryFee" required />
              </div>
              <div class="form-group checkbox">
                <label>
                  <input type="checkbox" [(ngModel)]="ruleForm.isActive" name="isActive" />
                  Aktif
                </label>
              </div>
              <div class="modal-actions">
                <button type="button" class="cancel-btn" (click)="closeRuleModal()">İptal</button>
                <button type="submit" class="save-btn">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Geo Check Test Section -->
      <div class="geo-test-section">
        <h3><app-icon name="test-tube" [size]="14"/> Servis Alanı Test</h3>
        <div class="geo-test-form">
          <div class="form-row">
            <div class="form-group">
              <label>Test Enlem</label>
              <input type="number" step="any" [(ngModel)]="testLat" />
            </div>
            <div class="form-group">
              <label>Test Boylam</label>
              <input type="number" step="any" [(ngModel)]="testLng" />
            </div>
            <button class="test-btn" (click)="testGeoCheck()">Test Et</button>
          </div>
        </div>
        @if (geoTestResult()) {
          <div class="geo-test-result" [class.success]="geoTestResult()!.isWithinServiceArea" [class.error]="!geoTestResult()!.isWithinServiceArea">
            <p><strong>@if (geoTestResult()!.isWithinServiceArea) { <app-icon name="check-circle" [size]="14"/> Servis Alanı İçinde } @else { <app-icon name="x-circle" [size]="14"/> Servis Alanı Dışında }</strong></p>
            <p>{{ geoTestResult()!.message }}</p>
            @if (geoTestResult()!.nearestStore) {
              <p>En yakın şube: {{ geoTestResult()!.nearestStore!.name }} ({{ geoTestResult()!.distance }} km)</p>
            }
            @if (geoTestResult()!.deliveryRule) {
              <p>Teslimat ücreti: {{ geoTestResult()!.deliveryRule!.deliveryFee }} TL | Min sepet: {{ geoTestResult()!.deliveryRule!.minBasket }} TL</p>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .stores-page {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .page-header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .add-btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: var(--color-primary);
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .add-btn:hover {
      background: var(--color-accent-primary-hover);
    }

    .stores-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 20px;
    }

    .store-card {
      background: var(--color-bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 20px;
      transition: all 0.2s;
    }

    .store-card:hover {
      border-color: var(--color-primary);
    }

    .store-card.inactive {
      opacity: 0.7;
    }

    .store-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .store-header h3 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .status-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #ef4444;
      color: white;
    }

    .status-badge.active {
      background: #10b981;
    }

    .badges {
      display: flex;
      gap: 6px;
    }

    .open-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      color: white;
    }

    .open-badge.open {
      background: #10b981;
    }

    .open-badge.closed {
      background: #ef4444;
    }

    .store-info {
      margin-bottom: 16px;
    }

    .store-info p {
      margin: 6px 0;
      font-size: 0.9rem;
      color: var(--color-text-secondary);
    }

    .delivery-rules {
      border-top: 1px solid var(--color-border);
      padding-top: 16px;
      margin-bottom: 16px;
    }

    .delivery-rules h4 {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .add-rule-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid var(--color-primary);
      background: transparent;
      color: var(--color-primary);
      font-size: 1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .add-rule-btn:hover {
      background: var(--color-primary);
      color: white;
    }

    .rule-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--color-bg-tertiary);
      border-radius: 8px;
      margin-bottom: 8px;
    }

    .rule-item.inactive {
      opacity: 0.6;
    }

    .rule-info {
      display: flex;
      gap: 12px;
      font-size: 0.85rem;
      color: var(--color-text-primary);
    }

    .rule-actions {
      display: flex;
      gap: 8px;
    }

    .rule-actions button {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .rule-actions button:hover {
      opacity: 1;
    }

    .no-rules {
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      font-style: italic;
    }

    .store-actions {
      display: flex;
      gap: 8px;
      border-top: 1px solid var(--color-border);
      padding-top: 16px;
    }

    .store-actions button {
      flex: 1;
      padding: 8px 12px;
      border-radius: 6px;
      border: none;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .edit-btn {
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
    }

    .open-toggle-btn {
      background: #10b981;
      color: white;
    }

    .open-toggle-btn.is-open {
      background: #ef4444;
    }

    .toggle-btn {
      background: #f59e0b;
      color: white;
    }

    .delete-btn {
      background: transparent;
      border: 1px solid #ef4444 !important;
      color: #ef4444;
    }

    .delete-btn:hover {
      background: #ef4444;
      color: white;
    }

    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px;
      background: var(--color-bg-secondary);
      border-radius: 12px;
      border: 1px dashed var(--color-border);
    }

    .empty-icon {
      color: var(--color-text-muted);
      margin-bottom: 16px;
    }

    .empty-state p {
      color: var(--color-text-secondary);
      margin-bottom: 16px;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: var(--color-bg-secondary);
      border-radius: 12px;
      padding: 24px;
      width: 100%;
      max-width: 560px;
      max-height: 90vh;
      overflow-y: auto;
      border: 1px solid var(--color-border);
    }

    .modal h2 {
      margin-bottom: 8px;
      color: var(--color-text-primary);
    }

    .modal-subtitle {
      color: var(--color-text-secondary);
      margin-bottom: 20px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.9rem;
      color: var(--color-text-secondary);
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--color-border);
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
      font-size: 0.95rem;
    }

    .form-row {
      display: flex;
      gap: 16px;
    }

    .form-row .form-group {
      flex: 1;
    }

    .form-group.checkbox label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .form-group.checkbox input {
      width: auto;
    }

    .modal-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
    }

    .cancel-btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: 1px solid var(--color-border);
      background: transparent;
      color: var(--color-text-primary);
      cursor: pointer;
    }

    .save-btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: var(--color-primary);
      color: white;
      cursor: pointer;
    }

    /* Map */
    .store-map {
      width: 100%;
      height: 300px;
      border-radius: 8px;
      border: 1px solid var(--color-border);
      background: var(--color-bg-tertiary);
    }

    .coords-display {
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--color-primary);
    }

    /* Geo Test Section */
    .geo-test-section {
      margin-top: 32px;
      padding: 20px;
      background: var(--color-bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--color-border);
    }

    .geo-test-section h3 {
      margin-bottom: 16px;
      color: var(--color-text-primary);
    }

    .geo-test-form .form-row {
      align-items: flex-end;
    }

    .test-btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: var(--color-primary);
      color: white;
      cursor: pointer;
      white-space: nowrap;
    }

    .geo-test-result {
      margin-top: 16px;
      padding: 16px;
      border-radius: 8px;
    }

    .geo-test-result.success {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid #10b981;
    }

    .geo-test-result.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #ef4444;
    }

    .geo-test-result p {
      margin: 4px 0;
      color: var(--color-text-primary);
    }
  `]
})
export class StoresComponent implements OnInit, OnDestroy {
  private storeService = inject(StoreService);
  private ngZone = inject(NgZone);

  stores = signal<StoreDto[]>([]);
  loading = signal(false);

  // Google Maps
  private map: any = null;
  private marker: any = null;

  // Store form
  showAddStore = false;
  editingStore = signal<StoreDto | null>(null);
  storeForm: CreateStoreDto = { name: '', lat: 0, lng: 0, isActive: true };

  // Rule form
  showAddRule = false;
  editingRule = signal<DeliveryRuleDto | null>(null);
  selectedStoreForRule = signal<StoreDto | null>(null);
  ruleForm: CreateDeliveryRuleDto = { storeId: '', radiusKm: 5, minBasket: 50, deliveryFee: 10, isActive: true };

  // Geo test
  testLat = 41.0082; // Istanbul default
  testLng = 28.9784;
  geoTestResult = signal<any | null>(null);

  ngOnInit(): void {
    this.loadStores();
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  // ==================== GOOGLE MAPS ====================

  private loadGoogleMaps(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).google?.maps) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Maps yüklenemedi'));
      document.head.appendChild(script);
    });
  }

  private async initMap(): Promise<void> {
    try {
      await this.loadGoogleMaps();
    } catch {
      console.error('Google Maps API yüklenemedi');
      return;
    }

    const mapEl = document.getElementById('storeMap');
    if (!mapEl) return;

    const google = (window as any).google;
    const lat = this.storeForm.lat || 41.0082;
    const lng = this.storeForm.lng || 28.9784;
    const center = { lat, lng };

    this.map = new google.maps.Map(mapEl, {
      center,
      zoom: 13,
      mapTypeId: 'roadmap',
      streetViewControl: false,
      mapTypeControl: false,
    });

    // Place marker if editing or has coordinates
    if (this.storeForm.lat !== 0 || this.storeForm.lng !== 0) {
      this.placeMarker(center);
    }

    // Click to place marker
    this.map.addListener('click', (e: any) => {
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      this.ngZone.run(() => {
        this.storeForm.lat = pos.lat;
        this.storeForm.lng = pos.lng;
      });
      this.placeMarker(pos);
    });
  }

  private placeMarker(position: { lat: number; lng: number }): void {
    const google = (window as any).google;
    if (this.marker) {
      this.marker.setPosition(position);
      return;
    }
    this.marker = new google.maps.Marker({
      position,
      map: this.map,
      draggable: true,
    });
    this.marker.addListener('dragend', (e: any) => {
      this.ngZone.run(() => {
        this.storeForm.lat = e.latLng.lat();
        this.storeForm.lng = e.latLng.lng();
      });
    });
  }

  private destroyMap(): void {
    if (this.marker) {
      this.marker.setMap(null);
      this.marker = null;
    }
    this.map = null;
  }

  loadStores(): void {
    this.loading.set(true);
    this.storeService.getStores(true).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.stores.set(res.data);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // ==================== STORE CRUD ====================

  openAddStoreModal(): void {
    this.showAddStore = true;
    setTimeout(() => this.initMap(), 50);
  }

  editStore(store: StoreDto): void {
    this.editingStore.set(store);
    this.storeForm = {
      name: store.name,
      address: store.address || undefined,
      lat: store.lat,
      lng: store.lng,
      phone: store.phone || undefined,
      isActive: store.isActive,
    };
    setTimeout(() => this.initMap(), 50);
  }

  closeStoreModal(): void {
    this.destroyMap();
    this.showAddStore = false;
    this.editingStore.set(null);
    this.storeForm = { name: '', lat: 0, lng: 0, isActive: true };
  }

  saveStore(): void {
    const editing = this.editingStore();
    if (editing) {
      this.storeService.updateStore(editing.id, this.storeForm).subscribe({
        next: () => {
          this.closeStoreModal();
          this.loadStores();
        },
        error: (err) => console.error('Update store failed:', err),
      });
    } else {
      this.storeService.createStore(this.storeForm).subscribe({
        next: () => {
          this.closeStoreModal();
          this.loadStores();
        },
        error: (err) => console.error('Create store failed:', err),
      });
    }
  }

  toggleStoreOpen(store: StoreDto): void {
    this.storeService.toggleStoreOpen(store.id).subscribe({
      next: () => this.loadStores(),
      error: (err) => console.error('Toggle store open failed:', err),
    });
  }

  toggleStore(store: StoreDto): void {
    this.storeService.updateStore(store.id, { isActive: !store.isActive }).subscribe({
      next: () => this.loadStores(),
      error: (err) => console.error('Toggle store failed:', err),
    });
  }

  deleteStore(store: StoreDto): void {
    if (confirm(`"${store.name}" şubesini silmek istediğinize emin misiniz?`)) {
      this.storeService.deleteStore(store.id).subscribe({
        next: () => this.loadStores(),
        error: (err) => console.error('Delete store failed:', err),
      });
    }
  }

  // ==================== RULE CRUD ====================

  openAddRule(store: StoreDto): void {
    this.selectedStoreForRule.set(store);
    this.ruleForm = { storeId: store.id, radiusKm: 5, minBasket: 50, deliveryFee: 10, isActive: true };
    this.showAddRule = true;
  }

  editRule(rule: DeliveryRuleDto): void {
    this.editingRule.set(rule);
    this.ruleForm = {
      storeId: rule.storeId,
      radiusKm: rule.radiusKm,
      minBasket: rule.minBasket,
      deliveryFee: rule.deliveryFee,
      isActive: rule.isActive,
    };
  }

  closeRuleModal(): void {
    this.showAddRule = false;
    this.editingRule.set(null);
    this.selectedStoreForRule.set(null);
    this.ruleForm = { storeId: '', radiusKm: 5, minBasket: 50, deliveryFee: 10, isActive: true };
  }

  saveRule(): void {
    const editing = this.editingRule();
    if (editing) {
      this.storeService.updateDeliveryRule(editing.id, {
        radiusKm: this.ruleForm.radiusKm,
        minBasket: this.ruleForm.minBasket,
        deliveryFee: this.ruleForm.deliveryFee,
        isActive: this.ruleForm.isActive,
      }).subscribe({
        next: () => {
          this.closeRuleModal();
          this.loadStores();
        },
        error: (err) => console.error('Update rule failed:', err),
      });
    } else {
      this.storeService.createDeliveryRule(this.ruleForm).subscribe({
        next: () => {
          this.closeRuleModal();
          this.loadStores();
        },
        error: (err) => console.error('Create rule failed:', err),
      });
    }
  }

  deleteRule(rule: DeliveryRuleDto): void {
    if (confirm('Bu teslimat kuralını silmek istediğinize emin misiniz?')) {
      this.storeService.deleteDeliveryRule(rule.id).subscribe({
        next: () => this.loadStores(),
        error: (err) => console.error('Delete rule failed:', err),
      });
    }
  }

  // ==================== GEO TEST ====================

  testGeoCheck(): void {
    this.storeService.checkServiceArea(this.testLat, this.testLng).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.geoTestResult.set(res.data);
        }
      },
      error: (err) => console.error('Geo check failed:', err),
    });
  }
}


