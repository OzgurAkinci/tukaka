
import { Module } from '@nestjs/common';

import { QueryHistoryController } from './query-history.controller';
import { QueryHistoryService } from './query-history.service';
import { SavedQueriesController } from './saved-queries.controller';
import { SavedQueriesService } from './saved-queries.service';

@Module({
  controllers: [QueryHistoryController, SavedQueriesController],
  providers: [QueryHistoryService, SavedQueriesService],
  exports: [QueryHistoryService],
})
export class QueriesModule {}
