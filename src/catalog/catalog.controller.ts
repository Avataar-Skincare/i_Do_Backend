import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { QuoteDto } from './dto/quote.dto';

/** Public: no login needed to see prices or get a quote. */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  getCatalog() {
    return this.catalog.getCatalog();
  }

  /** 200, not 201: a quote creates nothing. Display only — POST /orders prices again on the server. */
  @Post('orders/quote')
  @HttpCode(200)
  quote(@Body() dto: QuoteDto) {
    return this.catalog.quote(dto);
  }
}
