import Image from 'next/image';
import { BRAND_ASSETS, BRAND_ASSETS_AVAILABLE, PRODUCT_NAME } from '@/design-system/brand';
import { cn } from '@/design-system/cn';

/**
 * Assinatura visual da aplicacao.
 *
 * Com os ativos oficiais presentes, renderiza o SVG vetorial. Sem eles,
 * renderiza um marcador neutro SEM lettering — a logo Nexo56 nunca e
 * reconstruida com fonte (Prompt 00, item 74).
 *
 * O nome do produto ao lado e texto de interface em Inter, nao a marca
 * tipografica: nao substitui nem imita o lettering oficial.
 */
export function BrandMark({
  variant = 'light',
  showName = true,
  className,
}: {
  variant?: 'light' | 'dark';
  showName?: boolean;
  className?: string;
}) {
  const nameColor = variant === 'dark' ? 'text-white' : 'text-ink-900';

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {BRAND_ASSETS_AVAILABLE ? (
        <Image
          src={variant === 'dark' ? BRAND_ASSETS.logoDark : BRAND_ASSETS.logoLight}
          alt={PRODUCT_NAME}
          width={112}
          height={28}
          priority
        />
      ) : (
        <span
          aria-hidden="true"
          title="Espaco reservado para a logo oficial Nexo56"
          className="inline-block size-7 rounded-md bg-brand-500"
        />
      )}

      {showName && !BRAND_ASSETS_AVAILABLE ? (
        <span className={cn('text-h5 font-semibold tracking-tight', nameColor)}>
          {PRODUCT_NAME}
        </span>
      ) : null}
    </span>
  );
}
