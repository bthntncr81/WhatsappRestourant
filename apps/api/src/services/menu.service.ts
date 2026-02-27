import prisma from '../db/prisma';
import { cacheService } from './cache.service';
import { AppError } from '../middleware/error-handler';
import {
  MenuVersionDto,
  MenuItemDto,
  CreateMenuItemDto,
  UpdateMenuItemDto,
  MenuOptionGroupDto,
  CreateMenuOptionGroupDto,
  UpdateMenuOptionGroupDto,
  MenuOptionDto,
  CreateMenuOptionDto,
  UpdateMenuOptionDto,
  MenuSynonymDto,
  CreateMenuSynonymDto,
  UpdateMenuSynonymDto,
  CanonicalMenuExport,
  CanonicalCategory,
  CanonicalOptionGroup,
  CanonicalSynonym,
  MenuImportDto,
  MenuImportResultDto,
} from '@whatres/shared';

export class MenuService {
  // ==================== VERSIONS ====================

  async getVersions(tenantId: string): Promise<MenuVersionDto[]> {
    const versions = await prisma.menuVersion.findMany({
      where: { tenantId },
      orderBy: { version: 'desc' },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return versions.map((v) => ({
      id: v.id,
      tenantId: v.tenantId,
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      publishedAt: v.publishedAt?.toISOString() || null,
      itemCount: v._count.items,
    }));
  }

  async createVersion(tenantId: string): Promise<MenuVersionDto> {
    // Get next version number
    const lastVersion = await prisma.menuVersion.findFirst({
      where: { tenantId },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (lastVersion?.version || 0) + 1;

    const version = await prisma.menuVersion.create({
      data: {
        tenantId,
        version: nextVersion,
      },
    });

    return {
      id: version.id,
      tenantId: version.tenantId,
      version: version.version,
      createdAt: version.createdAt.toISOString(),
      publishedAt: null,
      itemCount: 0,
    };
  }

  async publishVersion(tenantId: string, versionId: string): Promise<MenuVersionDto> {
    const version = await prisma.menuVersion.findFirst({
      where: { id: versionId, tenantId },
    });

    if (!version) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Menu version not found');
    }

    if (version.publishedAt) {
      throw new AppError(400, 'ALREADY_PUBLISHED', 'This version is already published');
    }

    const updated = await prisma.menuVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date() },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    // Update cache with canonical export
    const canonicalMenu = await this.exportVersion(tenantId, versionId);
    await cacheService.setPublishedMenu(tenantId, canonicalMenu);

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      version: updated.version,
      createdAt: updated.createdAt.toISOString(),
      publishedAt: updated.publishedAt?.toISOString() || null,
      itemCount: updated._count.items,
    };
  }

  async getVersion(tenantId: string, versionId: string): Promise<MenuVersionDto> {
    const version = await prisma.menuVersion.findFirst({
      where: { id: versionId, tenantId },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    if (!version) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Menu version not found');
    }

    return {
      id: version.id,
      tenantId: version.tenantId,
      version: version.version,
      createdAt: version.createdAt.toISOString(),
      publishedAt: version.publishedAt?.toISOString() || null,
      itemCount: version._count.items,
    };
  }

  // ==================== ITEMS ====================

  async getItems(tenantId: string, versionId: string): Promise<MenuItemDto[]> {
    const items = await prisma.menuItem.findMany({
      where: { tenantId, versionId },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        optionGroups: {
          include: {
            group: {
              include: {
                options: {
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return items.map((item) => this.mapItemToDto(item));
  }

  async createItem(
    tenantId: string,
    versionId: string,
    dto: CreateMenuItemDto
  ): Promise<MenuItemDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const item = await prisma.menuItem.create({
      data: {
        tenantId,
        versionId,
        name: dto.name,
        description: dto.description,
        basePrice: dto.basePrice,
        category: dto.category,
        isActive: dto.isActive ?? true,
        isReadyFood: dto.isReadyFood ?? false,
        sortOrder: dto.sortOrder ?? 0,
        optionGroups: dto.optionGroupIds
          ? {
              create: dto.optionGroupIds.map((groupId, index) => ({
                groupId,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        optionGroups: {
          include: {
            group: {
              include: {
                options: true,
              },
            },
          },
        },
      },
    });

    return this.mapItemToDto(item);
  }

  async updateItem(
    tenantId: string,
    versionId: string,
    itemId: string,
    dto: UpdateMenuItemDto
  ): Promise<MenuItemDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuItem.findFirst({
      where: { id: itemId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'ITEM_NOT_FOUND', 'Menu item not found');
    }

    // Update option groups if provided
    if (dto.optionGroupIds !== undefined) {
      await prisma.menuItemOptionGroup.deleteMany({
        where: { itemId },
      });

      if (dto.optionGroupIds.length > 0) {
        await prisma.menuItemOptionGroup.createMany({
          data: dto.optionGroupIds.map((groupId, index) => ({
            itemId,
            groupId,
            sortOrder: index,
          })),
        });
      }
    }

    const item = await prisma.menuItem.update({
      where: { id: itemId },
      data: {
        name: dto.name,
        description: dto.description,
        basePrice: dto.basePrice,
        category: dto.category,
        isActive: dto.isActive,
        isReadyFood: dto.isReadyFood,
        sortOrder: dto.sortOrder,
      },
      include: {
        optionGroups: {
          include: {
            group: {
              include: {
                options: true,
              },
            },
          },
        },
      },
    });

    return this.mapItemToDto(item);
  }

  async deleteItem(tenantId: string, versionId: string, itemId: string): Promise<void> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuItem.findFirst({
      where: { id: itemId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'ITEM_NOT_FOUND', 'Menu item not found');
    }

    await prisma.menuItem.delete({ where: { id: itemId } });
  }

  // ==================== OPTION GROUPS ====================

  async getOptionGroups(tenantId: string, versionId: string): Promise<MenuOptionGroupDto[]> {
    const groups = await prisma.menuOptionGroup.findMany({
      where: { tenantId, versionId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return groups.map((g) => this.mapOptionGroupToDto(g));
  }

  async createOptionGroup(
    tenantId: string,
    versionId: string,
    dto: CreateMenuOptionGroupDto
  ): Promise<MenuOptionGroupDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const group = await prisma.menuOptionGroup.create({
      data: {
        tenantId,
        versionId,
        name: dto.name,
        type: dto.type,
        required: dto.required ?? false,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: {
        options: true,
      },
    });

    return this.mapOptionGroupToDto(group);
  }

  async updateOptionGroup(
    tenantId: string,
    versionId: string,
    groupId: string,
    dto: UpdateMenuOptionGroupDto
  ): Promise<MenuOptionGroupDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuOptionGroup.findFirst({
      where: { id: groupId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Option group not found');
    }

    const group = await prisma.menuOptionGroup.update({
      where: { id: groupId },
      data: {
        name: dto.name,
        type: dto.type,
        required: dto.required,
        minSelect: dto.minSelect,
        maxSelect: dto.maxSelect,
        sortOrder: dto.sortOrder,
      },
      include: {
        options: true,
      },
    });

    return this.mapOptionGroupToDto(group);
  }

  async deleteOptionGroup(tenantId: string, versionId: string, groupId: string): Promise<void> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuOptionGroup.findFirst({
      where: { id: groupId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Option group not found');
    }

    await prisma.menuOptionGroup.delete({ where: { id: groupId } });
  }

  // ==================== OPTIONS ====================

  async createOption(
    tenantId: string,
    versionId: string,
    dto: CreateMenuOptionDto
  ): Promise<MenuOptionDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const option = await prisma.menuOption.create({
      data: {
        tenantId,
        versionId,
        groupId: dto.groupId,
        name: dto.name,
        priceDelta: dto.priceDelta ?? 0,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    return this.mapOptionToDto(option);
  }

  async updateOption(
    tenantId: string,
    versionId: string,
    optionId: string,
    dto: UpdateMenuOptionDto
  ): Promise<MenuOptionDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuOption.findFirst({
      where: { id: optionId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'OPTION_NOT_FOUND', 'Option not found');
    }

    const option = await prisma.menuOption.update({
      where: { id: optionId },
      data: {
        name: dto.name,
        priceDelta: dto.priceDelta,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });

    return this.mapOptionToDto(option);
  }

  async deleteOption(tenantId: string, versionId: string, optionId: string): Promise<void> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuOption.findFirst({
      where: { id: optionId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'OPTION_NOT_FOUND', 'Option not found');
    }

    await prisma.menuOption.delete({ where: { id: optionId } });
  }

  // ==================== SYNONYMS ====================

  async getSynonyms(tenantId: string, versionId: string): Promise<MenuSynonymDto[]> {
    const synonyms = await prisma.menuSynonym.findMany({
      where: { tenantId, versionId },
      orderBy: [{ phrase: 'asc' }],
      include: {
        item: true,
        option: true,
      },
    });

    return synonyms.map((s) => ({
      id: s.id,
      tenantId: s.tenantId,
      versionId: s.versionId,
      phrase: s.phrase,
      mapsToItemId: s.mapsToItemId,
      mapsToOptionId: s.mapsToOptionId,
      weight: s.weight,
      itemName: s.item?.name,
      optionName: s.option?.name,
    }));
  }

  async createSynonym(
    tenantId: string,
    versionId: string,
    dto: CreateMenuSynonymDto
  ): Promise<MenuSynonymDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const synonym = await prisma.menuSynonym.create({
      data: {
        tenantId,
        versionId,
        phrase: dto.phrase,
        mapsToItemId: dto.mapsToItemId,
        mapsToOptionId: dto.mapsToOptionId,
        weight: dto.weight ?? 1,
      },
      include: {
        item: true,
        option: true,
      },
    });

    return {
      id: synonym.id,
      tenantId: synonym.tenantId,
      versionId: synonym.versionId,
      phrase: synonym.phrase,
      mapsToItemId: synonym.mapsToItemId,
      mapsToOptionId: synonym.mapsToOptionId,
      weight: synonym.weight,
      itemName: synonym.item?.name,
      optionName: synonym.option?.name,
    };
  }

  async updateSynonym(
    tenantId: string,
    versionId: string,
    synonymId: string,
    dto: UpdateMenuSynonymDto
  ): Promise<MenuSynonymDto> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuSynonym.findFirst({
      where: { id: synonymId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'SYNONYM_NOT_FOUND', 'Synonym not found');
    }

    const synonym = await prisma.menuSynonym.update({
      where: { id: synonymId },
      data: {
        phrase: dto.phrase,
        mapsToItemId: dto.mapsToItemId,
        mapsToOptionId: dto.mapsToOptionId,
        weight: dto.weight,
      },
      include: {
        item: true,
        option: true,
      },
    });

    return {
      id: synonym.id,
      tenantId: synonym.tenantId,
      versionId: synonym.versionId,
      phrase: synonym.phrase,
      mapsToItemId: synonym.mapsToItemId,
      mapsToOptionId: synonym.mapsToOptionId,
      weight: synonym.weight,
      itemName: synonym.item?.name,
      optionName: synonym.option?.name,
    };
  }

  async deleteSynonym(tenantId: string, versionId: string, synonymId: string): Promise<void> {
    await this.verifyVersionEditable(tenantId, versionId);

    const existing = await prisma.menuSynonym.findFirst({
      where: { id: synonymId, tenantId, versionId },
    });

    if (!existing) {
      throw new AppError(404, 'SYNONYM_NOT_FOUND', 'Synonym not found');
    }

    await prisma.menuSynonym.delete({ where: { id: synonymId } });
  }

  // ==================== EXPORT ====================

  async exportVersion(tenantId: string, versionId: string): Promise<CanonicalMenuExport> {
    const version = await prisma.menuVersion.findFirst({
      where: { id: versionId, tenantId },
      include: {
        tenant: true,
      },
    });

    if (!version) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Menu version not found');
    }

    const items = await prisma.menuItem.findMany({
      where: { tenantId, versionId },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      include: {
        optionGroups: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const optionGroups = await prisma.menuOptionGroup.findMany({
      where: { tenantId, versionId },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const synonyms = await prisma.menuSynonym.findMany({
      where: { tenantId, versionId },
      include: {
        item: true,
        option: true,
      },
    });

    // Group items by category
    const categoryMap = new Map<string, CanonicalCategory>();
    for (const item of items) {
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, { name: item.category, items: [] });
      }
      categoryMap.get(item.category)!.items.push({
        id: item.id,
        name: item.name,
        description: item.description,
        basePrice: Number(item.basePrice),
        isActive: item.isActive,
        isReadyFood: item.isReadyFood,
        optionGroupIds: item.optionGroups.map((og) => og.groupId),
      });
    }

    const canonicalOptionGroups: CanonicalOptionGroup[] = optionGroups.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: Number(o.priceDelta),
        isDefault: o.isDefault,
        isActive: o.isActive,
      })),
    }));

    const canonicalSynonyms: CanonicalSynonym[] = synonyms
      .filter((s) => s.item || s.option)
      .map((s) => ({
        phrase: s.phrase,
        mapsTo: {
          type: s.mapsToItemId ? ('item' as const) : ('option' as const),
          id: (s.mapsToItemId || s.mapsToOptionId)!,
          name: (s.item?.name || s.option?.name)!,
        },
        weight: s.weight,
      }));

    return {
      version: version.version,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: version.tenant.id,
        name: version.tenant.name,
        slug: version.tenant.slug,
      },
      categories: Array.from(categoryMap.values()),
      optionGroups: canonicalOptionGroups,
      synonyms: canonicalSynonyms,
    };
  }

  async getPublishedMenu(tenantId: string): Promise<CanonicalMenuExport | null> {
    // Try cache first
    const cached = await cacheService.getPublishedMenu(tenantId);
    if (cached) {
      return cached;
    }

    // Find latest published version
    const latestPublished = await prisma.menuVersion.findFirst({
      where: { tenantId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });

    if (!latestPublished) {
      return null;
    }

    // Export and cache
    const menu = await this.exportVersion(tenantId, latestPublished.id);
    await cacheService.setPublishedMenu(tenantId, menu);

    return menu;
  }

  // ==================== IMPORT ====================

  async importMenu(tenantId: string, dto: MenuImportDto): Promise<MenuImportResultDto> {
    // Create new version
    const version = await this.createVersion(tenantId);

    let itemsCreated = 0;
    let optionGroupsCreated = 0;
    let optionsCreated = 0;
    let synonymsCreated = 0;

    // Create option groups first (needed for item references)
    const groupNameToId = new Map<string, string>();

    for (const group of dto.optionGroups) {
      const created = await prisma.menuOptionGroup.create({
        data: {
          tenantId,
          versionId: version.id,
          name: group.name,
          type: group.type,
          required: group.required ?? false,
          minSelect: group.minSelect ?? 0,
          maxSelect: group.maxSelect,
        },
      });
      groupNameToId.set(group.name, created.id);
      optionGroupsCreated++;

      // Create options for this group
      for (const option of group.options) {
        await prisma.menuOption.create({
          data: {
            tenantId,
            versionId: version.id,
            groupId: created.id,
            name: option.name,
            priceDelta: option.priceDelta ?? 0,
            isDefault: option.isDefault ?? false,
            isActive: option.isActive ?? true,
          },
        });
        optionsCreated++;
      }
    }

    // Create items
    const itemNameToId = new Map<string, string>();

    for (const category of dto.categories) {
      for (const item of category.items) {
        const groupIds = (item.optionGroupNames || [])
          .map((name) => groupNameToId.get(name))
          .filter((id): id is string => !!id);

        const created = await prisma.menuItem.create({
          data: {
            tenantId,
            versionId: version.id,
            name: item.name,
            description: item.description,
            basePrice: item.basePrice,
            category: category.name,
            isActive: item.isActive ?? true,
            optionGroups: {
              create: groupIds.map((groupId, index) => ({
                groupId,
                sortOrder: index,
              })),
            },
          },
        });
        itemNameToId.set(item.name, created.id);
        itemsCreated++;
      }
    }

    // Create synonyms
    if (dto.synonyms) {
      for (const synonym of dto.synonyms) {
        const itemId = synonym.mapsToItemName ? itemNameToId.get(synonym.mapsToItemName) : undefined;
        // For options, we'd need to look up by name - simplified for now
        
        if (itemId || synonym.mapsToOptionName) {
          await prisma.menuSynonym.create({
            data: {
              tenantId,
              versionId: version.id,
              phrase: synonym.phrase,
              mapsToItemId: itemId,
              weight: synonym.weight ?? 1,
            },
          });
          synonymsCreated++;
        }
      }
    }

    return {
      versionId: version.id,
      version: version.version,
      itemsCreated,
      optionGroupsCreated,
      optionsCreated,
      synonymsCreated,
    };
  }

  // ==================== HELPERS ====================

  private async verifyVersionEditable(tenantId: string, versionId: string): Promise<void> {
    const version = await prisma.menuVersion.findFirst({
      where: { id: versionId, tenantId },
    });

    if (!version) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Menu version not found');
    }

    if (version.publishedAt) {
      throw new AppError(400, 'VERSION_PUBLISHED', 'Cannot edit a published version');
    }
  }

  private mapItemToDto(item: any): MenuItemDto {
    return {
      id: item.id,
      tenantId: item.tenantId,
      versionId: item.versionId,
      name: item.name,
      description: item.description,
      basePrice: Number(item.basePrice),
      category: item.category,
      isActive: item.isActive,
      isReadyFood: item.isReadyFood,
      sortOrder: item.sortOrder,
      optionGroups: item.optionGroups?.map((og: any) => this.mapOptionGroupToDto(og.group)),
    };
  }

  private mapOptionGroupToDto(group: any): MenuOptionGroupDto {
    return {
      id: group.id,
      tenantId: group.tenantId,
      versionId: group.versionId,
      name: group.name,
      type: group.type,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      sortOrder: group.sortOrder,
      options: group.options?.map((o: any) => this.mapOptionToDto(o)),
    };
  }

  private mapOptionToDto(option: any): MenuOptionDto {
    return {
      id: option.id,
      tenantId: option.tenantId,
      versionId: option.versionId,
      groupId: option.groupId,
      name: option.name,
      priceDelta: Number(option.priceDelta),
      isDefault: option.isDefault,
      isActive: option.isActive,
      sortOrder: option.sortOrder,
    };
  }
}

export const menuService = new MenuService();

