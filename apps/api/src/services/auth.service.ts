import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../db/prisma';
import { getConfig } from '@whatres/config';
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  MeResponseDto,
  JwtPayload,
  MemberRole,
} from '@whatres/shared';
import { AppError } from '../middleware/error-handler';

const SALT_ROUNDS = 12;

export class AuthService {
  private config = getConfig();

  private generateSlug(name: string): string {
    const turkishMap: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
    return name
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => turkishMap[ch] || ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new AppError(400, 'USER_EXISTS', 'Bu e-posta adresi zaten kayıtlı');
    }

    // Auto-generate unique slug from tenant name
    let baseSlug = this.generateSlug(dto.tenantName);
    if (baseSlug.length < 2) baseSlug = 'isletme';
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.tenant.findUnique({ where: { slug } })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          slug,
        },
      });

      if (dto.phone) {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { orderNotifyPhones: [dto.phone] },
        });
      }

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: dto.name,
          phone: dto.phone || null,
        },
      });

      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      return { tenant, user, membership };
    });

    // Generate JWT
    const token = this.generateToken({
      sub: result.user.id,
      email: result.user.email,
      tenantId: result.tenant.id,
      role: result.membership.role as MemberRole,
    });

    return {
      accessToken: token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.membership.role as MemberRole,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
      },
    };
  }

  async login(dto: LoginDto, tenantId?: string): Promise<AuthResponseDto> {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Get membership
    let membership = user.memberships[0];
    
    if (tenantId) {
      membership = user.memberships.find((m) => m.tenantId === tenantId) || membership;
    }

    if (!membership) {
      throw new AppError(403, 'NO_MEMBERSHIP', 'User has no tenant membership');
    }

    // Generate JWT
    const token = this.generateToken({
      sub: user.id,
      email: user.email,
      tenantId: membership.tenantId,
      role: membership.role as MemberRole,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.role as MemberRole,
      },
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
      },
    };
  }

  async getMe(userId: string, tenantId: string): Promise<MeResponseDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const currentMembership = user.memberships.find((m) => m.tenantId === tenantId);
    if (!currentMembership) {
      throw new AppError(403, 'NO_ACCESS', 'User has no access to this tenant');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: currentMembership.role as MemberRole,
      },
      tenant: {
        id: currentMembership.tenant.id,
        name: currentMembership.tenant.name,
        slug: currentMembership.tenant.slug,
        onboardingStep: currentMembership.tenant.onboardingStep,
        onboardingCompleted: !!currentMembership.tenant.onboardingCompletedAt,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantSlug: m.tenant.slug,
        role: m.role as MemberRole,
      })),
    };
  }

  private generateToken(payload: JwtPayload): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (jwt.sign as any)(payload, this.config.jwt.secret, {
      expiresIn: this.config.jwt.expiresIn,
      algorithm: 'HS256',
    });
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.config.jwt.secret, {
        algorithms: ['HS256'],
      }) as JwtPayload;
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
  }
}

export const authService = new AuthService();

