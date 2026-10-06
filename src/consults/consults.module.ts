import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consult } from './entities/consult.entity';
import { ConsultsService } from './consults.service';
import { ConsultsController } from './consults.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Consult]), UsersModule],
  controllers: [ConsultsController],
  providers: [ConsultsService],
  exports: [ConsultsService],
})
export class ConsultsModule {}
