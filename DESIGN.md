# Design do Bello Flow

Este documento consolida os rascunhos `DESIGN.md`, `DESIGN_E_ESTILOS.md` e
`CODEX_SPEC.md` em uma referência para o quadro do Bello Flow. A composição
de referência é a prova de conceito interativa aprovada, com quatro listas
coloridas, navegação compacta, seletor de Workspace e os modos Claro, Escuro
e Seguir o sistema. A captura `prova_conceito.png` da avaliação visual mostra
o cenário claro em 898 × 675 px. Os nomes, a quantidade de pessoas e o conteúdo
dos cartões da demonstração são exemplos.

O escopo deste contrato é a apresentação e a interação do quadro. Permissões,
dados, ordenação, auditoria e sincronização seguem os contratos de
[produto](docs/produto/escopo-mvp.md),
[autorização](docs/arquitetura/seguranca-e-autorizacao.md) e
[colaboração](docs/arquitetura/colaboracao-tempo-real.md).

## Identidade e aparência

- A marca no quadro combina o símbolo de três barras ascendentes com o nome
  Bello Flow. O ultramarino identifica a marca, a seleção e as ações de
  destaque. Estados como atraso ou conclusão também têm rótulo ou ícone.
- O fundo do quadro, as listas, os cartões e as janelas sobrepostas formam
  níveis distintos. Superfícies opacas preservam a leitura com fotos claras,
  escuras ou movimentadas. Bordas e sombras ajudam a separar os níveis.
- Usar a fonte de interface do app. Dar maior peso ao título do quadro e aos
  títulos dos cartões, com descrição e metadados em tamanho secundário.
  Títulos longos podem quebrar em mais de uma linha. Manter espaçamento
  consistente entre listas, cartões e controles.
- Aparência pessoal oferece **Claro**, **Escuro** e **Seguir o sistema**.
  A preferência do quadro é salva no navegador e vale ao trocar de Workspace
  ou recarregar. O modo de sistema acompanha mudanças na preferência do
  dispositivo.
- **Configurações do quadro → Aparência** reúne a seleção e a restauração da
  foto de fundo. Na homologação atual a foto é temporária na página. Compartilhar
  ou persistir a imagem por quadro requer uma decisão de produto própria.

### Paleta do quadro

| Papel | Claro | Escuro |
| --- | --- | --- |
| Assinatura e seleção | `#2448D4` | `#A6B6FF` |
| Texto principal | `#19233E` | `#F1F3FC` |
| Fundo padrão | `#EAF3F0` | `#171E30` |
| Cartão e janela | `#FFFFFF` | `#20283B` |
| Lista rosa | `#F2D9EC` | `#3B293E` |
| Lista pêssego | `#F7DFC5` | `#433329` |
| Lista azul | `#CFE9EF` | `#23404A` |
| Lista lilás | `#DDDAF5` | `#343352` |
| Lista verde | `#DCEFE3` | `#274236` |

As cores distinguem listas visualmente. O nome da lista continua sendo sua
identificação, e a cor não representa uma regra de fluxo. Etiquetas usam os
nomes e as cores configurados no Workspace. A implementação usa Angular e
SCSS, com os tokens do quadro em
[workspaces-board.scss](apps/web/src/app/workspaces-board.scss) e os estilos
dos cartões e das listas em [board-content.scss](apps/web/src/app/board-content.scss).

## Composição e interação

