import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import prisma from '../db/prisma';
import { getConfig } from '@whatres/config';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import { MenuMediaDto } from '@whatres/shared';

const logger = createLogger();

const MAX_FILES_PER_TENANT = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC_TYPES = ['application/pdf'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];
const MAX_IMAGE_SIZE = 16 * 1024 * 1024; // 16MB (WhatsApp limit)
const MAX_DOC_SIZE = 100 * 1024 * 1024; // 100MB

export class MenuMediaService {
  private getUploadDir(tenantId: string): string {
    return path.join(process.cwd(), 'uploads', 'menu-media', tenantId);
  }

  async getMediaForTenant(tenantId: string): Promise<MenuMediaDto[]> {
    const records = await prisma.menuMedia.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return records.map((r) => this.mapToDto(r));
  }

  async uploadMedia(
    tenantId: string,
    file: Express.Multer.File,
    caption?: string,
  ): Promise<MenuMediaDto> {
    // Check count limit
    const count = await prisma.menuMedia.count({ where: { tenantId } });
    if (count >= MAX_FILES_PER_TENANT) {
      throw new AppError(400, 'LIMIT_REACHED', `En fazla ${MAX_FILES_PER_TENANT} dosya yukleyebilirsiniz`);
    }

    // Validate mime type
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new AppError(400, 'INVALID_FILE_TYPE', 'Desteklenen formatlar: jpeg, png, webp, pdf');
    }

    // Validate size
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
    if (file.size > maxSize) {
      throw new AppError(400, 'FILE_TOO_LARGE', `Maksimum dosya boyutu: ${maxSize / (1024 * 1024)}MB`);
    }

    const type = isImage ? 'IMAGE' : 'DOCUMENT';
    const ext = path.extname(file.originalname) || (isImage ? '.jpg' : '.pdf');
    const storedName = `${crypto.randomUUID()}${ext}`;

    // Ensure upload directory
    const uploadDir = this.getUploadDir(tenantId);
    await fs.mkdir(uploadDir, { recursive: true });

    // Write file
    await fs.writeFile(path.join(uploadDir, storedName), file.buffer);

    // Get next sort order
    const maxSort = await prisma.menuMedia.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    });

    const record = await prisma.menuMedia.create({
      data: {
        tenantId,
        type,
        filename: file.originalname,
        storedName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        caption: caption || null,
      },
    });

    logger.info({ tenantId, mediaId: record.id, type, filename: file.originalname }, 'Menu media uploaded');
    return this.mapToDto(record);
  }

  async deleteMedia(tenantId: string, mediaId: string): Promise<void> {
    const record = await prisma.menuMedia.findFirst({
      where: { id: mediaId, tenantId },
    });
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Dosya bulunamadi');

    // Delete file from disk
    const filePath = path.join(this.getUploadDir(tenantId), record.storedName);
    await fs.unlink(filePath).catch(() => {
      logger.warn({ filePath }, 'File already deleted from disk');
    });

    await prisma.menuMedia.delete({ where: { id: mediaId } });
    logger.info({ tenantId, mediaId }, 'Menu media deleted');
  }

  async reorderMedia(tenantId: string, mediaIds: string[]): Promise<MenuMediaDto[]> {
    await Promise.all(
      mediaIds.map((id, index) =>
        prisma.menuMedia.updateMany({
          where: { id, tenantId },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.getMediaForTenant(tenantId);
  }

  private mapToDto(record: any): MenuMediaDto {
    const config = getConfig();
    const url = `${config.whatsapp.appBaseUrl}/uploads/menu-media/${record.tenantId}/${record.storedName}`;
    return {
      id: record.id,
      tenantId: record.tenantId,
      type: record.type,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      sortOrder: record.sortOrder,
      caption: record.caption,
      url,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const menuMediaService = new MenuMediaService();
