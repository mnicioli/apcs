import type { Metadata } from "next";
import { getAppSettings, listConsentTexts, readSetting } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/utils";
import { SETTING_KEYS, SETTING_LABELS } from "@/modules/admin/admin.labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsentPublisher } from "./consent-publisher";
import { SettingEditor } from "./setting-editor";

export const metadata: Metadata = { title: "Textos e LGPD — Configurações" };

/**
 * OS TEXTOS QUE O SISTEMA MANDA — e o de consentimento, que é outra coisa.
 *
 * ⚠️ AS DUAS METADES DESTA TELA FUNCIONAM DE JEITOS DIFERENTES, e a diferença é
 * o ponto:
 *
 *   • A CONFIRMAÇÃO DE SAÍDA é uma configuração: tem um valor, e editar
 *     substitui. Ninguém precisa saber qual era a frase no mês passado.
 *
 *   • O CONSENTIMENTO é um HISTÓRICO. Publicar um texto novo NÃO apaga o
 *     antigo: cada solicitação guarda a versão que a pessoa leu, e uma
 *     autorização só vale para aquele texto. Reescrever a versão de agosto
 *     apagaria a única prova do que quem se cadastrou em agosto aceitou — por
 *     isso o banco recusa (AD003) e a tela só oferece "publicar nova versão".
 */
export default async function SettingsTextsPage() {
  const [settings, consentimentos] = await Promise.all([getAppSettings(), listConsentTexts()]);

  const vigente = consentimentos.find((c) => c.isCurrent);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mensagens automáticas</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingEditor
            settingKey={SETTING_KEYS.optOutConfirmed}
            label={SETTING_LABELS[SETTING_KEYS.optOutConfirmed].title}
            help={SETTING_LABELS[SETTING_KEYS.optOutConfirmed].help}
            value={readSetting(settings, SETTING_KEYS.optOutConfirmed)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consentimento (LGPD)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            Este é o texto que a pessoa aceita no formulário público de associação. Alterá-lo é
            publicar uma <strong>versão nova</strong> — a antiga continua guardada, porque cada
            solicitação aponta para o texto que aquela pessoa realmente leu.
          </div>

          <ConsentPublisher currentBody={vigente?.body ?? ""} />

          <div>
            <h3 className="mb-3 text-sm font-medium">Versões publicadas</h3>
            {consentimentos.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma versão no banco. O formulário está usando o texto padrão do código — sinal
                de que a migration da Administração não foi aplicada.
              </p>
            ) : (
              <ol className="space-y-4">
                {consentimentos.map((texto) => (
                  <li key={texto.version} className="border-border border-l-2 pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{texto.version}</span>
                      {texto.isCurrent && <Badge variant="attention">Em uso</Badge>}
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(texto.createdAt)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">{texto.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
