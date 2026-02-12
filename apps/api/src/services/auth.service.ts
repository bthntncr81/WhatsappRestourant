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

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new AppError(400, 'USER_EXISTS', 'User with this email already exists');
    }

    // Check if tenant slug exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });

    if (existingTenant) {
      throw new AppError(400, 'TENANT_EXISTS', 'Tenant with this slug already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // Create tenant, user, and membership in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          slug: dto.tenantSlug,
        },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: dto.name,
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
    });
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.config.jwt.secret) as JwtPayload;
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
  }
}

export const authService = new AuthService();

