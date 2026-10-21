import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { OtpInvalidException, OtpRateLimitException } from './otp-errors';

// This spec exercises AuthService's email OTP logic in isolation, so everything it merely
// injects is stubbed out. (It also keeps the spec independent of bcrypt's native build and of
// ESM-only packages that this repo's jest setup can't load.)
jest.mock('bcrypt', () => ({}), { virtual: true });
jest.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => undefined, getRepositoryToken: () => 'repo' }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../users/users.service', () => ({ UsersService: class {} }));
jest.mock('../orders/orders.service', () => ({ OrdersService: class {} }));
jest.mock('../consults/consults.service', () => ({ ConsultsService: class {} }));
jest.mock('../mail/mail.service', () => ({ MailService: class {} }));
jest.mock('../sms/fast2sms.service', () => ({ Fast2SmsService: class {} }));
jest.mock('../sms/whatsapp.service', () => ({ WhatsappService: class {} }));
// eslint-disable-next-line import/first
import { AuthService } from './auth.service';

const sha = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

function build(overrides: { ipLimit?: number } = {}) {
  const emailOtpRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn().mockImplementation(async (x) => x),
    create: jest.fn().mockImplementation((x) => x),
    count: jest.fn().mockResolvedValue(0),
  };
  const usersService = {
    findByEmailInsensitive: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (x) => ({ id: 'u1', phone: null, role: 'user', createdAt: new Date(), emailVerifiedAt: null, phoneVerifiedAt: null, fullName: null, ...x })),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
  };
  const refreshRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn().mockImplementation(async (x) => x),
    create: jest.fn().mockImplementation((x) => x),
  };
  const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const jwtService = {
    sign: jest.fn().mockReturnValue('jwt-token'),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 }),
  };
  const config = { get: jest.fn((key: string, def?: unknown) => (key === 'OTP_IP_HOURLY_LIMIT' && overrides.ipLimit ? overrides.ipLimit : def)) };

  const service = new AuthService(
    usersService as never,
    jwtService as never,
    {} as never,
    {} as never,
    mailService as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
    emailOtpRepo as never,
    refreshRepo as never,
    {} as never,
    {} as never,
  );
  return { service, emailOtpRepo, usersService, mailService, refreshRepo, jwtService };
}

const WEB = { client: 'web' as const, ip: '1.2.3.4', userAgent: 'jest' };
const sentCode = (mail: jest.Mock) => /letter-spacing[^>]*>(\d{6})</.exec(mail.mock.calls[0][0].html)![1];

