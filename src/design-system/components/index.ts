/**
 * Barril publico do Design System do Nexo56.
 *
 * Toda tela importa daqui — nunca do caminho interno de um arquivo. Isso
 * mantem a superficie estavel: mover um componente de arquivo nao quebra
 * dezenas de paginas.
 *
 * Componentes de cliente (modal, gaveta, menu, toast, tooltip, senha) sao
 * exportados normalmente; a diretiva 'use client' vive em cada um deles,
 * entao um Server Component pode importa-los sem virar cliente.
 */

// --- Acao ------------------------------------------------------------------
export {
  Button,
  linkButtonClass,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './button';
export { IconButton, type IconButtonProps } from './icon-button';

// --- Formulario ------------------------------------------------------------
export {
  Input,
  Textarea,
  Select,
  type InputProps,
  type TextareaProps,
  type SelectProps,
} from './input';
export { MoneyInput, type MoneyInputProps } from './money-input';
export { PasswordInput } from './password-input';
export { Checkbox, Radio, Switch } from './choice';
export { FormField, Field } from './form-field';
export { Label } from './label';
export { SearchField, type SearchFieldProps } from './search-field';
export { FilterBar } from './filter-bar';

// --- Conteudo --------------------------------------------------------------
export { Card, CardBody, CardHeader, CardFooter } from './card';
export { MetricCard } from './metric-card';
export { Section, Divider } from './section';
export { Badge } from './badge';
export { Alert } from './alert';
export { Avatar } from './avatar';
export { Table, THead, TBody, TR, TH, TD, CardList, CardListItem } from './table';
export { Pagination } from './pagination';

// --- Navegacao -------------------------------------------------------------
export { PageHeader } from './page-header';
export { Breadcrumb, type Crumb } from './breadcrumb';
export { Tabs, type TabItem } from './tabs';
export { Menu, MenuItem, MenuHeader, MenuSeparator, MENU_ROW } from './menu';

// --- Sobreposicao ----------------------------------------------------------
export { Modal } from './modal';
export { Drawer } from './drawer';
export { Tooltip } from './tooltip';
export { ToastProvider, useToast, type ToastTone } from './toast';

// --- Captura de imagem -----------------------------------------------------
export {
  prepareImage,
  ImagePreparationError,
  MAX_DIMENSION,
  JPEG_QUALITY,
  type PreparedImage,
} from './image-capture';

// --- Estado ----------------------------------------------------------------
export { EmptyState } from './empty-state';
export { ErrorState } from './error-state';
export { Skeleton, SkeletonText } from './skeleton';
export { Spinner } from './spinner';
