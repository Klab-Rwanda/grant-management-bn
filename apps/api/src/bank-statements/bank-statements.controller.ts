import type { AuthUserContext } from '@grant-ledger/shared';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { BankStatementsService } from './bank-statements.service';
import type { ImportBankStatementInput } from './bank-statements.service';

@ApiTags('Bank statements')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller('bank-statements/imports')
export class BankStatementsController {
  constructor(private readonly bankStatements: BankStatementsService) {}

  @Post()
  @Roles('FIN', 'FDR')
  @ApiOperation({ summary: 'Import a CAMT.053 statement into the tenant review queue' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['source_filename', 'xml'],
      properties: {
        source_filename: { type: 'string', maxLength: 255 },
        xml: {
          type: 'string',
          maxLength: 1000000,
          description: 'CAMT.053 XML; not retained after parsing',
        },
      },
    },
  })
  importStatement(@CurrentUser() actor: AuthUserContext, @Body() input: ImportBankStatementInput) {
    return this.bankStatements.importStatement(actor, input);
  }

  @Get()
  @Roles('FIN', 'FDR')
  @ApiOperation({ summary: 'List tenant bank statement imports' })
  listImports(@CurrentUser() actor: AuthUserContext) {
    return this.bankStatements.listImports(actor);
  }

  @Get(':id')
  @Roles('FIN', 'FDR')
  @ApiOperation({ summary: 'View tenant-private statement entries awaiting review' })
  getImport(@CurrentUser() actor: AuthUserContext, @Param('id') importId: string) {
    return this.bankStatements.getImport(actor, importId);
  }
}
