# Backend Project Initialization

**Stack:** NestJS + TypeScript + Prisma + PostgreSQL + Redis + BullMQ.

## 1. Bootstrap

```bash
cd apps/api
pnpm dlx @nestjs/cli new . --package-manager pnpm --skip-git

pnpm add @nestjs/config @nestjs/passport @nestjs/jwt @nestjs/bullmq \
        @prisma/client bullmq ioredis passport \
        class-validator class-transformer openid-client ethers cookie-parser
pnpm add -D prisma @types/node @types/passport @types/cookie-parser

pnpm dlx prisma init
```

## 2. Folder Structure

```
apps/api/src/
├── main.ts
├── app.module.ts
├── common/
│   ├── guards/          # jwt-auth.guard, roles.guard
│   ├── decorators/      # @CurrentUser, @Roles
│   ├── filters/         # all-exceptions.filter
│   ├── interceptors/    # response.interceptor
│   ├── prisma.service.ts
│   └── config/          # env.validation
├── modules/
│   ├── auth/ users/ campaigns/ reviews/
│   ├── donations/ payments/ blockchain/
│   ├── integrity/ disbursements/ audit/ storage/
└── queue/               # BullMQ setup
```

Setiap module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

## 3. main.ts

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:5173',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
```

## 4. Global Response & Error

**Response interceptor** — wrap semua response jadi `{ success, data }`:

```typescript
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
```

**Exception filter** — semua error jadi `{ success: false, error: { code, message } }`:

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof AppError) {
      return res.status(exception.status).json({
        success: false,
        error: { code: exception.code, message: exception.message },
      });
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
```

Register di `app.module.ts` sebagai `APP_INTERCEPTOR` + `APP_FILTER`.

## 5. Auth Structure

- **Guard** `JwtAuthGuard` — verify session JWT dari cookie
- **Guard** `RolesGuard` — cek role dari `@Roles()` decorator
- **Decorator** `@CurrentUser()` — extract user dari request
- **Strategy** — `openid-client` untuk Microsoft SSO callback

```typescript
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.fundchain_session;
    if (!token) throw new AppError('Missing session', 401, 'AUTH_UNAUTHENTICATED');
    req.user = jwt.verify(token, process.env.SESSION_JWT_SECRET);
    return true;
  }
}
```

## 6. Prisma Service

```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

Register sebagai global provider di `app.module.ts`.

## 7. DTO & Validation

```typescript
import { IsString, IsNumber, IsPositive, MinLength, IsDateString } from 'class-validator';

export class CreateCampaignDto {
  @IsString() @MinLength(5) title!: string;
  @IsString() @MinLength(20) description!: string;
  @IsString() sdgCategory!: string;
  @IsNumber() @IsPositive() targetAmount!: number;
  @IsDateString() deadline!: string;
}
```

Global `ValidationPipe` auto-validate, reject unknown fields.

## 8. Definition of Done

- [ ] `pnpm start:dev` boots tanpa error
- [ ] `GET /api/v1/health` returns 200
- [ ] Prisma connect ke Postgres
- [ ] Response interceptor wrap semua response
- [ ] Exception filter format error standar
- [ ] Validation pipe aktif (reject unknown fields)