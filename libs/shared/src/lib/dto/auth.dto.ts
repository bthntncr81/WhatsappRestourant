export interface RegisterDto {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponseDto {
  accessToken: string;
  user: UserInfoDto;
  tenant: TenantInfoDto;
}

export interface UserInfoDto {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
}

export interface TenantInfoDto {
  id: string;
  name: string;
  slug: string;
}

export interface MeResponseDto {
  user: UserInfoDto;
  tenant: TenantInfoDto;
  memberships: MembershipInfoDto[];
}

export interface MembershipInfoDto {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: MemberRole;
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT' | 'STAFF';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  tenantId: string;
  role: MemberRole;
  iat?: number;
  exp?: number;
}


