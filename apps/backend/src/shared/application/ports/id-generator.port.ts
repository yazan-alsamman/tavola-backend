export interface IdGeneratorPort {
  generate(): string;
}

export const ID_GENERATOR = Symbol('ID_GENERATOR');
