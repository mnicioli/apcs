"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFlowAction } from "@/lib/actions/flows";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { FLOW_CHANNEL_LABELS } from "@/modules/flow/flow.labels";
import { flowFormSchema, type FlowFormData } from "@/modules/flow/flow.schema";
import { FLOW_CHANNELS } from "@/modules/flow/flow.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * O CADASTRO DE UM FLUXO — quatro campos, e nenhum deles é o desenho.
 *
 * ⚠️ ELE É CURTO DE PROPÓSITO. A tentação é pedir aqui tudo o que um fluxo tem;
 * mas quem clica em "Novo fluxo" quer chegar ao canvas. Nome, canal e uma frase
 * bastam para o fluxo existir — o resto se descobre desenhando, e todos os
 * campos daqui continuam editáveis depois.
 */
export function NewFlowForm() {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<FlowFormData>({
    name: "",
    description: "",
    channel: "whatsapp",
    isEntry: false,
  });

  function enviar() {
    const parsed = flowFormSchema.safeParse(campos);
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? ACTION_ERROR_MESSAGES.invalidInput);
      return;
    }

    startTransition(async () => {
      setErro(null);
      const resultado = await createFlowAction(parsed.data);

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      // Direto para o desenho: criar um fluxo e cair de volta na lista faria a
      // pessoa procurar o que ela acabou de criar.
      router.push(`/flows/${resultado.data.id}?v=${resultado.data.versionId}`);
    });
  }

  return (
    <Card>
      <CardContent className="max-w-xl space-y-4 p-6">
        <Label className="block space-y-1.5">
          <span className="block">
            Nome <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </span>
          <Input
            value={campos.name}
            maxLength={120}
            placeholder="Triagem inicial"
            onChange={(e) => setCampos({ ...campos, name: e.target.value })}
          />
        </Label>

        <Label className="block space-y-1.5">
          <span className="block">Descrição</span>
          <Textarea
            rows={3}
            value={campos.description}
            maxLength={1000}
            placeholder="Para que serve este fluxo e quando ele entra."
            onChange={(e) => setCampos({ ...campos, description: e.target.value })}
          />
        </Label>

        <Label className="block space-y-1.5">
          <span className="block">Canal</span>
          <Select
            value={campos.channel}
            onChange={(e) =>
              setCampos({ ...campos, channel: e.target.value as FlowFormData["channel"] })
            }
          >
            {FLOW_CHANNELS.map((canal) => (
              <option key={canal} value={canal}>
                {FLOW_CHANNEL_LABELS[canal]}
              </option>
            ))}
          </Select>
        </Label>

        {/* ⚠️ A EXPLICAÇÃO É MAIOR QUE O RÓTULO, e precisa ser. "Fluxo de
            entrada" não diz nada sozinho — e marcá-lo sem entender tira a
            entrada de outro fluxo que já estava funcionando. */}
        <Label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={campos.isEntry}
            onChange={(e) => setCampos({ ...campos, isEntry: e.target.checked })}
          />
          <span>
            Este é o fluxo por onde toda conversa começa
            <span className="text-muted-foreground block text-xs font-normal">
              Só um fluxo por canal pode ser a entrada. Se já houver outro marcado, o cadastro é
              recusado.
            </span>
          </span>
        </Label>

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={enviar} loading={pendente}>
            Criar e desenhar
          </Button>
          <Button variant="outline" onClick={() => router.push("/flows")} disabled={pendente}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
