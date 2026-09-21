import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ConsultsService } from './consults.service';
import { CreateConsultDto } from './dto/create-consult.dto';

@Controller('consults')
export class ConsultsController {
  constructor(private readonly consultsService: ConsultsService) {}

  @Post()
  create(@Body() dto: CreateConsultDto) {
    return this.consultsService.create(dto);
  }

  @Get()
  findForClient(@Query('clientId') clientId: string) {
    return this.consultsService.findForClient(clientId);
  }
}
