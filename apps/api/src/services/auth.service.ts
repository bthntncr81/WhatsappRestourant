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
import {
  otorderLogin,
  otorderHasAIPlan,
  otorderPlanFeatures,
  provisionFromOtorder,
  connectOtorderWithToken,
} from './otorder-sso.service';
import { createLogger } from '../logger';

const SALT_ROUNDS = 12;
const ssoLogger = createLogger();

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
    // 1) Yerel kullanıcı + şifre (whatres'e doğrudan kayıt olanlar)
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

    if (user && (await bcrypt.compare(dto.password, user.passwordHash))) {
      let membership = user.memberships[0];
      if (tenantId) {
        membership = user.memberships.find((m) => m.tenantId === tenantId) || membership;
      }
      if (!membership) {
        throw new AppError(403, 'NO_MEMBERSHIP', 'User has no tenant membership');
      }
      // Tenant OtOrder'a bağlı değilse aynı kimlik bilgileriyle otomatik bağlamayı
      // dene — "üyelik OtOrder'dan alındıysa panel bağlı açılmalı".
      await this.ensureOtorderLink(dto, membership);
      return this.buildAuthResponse(user, membership);
    }

    // 2) Yerel eşleşme yok → OtOrder SSO: Pro AI paketli hesaplar POS
    //    e-posta+şifresiyle girer; ilk girişte provizyon + oto-bağlantı yapılır.
    const viaOtorder = await this.loginViaOtorder(dto);
    if (viaOtorder) return viaOtorder;

    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // OtOrder kimliğiyle giriş — kimlik OtOrder'a sorulur, whatres şifre saklamaz.
  private async loginViaOtorder(dto: LoginDto): Promise<AuthResponseDto | null> {
    const identity = await otorderLogin(dto.email, dto.password);
    if (!identity) return null;

    const gate = await otorderHasAIPlan(identity.token);
    if (!gate.ok) {
      throw new AppError(
        403,
        'OTORDER_PLAN_REQUIRED',
        'OtOrder hesabın doğrulandı ama paketinde yapay zekâ WhatsApp asistanı yok. otorder.com üzerinden Pro AI paketine geçtiğinde bu panel otomatik açılır.',
      );
    }

    let user = await prisma.user.findUnique({
      where: { email: dto.email },
      include: { memberships: { include: { tenant: true } } },
    });

    if (!user) {
      // İlk giriş: tenant + user + mağaza aç, POS bağlantısını kur
      const p = await provisionFromOtorder(identity);
      try {
        await connectOtorderWithToken(p.tenantId, identity.subdomain, identity.token);
      } catch (e) {
        ssoLogger.warn({ error: e, tenantId: p.tenantId }, 'OtOrder oto-bağlantı başarısız — Entegrasyonlar sayfasından tekrar denenebilir');
      }
      user = await prisma.user.findUnique({
        where: { email: dto.email },
        include: { memberships: { include: { tenant: true } } },
      });
    } else {
      // Daha önce provizyonlanmış hesap: bağlantı yoksa panel açılmadan tamamla
      const m = user.memberships[0];
      if (m && !(m.tenant as any).posApiKey) {
        try {
          await connectOtorderWithToken(m.tenantId, identity.subdomain, identity.token);
        } catch (e) {
          ssoLogger.warn({ error: e, tenantId: m.tenantId }, 'OtOrder yeniden bağlanma başarısız');
        }
      }
    }

    const membership = user?.memberships[0];
    if (!user || !membership) return null;
    return this.buildAuthResponse(user, membership);
  }

  // Yerel girişte OtOrder oto-bağlantısı: tenant bağlı değilse aynı e-posta+şifre
  // OtOrder'da da geçerliyse ve planı modül bağlamaya izin veriyorsa
  // (whatsappLink: Pro ve üzeri) bağlantıyı kurar. Başarısızlık girişi BOZMAZ.
  private async ensureOtorderLink(
    dto: LoginDto,
    membership: { tenantId: string; tenant: { posApiKey?: string | null } },
  ): Promise<void> {
    try {
      if ((membership.tenant as any).posApiKey) return;
      const identity = await otorderLogin(dto.email, dto.password);
      if (!identity) return;
      const feats = await otorderPlanFeatures(identity.token);
      if (!feats.whatsappLink && !feats.whatsappAI) return;
      await connectOtorderWithToken(membership.tenantId, identity.subdomain, identity.token);
    } catch (e) {
      ssoLogger.warn({ error: e, tenantId: membership.tenantId }, 'OtOrder oto-bağlantı (yerel giriş) başarısız');
    }
  }

  private buildAuthResponse(
    user: { id: string; email: string; name: string },
    membership: { tenantId: string; role: string; tenant: { id: string; name: string; slug: string } },
  ): AuthResponseDto {
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