describe('email OTP login', () => {
  describe('sendEmailOtp', () => {
    it('stores only a hash of the code, emails the code, and invalidates older codes', async () => {
      const { service, emailOtpRepo, mailService } = build();
      const res = await service.sendEmailOtp({ email: 'a@example.com' }, '1.2.3.4');

      expect(res.message).toMatch(/sent to your email/);
      const code = sentCode(mailService.sendEmail);
      expect(code).toMatch(/^\d{6}$/);
      const saved = emailOtpRepo.save.mock.calls[0][0];
      expect(saved.codeHash).toBe(sha(code));
      expect(JSON.stringify(saved)).not.toContain(code);
      expect(saved.ip).toBe('1.2.3.4');
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
      expect(emailOtpRepo.update).toHaveBeenCalledTimes(1); // outstanding codes burned first
      expect(mailService.sendEmail.mock.calls[0][0].to).toBe('a@example.com');
    });

    it('refuses a second code within 30 seconds and says how long to wait', async () => {
      const { service, emailOtpRepo, mailService } = build();
      emailOtpRepo.find.mockResolvedValue([{ createdAt: new Date(Date.now() - 10_000) }]);

      const err = await service.sendEmailOtp({ email: 'a@example.com' }).catch((e) => e);
      expect(err).toBeInstanceOf(OtpRateLimitException);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'OTP_RATE_LIMIT' });
      expect(err.retryAfterSeconds).toBeGreaterThan(15);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(20);
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('refuses a sixth code in an hour', async () => {
      const { service, emailOtpRepo } = build();
      const now = Date.now();
      emailOtpRepo.find.mockResolvedValue([1, 2, 3, 4, 5].map((i) => ({ createdAt: new Date(now - i * 5 * 60_000) })));

      await expect(service.sendEmailOtp({ email: 'a@example.com' })).rejects.toBeInstanceOf(OtpRateLimitException);
    });

    it('refuses once an IP has asked for its hourly allowance', async () => {
      const { service, emailOtpRepo } = build({ ipLimit: 20 });
      emailOtpRepo.count.mockResolvedValue(20);

      await expect(service.sendEmailOtp({ email: 'a@example.com' }, '9.9.9.9')).rejects.toBeInstanceOf(OtpRateLimitException);
    });
  });

  describe('verifyEmailOtp', () => {
    const live = (over: Record<string, unknown> = {}) => ({
      id: 'otp1',
      email: 'a@example.com',
      codeHash: sha('123456'),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      usedAt: null,
      attempts: 0,
      ...over,
    });

    it('creates the account on first verify, marks the email verified and returns a session', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live());

      const res = await service.verifyEmailOtp({ email: 'a@example.com', code: '123456', fullName: 'Ananya' }, WEB);

      expect(usersService.create).toHaveBeenCalledWith({ email: 'a@example.com', fullName: 'Ananya' });
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('u1');
      expect(res.session.accessToken).toBe('jwt-token');
      expect(res.session.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.user.email).toBe('a@example.com');
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1', usedAt: expect.anything() }, { usedAt: expect.any(Date) });
    });

    it('logs an existing account in without creating one', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live());
      usersService.findByEmailInsensitive.mockResolvedValue({ id: 'u9', email: 'a@example.com', emailVerifiedAt: new Date(), role: 'user' });

      const res = await service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB);

      expect(usersService.create).not.toHaveBeenCalled();
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
      expect(res.user.id).toBe('u9');
    });

    it('counts a wrong code and rejects with OTP_INVALID', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 1 }));

      const err = await service.verifyEmailOtp({ email: 'a@example.com', code: '000000' }, WEB).catch((e) => e);

      expect(err).toBeInstanceOf(OtpInvalidException);
      expect(err.getResponse()).toMatchObject({ statusCode: 401, code: 'OTP_INVALID' });
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1' }, { attempts: 2 });
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('burns the code on the fifth wrong guess', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 4 }));

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '000000' }, WEB)).rejects.toBeInstanceOf(OtpInvalidException);
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1' }, { attempts: 5, usedAt: expect.any(Date) });
    });

    it('rejects a burned code even when the code is right', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 5 }));

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB)).rejects.toBeInstanceOf(OtpInvalidException);
      expect(emailOtpRepo.update).not.toHaveBeenCalled();
    });

    it('rejects an expired code and an address with no code', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValueOnce(live({ expiresAt: new Date(Date.now() - 1000) }));
      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB)).rejects.toBeInstanceOf(OtpInvalidException);

      emailOtpRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB)).rejects.toBeInstanceOf(OtpInvalidException);
    });

    it('lets only one of two racing requests use a correct code', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live());
      emailOtpRepo.update.mockResolvedValue({ affected: 0 }); // someone else claimed it first

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB)).rejects.toBeInstanceOf(OtpInvalidException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('sessions (login, refresh rotation, logout)', () => {
    const liveRefresh = (over: Record<string, unknown> = {}) => ({
      id: 'rt1',
      userId: 'u1',
      familyId: 'fam1',
      client: 'web',
      expiresAt: new Date(Date.now() + 86_400_000),
      rotatedAt: null,
      revokedAt: null,
      ...over,
    });

    it('stores only the hash of the refresh token, in a new family, with the client and audit info', async () => {
      const { service, emailOtpRepo, refreshRepo } = build();
      emailOtpRepo.findOne.mockResolvedValue({ id: 'otp1', email: 'a@example.com', codeHash: sha('123456'), expiresAt: new Date(Date.now() + 60_000), usedAt: null, attempts: 0 });

      const res = await service.verifyEmailOtp({ email: 'a@example.com', code: '123456' }, WEB);

      const saved = refreshRepo.save.mock.calls[0][0];
      expect(saved.tokenHash).toBe(sha(res.session.refreshToken));
      expect(JSON.stringify(saved)).not.toContain(res.session.refreshToken);
      expect(saved).toMatchObject({ client: 'web', parentId: null, ip: '1.2.3.4', userAgent: 'jest' });
      expect(saved.familyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    });

    it('rotates a valid refresh token into the same family and marks the old one rotated', async () => {
      const { service, refreshRepo, usersService } = build();
      refreshRepo.findOne.mockResolvedValue(liveRefresh());
      usersService.findById.mockResolvedValue({ id: 'u1', role: 'user', email: 'a@example.com' });

      const res = await service.refreshSession('raw-token', WEB);

      expect(refreshRepo.update).toHaveBeenCalledWith({ id: 'rt1', rotatedAt: expect.anything() }, { rotatedAt: expect.any(Date) });
      const issued = refreshRepo.save.mock.calls[0][0];
      expect(issued).toMatchObject({ familyId: 'fam1', parentId: 'rt1', userId: 'u1' });
      expect(res.session.refreshToken).not.toBe('raw-token');
    });

    it('keeps the original client on rotation (an app token stays an app token)', async () => {
      const { service, refreshRepo, usersService } = build();
      refreshRepo.findOne.mockResolvedValue(liveRefresh({ client: 'app' }));
      usersService.findById.mockResolvedValue({ id: 'u1', role: 'user' });

      await service.refreshSession('raw-token', WEB);

      expect(refreshRepo.save.mock.calls[0][0].client).toBe('app');
    });

    it('revokes the whole family when an already-rotated token is presented again (theft signal)', async () => {
      const { service, refreshRepo } = build();
      refreshRepo.findOne.mockResolvedValue(liveRefresh({ rotatedAt: new Date() }));

      const err = await service.refreshSession('stolen', WEB).catch((e) => e);

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.getResponse()).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
      expect(refreshRepo.update).toHaveBeenCalledWith(
        { familyId: 'fam1', revokedAt: expect.anything() },
        { revokedAt: expect.any(Date), revokedReason: 'reuse' },
      );
      expect(refreshRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown', null],
      ['revoked', liveRefresh({ revokedAt: new Date() })],
      ['expired', liveRefresh({ expiresAt: new Date(Date.now() - 1000) })],
    ])('rejects a %s refresh token', async (_name, row) => {
      const { service, refreshRepo } = build();
      refreshRepo.findOne.mockResolvedValue(row);

      await expect(service.refreshSession('x', WEB)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshRepo.save).not.toHaveBeenCalled();
    });

    it('lets only one of two racing refreshes with the same token succeed', async () => {
      const { service, refreshRepo, usersService } = build();
      refreshRepo.findOne.mockResolvedValue(liveRefresh());
      usersService.findById.mockResolvedValue({ id: 'u1', role: 'user' });
      refreshRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.refreshSession('raw-token', WEB)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshRepo.save).not.toHaveBeenCalled();
    });

    it('logout revokes the whole family, and does nothing for an unknown token', async () => {
      const { service, refreshRepo } = build();
      refreshRepo.findOne.mockResolvedValueOnce(liveRefresh());
      await service.logoutSession('raw-token');
      expect(refreshRepo.update).toHaveBeenCalledWith(
        { familyId: 'fam1', revokedAt: expect.anything() },
        { revokedAt: expect.any(Date), revokedReason: 'logout' },
      );

      refreshRepo.update.mockClear();
      refreshRepo.findOne.mockResolvedValueOnce(null);
      await service.logoutSession('nope');
      expect(refreshRepo.update).not.toHaveBeenCalled();
    });
  });
});
