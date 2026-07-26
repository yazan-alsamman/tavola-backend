import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OneSignalIdentityTokenSigner } from '@shared/application/ports/onesignal-identity-token-signer.port';
import { GetOneSignalIdentityTokenUseCase } from './get-onesignal-identity-token.use-case';

describe('GetOneSignalIdentityTokenUseCase', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  function createUseCase(signer: OneSignalIdentityTokenSigner): GetOneSignalIdentityTokenUseCase {
    return new GetOneSignalIdentityTokenUseCase(signer);
  }

  it('signs a token for the caller external_id (= User.id) and returns the configured expiry', () => {
    const sign = jest.fn().mockReturnValue('signed.jwt.token');
    const useCase = createUseCase({ sign, getExpirySeconds: () => 3600 });

    const result = useCase.execute({ actor: userActor });

    expect(sign).toHaveBeenCalledWith(userId);
    expect(result).toEqual({ token: 'signed.jwt.token', expiresInSeconds: 3600 });
  });

  it('returns a null token (never fabricates one) when the signer is unconfigured', () => {
    const useCase = createUseCase({ sign: () => null, getExpirySeconds: () => 3600 });

    const result = useCase.execute({ actor: userActor });

    expect(result).toEqual({ token: null, expiresInSeconds: 3600 });
  });
});
