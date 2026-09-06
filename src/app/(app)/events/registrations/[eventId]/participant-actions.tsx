"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { updateCompanyAction, updateParticipantAction } from "@/lib/actions/event-landing";
import { formatPhoneInput } from "@/lib/format/phone";
import { formatDateTime } from "@/lib/utils";
import {
  PARTICIPANT_CONFIRMATION_LABELS,
  REGISTRATION_ORIGIN_LABELS,
} from "@/modules/event/event.landing.labels";
import { updateParticipantSchema } from "@/modules/event/event.landing.schema";
import type {
  ParticipantConfirmation,
  RegistrationBoardRow,
} from "@/modules/event/event.landing.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * AS AÇÕES DE UMA LINHA — ver a inscrição (§17) e editar a ficha (§13).
 *
 * ⚠️ NÃO HÁ "EXCLUIR", E NÃO É ESQUECIMENTO (§16). "Não criar exclusão física.
 * Não criar botão Excluir participante nem Excluir inscrição." Não existe action
 * de exclusão neste módulo, não existe função no banco e o DELETE está revogado
 * nas três tabelas desde o Prompt 1 — este arquivo não teria o que chamar.
 *
 * ⚠️ DOIS FORMULÁRIOS SEPARADOS, e é o modelo de dados aparecendo na tela. A
 * GRANJA é da INSCRIÇÃO e vale para todos os participantes dela; o resto é da
 * PESSOA. Um formulário só faria parecer que mudar a granja do João mudaria só
 * a dele — quando ela é a mesma da Maria e do Pedro na mesma inscrição. O aviso
 * está escrito no diálogo, e não só neste comentário.
 */
export function ParticipantActions({
  eventId,
  row,
  canWrite,
}: {
  eventId: string;
  row: RegistrationBoardRow;
  canWrite: boolean;
}) {
  const [vendo, setVendo] = useState(false);
  const [editando, setEditando] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setVendo(true)}>
        <Eye className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Ver</span>
      </Button>

      {canWrite && (
        <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Editar</span>
        </Button>
      )}

      <RegistrationDialog open={vendo} onClose={() => setVendo(false)} row={row} />

      {canWrite && (
        <ParticipantDialog
          open={editando}
          onClose={() => setEditando(false)}
          eventId={eventId}
          row={row}
        />
      )}
    </div>
  );
}

/**
 * §17 — a inscrição e as pessoas dela.
 *
 * ⚠️ MOSTRA A LINHA QUE JÁ VEIO, e não busca a inscrição inteira. A grid é de
 * PARTICIPANTES: abrir a ficha de um deles e disparar uma consulta para trazer
 * os irmãos seria uma ida ao banco por clique, num diálogo que existe para
 * conferir um dado de olho. Quem quer ver a granja inteira ordena por
 * "Granja / Empresa" ou busca pelo nome dela — as pessoas ficam juntas.
 */
function RegistrationDialog({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: RegistrationBoardRow;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Inscrição" description={row.companyName}>
      <dl className="space-y-3 text-sm">
        <Campo rotulo="Granja / Empresa" valor={row.companyName} />
        <Campo rotulo="Participante" valor={row.fullName} />
        <Campo rotulo="E-mail" valor={row.email} />
        <Campo rotulo="Telefone" valor={row.phone ?? "—"} />
        <Campo rotulo="WhatsApp" valor={row.whatsapp ?? "—"} />
        <Campo rotulo="Confirmado" valor={PARTICIPANT_CONFIRMATION_LABELS[row.confirmation]} />
        <Campo rotulo="Data da inscrição" valor={formatDateTime(row.registeredAt)} />
        {/* De onde veio: a página pública ou o cadastro manual. É o §36 do
            Prompt 3 chegando à tela de quem opera. */}
        <Campo rotulo="Origem" valor={REGISTRATION_ORIGIN_LABELS[row.origin]} />
      </dl>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="break-words">{valor}</dd>
    </div>
  );
}

type Erros = Record<string, string | undefined>;

/**
 * §13, §14, §15 — a ficha editável.
 *
 * ⚠️ O SCHEMA É O MESMO DO CADASTRO PÚBLICO (`updateParticipantSchema` estende
 * `participantSchema`). O §13 pede exatamente isso: "utilizar as mesmas regras e
 * validações do cadastro público". Duas listas de regras parecidas é como as
 * duas portas passariam a aceitar coisas diferentes da mesma pessoa.
 *
 * ⚠️ E NENHUMA DELAS É A ÚLTIMA BARREIRA. A duplicidade de e-mail (§14) só pode
 * ser respondida pelo banco — `update_event_participant` a confere
 * DESCONSIDERANDO o próprio participante, e o índice único é a garantia final
 * contra duas edições simultâneas.
 */
