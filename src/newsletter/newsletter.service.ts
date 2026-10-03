import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NewsletterSubscriber } from './entities/newsletter-subscriber.entity';

@Injectable()
export class NewsletterService {
  constructor(
    @InjectRepository(NewsletterSubscriber)
    private readonly subscribersRepo: Repository<NewsletterSubscriber>,
  ) {}

  /**
   * Idempotent — resubscribing (or signing up again after unsubscribing)
   * just quietly succeeds instead of erroring, same pattern as every other
   * "don't leak whether this already exists" flow in this codebase.
   */
  async subscribe(email: string): Promise<{ message: string }> {
    const existing = await this.subscribersRepo.findOne({ where: { email } });

    if (!existing) {
      await this.subscribersRepo.save(this.subscribersRepo.create({ email }));
    } else if (existing.unsubscribedAt) {
      existing.unsubscribedAt = null;
      await this.subscribersRepo.save(existing);
    }

    return { message: "You're subscribed — welcome to The Circle." };
  }
}
