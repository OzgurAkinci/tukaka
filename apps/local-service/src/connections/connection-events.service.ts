
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';

/**
 * Bağlantı profili değiştiğinde ya da silindiğinde yayın yapar.
 * Sürücüler bu olayları dinleyerek açık havuzlarını kapatır.
 */
@Injectable()
export class ConnectionEventsService implements OnModuleDestroy {
  private readonly invalidatedSubject = new Subject<string>();

  readonly invalidated$ = this.invalidatedSubject.asObservable();

  invalidate(connectionId: string): void {
    this.invalidatedSubject.next(connectionId);
  }

  onModuleDestroy(): void {
    this.invalidatedSubject.complete();
  }
}
