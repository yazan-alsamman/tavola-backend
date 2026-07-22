import { InvalidUsernameException, Username } from './username.vo';

describe('Username value object (ADR-022)', () => {
  it('accepts a valid username', () => {
    expect(Username.create('jane_doe').value).toBe('jane_doe');
  });

  it('normalizes to lowercase (case-insensitive uniqueness at the storage layer)', () => {
    expect(Username.create('Jane_Doe').value).toBe('jane_doe');
  });

  it('trims surrounding whitespace', () => {
    expect(Username.create('  jane_doe  ').value).toBe('jane_doe');
  });

  it('rejects a username shorter than 3 characters', () => {
    expect(() => Username.create('ab')).toThrow(InvalidUsernameException);
  });

  it('rejects a username longer than 30 characters', () => {
    expect(() => Username.create('a'.repeat(31))).toThrow(InvalidUsernameException);
  });

  it('rejects disallowed characters', () => {
    expect(() => Username.create('jane.doe')).toThrow(InvalidUsernameException);
    expect(() => Username.create('jane doe')).toThrow(InvalidUsernameException);
    expect(() => Username.create('jane-doe')).toThrow(InvalidUsernameException);
  });

  it('rejects an empty username', () => {
    expect(() => Username.create('')).toThrow(InvalidUsernameException);
  });
});
