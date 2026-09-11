"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  applyEvaluationTemplateAction,
  saveEvaluationSettingsAction,
} from "@/lib/actions/event-evaluation";
import { delayLabel, responseWindowLabel } from "@/modules/event/event.evaluation.labels";
import type { EvaluationDetail } from "@/modules/event/event.evaluation.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * A CONFIGURAÇÃO DE ENVIO (§9, §22).
 *
 * ⚠️ O ATRASO É EDITADO EM MINUTOS OU HORAS E GUARDADO EM MINUTOS. O §9 fala nas
 * duas unidades, e guardar a unidade ao lado do número obrigaria toda consulta
 * do banco a multiplicar condicionalmente — inclusive a que decide quem recebe
 * agora. A conversão acontece aqui, na única camada em que ela é cosmética.
 *
 * ⚠️ O MODELO SÓ APARECE ANTES DA PRIMEIRA AVALIAÇÃO EXISTIR. Depois disso, o
 * evento tem perguntas próprias e trocar de modelo joga fora o que alguém
 * escreveu — por isso a troca vira um botão separado, com confirmação, e o
 * banco recusa se já houver resposta. Ver `applyEvaluationTemplateAction`.
 */
export function EvaluationSettingsForm({
  detail,
  canWrite,
}: {
  detail: EvaluationDetail;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [habilitada, setHabilitada] = useState(detail.enabled);
  const [unidade, setUnidade] = useState<"minutes" | "hours">(
    // ⚠️ HORAS QUANDO O NÚMERO É REDONDO. Abrir "90 minutos" como "1,5 horas"
    // exigiria campo decimal; abrir "120 minutos" como "120 minutos" faria quem
    // configurou "2 horas" achar que o sistema não guardou o que ele escolheu.
    detail.delayMinutes >= 60 && detail.delayMinutes % 60 === 0 ? "hours" : "minutes",
  );
  const [atraso, setAtraso] = useState(() =>
    detail.delayMinutes >= 60 && detail.delayMinutes % 60 === 0
      ? String(detail.delayMinutes / 60)
      : String(detail.delayMinutes),
  );
  const [temPrazo, setTemPrazo] = useState(detail.responseWindowDays !== null);
  const [prazo, setPrazo] = useState(String(detail.responseWindowDays ?? 7));
  const [modelo, setModelo] = useState(
    detail.templates.find((t) => t.isDefault)?.id ?? detail.templates[0]?.id ?? "",
  );

  const habilitadaId = useId();
  const atrasoId = useId();
  const unidadeId = useId();
  const prazoId = useId();
  const temPrazoId = useId();
  const modeloId = useId();

  const semTermino = detail.endTime === null;
  const minutos = Math.round((Number.parseInt(atraso, 10) || 0) * (unidade === "hours" ? 60 : 1));

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await saveEvaluationSettingsAction({
        eventId: detail.eventId,
        enabled: habilitada,
        delayMinutes: minutos,
        responseWindowDays: temPrazo ? Number.parseInt(prazo, 10) || 7 : null,
        templateId: modelo || null,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      router.refresh();
    });
  }

  function trocarModelo() {
    if (!modelo) return;
    // ⚠️ `confirm` NATIVO, e não um diálogo próprio. Esta ação apaga perguntas
    // escritas à mão, e é rara o bastante para não merecer um componente — o
    // que ela precisa é de um obstáculo, e o navegador já tem um.
    if (
      !window.confirm(
        "Trocar o modelo substitui TODAS as perguntas deste evento pelas do modelo escolhido. As perguntas atuais serão perdidas. Continuar?",
      )
    ) {
      return;
    }

    setErro(null);
    startTransition(async () => {
      const resultado = await applyEvaluationTemplateAction({
        eventId: detail.eventId,
        templateId: modelo,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Envio da avaliação</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!canWrite || pendente} className="space-y-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor={habilitadaId}>Avaliação</Label>
              <Select
                id={habilitadaId}
                value={habilitada ? "on" : "off"}
                onChange={(event) => setHabilitada(event.target.value === "on")}
                className="w-36"
              >
                <option value="off">Desligada</option>
                {/* ⚠️ A OPÇÃO SOME QUANDO NÃO HÁ TÉRMINO. Deixá-la clicável para
                    o banco recusar depois (AV001) faria a pessoa preencher tudo
                    para levar um "não" — o aviso no topo da tela já explicou o
                    que falta e onde. */}
                {!semTermino && <option value="on">Ligada</option>}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={atrasoId}>Enviar após o término</Label>
              <div className="flex gap-2">
                <Input
                  id={atrasoId}
                  type="number"
                  min={0}
                  max={unidade === "hours" ? 168 : 10080}
                  value={atraso}
                  onChange={(event) => setAtraso(event.target.value)}
                  className="w-24"
                />
                <Select
                  id={unidadeId}
                  aria-label="Unidade do atraso"
                  value={unidade}
                  onChange={(event) => setUnidade(event.target.value as "minutes" | "hours")}
                  className="w-32"
                >
                  <option value="minutes">minutos</option>
                  <option value="hours">horas</option>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={temPrazoId}>Prazo para responder</Label>
              <div className="flex gap-2">
                <Select
                  id={temPrazoId}
                  value={temPrazo ? "on" : "off"}
                  onChange={(event) => setTemPrazo(event.target.value === "on")}
                  className="w-32"
                >
                  <option value="off">Sem prazo</option>
                  <option value="on">Com prazo</option>
                </Select>
                {temPrazo && (
                  <div className="flex items-center gap-2">
                    <Input
                      id={prazoId}
                      type="number"
                      min={1}
                      max={365}
                      value={prazo}
                      onChange={(event) => setPrazo(event.target.value)}
                      className="w-20"
                      aria-label="Dias para responder"
                    />
                    <span className="text-muted-foreground text-sm">dias</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* A frase em português do que foi configurado. Os três controles
              acima são precisos e não são legíveis juntos; esta linha é. */}
          <p className="text-muted-foreground text-sm">
            O convite sai <strong>{delayLabel(minutos)}</strong>, com{" "}
            <strong>
              {responseWindowLabel(temPrazo ? Number.parseInt(prazo, 10) || 7 : null)}
            </strong>
            .
          </p>

          {/* ⚠️ O SELETOR DE MODELO SÓ NA PRIMEIRA VEZ (§22). Depois que o
              evento tem avaliação própria, escolher um modelo é DESTRUIR as
              perguntas atuais — e isso vira o botão separado abaixo. */}
          {detail.evaluationId === null && detail.templates.length > 0 && (
            <div className="max-w-md space-y-2">
              <Label htmlFor={modeloId}>Modelo de perguntas</Label>
              <Select
                id={modeloId}
                value={modelo}
                onChange={(event) => setModelo(event.target.value)}
              >
                {detail.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isDefault ? " (padrão APCS)" : ""}
                  </option>
                ))}
              </Select>
              <p className="text-muted-foreground text-xs">
                Ao ligar a avaliação, o modelo é <strong>copiado</strong> para este evento. Editar
                as perguntas aqui não altera o modelo da APCS.
              </p>
            </div>
          )}
        </fieldset>

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}

        {canWrite && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={salvar} disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar configuração"}
            </Button>

            {detail.evaluationId !== null && detail.templates.length > 0 && (
              <div className="flex items-end gap-2">
                <Select
                  aria-label="Modelo para substituir as perguntas"
                  value={modelo}
                  onChange={(event) => setModelo(event.target.value)}
                  className="w-56"
                  disabled={pendente || detail.versionHasAnswers}
                >
                  {detail.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  onClick={trocarModelo}
                  // ⚠️ DESABILITADO COM RESPOSTA (§22). O banco recusa de
                  // qualquer jeito (AV004); o botão apagado evita que alguém
                  // confirme um aviso assustador para levar um "não" depois.
                  disabled={pendente || detail.versionHasAnswers}
                  title={
                    detail.versionHasAnswers
                      ? "Esta avaliação já tem respostas. Edite as perguntas em vez de trocar o modelo."
                      : undefined
                  }
                >
                  Recomeçar do modelo
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
