
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CredentialService } from '../credentials/credential.service';
import { SetCredentialDto } from './dto/set-credential.dto';
import { ConnectionsService } from './connections.service';
import { ConnectionEventsService } from './connection-events.service';

@Controller('connections')
export class CredentialController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly connectionEvents: ConnectionEventsService,
  ) {}

  @Post(':id/credential')
  saveCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCredentialDto,
  ) {
    const connection = this.connectionsService.findOne(id);

    if (connection.type === 'sqlite') {
      throw new BadRequestException(
        'SQLite connections do not require a password.',
      );
    }

    if (dto.password !== undefined) {
      this.credentialService.savePassword(id, dto.password);
    }

    if (dto.sshSecret !== undefined) {
      this.credentialService.saveSshSecret(id, dto.sshSecret);
    }

    this.connectionEvents.invalidate(id);

    return {
      success: true,
      message: 'Credential saved successfully.',
    };
  }

  @Delete(':id/credential')
  deleteCredential(@Param('id', ParseUUIDPipe) id: string) {
    this.connectionsService.findOne(id);
    this.credentialService.deletePassword(id);
    this.credentialService.deleteSshSecret(id);
    this.connectionEvents.invalidate(id);

    return {
      success: true,
      message: 'Credential deleted successfully.',
    };
  }
}
