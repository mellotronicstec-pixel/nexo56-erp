import type { SVGProps } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Conjunto de icones do Nexo56 (Prompt 04, itens 62 e 63).
 *
 * UMA unica familia coerente, desenhada com as mesmas regras:
 *
 *   - grade de 24x24, traco de 1.5, cantos e juntas arredondados;
 *   - `currentColor` sempre — o icone herda a cor do contexto;
 *   - `aria-hidden` por padrao, porque icone decorativo nao deve ser lido.
 *     Quando o icone e a UNICA informacao, quem usa passa `title`, e ai ele
 *     vira `role="img"` com nome acessivel.
 *
 * Nao ha dependencia externa: um pacote de icones traria milhares de arquivos
 * para usar duas dezenas, e nenhuma biblioteca conhece o simbolo oficial da
 * marca. O simbolo Nexo56 NUNCA e reconstruido aqui (Prompt 00, item 74) —
 * ele vive em `brand-mark.tsx` e depende do SVG oficial.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Nome acessivel. Sem ele o icone e decorativo e fica oculto. */
  title?: string;
  /** Tamanho em pixels. Padrao 20 — a medida de interface do Nexo56. */
  size?: number;
}

function Icon({
  title,
  size = 20,
  className,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      className={cn('shrink-0', className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconMenu = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const IconChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 9.5l6 6 6-6" />
  </Icon>
);

export const IconChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);

export const IconChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 6l-6 6 6 6" />
  </Icon>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

export const IconUser = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" />
  </Icon>
);

export const IconUsers = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 19.5a6.2 6.2 0 0112.4 0" />
    <path d="M16 5.4a3.2 3.2 0 010 5.2M17.4 14.2a6.2 6.2 0 013.8 5.3" />
  </Icon>
);

export const IconShield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3z" />
    <path d="M9.3 12l1.9 1.9 3.5-3.6" />
  </Icon>
);

export const IconBuilding = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20V6.5L12 3l8 3.5V20" />
    <path d="M3 20h18" />
    <path d="M10 20v-4h4v4" />
    <path d="M8.5 10h1.5M14 10h1.5M8.5 13.5h1.5M14 13.5h1.5" />
  </Icon>
);

export const IconModules = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const IconHistory = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.8 12a8.2 8.2 0 108.2-8.2A8.2 8.2 0 006 6.4" />
    <path d="M3.5 3.5v3.2h3.2" />
    <path d="M12 7.8V12l2.8 1.8" />
  </Icon>
);

export const IconHome = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10.5L12 4l8 6.5V20H4z" />
    <path d="M9.5 20v-5h5v5" />
  </Icon>
);

export const IconSettings = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1" />
  </Icon>
);

export const IconLogout = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4.5H6.5A1.5 1.5 0 005 6v12a1.5 1.5 0 001.5 1.5H14" />
    <path d="M16.5 8.5L20 12l-3.5 3.5M20 12H9.5" />
  </Icon>
);

export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);

export const IconAlert = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4M12 16.8v.2" />
  </Icon>
);

export const IconInfo = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </Icon>
);

export const IconFilter = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16l-6.2 7.2V19l-3.6-2v-3.8z" />
  </Icon>
);

export const IconPlus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconEye = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);

export const IconEyeOff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4l16 16" />
    <path d="M9.6 9.7A2.8 2.8 0 0012 14.8c.8 0 1.5-.3 2-.8" />
    <path d="M6.3 6.8C3.9 8.3 2.5 12 2.5 12s3.5 6.2 9.5 6.2c1.6 0 3-.4 4.2-1M18.3 15c1.9-1.5 3.2-3 3.2-3S18 5.8 12 5.8c-.7 0-1.3.1-1.9.2" />
  </Icon>
);

export const IconMore = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconSort = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 4.5v15M8 19.5L4.8 16.3M8 4.5l3.2 3.2" />
    <path d="M16 19.5v-15M16 4.5l3.2 3.2M16 4.5l-3.2 3.2" />
  </Icon>
);

export const IconKey = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="15.5" r="3.5" />
    <path d="M10.6 13L20 3.6M17.2 6.4l2 2M15 8.6l2 2" />
  </Icon>
);

export const IconCustomers = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="7.5" r="3.2" />
    <path d="M5 20a7 7 0 0114 0" />
    <path d="M3.2 9.5h1.6M19.2 9.5h1.6" />
  </Icon>
);
