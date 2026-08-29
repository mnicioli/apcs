import type { Metadata } from "next";
import { listSegments } from "@/lib/services/admin";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentRow } from "./segment-row";

export const metadata: Metadata = { title: "Públicos-alvo — Configurações" };

/**
 * O CATÁLOGO DE PÚBLICOS-ALVO.
 *
 * Antes disto, renomear "Criadores" exigia uma migration e um deploy. O nome é
 * rótulo de tela: ele muda porque a APCS muda como fala com a base, e isso não
 * devia depender de quem sabe escrever SQL.
 *
 * ⚠️ O SLUG NÃO É EDITÁVEL, e a tela mostra isso em vez de esconder. Ele prende
 * os eventos já cadastrados E o mapeamento perfil ↔ público
 * (`profile_for_event_segment`). Renomeá-lo pela tela quebraria os dois sem
 * erro nenhum aparecer: o evento continuaria vinculado a um público que a
 * função de audiência não reconhece mais, e a divulgação alcançaria zero
 * pessoas com toda a confiança.
 *
 * ⚠️ A CONTAGEM DE EVENTOS NÃO É ENFEITE. Desativar um público que dez eventos
 * usam é uma decisão diferente de desativar um que ninguém usa — sem o número,
 * as duas parecem o mesmo clique.
 */
export default async function SettingsSegmentsPage() {
  const publicos = await listSegments();

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        O nome e a descrição aparecem na hora de escolher o público-alvo de um evento. Desativar um
        público não mexe nos eventos que já o usam — ele só deixa de ser oferecido em cadastros
        novos.
      </p>

      <Card>
        <CardContent className="divide-border divide-y p-0">
          {publicos.map((publico) => (
            <SegmentRow key={publico.id} segment={publico} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
