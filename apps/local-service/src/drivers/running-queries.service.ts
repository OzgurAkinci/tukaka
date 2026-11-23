
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { CancelQueryResponse } from '@tukaka/contracts';

interface RunningQuery {
  connectionId: string;
  supportsCancel: boolean;
  cancel: (() => Promise<void>) | null;
  cancelRequested: boolean;
}

export interface RunningQueryHandle {
  /** Sürücünün `onCancelAvailable` geri çağrısına verilir. */
  setCancel(cancel: () => Promise<void>): void;
  /** Kullanıcı bu sorgu için iptal istedi mi? */
  readonly cancelRequested: boolean;
  /** Sorgu bittiğinde (başarılı ya da hatalı) çağrılmalıdır. */
  finish(): void;
}

/**
 * İstemcinin verdiği `queryId` ile çalışan sorguları izler ve iptal eder.
 */
@Injectable()
export class RunningQueriesService {
  private readonly logger = new Logger(RunningQueriesService.name);

  private readonly running = new Map<string, RunningQuery>();

  start(
    queryId: string,
    connectionId: string,
    supportsCancel: boolean,
  ): RunningQueryHandle {
    if (this.running.has(queryId)) {
      throw new ConflictException('A query with this id is already running.');
    }

    const entry: RunningQuery = {
      connectionId,
      supportsCancel,
      cancel: null,
      cancelRequested: false,
    };

    this.running.set(queryId, entry);

    return {
      setCancel: (cancel) => {
        entry.cancel = cancel;

        // İptal, sürücü sorguyu başlatmadan önce istendiyse hemen uygula.
        if (entry.cancelRequested) {
          void this.invoke(queryId, entry);
        }
      },
      get cancelRequested() {
        return entry.cancelRequested;
      },
      finish: () => {
        if (this.running.get(queryId) === entry) {
          this.running.delete(queryId);
        }
      },
    };
  }

  async cancel(queryId: string): Promise<CancelQueryResponse> {
    const entry = this.running.get(queryId);

    if (!entry) {
      return {
        success: true,
        cancelled: false,
        message: 'Query is not running.',
      };
    }

    if (!entry.supportsCancel) {
      return {
        success: false,
        cancelled: false,
        message: 'Queries on this database type cannot be cancelled.',
      };
    }

    entry.cancelRequested = true;

    if (!entry.cancel) {
      return {
        success: true,
        cancelled: true,
        message: 'Cancellation requested.',
      };
    }

    const sent = await this.invoke(queryId, entry);

    return {
      success: sent,
      cancelled: sent,
      message: sent
        ? 'Cancellation sent to the database.'
        : 'Cancellation could not be sent.',
    };
  }

  private async invoke(queryId: string, entry: RunningQuery): Promise<boolean> {
    try {
      await entry.cancel?.();
      this.logger.log(`Query ${queryId} cancelled.`);
      return true;
    } catch (error) {
      this.logger.warn(
        `Query ${queryId} could not be cancelled: ${String(error)}`,
      );
      return false;
    }
  }
}
