import prisma from '../db/prisma';
import { createLogger } from '../logger';

const logger = createLogger();

export interface SurveyDto {
  id: string;
  tenantId: string;
  conversationId: string;
  orderId: string;
  customerPhone: string;
  customerName: string | null;
  rating: number;
  comment: string | null;
  isComplaint: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ComplaintWithMessages extends SurveyDto {
  messages: {
    id: string;
    text: string | null;
    direction: string;
    kind: string;
    createdAt: string;
  }[];
}

export class SurveyService {
  /**
   * Create a satisfaction survey record (initially just rating, comment added later)
   */
  async createSurvey(
    tenantId: string,
    conversationId: string,
    orderId: string,
    customerPhone: string,
    customerName: string | null,
    rating: number,
  ): Promise<SurveyDto> {
    const survey = await prisma.satisfactionSurvey.create({
      data: {
        tenantId,
        conversationId,
        orderId,
        customerPhone,
        customerName,
        rating,
        isComplaint: rating <= 2,
      },
    });

    return this.mapToDto(survey);
  }

  /**
   * Add comment to an existing survey
   */
  async addComment(surveyId: string, comment: string): Promise<void> {
    await prisma.satisfactionSurvey.update({
      where: { id: surveyId },
      data: { comment },
    });
  }

  /**
   * Get complaints (rating <= 2) with conversation messages
   */
  async getComplaints(
    tenantId: string,
    query: { resolved?: boolean; limit?: number; offset?: number },
  ): Promise<{ complaints: ComplaintWithMessages[]; total: number }> {
    const where: any = { tenantId, isComplaint: true };
    if (query.resolved === true) {
      where.resolvedAt = { not: null };
    } else if (query.resolved === false) {
      where.resolvedAt = null;
    }

    const [surveys, total] = await Promise.all([
      prisma.satisfactionSurvey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
        include: {
          conversation: {
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  text: true,
                  direction: true,
                  kind: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      }),
      prisma.satisfactionSurvey.count({ where }),
    ]);

    const complaints: ComplaintWithMessages[] = surveys.map((s: any) => ({
      ...this.mapToDto(s),
      messages: s.conversation.messages.map((m: any) => ({
        id: m.id,
        text: m.text,
        direction: m.direction,
        kind: m.kind,
        createdAt: m.createdAt.toISOString(),
      })),
    }));

    return { complaints, total };
  }

  /**
   * Get all surveys for analytics
   */
  async getSurveys(
    tenantId: string,
    query: { limit?: number; offset?: number },
  ): Promise<{ surveys: SurveyDto[]; total: number }> {
    const where = { tenantId };
    const [surveys, total] = await Promise.all([
      prisma.satisfactionSurvey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
      }),
      prisma.satisfactionSurvey.count({ where }),
    ]);

    return {
      surveys: surveys.map((s) => this.mapToDto(s)),
      total,
    };
  }

  /**
   * Resolve a complaint
   */
  async resolveComplaint(
    tenantId: string,
    surveyId: string,
    userId: string,
    note: string,
  ): Promise<void> {
    await prisma.satisfactionSurvey.update({
      where: { id: surveyId, tenantId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolutionNote: note,
      },
    });
  }

  /**
   * Get survey stats for a tenant
   */
  async getStats(tenantId: string): Promise<{
    totalSurveys: number;
    averageRating: number;
    complaintCount: number;
    unresolvedCount: number;
  }> {
    const [total, complaints, unresolved, avgResult] = await Promise.all([
      prisma.satisfactionSurvey.count({ where: { tenantId } }),
      prisma.satisfactionSurvey.count({ where: { tenantId, isComplaint: true } }),
      prisma.satisfactionSurvey.count({ where: { tenantId, isComplaint: true, resolvedAt: null } }),
      prisma.satisfactionSurvey.aggregate({
        where: { tenantId },
        _avg: { rating: true },
      }),
    ]);

    return {
      totalSurveys: total,
      averageRating: avgResult._avg.rating || 0,
      complaintCount: complaints,
      unresolvedCount: unresolved,
    };
  }

  private mapToDto(survey: any): SurveyDto {
    return {
      id: survey.id,
      tenantId: survey.tenantId,
      conversationId: survey.conversationId,
      orderId: survey.orderId,
      customerPhone: survey.customerPhone,
      customerName: survey.customerName,
      rating: survey.rating,
      comment: survey.comment,
      isComplaint: survey.isComplaint,
      resolvedAt: survey.resolvedAt?.toISOString() || null,
      resolvedBy: survey.resolvedBy,
      resolutionNote: survey.resolutionNote,
      createdAt: survey.createdAt.toISOString(),
    };
  }
}

export const surveyService = new SurveyService();
