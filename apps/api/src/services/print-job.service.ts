import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import { PrintJobDto, PrintJobStatus, PrintJobType, PrintJobPayload } from '@whatres/shared';
import { Prisma } from '@prisma/client';

const logger = createLogger();

export class PrintJobService {
  // ==================== GET JOBS ====================

  async getPendingJobs(tenantId: string, limit = 10): Promise<PrintJobDto[]> {
    const jobs = await prisma.printJob.findMany({
      where: {
        tenantId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return jobs.map((j) => this.mapToDto(j));
  }

  async getJobs(
    tenantId: string,
    query: { status?: PrintJobStatus; orderId?: string; limit?: number; offset?: number }
  ): Promise<{ jobs: PrintJobDto[]; total: number }> {
    const where: Prisma.PrintJobWhereInput = { tenantId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.orderId) {
      where.orderId = query.orderId;
    }

    const [jobs, total] = await Promise.all([
      prisma.printJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
      }),
      prisma.printJob.count({ where }),
    ]);

    return {
      jobs: jobs.map((j) => this.mapToDto(j)),
      total,
    };
  }

  async getJob(tenantId: string, jobId: string): Promise<PrintJobDto> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found');
    }

    return this.mapToDto(job);
  }

  // ==================== PROCESS JOBS ====================

  async claimJob(tenantId: string, jobId: string): Promise<PrintJobDto> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId, status: 'PENDING' },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found or not pending');
    }

    const updated = await prisma.printJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING' },
    });

    return this.mapToDto(updated);
  }

  async completeJob(
    tenantId: string,
    jobId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<PrintJobDto> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found');
    }

    if (job.status === 'DONE') {
      throw new AppError(400, 'ALREADY_DONE', 'Job already completed');
    }

    const updated = await prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: success ? 'DONE' : 'FAILED',
        processedAt: new Date(),
        errorMessage: success ? null : errorMessage,
        retryCount: success ? job.retryCount : job.retryCount + 1,
      },
    });

    logger.info(
      { tenantId, jobId, success, errorMessage },
      `Print job ${success ? 'completed' : 'failed'}`
    );

    return this.mapToDto(updated);
  }

  async retryJob(tenantId: string, jobId: string): Promise<PrintJobDto> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId, status: 'FAILED' },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found or not failed');
    }

    const updated = await prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        errorMessage: null,
      },
    });

    logger.info({ tenantId, jobId }, 'Print job retried');

    return this.mapToDto(updated);
  }

  async cancelJob(tenantId: string, jobId: string): Promise<PrintJobDto> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found');
    }

    if (job.status === 'DONE') {
      throw new AppError(400, 'CANNOT_CANCEL', 'Cannot cancel a completed job');
    }

    const updated = await prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: 'Cancelled by user',
        processedAt: new Date(),
      },
    });

    logger.info({ tenantId, jobId }, 'Print job cancelled');

    return this.mapToDto(updated);
  }

  async deleteJob(tenantId: string, jobId: string): Promise<void> {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Print job not found');
    }

    await prisma.printJob.delete({
      where: { id: jobId },
    });

    logger.info({ tenantId, jobId }, 'Print job deleted');
  }

  // ==================== HELPERS ====================

  private mapToDto(job: any): PrintJobDto {
    return {
      id: job.id,
      tenantId: job.tenantId,
      orderId: job.orderId,
      type: job.type as PrintJobType,
      status: job.status as PrintJobStatus,
      payloadJson: job.payloadJson as PrintJobPayload,
      errorMessage: job.errorMessage,
      retryCount: job.retryCount,
      createdAt: job.createdAt.toISOString(),
      processedAt: job.processedAt?.toISOString() || null,
    };
  }
}

export const printJobService = new PrintJobService();

