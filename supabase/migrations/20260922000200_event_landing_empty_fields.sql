-- ============================================================================
-- Correção — lista de campos VAZIA acusava "campo repetido"
-- ----------------------------------------------------------------------------
-- ⚠️ DEFEITO MEU, encontrado na revisão do §33. Em
-- `assert_event_landing_fields`, uma lista vazia (`'[]'`) percorria este
-- caminho:
--
--   1. `jsonb_typeof = 'array'`                        passa
--   2. `v_keys` fica `'{}'`
--   3. a checagem de campo desconhecido                passa (não há campos)
--   4. `array_length('{}', 1)` devolve **NULL**, e `count(*)` devolve 0.
--      `NULL is distinct from 0` é VERDADEIRO → levantava "campo repetido".
--
-- O erro chega ao usuário como LP004 nos dois casos, então a TELA sempre disse
-- a coisa certa. Quem seria enganado é quem fosse investigar: o log do servidor
-- e o log do Postgres diriam "campo repetido" sobre uma lista sem campo nenhum,
-- e é exatamente o tipo de mensagem que manda procurar no lugar errado.
--
-- ⚠️ POR QUE UMA MIGRATION NOVA E NÃO UMA EDIÇÃO DA ANTERIOR: 20260922000100 já
-- foi aplicada. Editar um arquivo aplicado o deixa igual ao que está no banco
-- só nas máquinas que ainda não rodaram — que é a definição de duas verdades.
--
-- A correção é uma guarda explícita antes das outras três. Nada mais muda.
-- ============================================================================

create or replace function public.assert_event_landing_fields(p_fields jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Configuração de campos inválida.' using errcode = 'LP004';
  end if;

  select coalesce(array_agg(value), '{}') into v_keys
  from jsonb_array_elements_text(p_fields) as t(value);

  -- ⚠️ A GUARDA QUE FALTAVA, e ela vem PRIMEIRO de propósito. `array_length` de
  -- um array vazio é NULL, não 0 — e NULL atravessa a comparação de duplicidade
  -- logo abaixo como se fosse divergência.
  if array_length(v_keys, 1) is null then
    raise exception 'Escolha ao menos um campo para o formulário.' using errcode = 'LP004';
  end if;

  if exists (select 1 from unnest(v_keys) as k where k <> all (public.event_landing_field_keys())) then
    raise exception 'Configuração de campos inválida: campo desconhecido.' using errcode = 'LP004';
  end if;

  if array_length(v_keys, 1) is distinct from (select count(distinct k) from unnest(v_keys) as k) then
    raise exception 'Configuração de campos inválida: campo repetido.' using errcode = 'LP004';
  end if;

  if not ('GRANJA_EMPRESA' = any (v_keys)
          and 'EMAIL' = any (v_keys)
          and 'NOME_PARTICIPANTE' = any (v_keys)) then
    raise exception 'Granja/Empresa, E-mail e Nome do Participante são obrigatórios no formulário.'
      using errcode = 'LP004';
  end if;

  if not ('TELEFONE' = any (v_keys) or 'WHATSAPP' = any (v_keys)) then
    raise exception 'O formulário precisa de Telefone ou WhatsApp: cada participante tem de informar um dos dois.'
      using errcode = 'LP004';
  end if;
end;
$$;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- Recriar a versão de 20260922000100, sem a guarda de lista vazia. Não há
-- motivo para fazê-lo: a versão antiga recusa exatamente as mesmas entradas,
-- só que com a frase errada numa delas.
-- ============================================================================
