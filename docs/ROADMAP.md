# Roadmap — Plataforma de Atendimento Inteligente APCS

O objetivo deste projeto é desenvolver uma plataforma completa de atendimento inteligente para a APCS, utilizando WhatsApp, IA (LLM) e um Backoffice próprio para gerenciamento das conversas, filas de atendimento, SLAs e operação humana.

O projeto será desenvolvido em fases incrementais, priorizando primeiro a construção da plataforma e, posteriormente, os fluxos de negócio.

A ordem das fases é extremamente importante. Os fluxos de atendimento dependem da infraestrutura da plataforma, e os módulos analíticos dependem dos dados gerados durante a operação.

---

# Fase 1 — Fundação da Plataforma

Esta fase cria toda a infraestrutura necessária para suportar o atendimento inteligente.

| # | Módulo | Rota | Essência |
|---|---------------------------|------------------------|-------------------------------------------------------------|
| 1 | Autenticação e RBAC | /auth | Login, usuários, perfis e permissões |
| 2 | Contatos | /contacts | Cadastro automático dos usuários do WhatsApp |
| 3 | Conversas | /conversations | Histórico completo das conversas |
| 4 | Tickets | /tickets | Criação, status e ciclo de vida dos atendimentos |
| 5 | Filas | /queues | Distribuição dos atendimentos por fila |
| 6 | SLA | /sla | Controle de tempos, alertas e vencimentos |
| 7 | Mensagens | /messages | Histórico de mensagens e anexos |
| 8 | Auditoria | /audit | Registro de todas as ações da plataforma |

Objetivo da fase:

Construir toda a base operacional da plataforma antes da utilização da IA.

---

# Fase 2 — Motor de IA

Nesta fase será construída toda a inteligência responsável por interpretar, classificar e conduzir as conversas.

| # | Módulo | Rota | Essência |
|---|---------------------------|------------------------|-------------------------------------------------------------|
| 9 | Orquestrador LLM | /ai/orchestrator | Identificação de intenção e roteamento |
| 10 | Memória Conversacional | /ai/memory | Memória do usuário e contexto das conversas |
| 11 | Prompt Manager | /ai/prompts | Administração dos prompts utilizados pela IA |
| 12 | Knowledge Base | /knowledge | Base de conhecimento utilizada pelo LLM |
| 13 | Classificação Automática | /classification | Categoria, prioridade, resumo e fila |
| 14 | Resumo Inteligente | /summaries | Resumo automático para os operadores |
| 15 | Transferência Humana | /handoff | Encaminhamento automático para atendimento humano |

Objetivo da fase:

Entregar um chatbot inteligente capaz de interpretar conversas naturalmente e encaminhar corretamente cada atendimento.

---

# Fase 3 — Backoffice

Esta fase entrega a plataforma utilizada pela equipe da APCS.

| # | Módulo | Rota | Essência |
|---|---------------------------|------------------------|-------------------------------------------------------------|
| 16 | Dashboard | /dashboard | Indicadores operacionais |
| 17 | Central de Atendimento | /attendances | Atendimento humano em tempo real |
| 18 | Gestão de Tickets | /tickets/manage | Pesquisa, filtros e acompanhamento |
| 19 | Gestão de Usuários | /users | Operadores, supervisores e administradores |
| 20 | Configuração de Filas | /queues/manage | Administração das filas |
| 21 | Configuração de SLA | /sla/manage | Administração dos tempos de atendimento |
| 22 | Configurações Gerais | /settings | Configuração da plataforma |

Objetivo da fase:

Disponibilizar toda a operação humana da APCS.

---

# Fase 4 — Fluxos de Atendimento APCS

Com toda a plataforma pronta, serão implementados os fluxos de negócio.

