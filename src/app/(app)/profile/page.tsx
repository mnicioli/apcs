import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/services/profile";
import { ROLE_LABELS } from "@/lib/rbac/rbac.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Meu perfil</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>E-mail</Label>
            <p className="text-muted-foreground text-sm">{profile.email}</p>
          </div>
          <div className="space-y-2">
            <Label>Papel</Label>
            <p className="text-muted-foreground text-sm">{ROLE_LABELS[profile.role]}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Editar dados</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm defaultFullName={profile.fullName ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
