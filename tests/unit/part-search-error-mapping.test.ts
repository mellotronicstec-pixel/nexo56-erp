import { describe, expect, it } from 'vitest';
import { AuthorizationError, BusinessRuleError, IntegrationError } from '@/core/errors';
import { partSearchError } from '@/modules/part-search/domain/part-search-request';

describe('partSearchError (item 127)', () => {
  it('feature/permissao negadas viram AuthorizationError', () => {
    expect(partSearchError('PART_SEARCH_FEATURE_DISABLED')).toBeInstanceOf(AuthorizationError);
    expect(partSearchError('PART_SEARCH_PERMISSION_DENIED')).toBeInstanceOf(AuthorizationError);
  });

  it('timeout/erro de provedor viram IntegrationError com expose=false', () => {
    const timeout = partSearchError('PART_SEARCH_PROVIDER_TIMEOUT');
    expect(timeout).toBeInstanceOf(IntegrationError);
    expect(timeout.expose).toBe(false);

    const providerError = partSearchError('PART_SEARCH_PROVIDER_ERROR');
    expect(providerError).toBeInstanceOf(IntegrationError);
  });

  it('detalhe cru do provedor nunca vaza na mensagem exposta (item 103/126)', () => {
    const cause = new Error('stack trace sensivel com detalhe interno do provedor');
    const error = partSearchError('PART_SEARCH_PROVIDER_ERROR', cause);
    expect(error.message).not.toContain('stack trace sensivel');
  });

  it('demais codigos viram BusinessRuleError', () => {
    expect(partSearchError('PART_SEARCH_INCOMPATIBLE_SELECTION')).toBeInstanceOf(BusinessRuleError);
    expect(partSearchError('PART_SEARCH_UNVERIFIED_CONFIRMATION_REQUIRED')).toBeInstanceOf(
      BusinessRuleError,
    );
    expect(partSearchError('PART_SEARCH_EXTERNAL_URL_INVALID')).toBeInstanceOf(BusinessRuleError);
  });

  it('cada codigo carrega o proprio codigo estavel em `details.partSearchErrorCode`', () => {
    const error = partSearchError('PART_SEARCH_CANDIDATE_NOT_FOUND');
    expect(error.details).toEqual({ partSearchErrorCode: 'PART_SEARCH_CANDIDATE_NOT_FOUND' });
  });
});
