import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ConsultsService } from './consults.service';
import { CreateConsultDto } from './dto/create-consult.dto';
import { ConfirmConsultDto } from './dto/confirm-consult.dto';
import { RescheduleConsultDto } from './dto/reschedule-consult.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { ConsultStatus } from './entities/consult.entity';

@Controller('consults')
export class ConsultsController {
  constructor(private readonly consultsService: ConsultsService) {}

  /** Booking requires an account — staff need a real name/phone/email to act on the lead. */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateConsultDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.consultsService.create(dto, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.consultsService.findMineForUser(req.user.userId);
  }

  /** Frees the customer up to book a new slot for this type. */
  @UseGuards(JwtAuthGuard)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.consultsService.cancel(id, req.user.userId);
  }

  /** Moves this specific session — doesn't touch any of the customer's other sessions. */
  @UseGuards(JwtAuthGuard)
  @Patch(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleConsultDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.consultsService.reschedule(id, req.user.userId, dto);
  }

  /**
   * partner-app-server's "i do Consultations" tab — machine-to-machine, not a
   * customer JWT. Returns everything by default; `?status=PENDING` etc. filters.
   */
  @UseGuards(ApiKeyGuard)
  @Get('partner')
  findForPartner(@Query('status') status?: ConsultStatus) {
    return this.consultsService.findLeadsForPartner(status);
  }

  /** partner-app-server calls this back once staff books a real doctor for a lead. */
  @UseGuards(ApiKeyGuard)
  @Patch('partner/:id/confirm')
  confirmForPartner(@Param('id') id: string, @Body() dto: ConfirmConsultDto) {
    return this.consultsService.confirmLead(id, dto);
  }

  /** Ops moving an already-confirmed session's time from the "i do Consultations" tab. */
  @UseGuards(ApiKeyGuard)
  @Patch('partner/:id/reschedule')
  rescheduleForPartner(@Param('id') id: string, @Body() dto: RescheduleConsultDto) {
    return this.consultsService.rescheduleByPartner(id, dto);
  }
}
