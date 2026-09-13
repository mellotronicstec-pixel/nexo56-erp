import type { NextConfig } from 'next';

/**
 * Cabecalhos de seguranca aplicados a toda a aplicacao (Prompt 01, item 42;
 * Prompt 04, item 115).
 *
 * A CSP permite 'unsafe-inline' em script-src porque o runtime do Next injeta
 * scripts inline de bootstrap/hidratacao sem nonce no modo `next start`.
 * Evolucao documentada em docs/architecture/security.md.
 *
 * 'unsafe-eval' entra APENAS em desenvolvimento: o React em modo dev compila
 * com eval, e sem essa permissao a hidratacao falha em silencio — a pagina
 * aparece, mas nenhum botao, menu ou dialogo responde. O sintoma engana
 * (parece bug de componente) e custa horas. Em producao a diretiva NAO e
 * emitida, entao o build publicado continua sem eval.
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Em desenvolvimento o Next abre um WebSocket para recarga automatica.
  `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['mysql2'],
  async headers() {
    /**
     * O canal de recarga automatica do Next (`/_next/hmr`) e um upgrade para
     * WebSocket. Carimbar cabecalhos de resposta HTTP nesse handshake o faz
     * falhar, e sem esse canal o runtime de desenvolvimento nao conclui a
     * hidratacao: a tela aparece, mas nenhum botao responde. O caminho fica
     * de fora — ele nao existe em producao.
     */
    return [{ source: '/((?!_next/hmr).*)', headers: securityHeaders }];
  },
};

export default nextConfig;
