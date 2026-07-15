import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { createGlobalValidationPipe } from './validation-pipe.factory';

class SampleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

class SampleBooleanDto {
  @IsBoolean()
  flag!: boolean;
}

class SampleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}

describe('createGlobalValidationPipe', () => {
  const pipe = createGlobalValidationPipe();

  it('rejects unknown properties', async () => {
    await expect(
      pipe.transform({ name: 'ok', extra: 'nope' }, { type: 'body', metatype: SampleDto }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 400,
      }),
    });
  });

  it('accepts valid DTO payloads', async () => {
    const result = await pipe.transform({ name: 'ok' }, { type: 'body', metatype: SampleDto });

    expect(result).toEqual({ name: 'ok' });
  });

  describe('boolean coercion (regression: Phase 3.4 live E2E verification)', () => {
    it('accepts a real boolean true', async () => {
      const result = await pipe.transform(
        { flag: true },
        { type: 'body', metatype: SampleBooleanDto },
      );
      expect(result.flag).toBe(true);
    });

    it('accepts a real boolean false', async () => {
      const result = await pipe.transform(
        { flag: false },
        { type: 'body', metatype: SampleBooleanDto },
      );
      expect(result.flag).toBe(false);
    });

    it.each(['yes', 'no', '1', '0', 'true', 'false', 'abc', 'anything', ''])(
      'rejects the non-boolean string %j with 400 instead of silently coercing it to true/false',
      async (value) => {
        await expect(
          pipe.transform({ flag: value }, { type: 'body', metatype: SampleBooleanDto }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ statusCode: 400 }),
        });
      },
    );

    it('rejects a numeric 1/0 for a boolean field', async () => {
      await expect(
        pipe.transform({ flag: 1 }, { type: 'body', metatype: SampleBooleanDto }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ statusCode: 400 }),
      });
    });
  });

  describe('explicit numeric conversion still works without implicit conversion', () => {
    it('converts a query-string numeric value via @Type(() => Number)', async () => {
      const result = await pipe.transform(
        { page: '2' },
        { type: 'query', metatype: SampleQueryDto },
      );
      expect(result.page).toBe(2);
    });

    it('still rejects a non-numeric query-string value', async () => {
      await expect(
        pipe.transform({ page: 'abc' }, { type: 'query', metatype: SampleQueryDto }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ statusCode: 400 }),
      });
    });
  });
});
