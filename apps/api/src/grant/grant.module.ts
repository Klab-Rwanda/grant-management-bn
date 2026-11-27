import { Module } from '@nestjs/common';
import { GrantService } from './grant.service';
import { GrantController } from './grant.controller';
import { DatabaseModule } from '../database/database.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { EvidenceVaultService } from './evidence-vault.service';

@Module({
  imports: [DatabaseModule, StateMachineModule],
  providers: [GrantService, EvidenceVaultService],
  controllers: [GrantController],
  exports: [GrantService, EvidenceVaultService],
})
export class GrantModule {}
