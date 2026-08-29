"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { updateMemberAction } from "@/lib/actions/membership";
import {
  MEMBERSHIP_PROFILE_TYPE_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/modules/membership/membership.labels";
import {
  INTEREST_OPTIONS,
  UFS,
  formatCnpj,
  formatWhatsapp,
  updateMemberSchema,
  type UpdateMemberInput,
} from "@/modules/membership/membership.schema";
import {
  MEMBERSHIP_PROFILE_TYPES,
  MEMBER_STATUSES,
  type MemberDetail,
} from "@/modules/membership/membership.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * O formulário de edição do cadastro do associado.
 *
 * ⚠️ MOSTRA TODOS OS CAMPOS, INCLUSIVE OS QUE NÃO PERTENCEM AO PERFIL ATUAL, e
 * isso é decisão, não descuido. A tela da SOLICITAÇÃO esconde campo vazio (um
 * perfil "empresa" não tem número de matrizes, e uma lista de "—" faz procurar
 * o que nunca foi perguntado). Aqui é o contrário: é uma tela de CORRIGIR, e
 * um dos erros a corrigir é justamente o perfil. Quem troca "Técnico" para
 * "Criador" precisa do campo de granja aparecendo no mesmo lugar — esconder e
 * revelar por perfil faria o formulário mudar de tamanho embaixo da mão de
 * quem está digitando.
 *
 * ⚠️ NADA AQUI É OBRIGATÓRIO ALÉM DO NOME. Ver o cabeçalho de
 * `updateMemberSchema`: o registro guarda cadastro legado incompleto, e exigir
 * CNPJ para salvar a correção de um telefone travaria o trabalho real.
 *
 * ⚠️ CAMPO VAZIO APAGA O VALOR. `update_member` recebe o registro inteiro; é
 * assim que dá para limpar um dado errado pela tela. A frase está no rodapé,
 * porque é o tipo de comportamento que ninguém adivinha.
 */
export function MemberForm({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ids = {
    fullName: useId(),
    status: useId(),
    profileType: useId(),
    code: useId(),
    joinedAt: useId(),
    whatsapp: useId(),
    email: useId(),
    city: useId(),
    state: useId(),
    organization: useId(),
    farmName: useId(),
    productionCity: useId(),
    sowCount: useId(),
    cnpj: useId(),
    stateRegistration: useId(),
    activityArea: useId(),
    jobTitle: useId(),
    legalName: useId(),
    tradeName: useId(),
    otherInterest: useId(),
    notes: useId(),
  };

  /**
   * ⚠️ A UF GRAVADA PODE NÃO ESTAR NA LISTA, e a checagem é por isso.
   *
   * A coluna aceita qualquer `^[A-Z]{2}$` (o CHECK do banco é de forma, não de
   * conteúdo), justamente para a carga do cadastro legado não travar numa
   * sigla estranha. `UFS` tem as 27 de verdade, então o que sobra já é dado
   * ruim — mas sem esta checagem o `<select>` cairia calado na primeira opção
   * e trocaria a sigla estranha por outra ao salvar. Cair em "Não informado"
   * pelo menos MOSTRA que aquele valor não é uma UF.
   */
  const ufAtual = (UFS as readonly string[]).includes(member.state ?? "")
    ? (member.state as (typeof UFS)[number])
    : "";

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<UpdateMemberInput>({
    resolver: zodResolver(updateMemberSchema),
    defaultValues: {
      memberId: member.id,
      fullName: member.fullName,
      status: member.status,
      profileType: member.profileType ?? "",
      code: member.code ?? "",
      // As máscaras entram já formatadas: o banco guarda dígitos, e mostrar
      // "54991234567" numa caixa de telefone é pedir para alguém "arrumar".
      whatsapp: member.whatsapp ? formatWhatsapp(member.whatsapp) : "",
      email: member.email ?? "",
      city: member.city ?? "",
      state: ufAtual,
      organization: member.organization ?? "",
      farmName: member.farmName ?? "",
      productionCity: member.productionCity ?? "",
      sowCount: member.sowCount === null ? "" : String(member.sowCount),
      cnpj: member.cnpj ? formatCnpj(member.cnpj) : "",
      stateRegistration: member.stateRegistration ?? "",
      activityArea: member.activityArea ?? "",
      jobTitle: member.jobTitle ?? "",
      legalName: member.legalName ?? "",
      tradeName: member.tradeName ?? "",
      interests: member.interests,
      otherInterest: member.otherInterest ?? "",
      joinedAt: member.joinedAt ?? "",
      notes: member.notes ?? "",
    },
  });

  const interesses = watch("interests") ?? [];

  /**
   * ⚠️ AS CAIXAS DE INTERESSE SÃO A UNIÃO da lista atual com o que o associado
   * JÁ TEM gravado. Só `INTEREST_OPTIONS` faria um interesse antigo — de uma
   * versão anterior da lista, ou vindo da carga — desaparecer da tela e ser
   * apagado no primeiro "Salvar", sem ninguém ter pedido.
   */
  const opcoesInteresse = [
    ...INTEREST_OPTIONS,
    ...member.interests.filter((i) => !(INTEREST_OPTIONS as readonly string[]).includes(i)),
  ];

  useUnsavedGuard(isDirty && !isPending);

  // O aviso de "salvo" some assim que a pessoa mexe em qualquer coisa: um
  // "alterações salvas" parado na tela sobre um formulário já modificado diz
  // exatamente o contrário do que está acontecendo.
  useEffect(() => {
    if (isDirty) setSaved(false);
  }, [isDirty]);

  function alternarInteresse(valor: string, marcado: boolean) {
    const atual = interesses ?? [];
    setValue("interests", marcado ? [...atual, valor] : atual.filter((i) => i !== valor), {
      shouldDirty: true,
    });
  }

  function onSubmit(values: UpdateMemberInput) {
    setFormError(null);

    startTransition(async () => {
      const result = await updateMemberAction(values);

      if (!result.ok) {
        // O formulário NÃO é limpo nem recarregado: vinte campos preenchidos
        // não podem sumir porque o servidor recusou um deles.
        setFormError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setSaved(true);
      // `refresh` e não `push`: a pessoa continua na ficha, e o que precisa
      // mudar é o cabeçalho (nome, situação, histórico) que o servidor desenha.
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <input type="hidden" {...register("memberId")} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identificação</CardTitle>
          <CardDescription>
            Só o nome é obrigatório. O resto pode ficar vazio — o registro guarda cadastros antigos,
            que quase nunca vêm completos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.fullName} label="Nome completo" required error={errors.fullName?.message}>
            <Input id={ids.fullName} aria-invalid={!!errors.fullName} {...register("fullName")} />
          </Field>

          <Field
            id={ids.code}
            label="Matrícula"
            error={errors.code?.message}
            hint="O código do associado na APCS, se houver."
          >
            <Input id={ids.code} aria-invalid={!!errors.code} {...register("code")} />
          </Field>

          <Field id={ids.status} label="Situação" required error={errors.status?.message}>
            <Select id={ids.status} {...register("status")}>
              {MEMBER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {MEMBER_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={ids.profileType}
            label="Perfil"
            error={errors.profileType?.message}
            hint="É por aqui que a divulgação de eventos decide quem recebe o quê."
          >
            <Select id={ids.profileType} {...register("profileType")}>
              <option value="">Não definido</option>
              {MEMBERSHIP_PROFILE_TYPES.map((perfil) => (
                <option key={perfil} value={perfil}>
                  {MEMBERSHIP_PROFILE_TYPE_LABELS[perfil]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={ids.joinedAt}
            label="Associado desde"
            error={errors.joinedAt?.message}
            hint="A data real de associação — não a data em que o cadastro entrou no sistema."
          >
            <Input id={ids.joinedAt} type="date" {...register("joinedAt")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contato</CardTitle>
          <CardDescription>
            O WhatsApp é o número que recebe a divulgação de eventos e as enquetes. Telefone fixo é
            aceito no cadastro, mas não recebe mensagem.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.whatsapp} label="WhatsApp" error={errors.whatsapp?.message}>
            <Input
              id={ids.whatsapp}
              type="tel"
              inputMode="tel"
              placeholder="(54) 99123-4567"
              aria-invalid={!!errors.whatsapp}
              {...register("whatsapp", {
                // A máscara é aplicada enquanto se digita; o que vai para o
                // banco são os dígitos, extraídos na action.
                onChange: (event) => {
                  event.target.value = formatWhatsapp(event.target.value);
                },
              })}
            />
          </Field>

          <Field
            id={ids.email}
            label="E-mail"
            error={errors.email?.message}
            hint="O registro não aceita o mesmo e-mail em dois associados."
          >
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
          </Field>

          <Field id={ids.city} label="Cidade" error={errors.city?.message}>
            <Input id={ids.city} aria-invalid={!!errors.city} {...register("city")} />
          </Field>

          <Field id={ids.state} label="Estado" error={errors.state?.message}>
            <Select id={ids.state} {...register("state")}>
              <option value="">Não informado</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={ids.organization}
            label="Empresa ou entidade"
            error={errors.organization?.message}
            wide
          >
            <Input id={ids.organization} {...register("organization")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do perfil</CardTitle>
          <CardDescription>
            Todos os campos aparecem sempre, independentemente do perfil escolhido — é o que permite
            corrigir o perfil e os dados dele na mesma passada. Preencha só o que se aplica.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field id={ids.farmName} label="Nome da granja" error={errors.farmName?.message}>
            <Input id={ids.farmName} {...register("farmName")} />
          </Field>

          <Field
            id={ids.productionCity}
            label="Município da produção"
            error={errors.productionCity?.message}
          >
            <Input id={ids.productionCity} {...register("productionCity")} />
          </Field>

          <Field id={ids.sowCount} label="Número de matrizes" error={errors.sowCount?.message}>
            <Input
              id={ids.sowCount}
              type="number"
              inputMode="numeric"
              min={0}
              aria-invalid={!!errors.sowCount}
              {...register("sowCount")}
            />
          </Field>

          <Field id={ids.cnpj} label="CNPJ" error={errors.cnpj?.message}>
            <Input
              id={ids.cnpj}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              aria-invalid={!!errors.cnpj}
              {...register("cnpj", {
                onChange: (event) => {
                  event.target.value = formatCnpj(event.target.value);
                },
              })}
            />
          </Field>

          <Field
            id={ids.stateRegistration}
            label="Inscrição estadual"
            error={errors.stateRegistration?.message}
          >
            <Input id={ids.stateRegistration} {...register("stateRegistration")} />
          </Field>

          <Field id={ids.legalName} label="Razão social" error={errors.legalName?.message}>
            <Input id={ids.legalName} {...register("legalName")} />
          </Field>

          <Field id={ids.tradeName} label="Nome fantasia" error={errors.tradeName?.message}>
            <Input id={ids.tradeName} {...register("tradeName")} />
          </Field>

          <Field id={ids.activityArea} label="Área de atuação" error={errors.activityArea?.message}>
            <Input id={ids.activityArea} {...register("activityArea")} />
          </Field>

          <Field id={ids.jobTitle} label="Cargo ou função" error={errors.jobTitle?.message}>
            <Input id={ids.jobTitle} {...register("jobTitle")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interesses e observações</CardTitle>
          <CardDescription>
            O que a APCS sabe sobre o que este associado acompanha, e o que o time precisa lembrar
            sobre ele.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Interesses</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {opcoesInteresse.map((opcao) => (
                <label key={opcao} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="border-input accent-primary h-4 w-4 rounded"
                    checked={interesses.includes(opcao)}
                    onChange={(event) => alternarInteresse(opcao, event.target.checked)}
                  />
                  {opcao}
                </label>
              ))}
            </div>
            {errors.interests?.message && (
              <p role="alert" className="text-destructive text-sm">
                {errors.interests.message}
              </p>
            )}
          </fieldset>

          <Field
            id={ids.otherInterest}
            label="Outro interesse"
            error={errors.otherInterest?.message}
          >
            <Input id={ids.otherInterest} {...register("otherInterest")} />
          </Field>

          <Field
            id={ids.notes}
            label="Observações"
            error={errors.notes?.message}
            hint="Uso interno. Não aparece para o associado."
          >
            <Textarea id={ids.notes} rows={4} {...register("notes")} />
          </Field>
        </CardContent>
      </Card>

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}

      {saved && !formError && (
        <p role="status" className="text-sm font-medium">
          Alterações salvas.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={isPending} disabled={!isDirty && !formError}>
          {isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => router.back()}>
          Voltar
        </Button>
        <p className="text-muted-foreground w-full text-xs">
          Campo deixado em branco apaga o dado que estava lá.
        </p>
      </div>
    </form>
  );
}

/**
 * Proteção contra perda acidental — a mesma de Palestras, com o mesmo limite
 * honesto: `beforeunload` cobre fechar a aba, recarregar e sair do app, mas NÃO
 * intercepta a navegação interna do App Router, que não expõe gancho para
 * bloquear rota. Clicar num item do menu ainda perde o rascunho.
 */
function useUnsavedGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

/** Um campo: rótulo, controle, dica e erro sempre na mesma ordem. */
function Field({
  id,
  label,
  required,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
