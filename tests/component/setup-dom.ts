import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Limpeza entre testes de componente.
 *
 * Sem isso, cada `render` deixa o markup anterior no documento e as consultas
 * do Testing Library passam a encontrar dois elementos iguais — falha
 * confusa, cuja causa nao esta no teste que quebrou.
 */
afterEach(() => {
  cleanup();
});