| # | Fluxo | Rota |
|---|-----------------------------|------------------------------|
| 23 | Boas-vindas | /flows/welcome |
| 24 | CSP | /flows/csp |
| 25 | Eventos | /flows/events |
| 26 | Filiação | /flows/membership |
| 27 | Bolsa de Suínos | /flows/market |
| 28 | Selo Suíno Paulista | /flows/seal |
| 29 | Imprensa e Parcerias | /flows/press |
| 30 | Atendimento Humano | /flows/human |
| 31 | Consentimento LGPD | /flows/lgpd |
| 32 | Encerramento | /flows/closing |

Objetivo da fase:

Implementar cada fluxo de atendimento de forma independente, permitindo homologação individual.

---

# Fase 5 — Inteligência Operacional

Após a plataforma entrar em operação serão adicionados recursos analíticos.

| # | Módulo | Rota | Essência |
|---|---------------------------|------------------------|-------------------------------------------------------------|
| 33 | Analytics | /analytics | Indicadores operacionais |
| 34 | Relatórios | /reports | Exportações e relatórios |
| 35 | Monitoramento | /monitoring | Saúde da plataforma |
| 36 | IA Consultiva | /assistant | Consultas em linguagem natural |
| 37 | Dashboard Executivo | /executive | Indicadores consolidados |
| 38 | Logs Inteligentes | /logs | Pesquisa e análise das conversas |

Objetivo da fase:

Transformar os dados gerados pela operação em inteligência para gestão da APCS.

---

# Arquitetura do Projeto

WhatsApp
    │
    ▼
API Oficial Meta
    │
    ▼
Gateway de Mensagens
    │
    ▼
Motor Conversacional (LLM)
    │
    ├── Memória Conversacional
    ├── Prompt Manager
    ├── Knowledge Base
    ├── Classificação
    ├── Resumo
    └── Transferência
    │
    ▼
Motor de Atendimento
    │
    ├── Conversas
    ├── Tickets
    ├── Filas
    ├── SLA
    ├── Auditoria
    └── Banco de Dados
    │
    ▼
Backoffice APCS
    │
    ├── Dashboard
    ├── Atendimento
    ├── Gestão de Tickets
    ├── Configurações
    ├── Usuários
    └── Relatórios

---

# Princípios do Projeto

1. Plataforma antes dos fluxos.

Toda a infraestrutura será construída antes da implementação dos fluxos de atendimento.

2. Um módulo por Pull Request.

Cada entrega deve possuir escopo bem definido, facilitando revisão e homologação.

3. Fluxos independentes.

Cada fluxo da APCS será implementado como um módulo independente, permitindo evolução sem impacto nos demais.

4. IA como orquestradora.

O LLM será responsável por:

- interpretar intenção;
- identificar mudança de contexto;
- classificar prioridade;
- gerar resumo;
- selecionar a fila de atendimento;
- transferir para operador quando necessário.

5. Atendimento humano prioritário.

Após a transferência, o operador assume totalmente a conversa e será responsável pelo encerramento do atendimento.

6. Memória híbrida.

A plataforma armazenará:

- Dados estruturados (nome, telefone, empresa, categoria etc.);
- Memória resumida das conversas;
- Histórico completo das mensagens.

7. Auditoria completa.

Toda decisão tomada pela IA deverá ser registrada:

- intenção detectada;
- prioridade atribuída;
- fila escolhida;
- resumo gerado;
- operador responsável;
- tempos de SLA.

8. Arquitetura escalável.

Toda a plataforma deverá permitir a inclusão futura de:

- novos fluxos;
- novos canais (Portal, Instagram, Telegram, Facebook Messenger etc.);
- novas bases de conhecimento;
- novos modelos de IA.

9. Desenvolvimento incremental.

Cada fase deverá estar completamente funcional antes do início da próxima.

10. Qualidade.

Todo módulo deverá seguir o padrão:

Migration
→ Repository
→ Service
→ Action
→ API
→ Frontend
→ Testes
→ Homologação

Nenhum módulo será considerado concluído sem testes, homologação e documentação técnica.