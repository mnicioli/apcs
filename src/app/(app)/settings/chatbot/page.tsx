import type { Metadata } from "next";
import Link from "next/link";
import { getAppSettings, readSetting } from "@/lib/services/admin";
import { SETTING_KEYS, SETTING_LABELS } from "@/modules/admin/admin.labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getIntelligenceDailyMetrics,
  getIntelligenceIntentTotals,
  getUnknownQuestions,
} from "@/lib/services/intelligence-metrics";
import { ChatbotMetrics } from "./chatbot-metrics";
import { SettingEditor } from "../setting-editor";

export const metadata: Metadata = { title: "Chatbot — Configurações" };

/**
 * AS FRASES QUE O ROBÔ DIZ QUANDO NÃO ESTÁ ENTREGANDO CONTEÚDO.
 *
 * ⚠️ O QUE **NÃO** ESTÁ AQUI É O PONTO DA TELA. Nenhuma resposta de conteúdo se
 * escreve nesta página: o valor da Bolsa vem do boletim ativo, a normativa vem
 * da versão publicada, e as respostas escritas ("qual o horário de atendimento?")
 * vêm da Base de Conhecimento. Aqui ficam só as frases de ENQUADRAMENTO — a
 * saudação, os desfechos em que não há conteúdo a entregar, a despedida e o
 * menu de emergência —, mais a chave geral e o painel de acompanhamento.
 *
 * A divisão importa porque é ela que impede o caminho fácil e errado: colar a
 * resposta do momento numa dessas caixas. Um texto colado aqui não tem versão,
 * não tem vigência, não tem trilha de quem publicou — e ninguém nunca mais o
 * revisa, porque ele não aparece em lista nenhuma de conteúdo.
 *
 * Todas vêm de `app_settings`, a mesma tabela da confirmação de saída: RLS,
 * `set_app_setting` com auditoria e um padrão escrito no código para o caso de
 * a linha não existir (`SETTING_FALLBACKS`).
 */
export default async function SettingsChatbotPage() {
  const [settings, dias, intencoes, perguntas] = await Promise.all([
    getAppSettings(),
    getIntelligenceDailyMetrics(),
    getIntelligenceIntentTotals(),
    getUnknownQuestions(),
  ]);

  const campo = (key: (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]) => (
    <SettingEditor
      key={key}
      settingKey={key}
      label={SETTING_LABELS[key].title}
      help={SETTING_LABELS[key].help}
      value={readSetting(settings, key)}
    />
  );

  return (
    <div className="space-y-6">
      {/* ⚠️ O PAINEL VEM PRIMEIRO, e a ordem é uma escolha. Quem abre esta tela
          quase sempre vem consertar alguma coisa — e o que dizer ao robô só faz
          sentido depois de ver o que as pessoas estão perguntando. */}
      <ChatbotMetrics dias={dias} intencoes={intencoes} perguntas={perguntas} />

      <Card>
        <CardHeader>
          <CardTitle>Operação</CardTitle>
        </CardHeader>
        <CardContent>{campo(SETTING_KEYS.chatbotEnabled)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abertura da conversa</CardTitle>
        </CardHeader>
        <CardContent>{campo(SETTING_KEYS.chatbotWelcome)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quando o robô não entrega conteúdo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            As quatro parecem a mesma coisa e não são. <strong>Não entendi</strong> é o robô sem
            saber o que a pessoa quer; <strong>nada publicado</strong> é ele tendo entendido e a
            APCS não ter o que enviar agora; <strong>falha na consulta</strong> é o sistema com
            problema; <strong>telefone não reconhecido</strong> é a resposta depender de saber quem
            está perguntando. Textos iguais fariam a equipe atender sem saber qual dos quatro
            aconteceu — e cada um é trabalho de uma pessoa diferente.
          </div>

          {campo(SETTING_KEYS.chatbotFallback)}
          {campo(SETTING_KEYS.chatbotNoResult)}
          {campo(SETTING_KEYS.chatbotError)}
          {campo(SETTING_KEYS.chatbotUnidentified)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Atendimento humano</CardTitle>
        </CardHeader>
        <CardContent>{campo(SETTING_KEYS.chatbotHumanHandoff)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Despedida e emergência</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {campo(SETTING_KEYS.chatbotClosing)}
          {campo(SETTING_KEYS.chatbotMenu)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>E as respostas de verdade?</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            O que o chatbot responde sobre horário, contato e como funciona cada processo mora na{" "}
            <Link href="/knowledge" className="text-foreground underline underline-offset-4">
              Base de Conhecimento
            </Link>
            , onde cada resposta tem status, vigência e trilha de quem escreveu.
          </p>
          <p>
            Bolsa, normativas e comunicados continuam saindo dos módulos próprios: o robô consulta a
            publicação vigente na hora, e nunca uma cópia.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
