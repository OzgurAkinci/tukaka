
import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { RunningQueriesService } from './running-queries.service';

@Controller('queries')
export class QueryCancelController {
  constructor(private readonly runningQueries: RunningQueriesService) {}

  @Post(':queryId/cancel')
  cancel(@Param('queryId', ParseUUIDPipe) queryId: string) {
    return this.runningQueries.cancel(queryId);
  }
}
