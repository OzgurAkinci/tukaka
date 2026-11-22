
import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';
import { CredentialService } from '../credentials/credential.service';
import { SetCredentialDto } from './dto/set-credential.dto';
import { ConnectionsService } from './connections.service';

@Controller('connections')
export class CredentialController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
  ) {}

  @Post(':id/credential')
  async saveCredential(
    @Param('id') id: string,
    @Body() dto: SetCredentialDto,
  ) {
    const connection = this.connectionsService.findOne(id);

    if (connection.type === 'sqlite') {
      throw new Error('SQLite connections do not require a password.');
    }

    this.credentialService.savePassword(id, dto.password);

    return {
      success: true,
      message: 'Credential saved successfully.',
    };
  }

  @Delete(':id/credential')
  async deleteCredential(@Param('id') id: string) {
    this.connectionsService.findOne(id);
    this.credentialService.deletePassword(id);

    return {
      success: true,
      message: 'Credential deleted successfully.',
    };
  }
}
