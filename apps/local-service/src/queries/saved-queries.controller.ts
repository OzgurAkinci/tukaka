
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import {
  CreateSavedQueryDto,
  UpdateSavedQueryDto,
} from './dto/saved-query.dto';
import { SavedQueriesService } from './saved-queries.service';

@Controller('saved-queries')
export class SavedQueriesController {
  constructor(private readonly savedQueriesService: SavedQueriesService) {}

  @Get()
  findAll() {
    return this.savedQueriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.savedQueriesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSavedQueryDto) {
    return this.savedQueriesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedQueryDto,
  ) {
    return this.savedQueriesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    this.savedQueriesService.remove(id);

    return {
      success: true,
      message: 'Saved query deleted.',
    };
  }
}
