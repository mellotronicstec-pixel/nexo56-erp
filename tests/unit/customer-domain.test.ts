import { describe, expect, it } from 'vitest';
import {
  formatDocument,
  inferDocumentType,
  isValidCnpj,
  isValidCpf,
  onlyDigits,
} from '@/core/document/brazilian-document';
import { formatPhone, isValidPhone, normalizeEmail, normalizePhone } from '@/core/contact/phone';
import {
  displayDocument,
  displayName,
  normalizeSearchText,
} from '@/modules/customers/domain/customer';
import { formatCnpj, formatCpf, makeCnpj, makeCpf } from '../helpers/fake-documents';

describe('CPF', () => {
  it('aceita um CPF com digitos verificadores corretos', () => {
    expect(isValidCpf(makeCpf('529982247'))).toBe(true);
  });

  it('aceita CPF formatado', () => {
    const cpf = makeCpf('111222333');
    expect(isValidCpf(formatCpf(cpf))).toBe(true);
  });

  it('recusa CPF com digito verificador errado', () => {
    const valido = makeCpf('529982247');
    const ultimo = Number(valido[10]);
    const adulterado = valido.slice(0, 10) + ((ultimo + 1) % 10);
    expect(isValidCpf(adulterado)).toBe(false);
  });

  it('recusa sequencia de digitos repetidos, que passa na conta mas nao existe', () => {
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('recusa comprimento errado', () => {
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('123456789012')).toBe(false);
  });

  it('mascara nao e validacao: forma certa e numero errado continua invalido', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('aceita um CNPJ com digitos verificadores corretos', () => {
    expect(isValidCnpj(makeCnpj('112223330001'))).toBe(true);
  });

  it('aceita CNPJ formatado', () => {
    const cnpj = makeCnpj('445556660001');
    expect(isValidCnpj(formatCnpj(cnpj))).toBe(true);
  });

  it('recusa CNPJ com digito adulterado', () => {
    const valido = makeCnpj('112223330001');
    const ultimo = Number(valido[13]);
    expect(isValidCnpj(valido.slice(0, 13) + ((ultimo + 1) % 10))).toBe(false);
  });

  it('recusa repetidos e comprimento errado', () => {
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123456')).toBe(false);
  });
});

describe('normalizacao de documento', () => {
  it('remove toda pontuacao', () => {
    expect(onlyDigits('123.456.789-00')).toBe('12345678900');
    expect(onlyDigits('12.345.678/0001-95')).toBe('12345678000195');
  });

  it('deduz o tipo pelo comprimento apenas para mensagem', () => {
    expect(inferDocumentType('123.456.789-00')).toBe('cpf');
    expect(inferDocumentType('12.345.678/0001-95')).toBe('cnpj');
    expect(inferDocumentType('123')).toBeNull();
  });

  it('formata para leitura', () => {
    expect(formatDocument('cpf', '12345678900')).toBe('123.456.789-00');
    expect(formatDocument('cnpj', '12345678000195')).toBe('12.345.678/0001-95');
  });
});

describe('telefone', () => {
  it('normaliza para apenas digitos', () => {
    expect(normalizePhone('(11) 98888-7777')).toBe('11988887777');
    expect(normalizePhone('+55 11 98888 7777')).toBe('5511988887777');
  });

  it('aceita celular, fixo e numero internacional', () => {
    expect(isValidPhone('(11) 98888-7777')).toBe(true);
    expect(isValidPhone('1133334444')).toBe(true);
    expect(isValidPhone('+351 912 345 678')).toBe(true);
  });

  it('recusa o que nao pode ser telefone', () => {
    expect(isValidPhone('1234')).toBe(false);
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('1'.repeat(20))).toBe(false);
  });

  it('formata celular e fixo brasileiros', () => {
    expect(formatPhone('11988887777')).toBe('(11) 98888-7777');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('numero fora do padrao brasileiro volta como veio, sem ser espremido', () => {
    expect(formatPhone('351912345678')).toBe('351912345678');
  });
});

describe('e-mail', () => {
  it('normaliza para minusculas sem espacos nas bordas', () => {
    expect(normalizeEmail('  Joao@Empresa.COM.BR ')).toBe('joao@empresa.com.br');
  });

  it('nao altera o que vem depois do @ alem do caixa', () => {
    expect(normalizeEmail('a.b+tag@dominio.com')).toBe('a.b+tag@dominio.com');
  });
});

describe('apresentacao do cliente', () => {
  it('PJ aparece pelo nome fantasia quando ele existe', () => {
    expect(
      displayName({ kind: 'company', name: 'ZE ALIMENTOS LTDA', tradeName: 'Padaria do Ze' }),
    ).toBe('Padaria do Ze');
  });

  it('PJ sem fantasia aparece pela razao social', () => {
    expect(displayName({ kind: 'company', name: 'ZE ALIMENTOS LTDA', tradeName: null })).toBe(
      'ZE ALIMENTOS LTDA',
    );
  });

  it('PF ignora fantasia', () => {
    expect(displayName({ kind: 'individual', name: 'Joao da Silva', tradeName: 'x' })).toBe(
      'Joao da Silva',
    );
  });

  it('documento ausente nao vira string vazia enganosa', () => {
    expect(displayDocument({ documentType: null, documentDigits: null })).toBeNull();
  });
});

describe('normalizacao de busca', () => {
  it('remove acento e caixa', () => {
    expect(normalizeSearchText('José da SILVA')).toBe('jose da silva');
    expect(normalizeSearchText('Açaí Comércio')).toBe('acai comercio');
  });

  it('colapsa espacos', () => {
    expect(normalizeSearchText('  Maria   Souza  ')).toBe('maria souza');
  });
});
