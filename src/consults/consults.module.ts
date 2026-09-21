import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consult } from './entities/consult.entity';
import { ConsultsService } from './consults.service';
import { ConsultsController } from './consults.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Consult])],
  controllers: [ConsultsController],
  providers: [ConsultsService],
  exports: [ConsultsService],
})
export class ConsultsModule {}