function ParticipantDialog({
  open,
  onClose,
  eventId,
  row,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  row: RegistrationBoardRow;
}) {
  const router = useRouter();

  const [companyName, setCompanyName] = useState(row.companyName);
  const [fullName, setFullName] = useState(row.fullName);
  const [email, setEmail] = useState(row.email);
  const [phone, setPhone] = useState(row.phone ? formatPhoneInput(row.phone) : "");
  const [whatsapp, setWhatsapp] = useState(row.whatsapp ? formatPhoneInput(row.whatsapp) : "");
  const [confirmation, setConfirmation] = useState<ParticipantConfirmation>(row.confirmation);

  const [erros, setErros] = useState<Erros>({});
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [salvando, startTransition] = useTransition();
  const salvandoRef = useRef(false);

  const companyId = `${row.participantId}-company`;
  const nameId = `${row.participantId}-name`;
  const emailId = `${row.participantId}-email`;
  const phoneId = `${row.participantId}-phone`;
  const whatsappId = `${row.participantId}-whatsapp`;
  const confirmationId = `${row.participantId}-confirmation`;

  function salvar() {
    // §23 — o `ref` pega os dois cliques do mesmo quadro; `setState` não pegaria.
    if (salvandoRef.current) return;

    const payload = {
      eventId,
      participantId: row.participantId,
      fullName,
      email,
      phone,
      whatsapp,
      confirmation,
    };

    const conferido = updateParticipantSchema.safeParse(payload);
    if (!conferido.success) {
      const lista: Erros = {};
      for (const problema of conferido.error.issues) {
        const chave = String(problema.path[0] ?? "");
        if (!lista[chave]) lista[chave] = problema.message;
      }
      setErros(lista);
      setErroEnvio(null);
      return;
    }

    if (companyName.trim().length < 2) {
      setErros({ companyName: "Informe a granja ou empresa." });
      return;
    }

    salvandoRef.current = true;
    setErros({});
    setErroEnvio(null);

    startTransition(async () => {
      try {
        // ⚠️ A GRANJA SÓ É ENVIADA SE MUDOU. Ela é da INSCRIÇÃO: mandá-la a cada
        // salvamento gravaria uma linha de auditoria "companyName: X → X" toda
        // vez que alguém corrigisse um telefone.
        if (companyName.trim() !== row.companyName) {
          const empresa = await updateCompanyAction({
            eventId,
            registrationId: row.registrationId,
            companyName,
          });
          if (!empresa.ok) {
            setErroEnvio(ACTION_ERROR_MESSAGES[empresa.error.code]);
            return;
          }
        }

        const resultado = await updateParticipantAction(conferido.data);
        if (!resultado.ok) {
          setErroEnvio(ACTION_ERROR_MESSAGES[resultado.error.code]);
          return;
        }

        router.refresh();
        onClose();
      } catch {
        setErroEnvio("Não foi possível salvar. Verifique sua conexão e tente novamente.");
      } finally {
        salvandoRef.current = false;
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar participante"
      description="As mesmas regras do formulário público valem aqui."
    >
      <div className="space-y-4">
        {erroEnvio && (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {erroEnvio}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor={companyId}>Granja / Empresa</Label>
          <Input
            id={companyId}
            value={companyName}
            disabled={salvando}
            aria-invalid={erros["companyName"] ? true : undefined}
            onChange={(evento) => setCompanyName(evento.target.value)}
          />
          {/* ⚠️ O AVISO É PARTE DA FUNCIONALIDADE. Sem ele, alguém corrige o
              nome da granja achando que mexe só na linha do João — e muda o de
              todo mundo daquela inscrição. */}
          <p className="text-muted-foreground text-xs">
            Vale para todos os participantes desta inscrição.
          </p>
          {erros["companyName"] && (
            <p className="text-destructive text-xs">{erros["companyName"]}</p>
          )}
        </div>

        <CampoTexto
          id={nameId}
          label="Nome do participante"
          value={fullName}
          disabled={salvando}
          error={erros["fullName"]}
          onChange={setFullName}
        />

        <CampoTexto
          id={emailId}
          label="E-mail"
          type="email"
          value={email}
          disabled={salvando}
          error={erros["email"]}
          onChange={setEmail}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            id={phoneId}
            label="Telefone"
            type="tel"
            value={phone}
            disabled={salvando}
            error={erros["phone"]}
            onChange={(valor) => setPhone(formatPhoneInput(valor))}
          />
          <CampoTexto
            id={whatsappId}
            label="WhatsApp"
            type="tel"
            value={whatsapp}
            disabled={salvando}
            error={erros["whatsapp"]}
            onChange={(valor) => setWhatsapp(formatPhoneInput(valor))}
          />
        </div>

        {/* §15 — a regra combinada, dita antes de o botão recusar. */}
        <p className="text-muted-foreground text-xs">
          Informe telefone ou WhatsApp: pelo menos um dos dois é obrigatório.
        </p>

        <div className="space-y-2">
          <Label htmlFor={confirmationId}>Confirmado</Label>
          <Select
            id={confirmationId}
            value={confirmation}
            disabled={salvando}
            onChange={(evento) => setConfirmation(evento.target.value as ParticipantConfirmation)}
          >
            <option value="confirmed">{PARTICIPANT_CONFIRMATION_LABELS.confirmed}</option>
            <option value="not_confirmed">{PARTICIPANT_CONFIRMATION_LABELS.not_confirmed}</option>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function CampoTexto({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (valor: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erro` : undefined}
        onChange={(evento) => onChange(evento.target.value)}
      />
      {error && (
        <p id={`${id}-erro`} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
