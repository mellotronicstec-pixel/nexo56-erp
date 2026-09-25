import { describe, expect, it } from 'vitest';
import { AuthorizationError, IntegrationError, BusinessRuleError } from '@/core/errors';
import { aiError } from '@/modules/ai/domain/ai-request';

/** Item 74: codigos estaveis, cada um com HTTP/expose corretos e sem vazar detalhe cru. */
describe('aiError', () => {
  it('AI_FEATURE_DISABLED e AI_PERMISSION_DENIED viram AuthorizationError (403)', () => {
    expect(aiError('AI_FEATURE_DISABLED')).toBeInstanceOf(AuthorizationError);
    expect(aiError('AI_PERMISSION_DENIED')).toBeInstanceOf(AuthorizationError);
  });

  it('AI_PROVIDER_TIMEOUT e AI_PROVIDER_ERROR viram IntegrationError, sem expor o cru ao usuario (item 71/103)', () => {
    const timeout = aiError('AI_PROVIDER_TIMEOUT');
    const providerError = aiError('AI_PROVIDER_ERROR', new Error('Bearer sk-super-secreto'));

    expect(timeout).toBeInstanceOf(IntegrationError);
    expect(providerError).toBeInstanceOf(IntegrationError);
    expect(providerError.expose).toBe(false);
    // A mensagem exposta nunca contem o detalhe cru do provedor.
    expect(providerError.message).not.toContain('sk-super-secreto');
  });

  it('AI_TECHNICAL_MEANING_RISK usa exatamente o texto do item 59', () => {
    const error = aiError('AI_TECHNICAL_MEANING_RISK');
    expect(error).toBeInstanceOf(BusinessRuleError);
    expect(error.message).toBe(
      'A sugestao pode ter alterado um dado tecnico. O texto original foi preservado.',
    );
  });

  it('todo erro carrega o codigo estavel em details.aiErrorCode', () => {
    const error = aiError('AI_INSUFFICIENT_CONTEXT');
    expect((error.details as { aiErrorCode?: string })?.aiErrorCode).toBe(
      'AI_INSUFFICIENT_CONTEXT',
    );
  });
});
