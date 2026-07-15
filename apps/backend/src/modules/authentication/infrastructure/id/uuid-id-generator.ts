import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';

@Injectable()
export class UuidIdGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}
