import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Behind the nginx container: trust exactly one hop so req.ip is the real client address
  // (the per-IP OTP limit needs it). Needs nginx to send X-Forwarded-For.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  app.use(cookieParser());

  // credentials: true is required for the browser to send and receive ido_at / ido_rt: without it a
  // cross-origin fetch (the website is a different origin even on another local port) drops the
  // cookies. Retry-After is exposed so the website can show how long to wait after an OTP 429.
  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN', 'http://localhost:3000'),
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
}
bootstrap();
