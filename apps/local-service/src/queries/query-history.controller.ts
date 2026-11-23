
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';

import { ClearHistoryDto, FindHistoryDto } from './dto/query-history.dto';
import { QueryHistoryService } from './query-history.service';

@Controller('history')
export class QueryHistoryController {
  constructor(private readonly historyService: QueryHistoryService) {}

  @Get()
  findAll(@Query() query: FindHistoryDto) {
    return this.historyService.findAll(query);
  }

  @Delete()
  clear(@Query() query: ClearHistoryDto) {
    const deleted = this.historyService.clear(query.connectionId);

    return {
      success: true,
      message: `${deleted} history entries deleted.`,
    };
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.historyService.remove(id);

    return {
      success: true,
      message: 'History entry deleted.',
    };
  }
}
