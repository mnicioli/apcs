"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileAction } from "@/lib/actions/profile";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { profileFormSchema, type ProfileFormData } from "@/modules/profile/profile.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Formulário de edição de perfil — REFERÊNCIA do fluxo de escrita no client:
 * React Hook Form + Zod (mesmo schema do server) + chamada da Server Action +
 * tratamento do `ActionResult`. Copie este padrão nos formulários dos módulos.
 */
export function ProfileForm({ defaultFullName }: { defaultFullName: string }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { fullName: defaultFullName },
  });

  function onSubmit(values: ProfileFormData) {
    setFeedback(null);
    startTransition(async () => {
      const result = await updateProfileAction(values);
      if (result.ok) {
        setFeedback({ type: "success", text: "Perfil atualizado com sucesso." });
      } else {
        setFeedback({ type: "error", text: ACTION_ERROR_MESSAGES[result.error.code] });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Nome completo</Label>
        <Input id="fullName" aria-invalid={!!errors.fullName} {...register("fullName")} />
        {errors.fullName && (
          <p role="alert" className="text-destructive text-sm">
            {errors.fullName.message}
          </p>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={
            feedback.type === "success" ? "text-primary text-sm" : "text-destructive text-sm"
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
