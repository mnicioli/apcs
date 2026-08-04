import { redirect } from "next/navigation";

// A raiz redireciona para o dashboard. Usuários anônimos são interceptados
// antes pelo middleware e mandados para /login.
export default function HomePage() {
  redirect("/dashboard");
}
