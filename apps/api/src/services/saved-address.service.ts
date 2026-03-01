import prisma from '../db/prisma';
import { createLogger } from '../logger';

const logger = createLogger();

interface SavedAddressDto {
  id: string;
  tenantId: string;
  customerPhone: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  storeId: string;
  createdAt: string;
}

export class SavedAddressService {
  async getByCustomerPhone(tenantId: string, customerPhone: string): Promise<SavedAddressDto[]> {
    const addresses = await prisma.savedAddress.findMany({
      where: { tenantId, customerPhone },
      orderBy: { createdAt: 'desc' },
      take: 9, // WhatsApp list max 10 rows, 1 reserved for "Yeni Adres"
    });

    return addresses.map(a => ({
      id: a.id,
      tenantId: a.tenantId,
      customerPhone: a.customerPhone,
      name: a.name,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      storeId: a.storeId,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async getById(tenantId: string, id: string): Promise<SavedAddressDto | null> {
    const a = await prisma.savedAddress.findFirst({
      where: { id, tenantId },
    });
    if (!a) return null;

    return {
      id: a.id,
      tenantId: a.tenantId,
      customerPhone: a.customerPhone,
      name: a.name,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      storeId: a.storeId,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async create(
    tenantId: string,
    customerPhone: string,
    data: { name: string; address: string; lat: number; lng: number; storeId: string },
  ): Promise<SavedAddressDto> {
    const a = await prisma.savedAddress.create({
      data: {
        tenantId,
        customerPhone,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        storeId: data.storeId,
      },
    });

    logger.info({ tenantId, customerPhone, name: data.name }, 'Saved address created');

    return {
      id: a.id,
      tenantId: a.tenantId,
      customerPhone: a.customerPhone,
      name: a.name,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      storeId: a.storeId,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await prisma.savedAddress.deleteMany({
      where: { id, tenantId },
    });
  }
}

export const savedAddressService = new SavedAddressService();
