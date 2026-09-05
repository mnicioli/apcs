"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createLandingPageAction } from "@/lib/actions/event-landing";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { fromLocalInput } from "@/lib/time/local-input";
import { formatCalendarDate } from "@/lib/utils";
import type { EventForLanding } from "@/lib/services/event-landing";
import { LANDING_FIELD_KEYS } from "@/modules/event/event.landing.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * O PRIMEIRO PASSO (§5): escolher o evento.
 *
 * ⚠️ A LISTA JÁ VEM FILTRADA PELO SERVIDOR — só eventos futuros e sem página.
 * Os dois recortes existem porque as duas regras são do BANCO: a segunda página
 * de um evento é recusada com LP005, e publicar a página de um evento vencido é
 * recusado com EV001. Mostrar o evento aqui e recusá-lo no clique seria mandar
 * a pessoa descobrir a regra por tentativa.
 *
 * ⚠️ E A RECUSA CONTINUA PODENDO ACONTECER. Entre carregar esta tela e clicar,
 * outra pessoa pode ter criado a página daquele evento. Por isso a mensagem de
 * LP005 existe e é mostrada aqui — a lista é uma cortesia, não uma garantia.
 *
 * ⚠️ O PRAZO NASCE NO INÍCIO DO EVENTO (§16). É o padrão que faz sentido sem
 * ninguém pensar: as inscrições fecham quando o evento começa. Quem quiser
 * outro muda no Builder, que é onde o campo mora.
 */
export function NewLandingForm({ events }: { events: EventForLanding[] }) {
  const router = useRouter();
  const [eventId, setEventId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectId = useId();

  const escolhido = events.find((evento) => evento.id === eventId) ?? null;

  function criar() {
    if (!escolhido) {
      setErro("Escolha o evento desta página de inscrição.");
      return;
    }
    setErro(null);

    startTransition(async () => {
      const resultado = await createLandingPageAction({
        eventId: escolhido.id,
        slug: "",
        description: "",
        formFields: [...LANDING_FIELD_KEYS],
        successTitle: "",
        successMessage: "",
        successFooter: "",
        // ⚠️ CONVERTIDO NO NAVEGADOR (`fromLocalInput`), porque o horário do
        // evento é hora LOCAL da APCS e o banco guarda um instante absoluto.
        // Montar isto no servidor leria "08:00" como UTC e fecharia as
        // inscrições três horas antes.
        closesAt: fromLocalInput(`${escolhido.eventDate}T${escolhido.startTime}`),
        maxParticipants: "",
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      router.push(`/events/landing-pages/${resultado.data.id}`);
    });
  }

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Não há evento disponível para receber uma página de inscrição. Ou todos os eventos futuros
          já têm a sua, ou não há evento cadastrado com data a partir de hoje.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/events/landing-pages">Voltar</Link>
          </Button>
          <Button asChild>
            <Link href="/events/new">Cadastrar evento</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={selectId}>
          Evento <span aria-hidden="true">*</span>
          <span className="sr-only">(obrigatório)</span>
        </Label>
        <Select
          id={selectId}
          value={eventId}
          disabled={isPending}
          aria-invalid={erro !== null && eventId === ""}
          aria-describedby={`${selectId}-ajuda`}
          onChange={(event) => {
            setEventId(event.target.value);
            setErro(null);
          }}
        >
          <option value="">Selecionar evento</option>
          {events.map((evento) => (
            <option key={evento.id} value={evento.id}>
              {formatCalendarDate(evento.eventDate)} — {evento.name}
            </option>
          ))}
        </Select>
        <p id={`${selectId}-ajuda`} className="text-muted-foreground text-xs">
          Só aparecem eventos com data a partir de hoje que ainda não têm página de inscrição.
        </p>
      </div>

      {/* A confirmação do que foi escolhido, antes de criar. Um seletor com
          trinta eventos e nomes parecidos erra fácil, e a página criada no
          evento errado teria de ser tirada do ar à mão. */}
      {escolhido && (
        <div className="border-border bg-muted/40 space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">{escolhido.name}</p>
          <p className="text-muted-foreground">
            {formatCalendarDate(escolhido.eventDate)} ·{" "}
            {formatTimeRange(escolhido.startTime, escolhido.endTime)}
          </p>
          <p className="text-muted-foreground">{escolhido.location}</p>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" disabled={isPending}>
          <Link href="/events/landing-pages">Cancelar</Link>
        </Button>
        <Button onClick={criar} disabled={isPending || eventId === ""}>
          {isPending ? "Criando…" : "Continuar"}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
