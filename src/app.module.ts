import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { OrdersModule } from './orders/orders.module';
import { ConsultsModule } from './consults/consults.module';
import { Order } from './orders/entities/order.entity';
import { Consult } from './consults/entities/consult.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'lume'),
        entities: [Order, Consult],
        // Explicit flag, not tied to NODE_ENV — there are no real migrations yet,
        // so this is how the schema gets created at all. Set DB_SYNC=false once
        // real migrations exist; don't leave this tied to an environment name
        // that Docker/EC2 configs will set to "production" long before that.
        synchronize: config.get<string>('DB_SYNC', 'true') === 'true',
      }),
    }),
    OrdersModule,
    ConsultsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
