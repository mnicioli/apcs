"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { createBulletinAction, updateBulletinAction } from "@/lib/actions/market-bulletins";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { bulletinFormSchema } from "@/modules/market/market.schema";
import type { MarketBulletinSummary } from "@/modules/market/market.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Só o que o formulário digita. `chatbotEnabled` é controlado à parte. */
type CamposDigitados = { name: string; description?: string };

const camposDigitadosSchema = bulletinFormSchema.pick({ name: true, description: true });

/**
 * Cadastro e edição de uma Bolsa, num componente só.
 *
 * As duas telas têm os mesmos três campos e as mesmas validações; o que muda é
 * o título, o texto do botão e a action chamada — e tudo isso cabe em `bulletin`
 * ser `null` ou não.
 *
 * É o que impede a lista de virar um enum no código: a Bolsa de Suínos é uma
 * LINHA no banco, e "Bolsa de Aves" entra por aqui, sem deploy.
 *
 * ⚠️ Nenhum arquivo é tocado aqui. Trocar imagem ou PDF de uma publicação já
 * existente não é edição de cadastro — é uma publicação nova.
 */
export function BulletinFormDialog({ bulletin }: { bulletin?: MarketBulletinSummary | null }) {
  const isEdit = !!bulletin;
  const [open, setOpen] = useState(false);
  const [chatbotEnabled, setChatbotEnabled] = useState(bulletin?.chatbotEnabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameId = useId();
  const descriptionId = useId();
  const chatbotId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CamposDigitados>({
    resolver: zodResolver(camposDigitadosSchema),
    defaultValues: {
      name: bulletin?.name ?? "",
      description: bulletin?.description ?? "",
    },
  });

  // A grid re-renderiza depois de cada operação; sem isto, o diálogo de edição
  // guardaria o valor de antes da última alteração.
  useEffect(() => {
    if (open) setChatbotEnabled(bulletin?.chatbotEnabled ?? true);
  }, [open, bulletin?.chatbotEnabled]);

  function close() {
    if (isPending) return;
    setOpen(false);
    setError(null);
    reset({ name: bulletin?.name ?? "", description: bulletin?.description ?? "" });
  }

  function onSubmit(values: CamposDigitados) {
    setError(null);

    startTransition(async () => {
      const payload = { ...values, chatbotEnabled };
      const result = bulletin
        ? await updateBulletinAction({ ...payload, bulletinId: bulletin.id })
        : await createBulletinAction(payload);

      if (!result.ok) {
        // Nome repetido é o erro mais provável aqui, e "registro duplicado" não
        // diria à pessoa o que fazer.
        setError(
          result.error.code === "uniqueViolation"
            ? "Já existe uma Bolsa com esse nome."
            : ACTION_ERROR_MESSAGES[result.error.code],
        );
        return;
      }

      setOpen(false);
      if (!bulletin) reset({ name: "", description: "" });
    });
  }

  // ⚠️ O aviso só aparece quando a mudança TIRA algo do ar. Ligar não tem
  // consequência que precise de alerta; desligar faz o robô parar de responder
  // sobre a Bolsa, e quem clica precisa ler isso antes de salvar.
  const vaiDesligarChatbot = isEdit && bulletin.chatbotEnabled && !chatbotEnabled;

  return (
    <>
      <Button
        variant={isEdit ? "ghost" : "default"}
        size={isEdit ? "sm" : "default"}
        onClick={() => setOpen(true)}
      >
        {isEdit ? (
          <>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova Bolsa
          </>
        )}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={isEdit ? "Editar Bolsa" : "Nova Bolsa"}
        description={
          isEdit
            ? "Alterar o cadastro não muda nenhuma publicação já enviada."
            : "O cadastro nasce sem publicação. O primeiro envio vira a primeira."
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={nameId}>Nome</Label>
            <Input
              id={nameId}
              aria-invalid={!!errors.name}
              placeholder="Ex.: Bolsa de Suínos"
              {...register("name")}
            />
            {errors.name && (
              <p role="alert" className="text-destructive text-sm">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={descriptionId}>Descrição (opcional)</Label>
            <Textarea
              id={descriptionId}
              rows={3}
              aria-invalid={!!errors.description}
              placeholder="Do que trata este boletim."
              {...register("description")}
            />
            {errors.description && (
              <p role="alert" className="text-destructive text-sm">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-3">
              {/* Caixa de seleção nativa: o design system não tem um componente
                  de interruptor, e inventar um só para este campo criaria um
                  padrão visual que nenhuma outra tela do CRM usa. */}
              <input
                id={chatbotId}
                type="checkbox"
                checked={chatbotEnabled}
                onChange={(event) => setChatbotEnabled(event.target.checked)}
                className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                aria-describedby={`${chatbotId}-ajuda`}
              />
              <div className="space-y-1">
                <Label htmlFor={chatbotId} className="cursor-pointer">
                  Disponível para o chatbot
                </Label>
                <p id={`${chatbotId}-ajuda`} className="text-muted-foreground text-xs">
                  O robô só cita a publicação ativa depois que a vigência dela chega. Desligar aqui
                  o impede de citar esta Bolsa em qualquer caso.
                </p>
              </div>
            </div>

            {vaiDesligarChatbot && (
              <p role="status" className="bg-muted rounded-md p-3 text-sm">
                Ao salvar, esta Bolsa deixará de ser disponibilizada para o chatbot.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              Cancelar
            </Button>
            {/* `loading` já desabilita o botão — dois cliques criariam duas
                bolsas com o mesmo nome, e a segunda morreria no índice único. */}
            <Button type="submit" loading={isPending}>
              {isEdit ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