| Área | Comportamento esperado |
| --- | --- |
| **Barra superior** | Marca e seletor com o nome do Workspace atual lado a lado. O seletor indica a seleção e mostra apenas os espaços acessíveis. A escolha abre os quadros do espaço. O menu fecha ao selecionar, clicar fora, sair com o foco ou pressionar `Esc`. Aparência pessoal e recolhimento da navegação ficam em controles distintos. |
| **Navegação** | Barra lateral compacta, com ícones rotulados e seção atual destacada. O controle de recolher permanece no mesmo lugar. Em tela estreita, a barra pode passar para uma faixa horizontal. |
| **Cabeçalho do quadro** | Contexto do Workspace, título e descrição à esquerda. Participantes e engrenagem à direita, com quebra de linha quando necessário. Mostrar até três iniciais e a contagem real para quem tem acesso à lista. A abertura mostra os identificadores autorizados disponíveis no app. |
| **Engrenagem do quadro** | Reúne aparência do quadro e ações de atividade, gestão e auditoria conforme o acesso vigente. A aparência pessoal tem controle próprio. |
| **Listas** | Colunas coloridas, com nome, contagem e opções por reticências. Cada lista termina após seus cartões e a ação **+ Adicionar**. A criação de lista fica recolhida em **+ Nova lista**. Com muitas listas, a rolagem ocorre dentro do quadro. |
| **Cartões** | Etiquetas acima do título, descrição curta quando disponível e rodapé para prazo, estado e responsáveis existentes. Descrições longas ficam completas nos detalhes. Metadados dependem do conteúdo real e da disponibilidade no produto. |
| **Detalhes do cartão** | Janela sobreposta com descrição e ações de um lado e comentários e atividade do outro. As áreas se empilham em tela estreita. Fechar por botão ou `Esc` devolve o foco ao cartão de origem quando ele ainda existe. |
| **Formulários de criação** | Abrir na lista ou no quadro a partir da ação correspondente. Fechar e limpar após confirmação. Em caso de erro ou resposta incerta, preservar o formulário e o texto digitado para nova tentativa. |

Os exemplos dos rascunhos com checklists, métricas, identificador público
sequencial de cartão e presença ao vivo ficam como referências para decisões
futuras. A ordem dos cartões e a atualização em tempo real usam os mecanismos
já aprovados. A proporção 8:4 dos rascunhos é uma referência para telas amplas,
com espaço suficiente para leitura nas duas áreas.

## Aceite na homologação

Usar uma sessão local isolada com dados sintéticos conforme o
[roteiro de homologação](docs/operacao/homologacao-local.md). Preparar dois
Workspaces acessíveis, um quadro com quatro listas, um quadro com muitas listas
e cartões com títulos longos, descrição, etiqueta, prazo e responsáveis. Usar
uma conta que possa editar e outra com leitura. Comparar a aplicação real com
a composição aprovada, observando que os dados podem variar.

| Verificação | Resultado esperado |
| --- | --- |
| **Composição a 898 × 675 px** | As quatro listas do cenário de referência cabem sem corte horizontal. Marca e seletor permanecem juntos. Participantes e engrenagem ficam no cabeçalho. Descrição e rodapé aparecem nos cartões com dados. Ações de gestão ficam recolhidas. |
| **Tela estreita a 360 px** | A página cabe na largura disponível. A rolagem horizontal, quando necessária, fica restrita ao quadro. Títulos quebram sem sobreposição e as duas áreas da janela se empilham. |
| **Muitas listas e títulos longos** | A última lista é alcançável e os cartões continuam legíveis. É possível abrir um cartão e voltar ao mesmo ponto do quadro. |
| **Seletor de Workspace** | Trocar de espaço leva à lista de quadros do destino. Conferir o fechamento por clique fora, seleção, `Esc` e saída de foco. A navegação pelo teclado entre opções internas mantém o menu aberto. |
| **Nova lista e novo cartão** | Uma criação confirmada aparece uma vez, recolhe o formulário e devolve o foco à ação de origem se ele ainda estiver no formulário. Uma falha controlada mantém o texto e permite nova tentativa. |
| **Temas e fotos** | Comparar claro e escuro com a mesma foto. Conferir superfícies legíveis, foco visível, persistência do tema após recarga, reação à mudança do sistema e restauração do fundo. |
| **Permissões e teclado** | A conta de leitura abre cartões e usa os controles de navegação. Ações de escrita e dados de participantes obedecem às permissões existentes. Os ícones têm nome acessível. Abrir e fechar menus e janelas funciona pelo teclado. |

Registrar versão, navegador, tamanho da janela, tema, perfil de acesso e
resultado de cada cenário. Guardar capturas do quadro e dos detalhes em claro
e escuro, com dados sintéticos. O aceite visual é registrado após comparar
essas evidências com a referência aprovada e resolver as diferenças que
afetam leitura ou interação.
