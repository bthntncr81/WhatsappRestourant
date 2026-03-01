// ==================== STORE ====================

export interface StoreDto {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  isActive: boolean;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
  deliveryRules?: DeliveryRuleDto[];
}

export interface CreateStoreDto {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  phone?: string;
  isActive?: boolean;
}

export interface UpdateStoreDto {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  isActive?: boolean;
  isOpen?: boolean;
}

// ==================== DELIVERY RULE ====================

export interface DeliveryRuleDto {
  id: string;
  tenantId: string;
  storeId: string;
  radiusKm: number;
  minBasket: number;
  deliveryFee: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  store?: StoreDto;
}

export interface CreateDeliveryRuleDto {
  storeId: string;
  radiusKm: number;
  minBasket: number;
  deliveryFee: number;
  isActive?: boolean;
}

export interface UpdateDeliveryRuleDto {
  radiusKm?: number;
  minBasket?: number;
  deliveryFee?: number;
  isActive?: boolean;
}

// ==================== GEO CHECK ====================

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface GeoCheckResult {
  isWithinServiceArea: boolean;
  nearestStore: StoreDto | null;
  distance: number | null; // in km
  deliveryRule: DeliveryRuleDto | null;
  alternativeStores: { store: StoreDto; distance: number }[];
  message: string;
}

// ==================== FUTURE: DELIVERY ZONE (POLYGON) ====================
// Placeholder interface for polygon-based zones

export interface DeliveryZoneDto {
  id: string;
  tenantId: string;
  storeId: string;
  name: string;
  polygon: GeoJsonPolygon;
  priority: number;
  minBasket: number;
  deliveryFee: number;
  isActive: boolean;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [[[lng, lat], [lng, lat], ...]]
}

// Future zone check interface
export interface ZoneCheckResult {
  isWithinZone: boolean;
  zone: DeliveryZoneDto | null;
  store: StoreDto | null;
}


