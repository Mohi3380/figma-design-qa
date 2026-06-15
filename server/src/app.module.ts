import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: isDev ? 'debug' : 'info',
        transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: true,
      },
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
