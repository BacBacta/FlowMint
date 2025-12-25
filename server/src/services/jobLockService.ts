/**
 * Job Lock Service
 *
 * Provides idempotent job execution with database-backed locking.
 * Prevents double execution of intents.
 */

import { v4 as uuidv4 } from 'uuid';

import { DatabaseService } from '../db/database.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'JobLock' });

/**
 * Job status
 */
export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Job record
 */
export interface Job {
  id: string;
  jobKey: string;
  intentId: string;
  scheduledAt: number;
  status: JobStatus;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  attempts: number;
  createdAt: number;
}

/**
 * Job execution result
 */
export interface JobResult {
  success: boolean;
  receiptId?: string;
  error?: string;
  signature?: string;
}

/**
 * Lock acquisition result
 */
export interface LockResult {
  acquired: boolean;
  jobId?: string;
  reason?: string;
  existingJob?: Job;
}

/**
 * Job Lock Service class
 */
export class JobLockService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Generate a unique job key for an intent execution
   * Format: intentId:scheduledWindow
   */
  generateJobKey(intentId: string, scheduledAt: number, windowMs: number = 60000): string {
    // Round to window (e.g., 1 minute windows)
    const windowStart = Math.floor(scheduledAt / windowMs) * windowMs;
    return `${intentId}:${windowStart}`;
  }

  /**
   * Try to acquire a lock for a job
   * Returns true if lock acquired, false if already exists
   */
  async acquireLock(
    intentId: string,
    scheduledAt: number,
    windowMs: number = 60000
  ): Promise<LockResult> {
    const jobKey = this.generateJobKey(intentId, scheduledAt, windowMs);
    const jobId = uuidv4();
    const now = Date.now();

    try {
      // Check if job already exists
      const existing = await this.getJobByKey(jobKey);

      if (existing) {
        // Job already exists
        if (existing.status === JobStatus.RUNNING) {
          log.debug({ jobKey, existingJobId: existing.id }, 'Job already running');
          return {
            acquired: false,
            reason: 'Job already running',
            existingJob: existing,
          };
        }

        if (existing.status === JobStatus.COMPLETED || existing.status === JobStatus.SKIPPED) {
          log.debug({ jobKey, existingJobId: existing.id }, 'Job already completed');
          return {
            acquired: false,
            reason: 'Job already completed',
            existingJob: existing,
          };
        }

        // Failed job - check retry limits
        if (existing.attempts >= 3) {
          log.warn({ jobKey, attempts: existing.attempts }, 'Job exceeded retry limit');
          return {
            acquired: false,
            reason: 'Job exceeded retry limit',
            existingJob: existing,
          };
        }

        // Retry failed job
        await this.updateJob(existing.id, {
          status: JobStatus.RUNNING,
          startedAt: now,
          attempts: existing.attempts + 1,
        });

        log.info(
          { jobKey, jobId: existing.id, attempt: existing.attempts + 1 },
          'Retrying failed job'
        );

        return {
          acquired: true,
          jobId: existing.id,
        };
      }

      // Create new job with lock
      await this.createJob({
        id: jobId,
        jobKey,
        intentId,
        scheduledAt,
        status: JobStatus.RUNNING,
        startedAt: now,
        attempts: 1,
        createdAt: now,
      });

      log.info({ jobKey, jobId }, 'Lock acquired for new job');

      return {
        acquired: true,
        jobId,
      };
    } catch (error) {
      // Unique constraint violation means another process got the lock
      if (this.isUniqueConstraintError(error)) {
        log.debug({ jobKey }, 'Lock contention - another process acquired lock');
        return {
          acquired: false,
          reason: 'Lock contention',
        };
      }

      log.error({ jobKey, error }, 'Failed to acquire lock');
      throw error;
    }
  }

  /**
   * Release lock with result
   */
  async releaseLock(jobId: string, result: JobResult): Promise<void> {
    const now = Date.now();

    if (result.success) {
      await this.updateJob(jobId, {
        status: JobStatus.COMPLETED,
        completedAt: now,
        result: JSON.stringify({
          receiptId: result.receiptId,
          signature: result.signature,
        }),
      });
      log.info({ jobId, receiptId: result.receiptId }, 'Job completed successfully');
    } else {
      await this.updateJob(jobId, {
        status: JobStatus.FAILED,
        completedAt: now,
        error: result.error,
      });
      log.warn({ jobId, error: result.error }, 'Job failed');
    }
  }

  /**
   * Skip a job (e.g., conditions not met)
   */
  async skipJob(jobId: string, reason: string): Promise<void> {
    await this.updateJob(jobId, {
      status: JobStatus.SKIPPED,
      completedAt: Date.now(),
      result: JSON.stringify({ skipped: true, reason }),
    });
    log.info({ jobId, reason }, 'Job skipped');
  }

  /**
   * Get job by key
   */
  async getJobByKey(jobKey: string): Promise<Job | null> {
    const result = await this.db.getJobByKey(jobKey);
    if (!result) return null;
    return this.rowToJob(result);
  }

  /**
   * Get job by ID
   */
  async getJobById(jobId: string): Promise<Job | null> {
    const result = await this.db.getJobById(jobId);
    if (!result) return null;
    return this.rowToJob(result);
  }

  /**
   * Get all jobs for an intent
   */
  async getJobsByIntentId(intentId: string): Promise<Job[]> {
    const jobs = await this.db.getJobsByIntent(intentId);
    return jobs.map(j => this.rowToJob(j));
  }

  /**
   * Get pending jobs for an intent
   */
  async getPendingJobs(intentId: string): Promise<Job[]> {
    const jobs = await this.db.getJobsByIntent(intentId);
    return jobs
      .filter(j => j.status === JobStatus.PENDING || j.status === JobStatus.RUNNING)
      .map(j => this.rowToJob(j));
  }

  /**
   * Get recent jobs for an intent
   */
  async getRecentJobs(intentId: string, limit: number = 10): Promise<Job[]> {
    const jobs = await this.db.getJobsByIntent(intentId);
    return jobs.slice(0, limit).map(j => this.rowToJob(j));
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupOldJobs(_maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    // Not yet implemented - would require a new method in DatabaseService
    log.debug('Job cleanup not yet implemented');
    return 0;
  }

  /**
   * Reset stuck running jobs (e.g., after server restart)
   */
  async resetStuckJobs(maxRunningTimeMs: number = 5 * 60 * 1000): Promise<number> {
    const staleJobs = await this.db.getStaleJobs(maxRunningTimeMs);
    let count = 0;

    for (const job of staleJobs) {
      await this.updateJob(job.id, {
        status: JobStatus.FAILED,
        error: 'Job timed out (server restart or stuck)',
      });
      count++;
    }

    if (count > 0) {
      log.warn({ reset: count }, 'Reset stuck running jobs');
    }
    return count;
  }

  /**
   * Create job record
   */
  private async createJob(job: {
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: JobStatus;
    startedAt?: number;
    attempts: number;
    createdAt: number;
  }): Promise<void> {
    await this.db.createJobLock({
      id: job.id,
      jobKey: job.jobKey,
      intentId: job.intentId,
      scheduledAt: job.scheduledAt,
      status: job.status,
      startedAt: job.startedAt,
      attempts: job.attempts,
      createdAt: job.createdAt,
    });
  }

  /**
   * Update job record
   */
  private async updateJob(
    jobId: string,
    updates: Partial<{
      status: JobStatus;
      startedAt: number;
      completedAt: number;
      result: string;
      error: string;
      attempts: number;
    }>
  ): Promise<void> {
    await this.db.updateJobLock(jobId, updates);
  }

  /**
   * Convert row to Job object
   */
  private rowToJob(row: {
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    attempts: number;
    createdAt: number;
  }): Job {
    return {
      id: row.id,
      jobKey: row.jobKey,
      intentId: row.intentId,
      scheduledAt: row.scheduledAt,
      status: row.status as JobStatus,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      result: row.result,
      error: row.error,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  }

  /**
   * Check if error is unique constraint violation
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('UNIQUE constraint failed');
    }
    return false;
  }
}
