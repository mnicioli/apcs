"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateLeadStatusAction } from "@/lib/actions/leads";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { leadStatusFormSchema, type LeadStatusFormData } from "@/modules/chat/chat.schema";
import { LEAD_STATUS_LABELS } from "@/modules/chat/chat.labels";
import { LEAD_STATUSES } from "@/modules/chat/chat.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Gestão do lead pelo time comercial. Segue o padrão de referência
 * (`profile-form.tsx`): React Hook Form + Zod + Server Action + ActionResult.
 */
export function LeadStatusForm({
  leadId,
  defaultStatus,
  defaultNotes,
}: {
  leadId: string;
  defaultStatus: LeadStatusFormData["status"];
  defaultNotes: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadStatusFormData>({
    resolver: zodResolver(leadStatusFormSchema),
    defaultValues: { status: defaultStatus, notes: defaultNotes },
  });

  function onSubmit(values: LeadStatusFormData) {
    setFeedback(null);
    startTransition(async () => {
      const result = await updateLeadStatusAction(leadId, values);
      if (result.ok) {
        setFeedback({ type: "success", text: "Lead atualizado com sucesso." });
      } else {
        setFeedback({ type: "error", text: ACTION_ERROR_MESSAGES[result.error.code] });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        {errors.status && (
          <p role="alert" className="text-destructive text-sm">
            {errors.status.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Observações</Label>
        <Textarea
          id="notes"
          rows={4}
          aria-invalid={!!errors.notes}
          placeholder="Registre o que foi combinado com o contato."
          {...register("notes")}
        />
        {errors.notes && (
          <p role="alert" className="text-destructive text-sm">
            {errors.notes.message}
          </p>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={
            feedback.type === "success" ? "text-primary-strong text-sm" : "text-destructive text-sm"
          }
        >
          {feedback.text}
        </p>
      )}

      <Button type="submit" loading={isPending} disabled={isPending}>
        Salvar
      </Button>
    </form>
  );
}
