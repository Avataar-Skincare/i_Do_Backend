import * as crypto from 'crypto';
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
    create: jest.fn().mockImplementation(async (x) => ({ id: 'u1', phone: null, role: 'user', createdAt: new Date(), emailVerifiedAt: null, phoneVerifiedAt: null, fullName: null, ...x })),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
  };
  const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const jwtService = { sign: jest.fn().mockReturnValue('jwt-token') };
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
    {} as never,
    {} as never,
  );
  return { service, emailOtpRepo, usersService, mailService };
}

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

      const res = await service.verifyEmailOtp({ email: 'a@example.com', code: '123456', fullName: 'Ananya' });

      expect(usersService.create).toHaveBeenCalledWith({ email: 'a@example.com', fullName: 'Ananya' });
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('u1');
      expect(res.token).toBe('jwt-token');
      expect(res.user.email).toBe('a@example.com');
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1', usedAt: expect.anything() }, { usedAt: expect.any(Date) });
    });

    it('logs an existing account in without creating one', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live());
      usersService.findByEmailInsensitive.mockResolvedValue({ id: 'u9', email: 'a@example.com', emailVerifiedAt: new Date(), role: 'user' });

      const res = await service.verifyEmailOtp({ email: 'a@example.com', code: '123456' });

      expect(usersService.create).not.toHaveBeenCalled();
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
      expect(res.user.id).toBe('u9');
    });

    it('counts a wrong code and rejects with OTP_INVALID', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 1 }));

      const err = await service.verifyEmailOtp({ email: 'a@example.com', code: '000000' }).catch((e) => e);

      expect(err).toBeInstanceOf(OtpInvalidException);
      expect(err.getResponse()).toMatchObject({ statusCode: 401, code: 'OTP_INVALID' });
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1' }, { attempts: 2 });
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('burns the code on the fifth wrong guess', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 4 }));

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '000000' })).rejects.toBeInstanceOf(OtpInvalidException);
      expect(emailOtpRepo.update).toHaveBeenCalledWith({ id: 'otp1' }, { attempts: 5, usedAt: expect.any(Date) });
    });

    it('rejects a burned code even when the code is right', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValue(live({ attempts: 5 }));

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' })).rejects.toBeInstanceOf(OtpInvalidException);
      expect(emailOtpRepo.update).not.toHaveBeenCalled();
    });

    it('rejects an expired code and an address with no code', async () => {
      const { service, emailOtpRepo } = build();
      emailOtpRepo.findOne.mockResolvedValueOnce(live({ expiresAt: new Date(Date.now() - 1000) }));
      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' })).rejects.toBeInstanceOf(OtpInvalidException);

      emailOtpRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' })).rejects.toBeInstanceOf(OtpInvalidException);
    });

    it('lets only one of two racing requests use a correct code', async () => {
      const { service, emailOtpRepo, usersService } = build();
      emailOtpRepo.findOne.mockResolvedValue(live());
      emailOtpRepo.update.mockResolvedValue({ affected: 0 }); // someone else claimed it first

      await expect(service.verifyEmailOtp({ email: 'a@example.com', code: '123456' })).rejects.toBeInstanceOf(OtpInvalidException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });
});
